/* ===== 天天滚动 · 数据持久层 (localStorage) ===== */
(function () {
  'use strict';

  const KEYS = {
    content: 'ttgd.content.v1',
    settings: 'ttgd.settings.v1',
    log: 'ttgd.log.v1',
    lastDate: 'ttgd.lastDate.v1',
    exam: 'ttgd.exam.v1',
    trash: 'ttgd.trash.v1',    // 回收站
    xp: 'ttgd.xp.v1'           // 经验值 / 成就
  };

  const DEFAULT_SETTINGS = {
    dailyNew: 10,          // 每日新学目标
    intervals: [1, 2, 4, 7, 15, 30],  // 艾宾浩斯复习间隔（天）
    theme: 'green',
    themeMode: 'auto',     // auto | light | dark
    examMinutes: 180,      // 整卷考试时长（分钟）
    examCount: 20,         // 整卷考试的题目数量（从题库随机抽取）
    notifyReminder: true, // 每日学习提醒
  };

  function uid() {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayStr(d) {
    const x = d || new Date();
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return todayStr(d);
  }

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('read failed', key, e);
      return fallback;
    }
  }

  function write(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.warn('write failed', key, e);
      // 存储空间不足时提示用户
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
        var msg = '⚠️ 存储空间不足！请导出备份后清理数据（设置 → 重置所有数据）';
        if (typeof toast === 'function') {
          toast(msg);
        } else {
          // fallback：在页面顶部显示
          var banner = document.createElement('div');
          banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#e5484d;color:#fff;text-align:center;padding:10px 16px;font-size:14px;font-weight:600';
          banner.textContent = msg;
          document.body.appendChild(banner);
          setTimeout(function () { banner.remove(); }, 5000);
        }
      }
    }
  }

  let contentCache = null; // 内容内存缓存（性能优化）

  /* ================= CSV / Anki 解析（纯函数，可测试） ================= */

  /** 解析分隔文本为二维数组（处理引号、自定义分隔符、CRLF） */
  function parseCsv(text, delim) {
    delim = delim || ',';
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const s = String(text == null ? '' : text);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === delim) { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
        else if (c === '\r') { /* 忽略 */ }
        else field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(f => String(f).trim() !== ''));
  }

  /** 答案解析：A-D(忽略大小写) 或 1-4 / 0-3 → 选项索引 */
  function parseAnswer(v) {
    if (v == null) return 0;
    const s = String(v).trim().toUpperCase();
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const li = letters.indexOf(s);
    if (li >= 0) return li;
    const n = parseInt(s, 10);
    if (!isNaN(n)) return (n - 1 >= 0 ? n - 1 : 0);
    return 0;
  }

  /**
   * 把 CSV 文本解析为内容条目数组 + 错误信息。
   * 推荐（带表头）：
   *   type,subject,question,optionA,optionB,optionC,optionD,answer,explain
   *   quiz, 生理学, 题干..., A项, B项, C项, D项, A, 解析...
   *   card, 生理学, 正面问题, , , , , , 背面答案
   * 若首行识别为表头则用命名列；否则视为纯题库：subject,question,optA..D,answer,explain（全部按选择题解析）。
   */
  function parseCsvToItems(text) {
    const rows = parseCsv(text);
    if (rows.length === 0) return { items: [], errors: ['未解析到任何数据行'], total: 0 };

    const KNOWN = ['type', 'subject', 'chapter', 'question', 'optiona', 'optionb', 'optionc', 'optiond', 'answer', 'explain', '题干', '章节', '解析', '正面', '背面'];
    const first = rows[0].map(h => h.trim().toLowerCase());
    const hasHeader = first.some(h => KNOWN.indexOf(h) >= 0);

    let headerMap = null;
    let dataRows;
    if (hasHeader) {
      headerMap = {};
      first.forEach((h, i) => { headerMap[h] = i; });
      dataRows = rows.slice(1);
    } else {
      dataRows = rows;
    }
    const idx = name => (headerMap && name in headerMap) ? headerMap[name] : -1;
    const col = (row, name) => {
      const i = idx(name);
      return (i >= 0 && row[i] != null) ? String(row[i]).trim() : '';
    };

    const items = [];
    const errors = [];
    dataRows.forEach((row, ri) => {
      const lineNo = (hasHeader ? ri + 2 : ri + 1);
      let type, subject, chapter, question, explain, options, answer;
      if (hasHeader) {
        type = col(row, 'type').toLowerCase();
        subject = col(row, 'subject') || '未分类';
        chapter = col(row, 'chapter') || col(row, '章节') || '';
        question = col(row, 'question') || col(row, '题干') || col(row, '正面');
        explain = col(row, 'explain') || col(row, '解析') || col(row, '背面');
        if (type !== 'card') {
          options = [col(row, 'optiona'), col(row, 'optionb'), col(row, 'optionc'), col(row, 'optiond')];
          answer = parseAnswer(col(row, 'answer'));
        }
      } else {
        // 无表头：subject,question,optA..D,answer,explain
        type = 'quiz';
        subject = (row[0] || '未分类').trim();
        chapter = '';
        question = (row[1] || '').trim();
        options = [row[2], row[3], row[4], row[5]].map(x => (x || '').trim());
        answer = row[6] != null ? parseAnswer(row[6]) : 0;
        explain = (row[7] || '').trim();
      }
      if (!question) { errors.push('第 ' + lineNo + ' 行缺少题干/问题，已跳过'); return; }
      if (type !== 'card') {
        const opts = options.filter(Boolean);
        if (opts.length < 2) { errors.push('第 ' + lineNo + ' 行选择题选项不足，已跳过'); return; }
        items.push({ type: 'quiz', subject, chapter, question, options: opts, answer, explain });
      } else {
        items.push({ type: 'card', subject, chapter, question, explain });
      }
    });
    return { items, errors, total: items.length };
  }

  /**
   * 解析 Anki 导出的「纯文本 / CSV」为记忆卡条目。
   * 字段按表头名（front/back/tags/正面/背面/标签...）或位置映射：第 0 字段=正面，第 1 字段=背面。
   * opts: { subject, chapter, tagSubjectIndex=0, tagChapterIndex=1 }
   *   subject 给定时作为固定科目；否则取第 tagSubjectIndex 个标签；chapter 同理。
   */
  function parseAnki(text, opts) {
    opts = opts || {};
    const firstLine = (String(text || '').split(/\r?\n/).find(l => l.trim() !== '') || '');
    const delim = firstLine.indexOf('\t') >= 0 ? '\t' : ',';
    const rows = parseCsv(text, delim);
    if (rows.length === 0) return { items: [], errors: ['未解析到任何数据行'], total: 0 };

    const HEAD = ['front', 'question', '正面', '题干', '题目', 'back', 'answer', '背面', '解析', '答案', 'tags', '标签', 'tag', 'subject', 'chapter', '科目', '章节'];
    const first = rows[0].map(h => h.trim().toLowerCase());
    const hasHeader = first.some(h => HEAD.indexOf(h) >= 0);
    let idx = null, dataRows;
    if (hasHeader) {
      idx = {};
      first.forEach((h, i) => { idx[h] = i; });
      dataRows = rows.slice(1);
    } else {
      dataRows = rows;
    }
    const find = names => {
      if (idx) for (const n of names) if (n in idx) return idx[n];
      return -1;
    };
    const fI = (find(['front', 'question', '正面', '题干', '题目', 'q']) >= 0) ? find(['front', 'question', '正面', '题干', '题目', 'q']) : 0;
    const bI = (find(['back', 'answer', '背面', '解析', '答案', 'a', 'explain']) >= 0) ? find(['back', 'answer', '背面', '解析', '答案', 'a', 'explain']) : 1;
    const tagsI = find(['tags', '标签', 'tag']);
    const subI = find(['subject', '科目']);
    const chI = find(['chapter', '章节']);

    const items = [], errors = [];
    dataRows.forEach((row, ri) => {
      const q = (row[fI] || '').trim();
      const a = (row[bI] || '').trim();
      if (!q) { errors.push('第 ' + (ri + 2) + ' 行缺少正面，已跳过'); return; }
      let tags = [];
      if (tagsI >= 0 && row[tagsI]) tags = String(row[tagsI]).split(/[\s,]+/).filter(Boolean);
      let subject = (opts.subject || '').trim() || (subI >= 0 ? (row[subI] || '').trim() : '');
      let chapter = (opts.chapter || '').trim() || (chI >= 0 ? (row[chI] || '').trim() : '');
      if (!subject && tags.length) subject = tags[opts.tagSubjectIndex == null ? 0 : opts.tagSubjectIndex] || '未分类';
      if (!chapter && tags.length) {
        const ci = opts.tagChapterIndex == null ? 1 : opts.tagChapterIndex;
        if (tags[ci]) chapter = tags[ci];
      }
      items.push({ type: 'card', subject: subject || '未分类', chapter: chapter || '', question: q, explain: a });
    });
    return { items, errors, total: items.length };
  }

  const Store = {
    uid,
    todayStr,
    daysAgo,
    addDays,

    // ---- 内容（内存缓存，避免每次全量解析 localStorage） ----
    getContent() {
      if (!contentCache) contentCache = read(KEYS.content, []);
      return contentCache;
    },
    saveContent(list) {
      contentCache = list;
      write(KEYS.content, list);
    },
    /** 构建完整条目（id/默认字段） */
    makeItem(item) {
      return Object.assign({
        id: uid(),
        type: 'quiz',           // quiz | card
        subject: '未分类',
        chapter: '',            // 章节（如：血液循环、糖代谢）
        question: '',           // 选择题题干 / 记忆卡正面
        options: [],            // 选择题选项 [A,B,C,D]
        answer: 0,              // 选择题正确项索引
        explain: '',            // 解析 / 记忆卡背面
        stage: -1,              // -1 未学习; 0..n 艾宾浩斯阶段
        nextReview: null,       // 下次复习日期 yyyy-mm-dd
        reviewCount: 0,         // 累计复习次数
        wrongCount: 0,          // 累计答错次数
        graduated: false,
        fav: false,             // 是否收藏
        note: '',               // 个人笔记
        noteUpdated: null,      // 笔记更新时间
        image: '',              // 图片卡：图片路径（如 images/xx.png）
        masks: [],              // 图片卡：挖空区域 [[x,y,w,h]...]（0-1 归一化）
        createdAt: Date.now()
      }, item);
    },
    addContent(item) {
      const list = this.getContent();
      const full = this.makeItem(item);
      list.push(full);
      this.saveContent(list);
      return full;
    },
    updateContent(id, patch) {
      const list = this.getContent();
      const i = list.findIndex(x => x.id === id);
      if (i >= 0) {
        list[i] = Object.assign({}, list[i], patch);
        this.saveContent(list);
      }
      return i >= 0 ? list[i] : null;
    },
    removeContent(id) {
      const list = this.getContent();
      const idx = list.findIndex(x => x.id === id);
      if (idx < 0) return false;
      // 移入回收站
      const trash = this.getTrash();
      const item = list[idx];
      trash.push(Object.assign({}, item, { _deletedAt: Date.now() }));
      this.saveTrash(trash.slice(-200)); // 最多保留 200 条
      const next = list.filter(x => x.id !== id);
      this.saveContent(next);
      return true;
    },
    /** 回收站：获取已删除条目 */
    getTrash() {
      return read(KEYS.trash, []);
    },
    saveTrash(arr) {
      write(KEYS.trash, arr);
    },
    /** 从回收站恢复 */
    restoreFromTrash(id) {
      const trash = this.getTrash();
      const idx = trash.findIndex(x => x.id === id);
      if (idx < 0) return false;
      const item = trash[idx];
      delete item._deletedAt;
      this.addContent(item);
      this.saveTrash(trash.filter(x => x.id !== id));
      return true;
    },
    /** 清空回收站 */
    clearTrash() {
      write(KEYS.trash, []);
    },
    getById(id) {
      return this.getContent().find(x => x.id === id) || null;
    },
    replaceAll(list) {
      this.saveContent(list);
    },

    /** CSV 题库解析（暴露给 UI / 测试） */
    parseCsv(text) {
      return parseCsvToItems(text);
    },

    /** Anki 导出的纯文本/CSV 解析（暴露给 UI / 测试） */
    parseAnki(text, opts) {
      return parseAnki(text, opts);
    },

    /** 批量添加到内容库（一次性写入，O(n)，适合上千条题库），返回成功数 */
    bulkAdd(items) {
      const arr = items || [];
      if (!arr.length) return 0;
      const list = this.getContent();
      arr.forEach(it => { list.push(this.makeItem(it)); });
      this.saveContent(list);
      return arr.length;
    },

    /** 批量删除（一次性写入），返回删除数 */
    removeMany(ids) {
      const set = new Set(ids || []);
      if (!set.size) return 0;
      const list = this.getContent();
      const next = list.filter(x => !set.has(x.id));
      this.saveContent(next);
      return list.length - next.length;
    },

    // ---- 设置 ----
    getSettings() {
      const s = read(KEYS.settings, null);
      return Object.assign({}, DEFAULT_SETTINGS, s || {});
    },
    saveSettings(patch) {
      const s = this.getSettings();
      write(KEYS.settings, Object.assign(s, patch));
      return this.getSettings();
    },

    // ---- 学习日志（每日统计） ----
    getLog() {
      return read(KEYS.log, {});
    },
    saveLog(log) {
      write(KEYS.log, log);
    },
    logDay(dateStr, delta) {
      const log = this.getLog();
      if (!log[dateStr]) log[dateStr] = { review: 0, correct: 0, wrong: 0, newLearned: 0, graduated: 0, seconds: 0 };
      const d = log[dateStr];
      d.review += (delta.review || 0);
      d.correct += (delta.correct || 0);
      d.wrong += (delta.wrong || 0);
      d.newLearned += (delta.newLearned || 0);
      d.graduated += (delta.graduated || 0);
      d.seconds += (delta.seconds || 0);
      this.saveLog(log);
      return d;
    },

    // ---- 日期滚动标记 ----
    getLastDate() {
      return localStorage.getItem(KEYS.lastDate);
    },
    setLastDate(s) {
      localStorage.setItem(KEYS.lastDate, s);
    },

    // ---- 整卷考试记录 ----
    getExam() {
      return read(KEYS.exam, []);
    },
    addExam(rec) {
      const arr = this.getExam();
      arr.unshift(rec);          // 最新在前
      this.saveExam(arr.slice(0, 20));
      return arr;
    },
    saveExam(list) {
      write(KEYS.exam, list);
    },

    // ---- 经验值 / 成就 ----
    getXp() {
      return Object.assign({ xp: 0, badges: [], relearn: 0, lastDate: '' }, read(KEYS.xp, null) || {});
    },
    saveXp(s) {
      write(KEYS.xp, s);
    },

    // ---- 全部导出/导入 ----
    exportAll() {
      // 除核心 key 外，把所有其他 ttgd.* key（学习计划/学习记录/题库等）一并纳入同步
      const CORE = [KEYS.content, KEYS.settings, KEYS.log, KEYS.trash, KEYS.xp, KEYS.lastDate, KEYS.exam];
      const extra = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('ttgd.') === 0 && k !== 'ttgd.sync.meta' && k !== 'ttgd.bundled.v1' && CORE.indexOf(k) < 0) {
          try { extra[k] = localStorage.getItem(k); } catch (e) {}
        }
      }
      return JSON.stringify({
        app: 'tiantian-gundong',
        version: 3,
        exportedAt: new Date().toISOString(),
        settings: this.getSettings(),
        content: this.getContent(),
        log: this.getLog(),
        trash: this.getTrash(),
        xp: this.getXp(),
        lastDate: this.getLastDate(),
        exam: this.getExam(),
        extra
      }, null, 2);
    },
    importAll(jsonStr) {
      const data = JSON.parse(jsonStr);
      if (!data || data.app !== 'tiantian-gundong') throw new Error('不是有效的「天天滚动」导出文件');
      if (Array.isArray(data.content)) this.replaceAll(data.content);
      if (data.settings) write(KEYS.settings, data.settings);
      if (data.log) this.saveLog(data.log);
      if (Array.isArray(data.trash)) this.saveTrash(data.trash);
      if (data.xp) write(KEYS.xp, data.xp);
      if (data.lastDate != null && data.lastDate !== '') this.setLastDate(data.lastDate);
      if (Array.isArray(data.exam)) this.saveExam(data.exam);
      if (data.extra && typeof data.extra === 'object') {
        Object.keys(data.extra).forEach(k => {
          try { localStorage.setItem(k, data.extra[k]); } catch (e) {}
        });
      }
      return data.content ? data.content.length : 0;
    },

    resetAll() {
      Object.keys(KEYS).forEach(k => localStorage.removeItem(KEYS[k]));
      localStorage.removeItem('ttgd.bundled.v1');
      contentCache = null;
    },

    /** 估算存储用量（字节），返回格式化字符串 */
    getStorageUsage() {
      var total = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('ttgd.') === 0) {
          var v = localStorage.getItem(k);
          total += (k.length + (v ? v.length : 0)) * 2; // UTF-16 每字符 2 字节
        }
      }
      var unit = 'B';
      if (total > 1024) { total = total / 1024; unit = 'KB'; }
      if (total > 1024) { total = total / 1024; unit = 'MB'; }
      return total.toFixed(1) + ' ' + unit;
    }
  };

  window.TTStore = Store;
})();

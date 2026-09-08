/* ===== 天天滚动 · 数据持久层 (localStorage) =====
 * 架构（v4）：静态题面与个人进度分离，避免内置题库(~8MB)撑爆 localStorage
 *  - base    : 内置题面，运行时由 bundled 注册进【内存】，不落盘（每台设备可从 js 文件重建）
 *  - overlay : 个人学习进度 { 稳定id: {stage,nextReview,anki,fav,note...} }，落盘，体积极小
 *  - users   : 用户自建 / CSV·Anki 导入的完整条目，落盘
 * 对外 getContent() 仍返回“题面+进度”的完整合并视图，业务层无感。
 * ============================================================== */
(function () {
  'use strict';

  const KEYS = {
    // v4：题面不再落盘
    progress: 'ttgd.progress.v4',   // 内置条目学习进度（overlay）
    users: 'ttgd.useritems.v4',     // 用户自建/导入条目（完整）
    hidden: 'ttgd.hidden.v4',       // 被用户移除的内置条目 id
    storeVer: 'ttgd.store.v',       // 存储架构版本标记
    legacyContent: 'ttgd.content.v1', // 旧版整包内容（迁移后删除以释放空间）
    settings: 'ttgd.settings.v1',
    log: 'ttgd.log.v1',
    lastDate: 'ttgd.lastDate.v1',
    exam: 'ttgd.exam.v1',
    trash: 'ttgd.trash.v1',    // 回收站
    xp: 'ttgd.xp.v1'           // 经验值 / 成就
  };

  const DEFAULT_SETTINGS = {
    dailyNew: 0,           // 每日新学目标（默认 0 = 不自动补新卡，可手动调）
    intervals: [1, 2, 4, 7, 15, 30],  // 艾宾浩斯复习间隔（天）
    theme: 'green',
    themeMode: 'auto',     // auto | light | dark
    examMinutes: 180,      // 整卷考试时长（分钟）
    examCount: 20,         // 整卷考试的题目数量（从题库随机抽取）
    notifyReminder: true,  // 每日学习提醒
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
      return true;
    } catch (e) {
      console.warn('write failed', key, e);
      // 存储空间不足时提示用户
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
        var msg = '⚠️ 存储空间不足！请导出备份后清理数据（设置 → 重置所有数据）';
        if (typeof toast === 'function') {
          toast(msg);
        } else {
          var banner = document.createElement('div');
          banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#e5484d;color:#fff;text-align:center;padding:10px 16px;font-size:14px;font-weight:600';
          banner.textContent = msg;
          document.body.appendChild(banner);
          setTimeout(function () { banner.remove(); }, 5000);
        }
      }
      return false;
    }
  }

  /* ================= 三层存储：base(内存) / overlay / users ================= */

  // 题面字段（来自内置 base，不进 overlay）
  const FACE_KEYS = { type:1, subject:1, chapter:1, question:1, options:1, answer:1, explain:1, image:1, masks:1, year:1, id:1, _bundled:1, createdAt:1 };
  // 视为“无进度”的默认值字段（不写入 overlay，保持 overlay 极小）
  function isEmptyProg(k, v) {
    if (v === null || v === undefined || v === '' || v === false) return true;
    if (k === 'stage' && v === -1) return true;
    if ((k === 'reviewCount' || k === 'wrongCount') && v === 0) return true;
    if (k === 'anki') {
      if (!v || v.state === 'new') return true;
    }
    return false;
  }

  const baseById = new Map();   // 稳定id -> 题面条目（含默认进度）
  const baseOrder = [];         // 注册顺序（稳定 id）
  let baseSeq = 0;
  const BASE_TIME = 1700000000000;

  let overlay = undefined;      // { bid: {进度} }
  let users = undefined;        // [完整用户条目]
  let hiddenSet = undefined;    // Set(bid)
  let mergedCache = null;

  function ov() { if (overlay === undefined) overlay = read(KEYS.progress, {}) || {}; return overlay; }
  function us() { if (users === undefined) users = read(KEYS.users, []) || []; return users; }
  function hidden() { if (hiddenSet === undefined) hiddenSet = new Set(read(KEYS.hidden, []) || []); return hiddenSet; }
  function saveOv() { write(KEYS.progress, ov()); mergedCache = null; }
  function saveUs() { write(KEYS.users, us()); mergedCache = null; }
  function saveHidden() { write(KEYS.hidden, Array.from(hidden())); mergedCache = null; }
  function invalidate() { mergedCache = null; }

  // 稳定内容主键：图片卡按图片 URL，选择题按 科目|章节|年份|题干
  function ckeyOf(it) {
    if (it && it.image) return 'c|' + it.image;
    // 选择题主键纳入答案与选项：同题干但答案不同（如配不同图的心电图判读题）视为不同题；
    // 不纳入 explain（解析会润色，纳入会导致进度丢失）。此算法上线后不可再改，否则云端进度 id 失效。
    var ans = Array.isArray(it.answer) ? it.answer.join(',') : it.answer;
    var opts = Array.isArray(it.options) ? it.options.join('') : (it.options || '');
    return 'q|' + (it.subject || '') + '|' + (it.chapter || '') + '|' + (it.year != null ? it.year : '') + '|' + (it.question || '') + '|' + (ans == null ? '' : ans) + '|' + opts;
  }
  function djb2(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) { h = (((h << 5) + h + str.charCodeAt(i)) | 0) >>> 0; }
    return h.toString(36);
  }
  // 双哈希拼接，把碰撞概率降到可忽略
  function sidOf(ckey) { return 'b' + djb2(ckey, 5381) + djb2(ckey, 2166136261 >>> 0); }

  function defaultProgress() {
    return {
      stage: -1, nextReview: null, reviewCount: 0, wrongCount: 0, graduated: false,
      fav: false, note: '', noteUpdated: null
    };
  }

  /** 从一个完整条目里抽取“有意义的个人进度”（剔除题面与默认值） */
  function pickProg(it) {
    const out = {};
    Object.keys(it).forEach(k => {
      if (FACE_KEYS[k]) return;
      const v = it[k];
      if (isEmptyProg(k, v)) return;
      out[k] = v;
    });
    return out;
  }
  function hasProg(p) { return p && Object.keys(p).length > 0; }

  function buildMerged() {
    const o = ov(), h = hidden(), arr = [];
    for (let i = 0; i < baseOrder.length; i++) {
      const id = baseOrder[i];
      if (h.has(id)) continue;
      const b = baseById.get(id);
      const patch = o[id];
      arr.push(patch ? Object.assign({}, b, patch, { id: id }) : Object.assign({}, b, { id: id }));
    }
    const ul = us();
    for (let i = 0; i < ul.length; i++) arr.push(ul[i]);
    return arr;
  }

  let contentCache = null; // = merged 缓存（对外语义保持原名）

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

    // ---- 内置题面注册（仅内存，不落盘）----
    /** 把 bundled 题面注册进内存 base；幂等（同内容主键只注册一次）。返回新增条数 */
    registerBundled(items) {
      const arr = items || [];
      let n = 0;
      for (let i = 0; i < arr.length; i++) {
        const raw = arr[i];
        if (!raw) continue;
        const ck = ckeyOf(raw);
        const id = sidOf(ck);
        if (baseById.has(id)) continue;
        const it = Object.assign({}, defaultProgress(), raw, {
          id: id,
          _bundled: true,
          createdAt: BASE_TIME + (baseSeq++) * 1000
        });
        baseById.set(id, it);
        baseOrder.push(id);
        n++;
      }
      if (n) mergedCache = null;
      return n;
    },
    /** 按匹配条件移除内置题面（含其进度与隐藏标记），返回移除数；用于“清除已导入真题” */
    removeBundledBy(matchFn) {
      const o = ov(), h = hidden();
      let n = 0;
      for (let i = baseOrder.length - 1; i >= 0; i--) {
        const id = baseOrder[i];
        const b = baseById.get(id);
        let hit = false;
        try { hit = matchFn(b); } catch (e) { hit = false; }
        if (hit) {
          baseById.delete(id);
          baseOrder.splice(i, 1);
          delete o[id];
          h.delete(id);
          n++;
        }
      }
      if (n) { write(KEYS.progress, o); write(KEYS.hidden, Array.from(h)); mergedCache = null; }
      return n;
    },
    bundledCount() { return baseOrder.length; },

    // ---- 内容合并视图 ----
    getContent() {
      if (!mergedCache) mergedCache = buildMerged();
      contentCache = mergedCache;
      return mergedCache;
    },
    /** 兼容旧调用：整体保存（anki.migrate 等）。内置条目只抽进度，用户条目整条更新 */
    saveContent(list) {
      const o = ov(), ul = us();
      let uChanged = false;
      (list || []).forEach(it => {
        if (!it || !it.id) return;
        if (baseById.has(it.id)) {
          const p = pickProg(it);
          if (hasProg(p)) o[it.id] = Object.assign({}, o[it.id], p);
        } else {
          const i = ul.findIndex(x => x.id === it.id);
          if (i >= 0) ul[i] = it; else { ul.push(it); uChanged = true; }
        }
      });
      write(KEYS.progress, o);
      write(KEYS.users, ul);
      mergedCache = null;
    },
    /** 构建完整条目（用户条目用，含随机 id 与默认字段） */
    makeItem(item) {
      return Object.assign({
        id: uid(),
        type: 'quiz',
        subject: '未分类',
        chapter: '',
        question: '',
        options: [],
        answer: 0,
        explain: '',
        stage: -1,
        nextReview: null,
        reviewCount: 0,
        wrongCount: 0,
        graduated: false,
        fav: false,
        note: '',
        noteUpdated: null,
        image: '',
        masks: [],
        createdAt: Date.now()
      }, item);
    },
    /** 用户新增条目（手动新建）→ users */
    addContent(item) {
      const full = this.makeItem(item);
      us().push(full);
      saveUs();
      return full;
    },
    updateContent(id, patch) {
      if (baseById.has(id)) {
        const o = ov();
        o[id] = Object.assign({}, o[id], patch);
        saveOv();
        return this.getById(id);
      }
      const list = us();
      const i = list.findIndex(x => x.id === id);
      if (i >= 0) {
        list[i] = Object.assign({}, list[i], patch);
        saveUs();
        return list[i];
      }
      return null;
    },
    removeContent(id) {
      if (baseById.has(id)) {
        // 内置条目“删除”= 隐藏（保留进度，取消隐藏可恢复）；同时不再出现在合并视图
        hidden().add(id);
        saveHidden();
        return true;
      }
      const list = us();
      const idx = list.findIndex(x => x.id === id);
      if (idx < 0) return false;
      const trash = this.getTrash();
      trash.push(Object.assign({}, list[idx], { _deletedAt: Date.now() }));
      this.saveTrash(trash.slice(-200));
      const next = list.filter(x => x.id !== id);
      users = next;
      saveUs();
      return true;
    },
    getTrash() { return read(KEYS.trash, []); },
    saveTrash(arr) { write(KEYS.trash, arr); },
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
    clearTrash() { write(KEYS.trash, []); },
    getById(id) { return this.getContent().find(x => x.id === id) || null; },
    /** 兼容旧调用（整体替换）：吸收为 overlay/users，不保存题面 */
    replaceAll(list) { this.absorbLegacy(list); },

    /** 把旧版“整包条目”吸收进三层：匹配到内置的只取进度，其余整条进 users */
    absorbLegacy(list) {
      const o = ov();
      const ul = us();
      let nProg = 0, nUser = 0;
      (list || []).forEach(it => {
        if (!it) return;
        const sid = sidOf(ckeyOf(it));
        if (baseById.has(sid)) {
          const p = pickProg(it);
          if (hasProg(p)) { o[sid] = Object.assign({}, o[sid], p); nProg++; }
        } else {
          // 未匹配到内置：视为用户条目完整保留（去掉内置标记，保留原 id 以免断链）
          const cp = Object.assign({}, it);
          delete cp._bundled;
          if (!cp.id) cp.id = uid();
          if (!ul.some(x => x.id === cp.id)) { ul.push(cp); nUser++; }
        }
      });
      write(KEYS.progress, o);
      write(KEYS.users, ul);
      mergedCache = null;
      return { progress: nProg, users: nUser };
    },
    /** 自愈：内置题面延迟注册后，把 users 中其实是内置条目的项转回纯进度，避免题面占空间 */
    reabsorbUsers() {
      const ul = us();
      if (!ul.length) return 0;
      const o = ov(); const keep = []; let n = 0;
      ul.forEach(it => {
        const sid = sidOf(ckeyOf(it));
        if (baseById.has(sid)) { const p = pickProg(it); if (hasProg(p)) o[sid] = Object.assign({}, o[sid], p); n++; }
        else keep.push(it);
      });
      if (n) { users = keep; write(KEYS.progress, o); write(KEYS.users, keep); mergedCache = null; }
      return n;
    },

    parseCsv(text) { return parseCsvToItems(text); },
    parseAnki(text, opts) { return parseAnki(text, opts); },

    /** 用户批量导入（CSV/Anki），完整条目进 users，返回条数 */
    bulkAdd(items) {
      const arr = items || [];
      if (!arr.length) return 0;
      const ul = us();
      arr.forEach(it => ul.push(this.makeItem(it)));
      saveUs();
      return arr.length;
    },

    removeMany(ids) {
      const set = new Set(ids || []);
      if (!set.size) return 0;
      // 内置：批量隐藏
      const o = ov(), h = hidden();
      let nHidden = 0;
      set.forEach(id => { if (baseById.has(id) && !h.has(id)) { h.add(id); nHidden++; } });
      // 用户：移入回收站并删除
      const ul = us();
      const trash = this.getTrash();
      const kept = ul.filter(x => {
        if (set.has(x.id)) { trash.push(Object.assign({}, x, { _deletedAt: Date.now() })); return false; }
        return true;
      });
      let nUser = ul.length - kept.length;
      if (nUser) { this.saveTrash(trash.slice(-200)); users = kept; }
      if (nHidden || nUser) {
        if (nHidden) write(KEYS.hidden, Array.from(h));
        if (nUser) write(KEYS.users, users);
        mergedCache = null;
      }
      return nHidden + nUser;
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
    getLog() { return read(KEYS.log, {}); },
    saveLog(log) { write(KEYS.log, log); },
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
    getLastDate() { return localStorage.getItem(KEYS.lastDate); },
    setLastDate(s) { localStorage.setItem(KEYS.lastDate, s); },

    // ---- 整卷考试记录 ----
    getExam() { return read(KEYS.exam, []); },
    addExam(rec) {
      const arr = this.getExam();
      arr.unshift(rec);
      this.saveExam(arr.slice(0, 20));
      return arr;
    },
    saveExam(list) { write(KEYS.exam, list); },

    // ---- 经验值 / 成就 ----
    getXp() {
      return Object.assign({ xp: 0, badges: [], relearn: 0, lastDate: '' }, read(KEYS.xp, null) || {});
    },
    saveXp(s) { write(KEYS.xp, s); },

    /* ---- 旧版整包迁移：把 ttgd.content.v1 抽成进度后删除，释放 ~8MB ---- */
    migrateLegacyStorage() {
      // 每次启动清洗 overlay 中的空项（历史版本可能残留），廉价且幂等
      const _o = ov();
      let cleaned = 0;
      Object.keys(_o).forEach(k => { if (!_o[k] || Object.keys(_o[k]).length === 0) { delete _o[k]; cleaned++; } });
      if (cleaned) write(KEYS.progress, _o);
      if (localStorage.getItem(KEYS.storeVer) === '4') return { skipped: true, cleaned: cleaned };
      const raw = localStorage.getItem(KEYS.legacyContent);
      let summary = { migrated: 0 };
      if (raw !== null) {
        try {
          const list = JSON.parse(raw);
          summary = this.absorbLegacy(list);
        } catch (e) {
          console.warn('legacy content migrate failed', e);
        }
        // 无论成败都删除旧大 key：题面可由 bundled 重建，进度已抽取；避免继续占满配额
        localStorage.removeItem(KEYS.legacyContent);
        contentCache = null; mergedCache = null;
      }
      localStorage.setItem(KEYS.storeVer, '4');
      return summary;
    },

    // ---- 全部导出（v4 精简：不含内置题面，仅进度/用户条目/记录）----
    exportAll() {
      const SKIP = { 'ttgd.sync.meta':1, 'ttgd.bundled.v1':1 };
      const extra = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('ttgd.') === 0 && !SKIP[k] &&
          k !== KEYS.progress && k !== KEYS.users && k !== KEYS.hidden && k !== KEYS.storeVer &&
          k !== KEYS.settings && k !== KEYS.log && k !== KEYS.trash && k !== KEYS.xp &&
          k !== KEYS.lastDate && k !== KEYS.exam && k !== KEYS.legacyContent) {
          try { extra[k] = localStorage.getItem(k); } catch (e) {}
        }
      }
      return JSON.stringify({
        app: 'tiantian-gundong',
        version: 4,
        exportedAt: new Date().toISOString(),
        settings: this.getSettings(),
        progress: ov(),
        hidden: Array.from(hidden()),
        userItems: us(),
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

      if (data.version >= 4) {
        // 新格式：合并进度（云端覆盖同条目）、用户条目（按 id 去重）
        if (data.progress && typeof data.progress === 'object') {
          const o = ov();
          Object.keys(data.progress).forEach(k => { o[k] = Object.assign({}, o[k], data.progress[k]); });
          write(KEYS.progress, o);
        }
        if (Array.isArray(data.hidden)) { const h = hidden(); data.hidden.forEach(x => h.add(x)); write(KEYS.hidden, Array.from(h)); }
        if (Array.isArray(data.userItems)) {
          const ul = us();
          data.userItems.forEach(it => { if (!ul.some(x => x.id === it.id)) ul.push(it); });
          write(KEYS.users, ul);
        }
      } else if (Array.isArray(data.content)) {
        // 旧格式（整包题面）：只吸收进度/用户条目，不回写题面（避免撑爆配额）
        this.absorbLegacy(data.content);
        if (Array.isArray(data.trash)) this.saveTrash(data.trash);
      }

      if (data.settings) write(KEYS.settings, data.settings);
      if (data.log) this.saveLog(data.log);
      if (data.xp) write(KEYS.xp, data.xp);
      if (data.lastDate != null && data.lastDate !== '') this.setLastDate(data.lastDate);
      if (Array.isArray(data.exam)) this.saveExam(data.exam);
      if (data.version >= 4 && Array.isArray(data.trash)) this.saveTrash(data.trash);
      if (data.extra && typeof data.extra === 'object') {
        Object.keys(data.extra).forEach(k => { try { localStorage.setItem(k, data.extra[k]); } catch (e) {} });
      }
      mergedCache = null;
      // 返回进度条数，供调用方判断
      return Object.keys(ov()).length;
    },

    resetAll() {
      Object.keys(KEYS).forEach(k => {
        const key = KEYS[k];
        if (key.indexOf('ttgd.') === 0) localStorage.removeItem(key);
      });
      localStorage.removeItem('ttgd.bundled.v1');
      overlay = {}; users = []; hiddenSet = new Set();
      baseById.clear(); baseOrder.length = 0;
      contentCache = null; mergedCache = null;
    },

    /** 估算存储用量（字节），返回格式化字符串 */
    getStorageUsage() {
      var total = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('ttgd.') === 0) {
          var v = localStorage.getItem(k);
          total += (k.length + (v ? v.length : 0)) * 2;
        }
      }
      var unit = 'B';
      if (total > 1024) { total = total / 1024; unit = 'KB'; }
      if (total > 1024) { total = total / 1024; unit = 'MB'; }
      return total.toFixed(2) + ' ' + unit;
    }
  };

  window.TTStore = Store;
})();

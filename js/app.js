/* ===== 天天滚动 · 主应用逻辑 ===== */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };

  const App = {
    tab: 'today',
    learnMode: 'all',      // all | quiz | card
    learnQueue: [],        // [{item, isNew}]
    learnIndex: 0,
    learnResults: [],      // [{id, ok, isNew}]
    learnSessionDone: false,
    learnSource: 'today',  // today | subject | wrong
    learnBackTo: 'today',
    learnTitle: '今日学习完成！',
    libFilter: 'all',
    libSearch: '',
    libView: 'flat',         // flat 平铺 | group 按科目·章节分组
    libLimit: 150,           // 内容库分页渲染上限
    practiceSubject: null,   // 练习中心当前下钻的科目
    imgBrowseSub: null,      // 看图卡库：当前浏览的科目
    imgBrowseCh: null,       // 看图卡库：当前浏览的章节
    learnBusy: false,
    exam: null             // 整卷考试会话
  };

  /* ================= 工具 ================= */
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function fmtDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function fmtClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  /* ---- 多选答案辅助（answer 可为索引 或 索引数组） ---- */
  function isMulti(ans) { return Array.isArray(ans); }
  function ansHas(ans, i) { return Array.isArray(ans) ? ans.indexOf(i) >= 0 : ans === i; }
  function ansSet(ans, i, multi) {
    if (!multi) return i;
    const a = Array.isArray(ans) ? ans.slice() : [];
    const k = a.indexOf(i);
    if (k >= 0) a.splice(k, 1); else a.push(i);
    return a;
  }
  function ansLetters(ans) {
    if (ans == null) return '未作答';
    const arr = Array.isArray(ans) ? ans : [ans];
    return arr.map(i => 'ABCDE'[i]).join('');
  }
  function sameAnswer(a, b) {
    const A = (Array.isArray(a) ? a.slice() : [a]).sort((x, y) => x - y);
    const B = (Array.isArray(b) ? b.slice() : [b]).sort((x, y) => x - y);
    return A.length === B.length && A.every((v, i) => v === B[i]);
  }

  function isNewItem(it) {
    return it.type === 'card'
      ? !!(it.anki && it.anki.state === 'new')
      : it.stage < 0;
  }

  /* ================= Tab 切换 ================= */
  function switchTab(tab) {
    App.tab = tab;
    $$('.page').forEach(p => p.classList.add('hidden'));
    $('#page-' + tab).classList.remove('hidden');
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    if (tab === 'today') renderToday();
    else if (tab === 'practice') renderPractice();
    else if (tab === 'learn') renderLearn();
    else if (tab === 'library') renderLibrary();
    else if (tab === 'stats') renderStats();
  }

  /* ================= 今日页（任务看板） ================= */
  function renderMasteryList(el, arr, emptyMsg) {
    if (!arr.length) {
      el.innerHTML = `<div style="text-align:center;color:var(--text-3);font-size:13px;padding:6px">${emptyMsg || '暂无内容'}</div>`;
      return;
    }
    el.innerHTML = arr.map(r => `
      <div class="mastery-row">
        <div class="mastery-name">${esc(r.subject)}</div>
        <div class="mastery-track"><div class="mastery-fill" style="width:${r.pct}%"></div></div>
        <div class="mastery-num">${r.pct}%</div>
      </div>`).join('');
  }

  function renderToday() {
    const settings = TTStore.getSettings();
    const progress = TTScheduler.todayProgress();
    const streak = TTScheduler.streak();
    const modeQ = TTScheduler.todayQueue(App.learnMode);
    const rec = TTScheduler.dailyRecord();
    const tomorrow = TTScheduler.tomorrowDueCount();
    const mastery = TTScheduler.subjectMastery();
    const subjects = TTScheduler.subjects();

    // 打卡横幅
    const banner = $('#streak-banner');
    const studied = TTScheduler.hasStudiedToday();
    banner.innerHTML = studied
      ? `<span class="streak-fire">🔥 已连续打卡 ${streak} 天</span><span class="streak-sub">今天已学习，继续保持！</span>`
      : `<span class="streak-fire">连续打卡 ${streak} 天</span><span class="streak-sub">今天还没开始，动起来！</span>`;

    // 本阶段目标（按条目数最多的科目）
    const goalSub = subjects[0] || '--';
    $('#goal-subject').textContent = goalSub;
    const goalPct = Math.round(progress.pct * 100);
    $('#goal-pct').textContent = goalPct + '%';
    const circ = 326.7;
    $('#goal-ring-fg').style.strokeDashoffset = circ * (1 - progress.pct);
    $('#goal-scroll-info').textContent =
      `今日 ${progress.done} / ${progress.total} 张 · 明日到期 ${tomorrow} 张`;

    // 每日记录
    $('#rec-today').textContent = `今日 ${rec.todayCount} 题`;
    $('#rec-days').textContent = `已记录 ${rec.recordedDays} 天`;

    // 学习模式
    $$('#mode-seg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === App.learnMode));

    // 开始按钮
    const btn = $('#btn-start');
    btn.disabled = modeQ.total === 0;
    const modeName = App.learnMode === 'quiz' ? '刷题' : App.learnMode === 'card' ? 'Anki 复习' : '学习';
    btn.textContent = modeQ.total === 0
      ? (App.learnMode === 'all' && settings.dailyNew === 0 ? '今日任务已完成 🎉' : '当前模式今日无任务')
      : `开始${modeName}（${modeQ.total} 项）`;

    // 三段任务
    const qzDue = TTScheduler.dueItems('quiz').length;
    const qzNew = TTScheduler.newItems('quiz').length;
    const cdDue = TTScheduler.dueItems('card').length;
    const cdNew = TTScheduler.newItems('card').length;
    const wrongBook = TTScheduler.wrongBook().length;

    const taskRow = (icon, title, sub, status, locked, action) => `
      <div class="task-row" data-action="${action}" style="${locked ? 'opacity:.72' : ''}">
        <div class="task-icon">${icon}</div>
        <div class="task-main">
          <div class="task-title">${title}</div>
          <div class="task-sub">${sub}</div>
        </div>
        <span class="task-status ${locked ? 'lock' : 'on'}">${status}</span>
      </div>`;

    const tasks = [];
    tasks.push(
      taskRow('🎯', '学成选择题', `新学 ${qzNew} · 复习 ${qzDue}`, qzDue + qzNew > 0 ? '进行中' : '等待中', qzDue + qzNew === 0, 'quiz')
    );
    tasks.push(
      taskRow('📖', '以题带动知识点复习', cdDue + cdNew > 0 ? `新学 ${cdNew} · 复习 ${cdDue}` : '今天尚未学习卡片', cdDue + cdNew > 0 ? '进行中' : '待解锁', cdDue + cdNew === 0, 'card')
    );
    tasks.push(
      taskRow('♻️', '错题回炉', wrongBook > 0 ? `${wrongBook} 项待巩固` : '完成今日练习后自动生成', wrongBook > 0 ? '进行中' : '待解锁', wrongBook === 0, 'wrong')
    );
    $('#task-list').innerHTML = tasks.join('');

    // 今日队列预览
    $('#today-date').textContent = TTStore.todayStr();
    const listEl = $('#today-queue');
    const doneIds = new Set(TTScheduler.doneItemsToday().map(x => x.id));
    const wrongIds = new Set(TTScheduler.wrongItemsToday().map(x => x.id));
    const items = [...modeQ.due, ...modeQ.fresh];
    if (items.length === 0) {
      listEl.innerHTML = `<div class="queue-item"><span class="q-badge done">完成</span><span class="q-text">今日无待办，休息一下或添加新内容</span></div>`;
    } else {
      listEl.innerHTML = items.slice(0, 12).map(it => {
        let badge, text;
        if (doneIds.has(it.id)) { badge = '<span class="q-badge done">已复习</span>'; text = it.question; }
        else if (wrongIds.has(it.id)) { badge = '<span class="q-badge review">重刷</span>'; text = '⚠ ' + it.question; }
        else if (it.stage < 0 && it.type === 'quiz') { badge = '<span class="q-badge new">新学</span>'; text = it.question; }
        else if (it.type === 'card' && it.anki && it.anki.state === 'new') { badge = '<span class="q-badge new">新卡</span>'; text = it.question; }
        else { badge = '<span class="q-badge review">复习</span>'; text = it.question; }
        return `<div class="queue-item">${badge}<span class="q-text">${esc(text)}</span></div>`;
      }).join('');
      if (items.length > 12) {
        listEl.insertAdjacentHTML('beforeend', `<div class="queue-item"><span class="q-badge done">…</span><span class="q-text">还有 ${items.length - 12} 项，开始学习后逐题展示</span></div>`);
      }
    }

    // 五科掌握度
    $('#mastery-total').textContent = `${mastery.length} 科`;
    renderMasteryList($('#mastery-list'), mastery);
  }

  /* ================= 练习中心 ================= */
  function renderPractice() {
    const rec = TTScheduler.dailyRecord();
    $('#p-rec-info').textContent = `今日 ${rec.todayCount} 题 · 已记录 ${rec.recordedDays} 天`;

    const book = TTScheduler.wrongBook();
    $('#wrong-desc').textContent = book.length > 0 ? `${book.length} 项待巩固` : '0 项待巩固';

    const imgs = TTScheduler.imageCards();
    $('#img-desc').textContent = imgs.length > 0 ? `${imgs.length} 张图片挖空卡` : '0 张待学';

    const bank = window.TTBundledQuestionBank || {};
    const bankTotal = Object.keys(bank).reduce((s, k) => s + bank[k].length, 0);
    const imp = qbankImported();
    $('#qbank-desc').textContent = (imp.length ? '已导入 ' + imp.length + ' 科 · ' : '') + bankTotal + ' 题可选';

    // 按章节练习（两级下钻：科目 → 章节）
    const ps = App.practiceSubject;
    const sp = $('#subj-practice');
    const pivot = $('#p-sub-all');
    let rowHTML = '';
    if (ps) {
      const chapStats = TTScheduler.chapterQuizStats(ps);
      const totalThis = chapStats.reduce((s, o) => s + o.total, 0);
      pivot.textContent = `${ps} · 共 ${totalThis} 题`;
      rowHTML = `<div class="subj-crumb" id="subj-back">‹ 返回科目列表</div>`
        + (chapStats.length === 0
          ? `<div style="text-align:center;color:var(--text-3);font-size:13px;padding:8px">该科目暂无选择题</div>`
          : chapStats.map(o => `
            <div class="subj-row" data-subject="${esc(ps)}" data-chapter="${esc(o.chapter)}">
              <div class="subj-row-name">
                <div class="subj-name">${esc(o.chapter)}</div>
                <div class="subj-done">已完成 ${o.done} / ${o.total} 题</div>
              </div>
              <div class="subj-row-track"><div class="subj-row-fill" style="width:${o.pct}%"></div></div>
              <div class="subj-pct">${o.pct}%</div>
            </div>`).join(''));
    } else {
      const stats = TTScheduler.subjectQuizStats();
      const totalQuiz = stats.reduce((s, o) => s + o.total, 0);
      pivot.textContent = `共 ${totalQuiz} 题 · 点科目进入章节`;
      rowHTML = stats.length === 0
        ? `<div style="text-align:center;color:var(--text-3);font-size:13px;padding:8px">暂无选择题，请到内容库添加</div>`
        : stats.map(o => `
          <div class="subj-row" data-subject="${esc(o.subject)}" data-chapter="">
            <div class="subj-row-name">
              <div class="subj-name">${esc(o.subject)}</div>
              <div class="subj-done">已完成 ${o.done} / ${o.total} 题</div>
            </div>
            <div class="subj-row-track"><div class="subj-row-fill" style="width:${o.pct}%"></div></div>
            <div class="subj-pct">${o.pct}%</div>
          </div>`).join('');
    }
    sp.innerHTML = rowHTML;

    // 考试记录
    const exam = TTStore.getExam();
    const eh = $('#exam-history');
    if (exam.length === 0) {
      eh.innerHTML = `<div style="text-align:center;color:var(--text-3);font-size:13px;padding:8px">暂无考试记录，来一次整卷考试吧</div>`;
    } else {
      eh.innerHTML = exam.map(e => {
        const m = Math.floor(e.seconds / 60), s = e.seconds % 60;
        return `
        <div class="exam-row">
          <div class="er-date">${fmtDate(e.date)}</div>
          <div class="er-mid">${e.correct} / ${e.total} 题 · 用时 ${m > 0 ? m + '分' : ''}${s}秒</div>
          <div class="er-pct ${e.pct >= 60 ? 'ok' : 'bad'}">${e.pct}分</div>
        </div>`;
      }).join('');
    }
  }

  /* ================= 学习页 ================= */
  function beginQueue(items, source, backTo, title, isNewFn) {
    clearExamTimer();
    App.exam = null;
    App.learnQueue = items.map(item => ({ item, isNew: isNewFn ? isNewFn(item) : false }));
    App.learnIndex = 0;
    App.learnResults = [];
    App.learnSessionDone = false;
    App.learnSource = source || 'today';
    App.learnBackTo = backTo || 'today';
    App.learnTitle = title || '今日学习完成！';
    switchTab('learn');
    renderLearn();
  }

  function startLearning(mode) {
    const m = mode || App.learnMode;
    const q = TTScheduler.todayQueue(m);
    if (q.total === 0) { toast('当前模式今日暂无任务'); return; }
    App.learnMode = m;
    beginQueue([...q.due, ...q.fresh], 'today', 'today',
      m === 'quiz' ? '刷题完成！' : m === 'card' ? 'Anki 复习完成！' : '今日学习完成！',
      isNewItem);
  }

  function startSubject(subject) {
    const items = TTScheduler.subjectQuizQueue(subject);
    if (items.length === 0) { toast('该科目暂无选择题'); return; }
    beginQueue(items, 'subject', 'practice', '科目练习完成！', it => it.stage < 0);
  }

  function startChapter(subject, chapter) {
    const items = TTScheduler.chapterQuizQueue(subject, chapter);
    if (items.length === 0) { toast('该章节暂无选择题'); return; }
    beginQueue(items, 'subject', 'practice', '章节练习完成！', it => it.stage < 0);
  }

  /** 开刷图片挖空卡（可选 科目+章节 组合） */
  function startImageStudy(sel) {
    const items = TTScheduler.imageCards(sel);
    if (items.length === 0) { toast('暂无选中的看图挖空卡'); return; }
    beginQueue(items, 'subject', 'practice', '看图卡学习完成！', isNewItem);
  }

  /** 选择要学习的看图卡（按科目分组、章节勾选） */
  function openImageStudy() {
    const chs = TTScheduler.imageChapters();
    if (chs.length === 0) { toast('暂无看图挖空卡'); return; }
    const total = chs.reduce((s, c) => s + c.count, 0);
    const groups = {};
    chs.forEach(c => { (groups[c.subject] = groups[c.subject] || []).push(c); });
    const rowsHtml = Object.keys(groups).map(sub => `
      <div class="img-ch-subj">${esc(sub)}</div>
      ${groups[sub].map(c => `
        <label class="img-ch-row">
          <input type="checkbox" class="img-ch-cb" value="${esc(JSON.stringify({ subject: c.subject, chapter: c.chapter }))}" checked>
          <span class="img-ch-name">${esc(c.chapter)}</span>
          <span class="img-ch-count">${c.count} 张</span>
        </label>`).join('')}`).join('');
    openModal(`
      <div class="modal-title">选择要学习的看图卡</div>
      <div class="wrong-summary">共 <b>${total}</b> 张 · 按科目/章节勾选（默认全选）</div>
      <div class="img-ch-list">${rowsHtml}</div>
      <div class="img-ch-tools">
        <button class="btn-cancel" id="img-all">全选</button>
        <button class="btn-cancel" id="img-none">清空</button>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" id="img-cancel">取消</button>
        <button class="btn-primary" id="img-start">开始学习</button>
      </div>
    `);
    $('#img-cancel').addEventListener('click', closeModal);
    $('#img-all').addEventListener('click', () => $$('.img-ch-cb').forEach(cb => { cb.checked = true; }));
    $('#img-none').addEventListener('click', () => $$('.img-ch-cb').forEach(cb => { cb.checked = false; }));
    $('#img-start').addEventListener('click', () => {
      const chosen = $$('.img-ch-cb').filter(cb => cb.checked).map(cb => JSON.parse(cb.value));
      if (chosen.length === 0) { toast('请至少选择一个章节'); return; }
      closeModal();
      startImageStudy(chosen);
    });
  }

  /* ---------- 真题题库（文字选择题）导入 ---------- */
  function qbankImported() {
    try { return JSON.parse(localStorage.getItem('ttgd.qbank.v1') || '[]'); } catch (e) { return []; }
  }

  /** 清除已导入的真题（带 year 字段的选择题），用于升级后重新导入 */
  function clearQBank() {
    const list = TTStore.getContent();
    const ids = list.filter(x => x.type === 'quiz' && x.year).map(x => x.id);
    const n = TTStore.removeMany(ids);
    localStorage.removeItem('ttgd.qbank.v1');
    toast('已清除真题 ' + n + ' 题，可重新导入');
    renderPractice();
    renderLibrary();
    renderToday();
  }

  function openQBank() {
    const bank = window.TTBundledQuestionBank || {};
    const subs = Object.keys(bank);
    if (!subs.length) { toast('题库未加载，请通过 http://127.0.0.1:8341 打开'); return; }
    const imported = qbankImported();
    const total = subs.reduce((s, k) => s + bank[k].length, 0);
    openModal(`
      <div class="modal-title">真题题库导入</div>
      <div class="wrong-summary">306 西综真题共 <b>${total}</b> 题（单选+多选），按科目勾选导入</div>
      <div class="img-ch-list">
        ${subs.map(s => {
          const done = imported.indexOf(s) >= 0;
          return `<label class="img-ch-row ${done ? 'muted' : ''}">
            <input type="checkbox" class="qbank-cb" value="${esc(s)}" ${done ? 'disabled' : ''}>
            <span class="img-ch-name">${esc(s)} <span class="img-ch-count">${bank[s].length} 题</span></span>
            <span class="img-ch-count">${done ? '已导入 ✓' : ''}</span>
          </label>`;
        }).join('')}
      </div>
      <div class="img-ch-tools">
        <button class="btn-cancel" id="qbank-all">全选</button>
        <button class="btn-cancel" id="qbank-none">清空</button>
      </div>
      <div class="template-hint" style="margin-bottom:12px">⚠ 浏览器存储有限（约 5~10MB）。题越多越可能超限；超限时少勾选几个科目分批导入。解析已精简。</div>
      <div class="modal-actions">
        <button class="btn-cancel" id="qbank-cancel">取消</button>
        <button class="btn-primary" id="qbank-import">导入选中</button>
      </div>
      <div style="margin-top:10px;text-align:center">
        <button class="btn-ghost" id="qbank-clear" style="color:var(--danger);border-color:#fecaca">清除已导入的真题（重新导入用）</button>
      </div>
    `);
    $('#qbank-cancel').addEventListener('click', closeModal);
    $('#qbank-all').addEventListener('click', () => $$('.qbank-cb:not(:disabled)').forEach(cb => { cb.checked = true; }));
    $('#qbank-none').addEventListener('click', () => $$('.qbank-cb:not(:disabled)').forEach(cb => { cb.checked = false; }));
    $('#qbank-clear').addEventListener('click', () => {
      if (confirm('确定清除已导入的真题（带年份的选择题）？之后可重新导入新版题库。')) {
        clearQBank();
        closeModal();
        openQBank();
      }
    });
    $('#qbank-import').addEventListener('click', () => {
      const chosen = $$('.qbank-cb').filter(cb => cb.checked).map(cb => cb.value);
      if (chosen.length === 0) { toast('请至少选择一个科目'); return; }
      let items = [];
      chosen.forEach(s => items = items.concat(bank[s]));
      try {
        TTStore.bulkAdd(items);
        const imported = qbankImported();
        chosen.forEach(s => { if (imported.indexOf(s) < 0) imported.push(s); });
        localStorage.setItem('ttgd.qbank.v1', JSON.stringify(imported));
        TTAnki.migrate();
        closeModal();
        toast('已导入题库 ' + items.length + ' 题');
        renderPractice();
        renderLibrary();
        renderToday();
      } catch (e) {
        toast('导入失败：可能超出存储上限，请少选科目分批导入');
      }
    });
  }

  /* ---------- 按年份刷题 ---------- */
  function startYearStudy(years) {
    const items = TTScheduler.quizByYears(years);
    if (!items.length) { toast('所选年份暂无题目'); return; }
    beginQueue(items, 'subject', 'practice', '年份刷题完成！', it => it.stage < 0);
  }

  function openYearPractice() {
    const ys = TTScheduler.quizYears();
    if (!ys.length) {
      openModal(`
        <div class="modal-title">按年份刷题</div>
        <div class="wrong-summary">还没有"带年份"的真题。</div>
        <div class="template-hint" style="margin-bottom:12px">
          ① 如果你之前导入过<b>旧版题库</b>（无年份/无多选），请先到「📖 真题题库」点底部 <b>「清除已导入的真题」</b>；<br>
          ② 再重新勾选科目导入（<b>新版含年份与多选</b>）；<br>
          ③ 回到这里即可按年份刷题。
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" id="year-cancel">关闭</button>
          <button class="btn-primary" id="year-goto-qbank">去导入/重导题库</button>
        </div>
      `);
      $('#year-cancel').addEventListener('click', closeModal);
      $('#year-goto-qbank').addEventListener('click', () => { closeModal(); openQBank(); });
      return;
    }
    const total = ys.reduce((s, y) => s + y.count, 0);
    openModal(`
      <div class="modal-title">按年份刷题</div>
      <div class="wrong-summary">共 <b>${total}</b> 题 · 勾选年份（可多选）</div>
      <div class="img-ch-list">
        ${ys.map(y => `
          <label class="img-ch-row">
            <input type="checkbox" class="year-cb" value="${y.year}" checked>
            <span class="img-ch-name">${y.year} 年</span>
            <span class="img-ch-count">${y.count} 题</span>
          </label>`).join('')}
      </div>
      <div class="img-ch-tools">
        <button class="btn-cancel" id="year-all">全选</button>
        <button class="btn-cancel" id="year-none">清空</button>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" id="year-cancel">取消</button>
        <button class="btn-primary" id="year-start">开始刷题</button>
      </div>
    `);
    $('#year-cancel').addEventListener('click', closeModal);
    $('#year-all').addEventListener('click', () => $$('.year-cb').forEach(cb => { cb.checked = true; }));
    $('#year-none').addEventListener('click', () => $$('.year-cb').forEach(cb => { cb.checked = false; }));
    $('#year-start').addEventListener('click', () => {
      const years = $$('.year-cb').filter(cb => cb.checked).map(cb => Number(cb.value));
      if (!years.length) { toast('请至少选择一个年份'); return; }
      closeModal();
      startYearStudy(years);
    });
  }

  /* ---------- 看图卡库：科目 → 章节(带预览) → 挖空图网格 ---------- */
  function openImageBrowse() {
    App.imgBrowseSub = null;
    App.imgBrowseCh = null;
    renderImageBrowse();
  }

  function renderImageBrowse() {
    const chs = TTScheduler.imageChapters();
    if (chs.length === 0) { toast('暂无看图挖空卡'); return; }
    let inner;
    if (!App.imgBrowseSub) {
      // 一级：科目
      const subTotal = {};
      chs.forEach(c => { subTotal[c.subject] = (subTotal[c.subject] || 0) + c.count; });
      const subs = Object.keys(subTotal);
      inner = `
        <div class="modal-title">看图挖空卡库</div>
        <div class="browse-tools">
          <button class="btn-ghost" id="browse-multi">📋 按章节多选学习</button>
        </div>
        <div class="subj-grid">
          ${subs.map(s => `
            <div class="subj-card" data-sub="${esc(s)}">
              <div class="subj-card-icon">🖼</div>
              <div class="subj-card-name">${esc(s)}</div>
              <div class="subj-card-count">${subTotal[s]} 张</div>
              <div class="subj-card-more">展开 ›</div>
            </div>`).join('')}
        </div>`;
    } else if (!App.imgBrowseCh) {
      // 二级：该科目的章节（带图预览）
      const subChs = chs.filter(c => c.subject === App.imgBrowseSub);
      inner = `
        <div class="modal-title">${esc(App.imgBrowseSub)}</div>
        <div class="browse-back" id="browse-back">‹ 返回科目列表</div>
        <div class="ch-list">
          ${subChs.map(c => {
            const first = TTScheduler.imageCards([{ subject: c.subject, chapter: c.chapter }])[0];
            return `
            <div class="ch-row" data-ch="${esc(c.chapter)}">
              <img class="ch-thumb" src="${esc(first ? first.image : '')}" loading="lazy" alt="">
              <div class="ch-info">
                <div class="ch-name">${esc(c.chapter)}</div>
                <div class="ch-count">${c.count} 张</div>
              </div>
              <button class="btn-ghost ch-go" data-go="${esc(c.chapter)}">学习本章</button>
            </div>`;
          }).join('')}
        </div>`;
    } else {
      // 三级：该章节的挖空图网格
      const cards = TTScheduler.imageCards([{ subject: App.imgBrowseSub, chapter: App.imgBrowseCh }]);
      inner = `
        <div class="modal-title">${esc(App.imgBrowseSub)} · ${esc(App.imgBrowseCh)}</div>
        <div class="browse-back" id="browse-back">‹ 返回章节列表</div>
        <button class="btn-primary" id="browse-all">学习本章全部（${cards.length}）</button>
        <div class="img-grid">
          ${cards.map(c => `
            <div class="img-cell" data-id="${c.id}" title="点图学习这张卡">
              <img class="img-cell-img" src="${esc(c.image)}" loading="lazy" alt="">
            </div>`).join('')}
        </div>
        <div class="img-grid-tip">👆 点任意一张图，直接学习该卡</div>`;
    }
    openModal(inner);
    bindImageBrowse();
  }

  function bindImageBrowse() {
    const back = $('#browse-back');
    if (back) back.addEventListener('click', () => {
      if (App.imgBrowseCh) App.imgBrowseCh = null;
      else App.imgBrowseSub = null;
      renderImageBrowse();
    });
    const multi = $('#browse-multi');
    if (multi) multi.addEventListener('click', openImageStudy);
    const all = $('#browse-all');
    if (all) all.addEventListener('click', () => {
      startImageStudy([{ subject: App.imgBrowseSub, chapter: App.imgBrowseCh }]);
    });
    $$('.subj-card').forEach(el => el.addEventListener('click', () => {
      App.imgBrowseSub = el.dataset.sub;
      App.imgBrowseCh = null;
      renderImageBrowse();
    }));
    $$('.ch-row').forEach(el => el.addEventListener('click', () => {
      App.imgBrowseCh = el.dataset.ch;
      renderImageBrowse();
    }));
    $$('.ch-go').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      startImageStudy([{ subject: App.imgBrowseSub, chapter: btn.dataset.go }]);
    }));
    $$('.img-cell').forEach(el => el.addEventListener('click', () => {
      const card = TTStore.getById(el.dataset.id);
      if (card) {
        closeModal();
        beginQueue([card], 'subject', 'practice', '看图卡学习完成！', isNewItem);
      }
    }));
  }

  function startWrong() {
    const items = TTScheduler.wrongBook();
    if (items.length === 0) { toast('暂无错题，继续加油！'); return; }
    beginQueue(items, 'wrong', 'practice', '错题重练完成！', () => false);
  }

  function renderLearn() {
    // 考试会话优先
    if (App.exam) { renderExam(); return; }

    if (App.learnQueue.length === 0) {
      $('#learn-body').innerHTML = `
        <div class="learn-done">
          <div class="done-icon">📖</div>
          <div class="done-title">暂无学习任务</div>
          <div class="done-desc">请先在「今日」页开始学习，或到内容库添加内容</div>
          <button class="btn-primary" onclick="TTApp.goToday()">返回今日</button>
        </div>`;
      $('#learn-count').textContent = '0/0';
      $('#learn-progress-bar').style.width = '0%';
      hideExamTimer();
      return;
    }

    if (App.learnSessionDone || App.learnIndex >= App.learnQueue.length) {
      renderLearnDone();
      return;
    }

    const entry = App.learnQueue[App.learnIndex];
    const it = entry.item;
    const total = App.learnQueue.length;

    $('#learn-count').textContent = (App.learnIndex + 1) + '/' + total;
    $('#learn-progress-bar').style.width = (App.learnIndex / total * 100) + '%';
    hideExamTimer();

    const body = $('#learn-body');
    if (it.type === 'quiz') {
      body.innerHTML = renderQuiz(it);
      bindQuiz(it);
    } else {
      body.innerHTML = renderCard(it);
      bindCard(it);
    }
  }

  /* ---------- 选择题（刷题） ---------- */
  function renderQuiz(it) {
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const opts = it.options.map((o, i) => `
      <div class="option" data-i="${i}">
        <span class="opt-key">${letters[i]}</span>
        <span>${esc(o)}</span>
      </div>`).join('');
    const entry = App.learnQueue[App.learnIndex];
    const typeTag = entry.isNew ? '<span class="tag type">新学</span>' : '<span class="tag type">复习</span>';
    const srcTag = App.learnSource === 'subject' ? '<span class="tag sub">科目练习</span>' :
      (App.learnSource === 'wrong' ? '<span class="tag sub">错题重练</span>' : '');
    const multiTag = isMulti(it.answer) ? '<span class="tag sub">多选</span>' : '';
    return `
      <div class="learn-card">
        <div class="learn-meta">
          <span class="tag sub">${esc(it.subject)}</span>
          ${typeTag}${srcTag}${multiTag}
          ${it.reviewCount > 0 ? `<span class="tag sub">已复习 ${it.reviewCount} 次</span>` : ''}
        </div>
        <div class="learn-question">${esc(it.question)}${isMulti(it.answer) ? '<div class="multi-hint">（多选 · 可点选多项后再提交）</div>' : ''}</div>
        <div class="option-list" id="opt-list">${opts}</div>
        <div id="quiz-feedback"></div>
      </div>
      <div class="learn-actions" id="quiz-actions"></div>`;
  }

  function bindQuiz(it) {
    const entry = App.learnQueue[App.learnIndex];
    const optList = $('#opt-list');
    const fb = $('#quiz-feedback');
    const actions = $('#quiz-actions');
    let answered = false;

    // ---------- 多选（answer 为数组） ----------
    if (isMulti(it.answer)) {
      let chosen = [];
      const renderSubmit = () => {
        actions.innerHTML = `<button class="btn-primary" id="btn-multi-submit" ${chosen.length ? '' : 'disabled'}>提交答案</button>`;
        $('#btn-multi-submit').addEventListener('click', () => {
          if (answered) return;
          answered = true;
          App.learnBusy = true;
          chosen.sort((a, b) => a - b);
          const correct = chosen.length === it.answer.length && chosen.every((v, i) => v === it.answer[i]);
          $$('.option').forEach((o, i) => {
            o.classList.add('disabled');
            if (it.answer.indexOf(i) >= 0) o.classList.add('correct');
            if (chosen.indexOf(i) >= 0 && it.answer.indexOf(i) < 0) o.classList.add('wrong');
          });
          fb.innerHTML = correct
            ? `<div class="feedback ok"><div class="fb-title">✓ 回答正确</div>${esc(it.explain || '')}</div>`
            : `<div class="feedback bad"><div class="fb-title">✗ 回答错误，正确答案 ${ansLetters(it.answer)}</div>${esc(it.explain || '')}</div>`;
          const r = TTScheduler.learnItem(it.id, correct ? 'ok' : 'wrong');
          App.learnResults.push({ id: it.id, ok: correct, isNew: entry.isNew });
          actions.innerHTML = `<button class="btn-primary" id="btn-next">${App.learnIndex + 1 >= App.learnQueue.length ? '完成' : '下一题'}</button>`;
          $('#btn-next').addEventListener('click', () => { App.learnIndex++; App.learnBusy = false; renderLearn(); });
        });
      };
      optList.addEventListener('click', e => {
        if (answered) return;
        const opt = e.target.closest('.option');
        if (!opt) return;
        const i = parseInt(opt.dataset.i, 10);
        const k = chosen.indexOf(i);
        if (k >= 0) chosen.splice(k, 1); else chosen.push(i);
        opt.classList.toggle('selected', chosen.indexOf(i) >= 0);
        renderSubmit();
      });
      renderSubmit();
      return;
    }

    // ---------- 单选 ----------
    optList.addEventListener('click', function handler(e) {
      if (answered) return;
      const opt = e.target.closest('.option');
      if (!opt) return;
      answered = true;
      App.learnBusy = true;

      const chosen = parseInt(opt.dataset.i, 10);
      const correct = chosen === it.answer;

      $$('.option').forEach((o, i) => {
        o.classList.add('disabled');
        if (i === it.answer) o.classList.add('correct');
        if (i === chosen && !correct) o.classList.add('wrong');
      });

      fb.innerHTML = correct
        ? `<div class="feedback ok"><div class="fb-title">✓ 回答正确</div>${esc(it.explain || '')}</div>`
        : `<div class="feedback bad"><div class="fb-title">✗ 回答错误，正确答案 ${'ABCDE'[it.answer]}</div>${esc(it.explain || '')}</div>`;

      const ok = correct ? 'ok' : 'wrong';
      const r = TTScheduler.learnItem(it.id, ok);
      App.learnResults.push({ id: it.id, ok: correct, isNew: entry.isNew });

      actions.innerHTML = `
        <button class="btn-primary" id="btn-next">${App.learnIndex + 1 >= App.learnQueue.length ? '完成' : '下一题'}</button>`;
      $('#btn-next').addEventListener('click', () => { App.learnIndex++; App.learnBusy = false; renderLearn(); });
    });
  }

  /* ---------- 记忆卡（Anki） ---------- */
  function renderCard(it) {
    // 图片挖空卡
    if (it.masks && it.masks.length) return renderImageCloze(it);
    const entry = App.learnQueue[App.learnIndex];
    const typeTag = entry.isNew ? '<span class="tag type">新学</span>' : '<span class="tag type">复习</span>';
    const a = TTAnki.ensureAnki(it).anki;
    const stateTag = a.suspended
      ? '<span class="tag sub">已暂停</span>'
      : (a.state === 'new' ? '<span class="tag sub">新卡</span>' :
        (a.state === 'review' ? `<span class="tag sub">间隔 ${TTAnki.fmtInterval(a.interval)}</span>` : '<span class="tag sub">学习中</span>'));
    return `
      <div class="learn-card" style="padding-bottom:0">
        <div class="learn-meta">
          <span class="tag sub">${esc(it.subject)}</span>
          ${typeTag}${stateTag}
          ${it.reviewCount > 0 ? `<span class="tag sub">复习 ${it.reviewCount} 次</span>` : ''}
        </div>
        <div class="flashcard" id="flashcard">
          <div class="flashcard-inner">
            <div class="flashcard-face flashcard-front">
              <div class="fc-title">📌 记忆卡（Anki 间隔重复）</div>
              <div class="fc-text">${esc(it.question)}</div>
              <div class="flashcard-hint">👆 点击卡片翻面查看答案</div>
            </div>
            <div class="flashcard-face flashcard-back">
              <div class="fc-title">答案</div>
              <div class="fc-text">${esc(it.explain || '（无答案内容）')}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="learn-actions anki-actions" id="card-actions"></div>`;
  }

  function bindCard(it) {
    if (it.masks && it.masks.length) { bindImageCloze(it); return; }
    const entry = App.learnQueue[App.learnIndex];
    const fc = $('#flashcard');
    const actions = $('#card-actions');
    let flipped = false;

    fc.addEventListener('click', () => {
      fc.classList.toggle('flipped');
      flipped = !flipped;
      if (flipped) renderAnkiButtons(it);
    });

    actions.innerHTML = `<button class="btn-primary" id="btn-flip-hint">点击卡片翻面，再选择记忆程度</button>`;
    $('#btn-flip-hint').addEventListener('click', () => {
      fc.classList.add('flipped');
      flipped = true;
      renderAnkiButtons(it);
    });
  }

  /* ---------- 图片挖空卡 ---------- */
  function renderImageCloze(it) {
    const entry = App.learnQueue[App.learnIndex];
    const typeTag = entry.isNew ? '<span class="tag type">新学</span>' : '<span class="tag type">复习</span>';
    const a = TTAnki.ensureAnki(it).anki;
    const stateTag = a.suspended
      ? '<span class="tag sub">已暂停</span>'
      : (a.state === 'new' ? '<span class="tag sub">新卡</span>' :
        (a.state === 'review' ? `<span class="tag sub">间隔 ${TTAnki.fmtInterval(a.interval)}</span>` : '<span class="tag sub">学习中</span>'));
    const boxes = it.masks.map((b, i) =>
      `<div class="img-mask" data-i="${i}" style="left:${(b[0] * 100).toFixed(3)}%;top:${(b[1] * 100).toFixed(3)}%;width:${(b[2] * 100).toFixed(3)}%;height:${(b[3] * 100).toFixed(3)}%"></div>`
    ).join('');
    return `
      <div class="learn-card" style="padding-bottom:0">
        <div class="learn-meta">
          <span class="tag sub">${esc(it.subject)}</span>
          <span class="tag">看图记忆卡</span>
          ${it.chapter ? `<span class="tag sub">${esc(it.chapter)}</span>` : ''}
          ${typeTag}${stateTag}
        </div>
        <div class="imgcard" id="imgcard">
          <img class="imgcard-img" src="${esc(it.image)}" alt="看图记忆卡" loading="lazy">
          <div class="imgcard-masks">${boxes}</div>
        </div>
        <div class="imgcard-hint">👆 点击空白处，查看对应答案</div>
      </div>
      <div class="learn-actions anki-actions" id="card-actions"></div>`;
  }

  function bindImageCloze(it) {
    const actions = $('#card-actions');
    let revealed = false;
    const showRatings = () => { if (!revealed) { revealed = true; renderAnkiButtons(it); } };
    // 每个空白可单独点击揭答案
    $$('#imgcard .img-mask').forEach(m => {
      m.addEventListener('click', () => { m.classList.add('revealed'); showRatings(); });
    });
    actions.innerHTML = `<button class="btn-primary" id="btn-reveal-all">显示全部答案</button>`;
    $('#btn-reveal-all').addEventListener('click', () => {
      $$('#imgcard .img-mask').forEach(m => m.classList.add('revealed'));
      showRatings();
    });
  }

  function renderAnkiButtons(it) {
    const actions = $('#card-actions');
    if (!actions) return;
    const pv = r => TTAnki.preview(it, r).label;
    actions.innerHTML = `
      <div class="anki-grid">
        <button class="anki-btn anki-again" data-r="again"><span class="anki-bt">😵 重来</span><span class="anki-pv">${pv('again')}</span></button>
        <button class="anki-btn anki-hard" data-r="hard"><span class="anki-bt">😓 困难</span><span class="anki-pv">${pv('hard')}</span></button>
        <button class="anki-btn anki-good" data-r="good"><span class="anki-bt">👍 良好</span><span class="anki-pv">${pv('good')}</span></button>
        <button class="anki-btn anki-easy" data-r="easy"><span class="anki-bt">🚀 简单</span><span class="anki-pv">${pv('easy')}</span></button>
      </div>`;
    const entry = App.learnQueue[App.learnIndex];
    $$('.anki-btn').forEach(b => {
      b.addEventListener('click', () => {
        if (App.learnBusy) return;
        App.learnBusy = true;
        TTScheduler.learnCard(it.id, b.dataset.r);
        App.learnResults.push({ id: it.id, ok: b.dataset.r !== 'again', isNew: entry.isNew });
        App.learnIndex++;
        App.learnBusy = false;
        renderLearn();
      });
    });
  }

  function renderLearnDone() {
    App.learnSessionDone = true;
    $('#learn-progress-bar').style.width = '100%';
    hideExamTimer();
    const total = App.learnQueue.length;
    const okCount = App.learnResults.filter(r => r.ok).length;
    const okPct = total === 0 ? 0 : okCount / total;
    const confetti = okCount === total && total > 0 ? '🎉' : (okPct >= 0.6 ? '👏' : '💪');
    const backLabel = App.learnBackTo === 'today' ? '返回今日' :
      (App.learnBackTo === 'practice' ? '返回练习中心' : '返回');
    const body = $('#learn-body');
    body.innerHTML = `
      <div class="learn-done">
        <div class="done-icon">${confetti}</div>
        <div class="done-title">${esc(App.learnTitle)}</div>
        <div class="done-desc">共完成 ${total} 项，答对 ${okCount} 项${okCount < total ? '，答错的已安排稍后重刷' : ''}。<br>错题会自动加入错题本，按记忆曲线继续滚动。</div>
        <button class="btn-primary" id="btn-done-again" style="margin-bottom:10px">再学一轮错题</button>
        <button class="btn-ghost" id="btn-done-home" style="width:100%">${backLabel}</button>
      </div>`;
    $('#btn-done-again').addEventListener('click', () => {
      const wrong = App.learnResults.filter(r => !r.ok);
      if (wrong.length === 0) { toast('没有错题啦，太棒了！'); return; }
      const items = wrong.map(r => TTStore.getById(r.id)).filter(Boolean);
      if (items.length === 0) { toast('错题已处理完毕'); return; }
      beginQueue(items, 'wrong', App.learnBackTo, '错题重练完成！', () => false);
    });
    $('#btn-done-home').addEventListener('click', () => switchTab(App.learnBackTo));
  }

  /* ---------- 整卷考试 ---------- */
  function openExam() {
    const pool = TTStore.getContent().filter(x => x.type === 'quiz');
    const totalAvail = pool.length;
    if (totalAvail === 0) { toast('题库暂无选择题，请先导入真题题库'); return; }
    const s = TTStore.getSettings();
    const defCount = Math.min(s.examCount || 20, totalAvail);
    const ys = TTScheduler.quizYears();
    const yearChips = ys.length
      ? `<div class="form-group">
          <label class="form-label">年份筛选（点选，可多选；不选 = 全部年份）</label>
          <div class="year-chips" id="exam-year-chips">
            <span class="year-chip" data-y="all">全部</span>
            ${ys.map(y => `<span class="year-chip" data-y="${y.year}">${y.year}</span>`).join('')}
          </div>
        </div>`
      : '';
    openModal(`
      <div class="modal-title">开始整卷考试</div>
      <div class="form-group">
        <label class="form-label">题目数量（题库共 ${totalAvail} 题）</label>
        <input class="form-input" type="number" min="1" max="${totalAvail}" id="exam-count" value="${defCount}">
      </div>
      <div class="form-group">
        <label class="form-label">考试时长（分钟）</label>
        <input class="form-input" type="number" min="1" id="exam-min" value="${s.examMinutes || 180}">
      </div>
      ${yearChips}
      <div class="exam-note">⚠ 考试中不可查看答案，交卷后统一评分；错题自动进入错题本。</div>
      <div class="modal-actions">
        <button class="btn-cancel" id="exam-cancel">取消</button>
        <button class="btn-primary" id="exam-start">开始考试</button>
      </div>
    `);
    // 年份 chips：默认"全部"
    let selYears = [];
    const chips = $$('#exam-year-chips .year-chip');
    const refreshChips = () => {
      chips.forEach(c => c.classList.toggle('active', (c.dataset.y === 'all' && selYears.length === 0) || selYears.indexOf(Number(c.dataset.y)) >= 0));
    };
    chips.forEach(c => {
      c.addEventListener('click', () => {
        if (c.dataset.y === 'all') { selYears = []; }
        else {
          const y = Number(c.dataset.y);
          const k = selYears.indexOf(y);
          if (k >= 0) selYears.splice(k, 1); else selYears.push(y);
        }
        refreshChips();
      });
    });
    refreshChips();
    $('#exam-cancel').addEventListener('click', closeModal);
    $('#exam-start').addEventListener('click', () => {
      const count = Math.max(1, Math.min(totalAvail, parseInt($('#exam-count').value, 10) || defCount));
      const minutes = Math.max(1, parseInt($('#exam-min').value, 10) || 180);
      closeModal();
      startExam(count, minutes, selYears);
    });
  }

  function startExam(count, minutes, years) {
    const pool = TTScheduler.quizByYears(years);
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const items = shuffled.slice(0, Math.min(count, shuffled.length));
    clearExamTimer();
    App.exam = {
      items, index: 0,
      answers: new Array(items.length).fill(null),
      startAt: Date.now(),
      minutes,
      submitted: false,
      wrong: [],
      timerId: null
    };
    App.learnQueue = [];
    App.learnSessionDone = false;
    switchTab('learn');
    App.exam.timerId = setInterval(tickExam, 1000);
    renderExam();
  }

  function clearExamTimer() {
    if (App.exam && App.exam.timerId) { clearInterval(App.exam.timerId); App.exam.timerId = null; }
  }

  function examRemainMs() {
    const ex = App.exam;
    return ex ? ex.minutes * 60000 - (Date.now() - ex.startAt) : 0;
  }

  function renderExamTimer(ms) {
    const el = $('#exam-timer');
    if (!el) return;
    el.textContent = '⏱ ' + fmtClock(ms);
    el.classList.remove('hidden');
    el.classList.toggle('timing', ms < 60000);
  }
  function hideExamTimer() {
    const el = $('#exam-timer');
    if (el) { el.classList.add('hidden'); el.textContent = ''; }
  }

  function tickExam() {
    if (!App.exam || App.exam.submitted) return;
    const remain = examRemainMs();
    renderExamTimer(Math.max(0, remain));
    if (remain <= 0) { submitExam(); toast('时间到，自动交卷'); }
  }

  function renderExam() {
    const ex = App.exam;
    if (!ex) { renderLearn(); return; }
    if (ex.submitted) { renderExamResult(); return; }
    const item = ex.items[ex.index];
    const total = ex.items.length;
    $('#learn-count').textContent = (ex.index + 1) + '/' + total;
    $('#learn-progress-bar').style.width = ((ex.index) / total * 100) + '%';
    renderExamTimer(examRemainMs());
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const multi = isMulti(item.answer);
    const opts = item.options.map((o, i) => `
      <div class="option ${ansHas(ex.answers[ex.index], i) ? 'selected' : ''}" data-i="${i}">
        <span class="opt-key">${letters[i]}</span><span>${esc(o)}</span>
      </div>`).join('');
    $('#learn-body').innerHTML = `
      <div class="learn-card exam-card">
        <div class="learn-meta"><span class="tag sub">${esc(item.subject)}</span><span class="tag">整卷考试</span>${multi ? '<span class="tag sub">多选</span>' : ''}</div>
        <div class="learn-question">${esc(item.question)}${multi ? '<div class="multi-hint">（多选 · 可点选多项）</div>' : ''}</div>
        <div class="option-list">${opts}</div>
      </div>
      <div class="exam-nav">
        <button class="btn-ghost" id="exam-prev" ${ex.index === 0 ? 'disabled' : ''}>上一题</button>
        <span class="exam-nav-info">${ex.index + 1} / ${total}</span>
        ${ex.index + 1 >= total
          ? `<button class="btn-primary" id="exam-submit">交卷</button>`
          : `<button class="btn-primary" id="exam-next">下一题</button>`}
      </div>`;
    $('#exam-prev').addEventListener('click', () => { ex.index--; renderExam(); });
    if ($('#exam-next')) $('#exam-next').addEventListener('click', () => { ex.index++; renderExam(); });
    if ($('#exam-submit')) $('#exam-submit').addEventListener('click', submitExam);
    $$('#learn-body .option').forEach(o => {
      o.addEventListener('click', () => {
        ex.answers[ex.index] = ansSet(ex.answers[ex.index], parseInt(o.dataset.i, 10), multi);
        renderExam();
      });
    });
  }

  function submitExam() {
    const ex = App.exam;
    if (!ex || ex.submitted) return;
    clearExamTimer();
    ex.submitted = true;
    ex.wrong = [];
    let correct = 0;
    ex.items.forEach((it, i) => {
      const ans = ex.answers[i];
      if (sameAnswer(ans, it.answer)) { correct++; }
      else {
        ex.wrong.push({ item: it, chosen: ans, correct: it.answer });
        if (ans != null) {
          TTStore.updateContent(it.id, {
            wrongCount: (it.wrongCount || 0) + 1,
            lastResult: 'wrong',
            lastReviewDate: TTStore.todayStr()
          });
        }
      }
    });
    const total = ex.items.length;
    const pct = Math.round(correct / total * 100);
    TTStore.logDay(TTStore.todayStr(), { review: total, correct, wrong: total - correct });
    TTStore.setLastDate(TTStore.todayStr());
    ex.correct = correct;
    ex.pct = pct;
    ex.seconds = Math.floor((Date.now() - ex.startAt) / 1000);
    TTStore.addExam({ date: TTStore.todayStr(), total, correct, pct, seconds: ex.seconds });
    renderExamResult();
  }

  function renderExamResult() {
    const ex = App.exam;
    const grade = ex.pct >= 90 ? '🏆 优秀' : ex.pct >= 70 ? '👏 良好' : ex.pct >= 60 ? '💪 及格' : '📚 需加强';
    const icon = grade.split(' ')[0];
    const m = Math.floor(ex.seconds / 60), s = ex.seconds % 60;
    const wrongHtml = ex.wrong.length
      ? ex.wrong.map(w => `
        <div class="exam-wrong">
          <div class="ex-q">${esc(w.item.question)}</div>
          <div class="ex-a">你的答案：${ansLetters(w.chosen)} · 正确：${ansLetters(w.correct)}</div>
        </div>`).join('')
      : '<div class="exam-wrong ok">全部答对！🎉</div>';
    $('#learn-count').textContent = '完成';
    $('#learn-progress-bar').style.width = '100%';
    hideExamTimer();
    $('#learn-body').innerHTML = `
      <div class="learn-done">
        <div class="done-icon">${icon}</div>
        <div class="done-title">考试结束 ${ex.pct}分</div>
        <div class="done-desc">共 ${ex.total} 题 · 答对 ${ex.correct} 题<br>用时 ${m > 0 ? m + '分' : ''}${s}秒 · ${grade}</div>
        <button class="btn-primary" id="exam-again" style="margin-bottom:10px">再做一次</button>
        <button class="btn-ghost" id="exam-back" style="width:100%">返回练习中心</button>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-title">错题回顾</div>${wrongHtml}</div>`;
    $('#exam-again').addEventListener('click', openExam);
    $('#exam-back').addEventListener('click', () => { App.exam = null; switchTab('practice'); });
  }

  /* ================= 内容库 ================= */
  function libMatch(it, kw) {
    if (!kw) return true;
    kw = kw.toLowerCase();
    return [it.question, it.subject, it.explain, it.note]
      .map(s => (s || '').toLowerCase())
      .some(s => s.indexOf(kw) >= 0);
  }

  /** 单个内容条目 HTML（含章节标签） */
  function itemHTML(it) {
    let stateTag;
    if (it.type === 'card') {
      TTAnki.ensureAnki(it);
      const a = it.anki;
      stateTag = a.suspended
        ? '<span class="tag sub">⏸ 已暂停</span>'
        : (a.state === 'new' ? '<span class="tag type">新卡</span>' :
          (a.state === 'review' ? `<span class="tag sub">复习中 · 间隔 ${TTAnki.fmtInterval(a.interval)}</span>` : '<span class="tag sub">学习中</span>'));
    } else {
      stateTag = it.stage < 0 ? '<span class="tag sub">未学习</span>' :
        (it.graduated ? '<span class="tag sub">✅ 已毕业</span>' :
          `<span class="tag sub">阶段 ${it.stage + 1}/${TTStore.getSettings().intervals.length}</span>`);
    }
    const meta = [
      `<span class="tag ${it.type === 'quiz' ? 'type' : ''}">${it.type === 'quiz' ? '选择题' : '记忆卡'}</span>`,
      `<span class="tag sub">${esc(it.subject)}</span>`,
      it.chapter ? `<span class="tag sub">${esc(it.chapter)}</span>` : '',
      stateTag,
      it.reviewCount > 0 ? `<span class="tag sub">复习 ${it.reviewCount} 次</span>` : ''
    ].join('');
    const suspendBtn = it.type === 'card'
      ? `<button class="li-icon" data-suspend="${it.id}" title="${it.anki && it.anki.suspended ? '恢复' : '暂停'}">${it.anki && it.anki.suspended ? '▶' : '⏸'}</button>`
      : '';
    return `
      <div class="lib-item">
        <div class="li-main">
          <div class="li-title">${esc(it.question)}</div>
          <div class="li-meta">${meta}</div>
          ${it.note ? `<div class="li-note">📝 ${esc(truncate(it.note, 70))}</div>` : ''}
        </div>
        <div class="li-btns">
          <button class="li-icon ${it.fav ? 'fav-on' : ''}" data-fav="${it.id}" title="${it.fav ? '取消收藏' : '收藏'}">${it.fav ? '★' : '☆'}</button>
          <button class="li-icon" data-note="${it.id}" title="笔记">✎</button>
          ${suspendBtn}
          <button class="li-icon del" data-id="${it.id}" title="删除">✕</button>
        </div>
      </div>`;
  }

  function renderLibrary() {
    const all = TTStore.getContent();
    const el0 = $('#lib-count');
    if (el0) {
      const imgTotal = all.filter(c => c.masks && c.masks.length).length;
      el0.textContent = '共 ' + all.length + ' 条 · 图片挖空卡 ' + imgTotal + ' 张';
    }
    let list = all;
    if (App.libFilter === 'quiz') list = all.filter(x => x.type === 'quiz');
    else if (App.libFilter === 'card') list = all.filter(x => x.type === 'card');
    else if (App.libFilter === 'graduated') list = all.filter(x => TTScheduler.isGraduated(x));
    else if (App.libFilter === 'fav') list = all.filter(x => x.fav);
    if (App.libSearch) list = list.filter(x => libMatch(x, App.libSearch));

    const el = $('#lib-list');

    // 分组视图：按科目 → 章节
    if (App.libView === 'group' && !App.libSearch) {
      if (list.length === 0) {
        el.innerHTML = `<div class="card" style="text-align:center;color:var(--text-3)">暂无内容，点击右上角「＋」添加</div>`;
        return;
      }
      const groups = {};   // subject -> chapter -> items[]
      list.forEach(it => {
        const sub = it.subject || '未分类';
        const ch = it.chapter || '未分章';
        groups[sub] = groups[sub] || {};
        groups[sub][ch] = groups[sub][ch] || [];
        groups[sub][ch].push(it);
      });
      const subjects = Object.keys(groups).sort((a, b) => {
        const ca = groups[a], cb = groups[b];
        const ta = Object.values(ca).reduce((s, x) => s + x.length, 0);
        const tb = Object.values(cb).reduce((s, x) => s + x.length, 0);
        return tb - ta;
      });
      el.innerHTML = subjects.map(sub => {
        const chapters = Object.keys(groups[sub]).sort((a, b) => groups[sub][b].length - groups[sub][a].length);
        const chapHtml = chapters.map(ch => `
          <div class="lib-group-chapter">
            <div class="lib-group-chapter-title">${esc(ch)}<span class="lib-group-count">${groups[sub][ch].length}</span></div>
            ${groups[sub][ch].map(itemHTML).join('')}
          </div>`).join('');
        const subTotal = Object.values(groups[sub]).reduce((s, x) => s + x.length, 0);
        return `
          <div class="lib-group-subject">
            <div class="lib-group-subject-title">📘 ${esc(sub)}<span class="lib-group-count">${subTotal}</span></div>
            ${chapHtml}
          </div>`;
      }).join('');
      return;
    }

    // 平铺视图（分页渲染，避免一次渲染上千条卡顿）
    if (list.length === 0) {
      el.innerHTML = `<div class="card" style="text-align:center;color:var(--text-3)">暂无匹配内容，点击右上角「＋」添加</div>`;
      return;
    }
    const shown = list.slice(0, App.libLimit);
    el.innerHTML = shown.map(itemHTML).join('');
    if (list.length > App.libLimit) {
      el.insertAdjacentHTML('beforeend',
        `<div class="card lib-more" id="lib-more" style="text-align:center;color:var(--primary);font-weight:600;cursor:pointer">显示更多（还有 ${list.length - App.libLimit} 条）</div>`);
      $('#lib-more').addEventListener('click', () => {
        App.libLimit += 300;
        renderLibrary();
      });
    }
  }

  function openNoteModal(id) {
    const it = TTStore.getById(id);
    if (!it) return;
    openModal(`
      <div class="modal-title">记笔记</div>
      <div class="form-group"><label class="form-label">题目</label><div class="note-q">${esc(it.question)}</div></div>
      <div class="form-group">
        <label class="form-label">我的笔记</label>
        <textarea class="form-textarea" id="note-text" placeholder="记录心得、易错点、口诀...">${esc(it.note || '')}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" id="note-cancel">取消</button>
        <button class="btn-primary" id="note-save">保存</button>
      </div>
    `);
    $('#note-cancel').addEventListener('click', closeModal);
    $('#note-save').addEventListener('click', () => {
      const note = $('#note-text').value.trim();
      TTStore.updateContent(id, { note, noteUpdated: note ? Date.now() : null });
      closeModal();
      toast('笔记已保存');
      renderLibrary();
    });
  }

  function bindLibrary() {
    $('#lib-list').addEventListener('click', e => {
      const del = e.target.closest('.li-icon[data-id]');
      if (del) {
        const id = del.dataset.id;
        if (confirm('确定删除这条内容吗？学习记录将一并清除。')) {
          TTStore.removeContent(id);
          renderLibrary();
          toast('已删除');
        }
        return;
      }
      const susp = e.target.closest('.li-icon[data-suspend]');
      if (susp) {
        const id = susp.dataset.suspend;
        const item = TTStore.getById(id);
        if (item && item.type === 'card') {
          TTAnki.ensureAnki(item);
          TTStore.updateContent(id, { anki: Object.assign({}, item.anki, { suspended: !item.anki.suspended }) });
          renderLibrary();
          toast(item.anki.suspended ? '已暂停复习' : '已恢复复习');
        }
        return;
      }
      const fav = e.target.closest('.li-icon[data-fav]');
      if (fav) {
        const id = fav.dataset.fav;
        const item = TTStore.getById(id);
        if (item) {
          TTStore.updateContent(id, { fav: !item.fav });
          renderLibrary();
          toast(item.fav ? '已取消收藏' : '已收藏');
        }
        return;
      }
      const note = e.target.closest('.li-icon[data-note]');
      if (note) openNoteModal(note.dataset.note);
    });

    // 搜索
    const search = $('#lib-search');
    search.addEventListener('input', () => {
      App.libSearch = search.value.trim();
      renderLibrary();
    });
  }

  /* ================= 错题本 ================= */
  function openWrongBook() {
    const book = TTScheduler.wrongBook();
    if (book.length === 0) { toast('暂无错题，继续加油！'); return; }
    openModal(`
      <div class="modal-title">错题本</div>
      <div class="wrong-summary">共 ${book.length} 道错题，点击「全部重练」逐个击破</div>
      <div class="wrong-list-wrap">
        ${book.map(w => `
          <div class="wrong-row">
            <div class="wr-q">[${esc(w.subject)}] ${esc(truncate(w.question, 36))}</div>
            <div class="wr-count">错 ${w.wrongCount} 次</div>
          </div>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" id="wrong-close">关闭</button>
        <button class="btn-primary" id="wrong-practice">重练全部（${book.length}）</button>
      </div>
    `);
    $('#wrong-close').addEventListener('click', closeModal);
    $('#wrong-practice').addEventListener('click', () => { closeModal(); startWrong(); });
  }

  /* ================= 统计页 ================= */
  function renderStats() {
    const content = TTStore.getContent();
    const graduated = content.filter(x => TTScheduler.isGraduated(x)).length;
    const accuracy = TTScheduler.accuracy();
    const streak = TTScheduler.streak();

    $('#s-total').textContent = content.length;
    $('#s-graduated').textContent = graduated;
    $('#s-accuracy').textContent = accuracy === null ? '--' : accuracy + '%';
    $('#s-streak').textContent = streak;

    // 日历
    const cal = $('#calendar');
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    let html = weekdays.map(d => `<div class="cal-day weekday">${d}</div>`).join('');
    const log = TTStore.getLog();
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - 29);
    const offset = start.getDay();
    start.setDate(start.getDate() - offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 41);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = TTStore.todayStr(d);
      const day = log[key];
      const isToday = key === TTStore.todayStr();
      let cls = 'cal-day';
      if (day && (day.review > 0 || day.newLearned > 0)) {
        const total = (day.review || 0) + (day.newLearned || 0);
        cls += total >= 8 ? ' hot' : ' mid';
      }
      if (isToday) cls += ' today';
      html += `<div class="${cls}">${d.getDate()}</div>`;
    }
    cal.innerHTML = html;

    // 各科掌握度
    renderMasteryList($('#subject-bars'), TTScheduler.subjectMastery());
  }

  /* ================= 模态框通用 ================= */
  function openModal(html) {
    const mask = $('#modal-mask');
    mask.innerHTML = `<div class="modal">${html}</div>`;
    mask.classList.remove('hidden');
  }
  function closeModal() {
    $('#modal-mask').classList.add('hidden');
    $('#modal-mask').innerHTML = '';
  }

  /* ================= 添加内容 ================= */
  function openAddModal() {
    let type = 'quiz';
    openModal(`
      <div class="modal-title">添加学习内容</div>
      <div class="form-group">
        <div class="radio-row" id="add-type">
          <div class="radio-pill active" data-type="quiz">选择题</div>
          <div class="radio-pill" data-type="card">记忆卡</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">科目</label>
        <input class="form-input" id="add-subject" placeholder="如：生理学">
      </div>
      <div class="form-group">
        <label class="form-label">章节（可选）</label>
        <input class="form-input" id="add-chapter" placeholder="如：血液循环">
      </div>
      <div id="add-fields"></div>
      <div class="modal-actions">
        <button class="btn-cancel" id="add-cancel">取消</button>
        <button class="btn-primary" id="add-save">保存</button>
      </div>
    `);

    const fields = $('#add-fields');
    function renderFields() {
      if (type === 'quiz') {
        fields.innerHTML = `
          <div class="form-group">
            <label class="form-label">题干</label>
            <textarea class="form-textarea" id="add-question" placeholder="输入题目"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">选项（4 个）</label>
            ${['A', 'B', 'C', 'D'].map((k, i) => `
              <div class="form-opt">
                <span class="opt-key">${k}</span>
                <input class="form-input" id="opt-${i}" placeholder="选项 ${k}">
              </div>`).join('')}
          </div>
          <div class="form-group">
            <label class="form-label">正确答案</label>
            <select class="form-select" id="add-answer">
              <option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">解析（可选）</label>
            <textarea class="form-textarea" id="add-explain" placeholder="答案解析"></textarea>
          </div>`;
      } else {
        fields.innerHTML = `
          <div class="form-group">
            <label class="form-label">正面（问题/知识点）</label>
            <textarea class="form-textarea" id="add-question" placeholder="输入问题或知识点"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">背面（答案）</label>
            <textarea class="form-textarea" id="add-explain" placeholder="输入答案内容"></textarea>
          </div>`;
      }
    }
    renderFields();

    $$('#add-type .radio-pill').forEach(p => {
      p.addEventListener('click', () => {
        $$('#add-type .radio-pill').forEach(x => x.classList.remove('active'));
        p.classList.add('active');
        type = p.dataset.type;
        renderFields();
      });
    });

    $('#add-cancel').addEventListener('click', closeModal);
    $('#add-save').addEventListener('click', () => {
      const subject = $('#add-subject').value.trim() || '未分类';
      const chapter = $('#add-chapter').value.trim();
      const question = $('#add-question').value.trim();
      if (!question) { toast('请填写内容'); return; }
      if (type === 'quiz') {
        const options = [0, 1, 2, 3].map(i => $('#opt-' + i).value.trim());
        if (options.some(o => !o)) { toast('请填写完整 4 个选项'); return; }
        TTStore.addContent({
          type: 'quiz', subject, chapter, question,
          options, answer: parseInt($('#add-answer').value, 10),
          explain: $('#add-explain').value.trim()
        });
      } else {
        TTStore.addContent({
          type: 'card', subject, chapter, question,
          explain: $('#add-explain').value.trim()
        });
      }
      closeModal();
      toast('已添加，明天将进入复习队列');
      renderLibrary();
      renderToday();
    });
  }

  /* ================= 导入 / 导出 ================= */
  function openExport() {
    const data = TTStore.exportAll();
    openModal(`
      <div class="modal-title">导出数据</div>
      <div class="form-group">
        <label class="form-label">复制以下 JSON 保存（含内容、设置与学习记录）：</label>
        <textarea class="form-textarea" style="min-height:180px;font-size:12px;font-family:monospace" readonly id="export-text">${esc(data)}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" id="export-copy">复制</button>
        <button class="btn-primary" id="export-close">关闭</button>
      </div>
    `);
    $('#export-close').addEventListener('click', closeModal);
    $('#export-copy').addEventListener('click', () => {
      const ta = $('#export-text');
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      toast('已复制到剪贴板');
    });
  }

  function openImport() {
    openModal(`
      <div class="modal-title">导入数据</div>
      <div class="form-group">
        <label class="form-label">粘贴 JSON：<b>①本应用导出的 {app:"tiantian-gundong",…}</b> 或 <b>②内容数组（如图片挖空卡 [ {...},… ]）</b>：</label>
        <textarea class="form-textarea" style="min-height:160px;font-size:12px;font-family:monospace" id="import-text" placeholder='{"app":"tiantian-gundong", ...}
或
[{"type":"card","subject":"外科学","chapter":"骨科","image":"images/xx.png","masks":[[0.4,0.1,0.2,0.02]]}]'></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" id="import-cancel">取消</button>
        <button class="btn-primary" id="import-save">导入</button>
      </div>
    `);
    $('#import-cancel').addEventListener('click', closeModal);
    $('#import-save').addEventListener('click', () => {
      try {
        const data = JSON.parse($('#import-text').value);
        let n;
        if (data && data.app === 'tiantian-gundong') {
          n = TTStore.importAll($('#import-text').value);
        } else if (Array.isArray(data)) {
          n = TTStore.bulkAdd(data);
        } else {
          throw new Error('无法识别的 JSON 格式（需本应用导出格式，或内容数组）');
        }
        TTAnki.migrate();
        toast('导入成功，共 ' + n + ' 条内容');
        closeModal();
        renderToday();
        renderLibrary();
        renderStats();
      } catch (e) {
        toast('导入失败：' + e.message);
      }
    });
  }

  /* ================= 题库 CSV 导入 ================= */
  function openCsvImport() {
    const template = [
      'type,subject,chapter,question,optionA,optionB,optionC,optionD,answer,explain',
      'quiz,生理学,血液,血浆胶体渗透压主要由什么维持?,白蛋白,球蛋白,纤维蛋白原,NaCl,A,血浆胶体渗透压主要由白蛋白维持。',
      'card,生理学,神经-肌肉,神经-骨骼肌接头兴奋传递的递质?,,,,,,乙酰胆碱（ACh）。'
    ].join('\n');
    openModal(`
      <div class="modal-title">导入题库（CSV）</div>
      <div class="form-group">
        <label class="form-label">① 选择 CSV 文件（UTF-8）或直接粘贴</label>
        <input class="form-input" type="file" id="csv-file" accept=".csv,text/csv,.txt">
      </div>
      <div class="form-group">
        <div class="csv-label-row">
          <label class="form-label" style="margin:0">② 粘贴 / 编辑 CSV（带表头）</label>
          <button class="btn-ghost csv-tpl" id="csv-tpl">填入示例模板</button>
        </div>
        <textarea class="form-textarea csv-area" id="csv-text" placeholder="${esc(template)}"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">③ 预览</label>
        <div class="csv-preview" id="csv-preview">尚未解析。填入内容后点「解析预览」。</div>
      </div>
      <div class="template-hint">记忆卡只需 <b>type,subject,chapter,question,explain</b>（type 填 <b>card</b>，选项列留空）。answer 支持 A/B/C/D 或 1-4。加了 <b>chapter</b>（章节）列，导入后就会按「科目→章节」自动划分。</div>
      <div class="modal-actions">
        <button class="btn-cancel" id="csv-cancel">取消</button>
        <button class="btn-primary" id="csv-do">解析预览</button>
      </div>
    `);
    const ta = $('#csv-text');
    const fileIn = $('#csv-file');
    const preview = $('#csv-preview');

    function parseNow() {
      const res = TTStore.parseCsv(ta.value);
      if (res.items.length === 0) {
        preview.innerHTML = `<div class="csv-err">可导入 0 条${res.errors.length ? ' · ' + esc(res.errors.join('；')) : ''}</div>`;
      } else {
        const qz = res.items.filter(i => i.type === 'quiz').length;
        const cd = res.items.length - qz;
        preview.innerHTML = `<div class="csv-ok">✅ 可导入 <b>${res.items.length}</b> 条（选择题 ${qz} · 记忆卡 ${cd}）</div>` +
          (res.errors.length ? `<div class="csv-warn">⚠ ${esc(res.errors.join('；'))}</div>` : '');
      }
      return res;
    }

    $('#csv-tpl').addEventListener('click', () => { ta.value = template; parseNow(); });
    fileIn.addEventListener('change', () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        let txt = String(reader.result || '');
        if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1); // 去 BOM
        ta.value = txt;
        parseNow();
      };
      reader.readAsText(f, 'utf-8');
    });
    ta.addEventListener('input', () => parseNow());

    $('#csv-cancel').addEventListener('click', closeModal);
    $('#csv-do').addEventListener('click', () => {
      const res = parseNow();
      if (res.items.length === 0) { toast('没有可导入的数据，请检查 CSV 格式'); return; }
      const n = TTStore.bulkAdd(res.items);
      closeModal();
      toast('题库导入成功，共 ' + n + ' 条');
      renderLibrary();
      renderToday();
    });
  }

  /* ================= Anki 卡组导入 ================= */
  function openAnkiImport() {
    openModal(`
      <div class="modal-title">导入 Anki 卡组</div>
      <div class="template-hint" style="margin-bottom:14px">
        从 <b>Anki 桌面端 › 文件 › 导出</b>，导出格式选「纯文本 Notes in Plain Text」或「CSV」，
        勾选 <b>包含标签</b>。然后在此粘贴或选择文件导入。标签会用作 <b>科目/章节</b>（第 1 个标签=科目，第 2 个=章节）。
      </div>
      <div class="form-group">
        <label class="form-label">选择 Anki 导出文件（Tab 分隔纯文本 / CSV，UTF-8）或粘贴</label>
        <input class="form-input" type="file" id="anki-file" accept=".txt,.csv,.tsv,text/plain,text/csv">
      </div>
      <div class="form-group">
        <div class="csv-label-row">
          <label class="form-label" style="margin:0">粘贴 Anki 导出内容</label>
          <button class="btn-ghost csv-tpl" id="anki-tpl">填入示例</button>
        </div>
        <textarea class="form-textarea csv-area" id="anki-text" placeholder="Front\tBack\tTags&#10;医学问题1\t答案1\t生理学 血液循环&#10;医学问题2\t答案2\t生理学 神经-肌肉"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">固定科目（留空则用第 1 个标签）</label>
          <input class="form-input" id="anki-subject" placeholder="如：生理学">
        </div>
        <div class="form-group">
          <label class="form-label">固定章节（可选）</label>
          <input class="form-input" id="anki-chapter" placeholder="留空则用第 2 个标签">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">预览</label>
        <div class="csv-preview" id="anki-preview">尚未解析。</div>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" id="anki-cancel">取消</button>
        <button class="btn-primary" id="anki-do">解析预览</button>
      </div>
    `);
    const ta = $('#anki-text');
    const preview = $('#anki-preview');

    function parseNow() {
      const res = TTStore.parseAnki(ta.value, {
        subject: $('#anki-subject').value.trim(),
        chapter: $('#anki-chapter').value.trim()
      });
      if (res.items.length === 0) {
        preview.innerHTML = `<div class="csv-err">可导入 0 条${res.errors.length ? ' · ' + esc(res.errors.join('；')) : ''}</div>`;
      } else {
        preview.innerHTML = `<div class="csv-ok">✅ 可导入 <b>${res.items.length}</b> 张记忆卡</div>` +
          (res.errors.length ? `<div class="csv-warn">⚠ ${esc(res.errors.join('；'))}</div>` : '');
      }
      return res;
    }

    $('#anki-tpl').addEventListener('click', () => {
      ta.value = 'Front\tBack\tTags\n医学问题1\t答案1\t生理学 血液循环\n医学问题2\t答案2\t生理学 神经-肌肉';
      parseNow();
    });
    const fileIn = $('#anki-file');
    fileIn.addEventListener('change', () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        let txt = String(reader.result || '');
        if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
        ta.value = txt;
        parseNow();
      };
      reader.readAsText(f, 'utf-8');
    });
    ta.addEventListener('input', parseNow);
    $('#anki-subject').addEventListener('input', parseNow);
    $('#anki-chapter').addEventListener('input', parseNow);
    $('#anki-cancel').addEventListener('click', closeModal);
    $('#anki-do').addEventListener('click', () => {
      const res = parseNow();
      if (res.items.length === 0) { toast('没有可导入的卡组，请检查 Anki 导出格式'); return; }
      const n = TTStore.bulkAdd(res.items);
      closeModal();
      toast('Anki 卡组导入成功，共 ' + n + ' 张记忆卡');
      renderLibrary();
      renderToday();
    });
  }

  /* ================= 设置 ================= */
  function openSettings() {
    const s = TTStore.getSettings();
    const a = Object.assign({}, TTAnki.DEFAULT_ANKI, s.anki || {});
    openModal(`
      <div class="modal-title">设置</div>
      <div class="form-group">
        <label class="form-label">外观</label>
        <div class="radio-row" id="set-theme-row">
          <div class="radio-pill ${s.darkMode ? '' : 'active'}" data-theme="light">☀️ 浅色</div>
          <div class="radio-pill ${s.darkMode ? 'active' : ''}" data-theme="dark">🌙 深色</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">每日新学目标（条）</label>
        <input class="form-input" type="number" min="0" max="100" id="set-daily" value="${s.dailyNew}">
      </div>
      <div class="form-group">
        <label class="form-label">选择题复习间隔（天，逗号分隔）</label>
        <input class="form-input" id="set-intervals" value="${s.intervals.join(',')}" placeholder="1,2,4,7,15,30">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">整卷考试时长（分钟）</label>
          <input class="form-input" type="number" min="1" id="set-exammin" value="${s.examMinutes || 180}">
        </div>
        <div class="form-group">
          <label class="form-label">整卷题目数</label>
          <input class="form-input" type="number" min="1" id="set-examcount" value="${s.examCount || 20}">
        </div>
      </div>
      <div class="form-group" style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">
        <label class="form-label" style="font-weight:700;color:var(--text)">Anki 记忆卡参数</label>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">学习步骤（分钟，逗号分隔）</label>
          <input class="form-input" id="set-steps" value="${a.learningSteps.join(',')}" placeholder="1,10">
        </div>
        <div class="form-group">
          <label class="form-label">毕业间隔（天）</label>
          <input class="form-input" type="number" min="1" id="set-grad" value="${a.graduatingInterval}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">简易间隔（天）</label>
          <input class="form-input" type="number" min="1" id="set-easy" value="${a.easyInterval}">
        </div>
        <div class="form-group">
          <label class="form-label">简易加成（倍）</label>
          <input class="form-input" type="number" step="0.1" min="1" id="set-bonus" value="${a.easyBonus}">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" id="set-cancel">取消</button>
        <button class="btn-primary" id="set-save">保存</button>
      </div>
      <div style="margin-top:14px;text-align:center">
        <button class="btn-ghost" id="set-bundled" style="margin-bottom:10px;color:var(--primary-dark);border-color:#b7e3d4">重新导入内置图片挖空卡</button>
        <br>
        <button class="btn-ghost" id="set-reset" style="color:var(--danger);border-color:#fecaca">重置所有数据</button>
      </div>
    `);
    $('#set-cancel').addEventListener('click', closeModal);
    $$('#set-theme-row .radio-pill').forEach(p => {
      p.addEventListener('click', () => {
        $$('#set-theme-row .radio-pill').forEach(x => x.classList.remove('active'));
        p.classList.add('active');
      });
    });
    $('#set-bundled').addEventListener('click', () => {
      importBundled();
      TTAnki.migrate();
      closeModal();
      toast('已检查/补全内置图片卡');
      renderToday();
      renderLibrary();
      renderStats();
    });
    $('#set-save').addEventListener('click', () => {
      const daily = Math.max(0, parseInt($('#set-daily').value, 10) || 0);
      const intervals = $('#set-intervals').value.split(/[,，\s]+/).map(Number).filter(n => n > 0);
      if (intervals.length === 0) { toast('选择题间隔格式不正确'); return; }
      const steps = $('#set-steps').value.split(/[,，\s]+/).map(Number).filter(n => n > 0);
      const grad = Math.max(1, parseInt($('#set-grad').value, 10) || 1);
      const easyI = Math.max(1, parseInt($('#set-easy').value, 10) || 1);
      const bonus = Math.max(1, parseFloat($('#set-bonus').value) || 1.3);
      const examMin = Math.max(1, parseInt($('#set-exammin').value, 10) || 180);
      const examCount = Math.max(1, parseInt($('#set-examcount').value, 10) || 20);
      const activeTheme = $('.radio-pill.active[data-theme]');
      const darkMode = activeTheme ? activeTheme.dataset.theme === 'dark' : !!s.darkMode;
      TTStore.saveSettings({
        dailyNew: daily,
        intervals,
        examMinutes: examMin,
        examCount,
        darkMode,
        anki: {
          learningSteps: steps.length > 0 ? steps : [1, 10],
          graduatingInterval: grad,
          easyInterval: easyI,
          easyBonus: bonus
        }
      });
      applyTheme();
      closeModal();
      toast('设置已保存');
      renderToday();
    });
    $('#set-reset').addEventListener('click', () => {
      if (confirm('确定清空全部数据（内容、进度、记录）？此操作不可恢复！')) {
        TTStore.resetAll();
        importBundled();
        removeSamples();
        TTAnki.migrate();
        closeModal();
        toast('已重置，重新载入图片挖空卡');
        renderToday();
        renderLibrary();
        renderStats();
      }
    });
  }

  /* ================= 事件绑定 & 启动 ================= */
  function exitLearn() {
    if (App.exam && !App.exam.submitted) {
      if (confirm('退出考试？本次答题将不保存。')) {
        clearExamTimer();
        App.exam = null;
        App.learnQueue = [];
        App.learnSessionDone = false;
        switchTab('practice');
      }
      return;
    }
    if (confirm('退出本次学习？进度已保存。')) {
      App.learnQueue = [];
      App.learnSessionDone = false;
      clearExamTimer();
      App.exam = null;
      switchTab(App.learnBackTo || 'today');
    }
  }

  function bindEvents() {
    $$('.tab').forEach(t => t.addEventListener('click', () => {
      if (t.dataset.tab === 'learn' && App.learnQueue.length === 0 && !App.learnSessionDone && !App.exam) {
        App.learnQueue = [];
        App.learnSessionDone = false;
      }
      switchTab(t.dataset.tab);
    }));

    // 模式切换
    $$('#mode-seg .seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        App.learnMode = b.dataset.mode;
        renderToday();
      });
    });

    // 任务段点击
    $('#task-list').addEventListener('click', e => {
      const row = e.target.closest('.task-row');
      if (!row) return;
      const action = row.dataset.action;
      if (action === 'quiz') startLearning('quiz');
      else if (action === 'card') startLearning('card');
      else if (action === 'wrong') openWrongBook();
    });

    $('#btn-start').addEventListener('click', () => startLearning());
    $('#btn-exit-learn').addEventListener('click', exitLearn);
    $('#btn-plan').addEventListener('click', () => switchTab('practice'));

    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-add').addEventListener('click', openAddModal);
    $('#btn-export').addEventListener('click', openExport);
    $('#btn-import').addEventListener('click', openImport);
    on('#btn-csv', 'click', openCsvImport);
    on('#btn-anki', 'click', openAnkiImport);

    // 练习中心入口
    $('#entry-record').addEventListener('click', () => switchTab('stats'));
    $('#entry-exam').addEventListener('click', openExam);
    $('#entry-wrong').addEventListener('click', openWrongBook);
    on('#entry-img', 'click', openImageBrowse);
    on('#entry-qbank', 'click', openQBank);
    on('#entry-year', 'click', openYearPractice);
    $('#entry-search').addEventListener('click', () => {
      App.libFilter = 'all';
      App.libSearch = '';
      $('#lib-search').value = '';
      switchTab('library');
      setTimeout(() => $('#lib-search').focus(), 100);
    });

    // 按章节练习（下钻）
    $('#subj-practice').addEventListener('click', e => {
      if (e.target.closest('#subj-back')) {
        App.practiceSubject = null;
        renderPractice();
        return;
      }
      const row = e.target.closest('.subj-row');
      if (!row) return;
      const subject = row.dataset.subject;
      const chapter = row.dataset.chapter;
      if (chapter) startChapter(subject, chapter);
      else { App.practiceSubject = subject; renderPractice(); }
    });

    // 内容库筛选
    $$('#lib-type-seg .seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        $$('#lib-type-seg .seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        App.libFilter = b.dataset.type;
        renderLibrary();
      });
    });

    // 内容库视图（平铺 / 分组）
    $$('#lib-view-seg .seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        $$('#lib-view-seg .seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        App.libView = b.dataset.view;
        renderLibrary();
      });
    });

    bindLibrary();

    $('#modal-mask').addEventListener('click', e => {
      if (e.target.id === 'modal-mask') closeModal();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
  }

  /** 应用浅色/深色主题 */
  function applyTheme() {
    try {
      const dark = !!TTStore.getSettings().darkMode;
      document.documentElement.classList.toggle('dark', dark);
    } catch (e) { /* 忽略 */ }
  }

  function init() {
    try {
      importBundled();
      removeSamples();
      TTAnki.migrate();
    } catch (e) {
      console.error('初始化数据失败', e);
    }
    applyTheme();
    try {
      bindEvents();
    } catch (e) {
      console.error('事件绑定失败', e);
    }
    try {
      renderToday();
    } catch (e) {
      console.error('渲染今日页失败', e);
    }
  }

  /** 移除初始示例题（按题干精确匹配，幂等；只删最初生成的 22 条） */
  function removeSamples() {
    try {
      const qs = (window.TTSeed && TTSeed.SAMPLE_QUESTIONS) || [];
      if (!qs.length) return;
      const list = TTStore.getContent();
      const toRemove = list.filter(x => qs.indexOf(x.question) >= 0).map(x => x.id);
      if (toRemove.length) {
        toRemove.forEach(id => TTStore.removeContent(id));
        console.log('已移除初始示例题 ' + toRemove.length + ' 条');
      }
    } catch (e) {
      console.warn('移除初始示例题失败', e);
    }
  }

  /** 导入内置图片挖空卡（按图片路径去重，幂等；每次加载自动补全，可手动触发） */
  const IMG_OSS_BASE = 'https://ttgd-images.oss-cn-hongkong.aliyuncs.com';

  function importBundled() {
    try {
      if (!window.TTBundledImageCards || !window.TTBundledImageCards.length) return;
      // 清理旧版/失效图片地址的图卡（本地 127.0.0.1、相对路径等），避免残留破图
      const stale = TTStore.getContent().filter(x =>
        x.masks && x.masks.length && x.image && x.image.indexOf(IMG_OSS_BASE) !== 0
      );
      if (stale.length) TTStore.removeMany(stale.map(x => x.id));
      const existing = new Set(TTStore.getContent().map(c => c.image).filter(Boolean));
      const fresh = window.TTBundledImageCards.filter(c => !existing.has(c.image));
      if (fresh.length) {
        TTStore.bulkAdd(fresh);
        toast('已导入图片挖空卡 ' + fresh.length + ' 张');
      }
    } catch (e) {
      console.warn('图片挖空卡导入失败', e);
    }
  }

  // 暴露给 onclick 使用
  window.TTApp = {
    goToday: () => switchTab('today'),
    goPractice: () => switchTab('practice')
  };

  document.addEventListener('DOMContentLoaded', init);
})();

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
    learnSessionStart: null, // 学习会话开始时间戳
    learnHistoryId: null,   // 当前会话对应历史记录 ID
    learnTotal: 0,          // 当前会话原始队列总数
    libFilter: 'all',
    libSearch: '',
    libView: 'flat',         // flat 平铺 | group 按科目·章节分组
    libLimit: 150,           // 内容库分页渲染上限
    practiceSubject: null,   // 练习中心当前下钻的科目
    imgBrowseSub: null,      // 看图卡库：当前浏览的科目
    imgBrowseCh: null,       // 看图卡库：当前浏览的章节
    learnBusy: false,
    learnTimerInterval: null,
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
      <div class="mastery-row" data-subject="${esc(r.subject)}">
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

    // 学习记录入口
    const learnHist = getLearnHistory();
    const lhDoing = learnHist.filter(x => !x.done).length;
    $('#rec-learn-info').textContent = lhDoing > 0
      ? `${lhDoing} 个未完成 · 共 ${learnHist.length} 次记录`
      : (learnHist.length > 0 ? `共 ${learnHist.length} 次记录` : '暂无学习记录');
    // 学习计划入口
    const planSt = getPlan();
    const planInfo = $('#rec-plan-info');
    if (!planSt.started) planInfo.textContent = '67 天滚动表 · 未开始';
    else if (planSt.paused) planInfo.textContent = '已暂停 · Day ' + planSt.currentDay;
    else planInfo.textContent = 'Day ' + planSt.currentDay + ' / 67 · ' +
      (planDayAllDone(planSt, planSt.currentDay) ? '今日已完成 🎉' : '进行中');

    // 学习模式
    $$('#mode-seg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === App.learnMode));

    // 开始按钮
    const btn = $('#btn-start');
    btn.disabled = modeQ.total === 0;
    const modeName = App.learnMode === 'quiz' ? '刷题' : App.learnMode === 'card' ? 'Anki 复习' : App.learnMode === 'wrong' ? '错题重练' : '学习';
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
    // 异步加载题库，如果尚未加载则先显示加载状态，加载完成后自动刷新
    var qbankLoaded = window.TTBundledQuestionBank ? true : false;
    if (!qbankLoaded) {
      ensureBundledQuestions().then(function () {
        renderPractice();
      });
    }
    const rec = TTScheduler.dailyRecord();
    $('#p-rec-info').textContent = `今日 ${rec.todayCount} 题 · 已记录 ${rec.recordedDays} 天`;

    const book = TTScheduler.wrongBook();
    $('#wrong-desc').textContent = book.length > 0 ? `${book.length} 项待巩固` : '0 项待巩固';

    const imgs = TTScheduler.imageCards();
    $('#img-desc').textContent = imgs.length > 0 ? `${imgs.length} 张图片挖空卡` : '0 张待学';

    var bankTotal = 0;
    if (qbankLoaded) {
      const bank = window.TTBundledQuestionBank || {};
      bankTotal = Object.keys(bank).reduce(function (s, k) { return s + bank[k].length; }, 0);
      const imp = qbankImported();
      $('#qbank-desc').textContent = (imp.length ? '已导入' + imp.length + ' 科· ' : '') + bankTotal + ' 题可选';
    } else {
      $('#qbank-desc').textContent = '题库加载中...';
    }

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
    App.learnSessionStart = Date.now();
    App.learnHistoryId = null;   // 新会话，历史记录新建
    App.learnTotal = items.length; // 原始队列总数（用于历史进度显示）
    startLearnTimer();
    switchTab('learn');
    renderLearn();
    saveLearnSession();
  }

  function startLearning(mode) {
    const m = mode || App.learnMode;
    if (m === 'wrong') {
      const q = TTScheduler.wrongTodayQueue('all');
      if (q.total === 0) { toast('今日暂无错题需要重刷'); return; }
      showStartPreview(q, 'wrong');
      return;
    }
    const q = TTScheduler.todayQueue(m);
    if (q.total === 0) { toast('当前模式今日暂无任务'); return; }
    showStartPreview(q, m);
  }

  function showStartPreview(q, m) {
    const modeName = m === 'quiz' ? '刷题' : m === 'card' ? 'Anki 复习' : m === 'wrong' ? '错题重练' : '学习';
    const dueCount = q.due.length;
    const freshCount = q.fresh.length;
    let html = '<div class="modal-title">开始' + modeName + '</div>';
    html += '<div class="start-preview">';
    html += '<div class="sp-row"><span class="sp-label">今日复习</span><span class="sp-num">' + dueCount + ' 项</span></div>';
    if (freshCount > 0) {
      html += '<div class="sp-row"><span class="sp-label">今日新学</span><span class="sp-num">' + freshCount + ' 项</span></div>';
    }
    html += '<div class="sp-row sp-total"><span class="sp-label">共计</span><span class="sp-num">' + q.total + ' 项</span></div>';
    if (m === 'wrong') {
      html += '<div class="sp-tip">错题优先出现，答错会再次安排重刷</div>';
    }
    html += '</div>';
    html += '<div class="modal-actions">';
    html += '<button class="btn-cancel" id="sp-cancel">取消</button>';
    html += '<button class="btn-primary" id="sp-go">开始学习</button>';
    html += '</div>';
    openModal(html);
    document.getElementById('sp-cancel').addEventListener('click', closeModal);
    document.getElementById('sp-go').addEventListener('click', () => {
      closeModal();
      App.learnMode = m;
      const title = m === 'quiz' ? '刷题完成！' : m === 'card' ? 'Anki 复习完成！' : m === 'wrong' ? '错题重练完成！' : '今日学习完成！';
      const source = m === 'wrong' ? 'wrong' : 'today';
      beginQueue([...q.due, ...q.fresh], source, 'today', title, isNewItem);
    });
  }

  /* ---------- 学习实时计时器 ---------- */
  function startLearnTimer() {
    stopLearnTimer();
    const el = document.getElementById('learn-timer');
    if (el) el.classList.remove('hidden');
    updateLearnTimer();
    App.learnTimerInterval = setInterval(updateLearnTimer, 1000);
  }

  function stopLearnTimer() {
    if (App.learnTimerInterval) {
      clearInterval(App.learnTimerInterval);
      App.learnTimerInterval = null;
    }
    const el = document.getElementById('learn-timer');
    if (el) el.classList.add('hidden');
  }

  function updateLearnTimer() {
    const el = document.getElementById('learn-timer');
    if (!el || !App.learnSessionStart) return;
    const elapsed = Math.floor((Date.now() - App.learnSessionStart) / 1000);
    el.textContent = '\u23F1 ' + fmtClock(elapsed * 1000);
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

  /** 选择要学习的看图卡（按科目分组 + 学科筛选/折叠，章节勾选） */
  function openImageStudy() {
    const chs = TTScheduler.imageChapters();
    if (chs.length === 0) { toast('暂无看图挖空卡'); return; }
    const total = chs.reduce((s, c) => s + c.count, 0);
    const groups = {};
    chs.forEach(c => { (groups[c.subject] = groups[c.subject] || []).push(c); });
    const subs = Object.keys(groups);
    const tabsHtml = '<button class="img-ch-tab active" data-sub="">全部</button>' +
      subs.map(s => `<button class="img-ch-tab" data-sub="${esc(s)}">${esc(s)}</button>`).join('');
    const groupsHtml = subs.map(sub => `
      <div class="img-ch-group" data-sub="${esc(sub)}" data-subject="${esc(sub)}">
        <div class="img-ch-subj" role="button" tabindex="0" aria-expanded="true">
          <span class="ics-name">${esc(sub)}</span>
          <span class="ics-tools">
            <button class="ics-btn" data-sel="1">全选</button>
            <button class="ics-btn" data-sel="0">清空</button>
          </span>
          <span class="ics-caret">▾</span>
        </div>
        <div class="img-ch-group-body">
          ${groups[sub].map(c => `
            <label class="img-ch-row">
              <input type="checkbox" class="img-ch-cb" value="${esc(JSON.stringify({ subject: c.subject, chapter: c.chapter }))}" checked>
              <span class="img-ch-name">${esc(c.chapter)}</span>
              <span class="img-ch-count">${c.count} 张</span>
            </label>`).join('')}
        </div>
      </div>`).join('');
    openModal(`
      <div class="modal-title">选择要学习的看图卡</div>
      <div class="wrong-summary">共 <b>${total}</b> 张 · 先选学科，再勾章节（默认全选）</div>
      <div class="img-ch-tabs" id="img-tabs">${tabsHtml}</div>
      <div class="img-ch-list">${groupsHtml}</div>
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
    // 学科筛选 chips：只看某学科的章节
    $$('.img-ch-tab').forEach(tab => tab.addEventListener('click', () => {
      const sub = tab.dataset.sub;
      $$('.img-ch-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.img-ch-group').forEach(g => {
        g.style.display = (!sub || g.dataset.sub === sub) ? '' : 'none';
      });
    }));
    // 学科折叠 / 展开
    $$('.img-ch-subj').forEach(h => h.addEventListener('click', e => {
      if (e.target.closest('.ics-btn')) return;
      const g = h.closest('.img-ch-group');
      const body = g.querySelector('.img-ch-group-body');
      const collapsed = g.classList.toggle('collapsed');
      body.style.display = collapsed ? 'none' : '';
      h.setAttribute('aria-expanded', String(!collapsed));
      const c = h.querySelector('.ics-caret');
      if (c) c.textContent = collapsed ? '▸' : '▾';
    }));
    // 学科组内 全选 / 清空（不冒泡到折叠）
    $$('.ics-btn').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const g = btn.closest('.img-ch-group');
      const sel = btn.dataset.sel === '1';
      g.querySelectorAll('.img-ch-cb').forEach(cb => { cb.checked = sel; });
    }));
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
      // 二级：该科目的章节（可搜索 + 点击展开内联图网格）
      const subChs = chs.filter(c => c.subject === App.imgBrowseSub);
      const totalCh = subChs.reduce((s, c) => s + c.count, 0);
      inner = `
        <div class="modal-title">${esc(App.imgBrowseSub)}</div>
        <div class="browse-back" id="browse-back">‹ 返回科目列表</div>
        <div class="browse-tools browse-search-wrap">
          <input class="form-input browse-search" id="browse-search" placeholder="🔍 搜索章节关键词" autocomplete="off" aria-label="搜索章节">
          <span class="browse-search-count" id="browse-search-count">${subChs.length} 个章节 · ${totalCh} 张</span>
        </div>
        <div class="ch-list" id="browse-ch-list">
          ${subChs.map(c => {
            const first = TTScheduler.imageCards([{ subject: c.subject, chapter: c.chapter }])[0];
            return `
            <div class="ch-acc" data-ch="${esc(c.chapter)}" data-subject="${esc(App.imgBrowseSub)}">
              <div class="ch-row" role="button" tabindex="0" data-ch="${esc(c.chapter)}" aria-expanded="false">
                <img class="ch-thumb" src="${esc(first ? first.image : '')}" loading="lazy" alt="">
                <div class="ch-info">
                  <div class="ch-name">${esc(c.chapter)}</div>
                  <div class="ch-count">${c.count} 张</div>
                </div>
                <span class="ch-toggle">展开</span>
              </div>
              <div class="ch-grid-wrap"></div>
            </div>`;
          }).join('')}
        </div>
        <div class="browse-empty" id="browse-empty" style="display:none">未找到匹配的章节，换个关键词试试</div>`;
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
    // 章节关键词搜索（仅二级章节列表）
    const search = $('#browse-search');
    if (search) search.addEventListener('input', () => {
      const q = (search.value || '').trim().toLowerCase();
      const items = $$('#browse-ch-list .ch-acc');
      let visible = 0;
      items.forEach(el => {
        const name = (el.dataset.ch || '').toLowerCase();
        const hit = !q || name.indexOf(q) >= 0;
        el.style.display = hit ? '' : 'none';
        if (hit) visible++;
      });
      const countEl = $('#browse-search-count');
      if (countEl) countEl.textContent = visible + ' 个章节';
      const empty = $('#browse-empty');
      if (empty) empty.style.display = visible === 0 ? '' : 'none';
    });
    const all = $('#browse-all');
    if (all) all.addEventListener('click', () => {
      closeModal();
      startImageStudy([{ subject: App.imgBrowseSub, chapter: App.imgBrowseCh }]);
    });
    $$('.subj-card').forEach(el => el.addEventListener('click', () => {
      App.imgBrowseSub = el.dataset.sub;
      App.imgBrowseCh = null;
      renderImageBrowse();
    }));
    // 章节行：点击展开/收起 该章内联图网格（同一时刻只展开一个）
    $$('.ch-row').forEach(el => {
      el.addEventListener('click', () => {
        const acc = el.closest('.ch-acc');
        if (!acc) return;
        const wrap = acc.querySelector('.ch-grid-wrap');
        const toggle = el.querySelector('.ch-toggle');
        const isOpen = acc.classList.contains('open');
        $$('#browse-ch-list .ch-acc.open').forEach(o => {
          if (o !== acc) {
            o.classList.remove('open');
            const w = o.querySelector('.ch-grid-wrap');
            if (w) w.innerHTML = '';
            const t = o.querySelector('.ch-toggle');
            if (t) t.textContent = '展开';
          }
        });
        if (isOpen) {
          acc.classList.remove('open');
          if (wrap) wrap.innerHTML = '';
          if (toggle) toggle.textContent = '展开';
          el.setAttribute('aria-expanded', 'false');
          return;
        }
        acc.classList.add('open');
        el.setAttribute('aria-expanded', 'true');
        if (toggle) toggle.textContent = '收起';
        renderChapterGrid(wrap, App.imgBrowseSub, el.dataset.ch);
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
      });
    });
    $$('.img-cell').forEach(el => el.addEventListener('click', () => {
      const card = TTStore.getById(el.dataset.id);
      if (card) {
        closeModal();
        beginQueue([card], 'subject', 'practice', '看图卡学习完成！', isNewItem);
      }
    }));
  }

  /** 在章节行内联渲染该章的挖空图网格 */
  function renderChapterGrid(wrap, subject, chapter) {
    const cards = TTScheduler.imageCards([{ subject: subject, chapter: chapter }]);
    wrap.innerHTML = `
      <div class="ch-grid-inner">
        <button class="btn-primary" data-learn-all="${esc(chapter)}">学习本章全部（${cards.length}）</button>
        <div class="img-grid">
          ${cards.map(c => `
            <div class="img-cell" data-id="${c.id}" title="点图学习这张卡">
              <img class="img-cell-img" src="${esc(c.image)}" loading="lazy" alt="">
            </div>`).join('')}
        </div>
        <div class="img-grid-tip">👆 点任意一张图，直接学习该卡</div>
      </div>`;
    const allBtn = wrap.querySelector('[data-learn-all]');
    if (allBtn) allBtn.addEventListener('click', () => {
      closeModal();
      startImageStudy([{ subject: subject, chapter: chapter }]);
    });
    wrap.querySelectorAll('.img-cell').forEach(cell => cell.addEventListener('click', () => {
      const card = TTStore.getById(cell.dataset.id);
      if (card) {
        closeModal();
        beginQueue([card], 'subject', 'practice', '看图卡学习完成！', isNewItem);
      }
    }));
  }
  function startWrong() {
    const items = TTScheduler.wrongBook();
    if (items.length === 0) { toast('暂无错题，继续加油！'); return; }
    const s = TTStore.getXp();
    s.relearn++;
    TTStore.saveXp(s);
    addXp(3);
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
    updateLearnTimer();

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
          <span class="tag sub" data-subject="${esc(it.subject)}">${esc(it.subject)}</span>
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
          afterQuiz(correct);
          App.learnResults.push({ id: it.id, ok: correct, isNew: entry.isNew });
          saveLearnSession();
          actions.innerHTML = `<button class="btn-primary" id="btn-next">${App.learnIndex + 1 >= App.learnQueue.length ? '完成' : '下一题'}</button>`;
          $('#btn-next').addEventListener('click', () => { App.learnIndex++; App.learnBusy = false; saveLearnSession(); renderLearn(); });
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
      afterQuiz(correct);
      App.learnResults.push({ id: it.id, ok: correct, isNew: entry.isNew });
      saveLearnSession();

      actions.innerHTML = `
        <button class="btn-primary" id="btn-next">${App.learnIndex + 1 >= App.learnQueue.length ? '完成' : '下一题'}</button>`;
      $('#btn-next').addEventListener('click', () => { App.learnIndex++; App.learnBusy = false; saveLearnSession(); renderLearn(); });
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
          <span class="tag sub" data-subject="${esc(it.subject)}">${esc(it.subject)}</span>
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
          <span class="tag sub" data-subject="${esc(it.subject)}">${esc(it.subject)}</span>
          <span class="tag">看图记忆卡</span>
          ${it.chapter ? `<span class="tag sub">${esc(it.chapter)}</span>` : ''}
          ${typeTag}${stateTag}
        </div>
        <div class="imgcard" id="imgcard">
          <img class="imgcard-img" src="${esc(it.image)}" alt="看图记忆卡" loading="lazy">
          <div class="imgcard-masks">${boxes}</div>
        </div>
        <div class="imgcard-hint">👆 点击空白处，查看对应答案</div>
        <div class="img-actions img-toolbar">
          <button class="btn-ghost" id="btn-zoom">🔍 放大</button>
          <button class="btn-ghost" id="btn-cover-all">🎭 重新遮盖</button>
          <button class="btn-primary" id="btn-reveal-all">显示全部答案</button>
        </div>
      </div>
      <div class="learn-actions anki-actions" id="card-actions"></div>`;
  }

  function bindImageCloze(it) {
    const actions = $('#card-actions');
    let revealed = false;
    const showRatings = () => { if (!revealed) { revealed = true; renderAnkiButtons(it); } };
    const allMasks = () => $$('#imgcard .img-mask');
    // 每个空白可单独点击：再点一次可重新盖回
    allMasks().forEach(m => {
      m.addEventListener('click', () => {
        m.classList.toggle('revealed');
        if (m.classList.contains('revealed')) showRatings();
      });
    });
    // 常驻工具栏（不随评级按钮消失）
    $('#btn-reveal-all').addEventListener('click', () => {
      allMasks().forEach(m => m.classList.add('revealed'));
      showRatings();
    });
    $('#btn-cover-all').addEventListener('click', () => {
      // 重新盖住所有挖空，再测一遍
      allMasks().forEach(m => m.classList.remove('revealed'));
    });
    $('#btn-zoom').addEventListener('click', () => openZoomViewer(it));
  }

  /* ---------- 看图卡：全屏放大查看器（双指缩放/双击/拖动 + 逐块开关） ---------- */
  function openZoomViewer(it) {
    const boxes = it.masks.map((b, i) =>
      `<div class="img-mask" data-i="${i}" style="left:${(b[0] * 100).toFixed(3)}%;top:${(b[1] * 100).toFixed(3)}%;width:${(b[2] * 100).toFixed(3)}%;height:${(b[3] * 100).toFixed(3)}%"></div>`
    ).join('');
    const ov = document.createElement('div');
    ov.className = 'zoom-overlay';
    ov.innerHTML = `
      <div class="zoom-stage" id="zoom-stage">
        <img class="zoom-img" src="${esc(it.image)}" alt="放大">
        <div class="imgcard-masks">${boxes}</div>
      </div>
      <div class="zoom-close" id="zoom-close">✕</div>
      <div class="zoom-toolbar">
        <button class="zoom-btn" id="z-cover">🎭 盖回全部</button>
        <button class="zoom-btn" id="z-reveal">显示全部答案</button>
      </div>
      <div class="zoom-hint">点挖空开/合 · 滚轮缩放 · 双指缩放 · 双击放大 · 拖动平移</div>`;
    document.body.appendChild(ov);
    const stage = ov.querySelector('#zoom-stage');
    const zoomMasks = () => ov.querySelectorAll('.img-mask');
    // 逐块开关
    zoomMasks().forEach(m => {
      m.addEventListener('click', e => {
        e.stopPropagation();
        m.classList.toggle('revealed');
      });
    });
    ov.querySelector('#z-cover').addEventListener('click', () => zoomMasks().forEach(m => m.classList.remove('revealed')));
    ov.querySelector('#z-reveal').addEventListener('click', () => zoomMasks().forEach(m => m.classList.add('revealed')));
    let scale = 1, tx = 0, ty = 0;
    let startDist = 0, startScale = 1, lastTouch = null, lastTap = 0;
    const apply = () => { stage.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
    ov.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        startDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        startScale = scale;
        e.preventDefault();
      } else if (e.touches.length === 1) {
        // 点挖空时不触发双击缩放
        if (e.target.closest && e.target.closest('.img-mask')) return;
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        const now = Date.now();
        if (now - lastTap < 300) {
          if (scale > 1) { scale = 1; tx = 0; ty = 0; } else { scale = 2.2; tx = 0; ty = 0; }
          apply(); lastTap = 0;
        } else lastTap = now;
      }
    }, { passive: false });
    ov.addEventListener('touchmove', e => {
      if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        scale = Math.min(5, Math.max(1, startScale * d / (startDist || 1)));
        apply(); e.preventDefault();
      } else if (e.touches.length === 1 && lastTouch) {
        tx += e.touches[0].clientX - lastTouch.x;
        ty += e.touches[0].clientY - lastTouch.y;
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        apply();
      }
    }, { passive: false });
    ov.addEventListener('touchend', () => { lastTouch = null; });
    // 桌面鼠标滚轮缩放
    ov.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      scale = Math.min(5, Math.max(1, scale * delta));
      apply();
    }, { passive: false });
    ov.querySelector('#zoom-close').addEventListener('click', () => ov.remove());
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
        afterCard();
        App.learnResults.push({ id: it.id, ok: b.dataset.r !== 'again', isNew: entry.isNew });
        saveLearnSession();
        App.learnIndex++;
        App.learnBusy = false;
        renderLearn();
      });
    });
  }

  function renderLearnDone() {
    markLearnSessionDone();
    App.learnSessionDone = true;
    // 记录学习时长
    if (App.learnSessionStart) {
      const elapsed = Math.round((Date.now() - App.learnSessionStart) / 1000);
      if (elapsed > 10) {
        TTStore.logDay(TTStore.todayStr(), { seconds: elapsed });
        App.lastSessionSeconds = elapsed;
      }
      App.learnSessionStart = null;
      stopLearnTimer();
    }
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
        <div class="done-desc">共完成 ${total} 项，答对 ${okCount} 项${okCount < total ? '，答错的已安排稍后重刷' : ''}。${App.lastSessionSeconds ? '<br>本次学习用时 ' + fmtClock(App.lastSessionSeconds * 1000) : ''}<br>错题会自动加入错题本，按记忆曲线继续滚动。</div>
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
    clearLearnSession();
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
          // 调用调度引擎让错题进入艾宾浩斯重刷队列
          TTScheduler.learnItem(it.id, 'wrong');
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
    addXp(10 + (pct >= 90 ? 20 : pct >= 70 ? 10 : 0));
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
      `<span class="tag sub" data-subject="${esc(it.subject)}">${esc(it.subject)}</span>`,
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
            <div class="lib-group-subject-title" data-subject="${esc(sub)}">${esc(sub)}<span class="lib-group-count">${subTotal}</span></div>
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
  /* ---------- 以题带动 · 每日记录面板 ---------- */
  function openDailyRecord() {
    const rec = TTScheduler.dailyRecord();
    const log = TTStore.getLog();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = TTStore.todayStr(d);
      const entry = log[ds] || { review: 0, correct: 0, wrong: 0, newLearned: 0 };
      days.push({ date: ds, count: (entry.review || 0) + (entry.newLearned || 0), label: (d.getMonth()+1) + '/' + d.getDate() });
    }
    const maxCount = Math.max.apply(null, days.map(function(d) { return d.count; }).concat([1]));
    let barsHtml = '';
    days.forEach(function(d) {
      const h = Math.round(d.count / maxCount * 60);
      barsHtml += '<div class="dr-bar-col"><div class="dr-bar" style="height:' + h + 'px"></div><div class="dr-bar-label">' + d.label + '</div></div>';
    });

    let html = '<div class="modal-title">以题带动 · 每日记录</div>';
    html += '<div class="dr-stats">';
    html += '<div class="dr-stat"><div class="dr-stat-num">' + rec.todayCount + '</div><div class="dr-stat-label">今日题数</div></div>';
    html += '<div class="dr-stat"><div class="dr-stat-num">' + rec.recordedDays + '</div><div class="dr-stat-label">已记录天数</div></div>';
    html += '<div class="dr-stat"><div class="dr-stat-num">' + TTScheduler.streak() + '</div><div class="dr-stat-label">连续打卡</div></div>';
    html += '</div>';
    html += '<div class="dr-chart">' + barsHtml + '</div>';
    html += '<div class="dr-actions"><button class="btn-primary" id="dr-start" style="flex:1">开始今日学习</button></div>';
    openModal(html);
    document.getElementById('dr-start').addEventListener('click', () => { closeModal(); switchTab('today'); });
  }

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
  /* ================= 游戏化：经验 / 等级 / 成就 ================= */
  const BADGES = [
    { id: 'first', icon: '🎉', name: '初出茅庐', desc: '完成第一次学习', test: () => Object.keys(TTStore.getLog()).length > 0 },
    { id: 's3', icon: '🔥', name: '小有坚持', desc: '连续打卡 3 天', test: () => TTScheduler.streak() >= 3 },
    { id: 's7', icon: '🌟', name: '习惯成自然', desc: '连续打卡 7 天', test: () => TTScheduler.streak() >= 7 },
    { id: 's30', icon: '👑', name: '学霸养成', desc: '连续打卡 30 天', test: () => TTScheduler.streak() >= 30 },
    { id: 'q100', icon: '💯', name: '百题斩', desc: '累计答对 100 题', test: () => totalCorrect() >= 100 },
    { id: 'q1000', icon: '🚀', name: '千题斩', desc: '累计答对 1000 题', test: () => totalCorrect() >= 1000 },
    { id: 'g1', icon: '🏆', name: '毕业达人', desc: '首次毕业 1 条', test: () => TTStore.getContent().filter(x => TTScheduler.isGraduated(x)).length >= 1 },
    { id: 'g50', icon: '🎓', name: '学有所成', desc: '毕业 50 条', test: () => TTStore.getContent().filter(x => TTScheduler.isGraduated(x)).length >= 50 },
    { id: 'exam1', icon: '📚', name: '真题勇士', desc: '完成 1 次整卷考试', test: () => TTStore.getExam().length >= 1 },
    { id: 'img10', icon: '🧠', name: '看图大师', desc: '学习 10 张看图卡', test: () => imgReviews() >= 10 },
    { id: 'rl10', icon: '🏅', name: '错题克星', desc: '错题重练 10 次', test: () => TTStore.getXp().relearn >= 10 }
  ];

  function totalCorrect() {
    const log = TTStore.getLog();
    let n = 0;
    Object.keys(log).forEach(k => n += (log[k].correct || 0));
    return n;
  }
  function imgReviews() {
    return TTStore.getContent()
      .filter(x => x.masks && x.masks.length)
      .reduce((s, x) => s + (x.reviewCount || 0), 0);
  }

  function addXp(n) {
    const s = TTStore.getXp();
    s.xp += n;
    TTStore.saveXp(s);
    checkBadges();
  }
  /** 每日首次学习奖励 +5 经验 */
  function studyBonus() {
    const s = TTStore.getXp();
    const today = TTStore.todayStr();
    if (s.lastDate !== today) {
      s.lastDate = today;
      s.xp += 5;
      TTStore.saveXp(s);
      checkBadges();
      toast('🔥 每日学习 +5 经验');
    }
  }
  function afterQuiz(correct) {
    addXp(correct ? 2 : 1);
    studyBonus();
  }
  function afterCard() {
    addXp(1);
    studyBonus();
  }
  function checkBadges() {
    try {
      const s = TTStore.getXp();
      const unlocked = new Set(s.badges);
      let changed = false;
      BADGES.forEach(b => {
        if (!unlocked.has(b.id) && b.test()) {
          unlocked.add(b.id);
          changed = true;
          unlockToast(b);
        }
      });
      if (changed) { s.badges = Array.from(unlocked); TTStore.saveXp(s); }
    } catch (e) { /* 忽略 */ }
  }
  function unlockToast(b) {
    try {
      const t = document.createElement('div');
      t.className = 'unlock-toast';
      t.innerHTML = `<span class="unlock-icon">${b.icon}</span><div><div class="unlock-name">🏆 解锁成就 · ${esc(b.name)}</div><div class="unlock-desc">${esc(b.desc)}</div></div>`;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3200);
    } catch (e) { /* 忽略 */ }
  }
  function levelInfo() {
    const xp = TTStore.getXp().xp;
    const level = Math.floor(xp / 100) + 1;
    const cur = xp % 100;
    return { level, xp, cur, next: 100, pct: Math.round(cur / 100 * 100) };
  }

  function renderStats() {
    const content = TTStore.getContent();
    const graduated = content.filter(x => TTScheduler.isGraduated(x)).length;
    const accuracy = TTScheduler.accuracy();
    const streak = TTScheduler.streak();

    $('#s-total').textContent = content.length;
    $('#s-graduated').textContent = graduated;
    $('#s-accuracy').textContent = accuracy === null ? '--' : accuracy + '%';
    $('#s-streak').textContent = streak;

    // 学习时长
    const log = TTStore.getLog();
    const today = TTStore.todayStr();
    const todayLog = log[today] || {};
    const todayMin = Math.round((todayLog.seconds || 0) / 60);
    $('#s-time-label').textContent = todayMin > 0 ? `今日 ${todayMin} 分钟` : '今日尚未学习';

    // 近 7 天正确率趋势（Canvas 2D）
    drawTrendChart(log);

    // 日历
    const cal = $('#calendar');
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    let html = weekdays.map(d => `<div class="cal-day weekday">${d}</div>`).join('');
    const todayDate = new Date();
    const start = new Date(todayDate);
    start.setDate(todayDate.getDate() - 29);
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

    // 等级与经验
    const lv = levelInfo();
    $('#xp-level').textContent = 'Lv.' + lv.level;
    $('#xp-num').textContent = lv.cur + ' / ' + lv.next;
    $('#xp-bar').style.width = lv.pct + '%';

    // 成就徽章
    const xpS = TTStore.getXp();
    const unlockedSet = new Set(xpS.badges);
    const grid = $('#badge-grid');
    $('#badge-count').textContent = unlockedSet.size + ' / ' + BADGES.length;
    grid.innerHTML = BADGES.map(b => {
      const got = unlockedSet.has(b.id);
      return `
        <div class="badge-item ${got ? 'got' : ''}" title="${esc(b.desc)}">
          <div class="badge-icon">${got ? b.icon : '🔒'}</div>
          <div class="badge-name">${esc(b.name)}</div>
          <div class="badge-desc">${got ? esc(b.desc) : '未解锁'}</div>
        </div>`;
    }).join('');

    // 各科掌握度
    renderMasteryList($('#subject-bars'), TTScheduler.subjectMastery());

    // 预计毕业进度：未毕业条目 / 每日新学 → 预估天数
    const total = content.length;
    const remain = content.filter(x => !TTScheduler.isGraduated(x)).length;
    const estPct = total === 0 ? 0 : Math.round((total - remain) / total * 100);
    const dailyNew = Math.max(1, TTStore.getSettings().dailyNew || 10);
    const estDays = Math.ceil(remain / dailyNew);
    $('#est-fill').style.width = estPct + '%';
    $('#est-pct').textContent = estPct + '%';
    $('#s-estimate').textContent = remain === 0 ? '全部毕业 🎉' : `未毕业 ${remain} 条 · 按每日 ${dailyNew} 条约需 ${estDays} 天`;

    // 错题科目分布
    const wrongBySub = {};
    TTScheduler.wrongBook().forEach(x => {
      wrongBySub[x.subject] = (wrongBySub[x.subject] || 0) + (x.wrongCount || 0);
    });
    const wrongArr = Object.keys(wrongBySub).map(s => ({ subject: s, total: wrongBySub[s] })).sort((a, b) => b.total - a.total);
    const wrongMax = wrongArr.reduce((m, o) => Math.max(m, o.total), 0) || 1;
    $('#wrong-bars').innerHTML = wrongArr.length
      ? wrongArr.map(o => `
        <div class="mastery-row">
          <div class="mastery-name">${esc(o.subject)}</div>
          <div class="mastery-track"><div class="mastery-fill wrong" style="width:${Math.round(o.total / wrongMax * 100)}%"></div></div>
          <div class="mastery-num">${o.total} 次</div>
        </div>`).join('')
      : '<div style="text-align:center;color:var(--text-3);font-size:13px;padding:6px">暂无错题</div>';

    // 存储用量
    var storageEl = $('#storage-usage');
    if (storageEl) {
      try {
        var usage = TTStore.getStorageUsage();
        if (navigator.storage && navigator.storage.estimate) {
          navigator.storage.estimate().then(function (est) {
            var quota = est.quota || 0;
            var used = est.usage || 0;
            var totalMB = (quota / (1024 * 1024)).toFixed(0);
            var usedMB = (used / (1024 * 1024)).toFixed(1);
            storageEl.textContent = usage + ' / ' + '总配额 ' + totalMB + ' MB (已用 ' + usedMB + ' MB)';
          }).catch(function () {
            storageEl.textContent = usage;
          });
        } else {
          storageEl.textContent = usage;
        }
      } catch (e) {
        storageEl.textContent = '--';
      }
    }
  }

  /** 绘制近 7 天正确率趋势折线图 */
  function drawTrendChart(log) {
    const canvas = document.getElementById('trend-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const PAD = { top: 20, right: 20, bottom: 25, left: 30 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    // 收集近 7 天数据
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = TTStore.todayStr(d);
      const day = log[key] || {};
      const total = (day.review || 0) + (day.newLearned || 0);
      const correct = day.correct || 0;
      const pct = total > 0 ? Math.round(correct / total * 100) : null;
      days.push({ key, label: (d.getMonth() + 1) + '/' + d.getDate(), pct, total });
    }

    const valid = days.filter(d => d.pct !== null);
    if (valid.length < 2) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('数据不足，继续学习后将显示趋势', W / 2, H / 2 + 5);
      $('#s-trend-label').textContent = valid.length + ' 天有数据';
      return;
    }

    $('#s-trend-label').textContent = valid.length + ' / 7 天有数据';

    const maxPct = 100;
    const minPct = 0;
    const range = maxPct - minPct || 1;

    // 绘制网格线
    ctx.strokeStyle = '#eef0f3';
    ctx.lineWidth = 1;
    for (let p = 0; p <= 100; p += 25) {
      const y = PAD.top + chartH - (p - minPct) / range * chartH;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(W - PAD.right, y);
      ctx.stroke();
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(p + '%', PAD.left - 4, y + 3);
    }

    // 绘制折线
    const points = days.map((d, i) => {
      const x = PAD.left + (i / (days.length - 1)) * chartW;
      const y = d.pct !== null ? PAD.top + chartH - (d.pct - minPct) / range * chartH : null;
      return { x, y, ...d };
    });

    // 填充区域
    const validPoints = points.filter(p => p.y !== null);
    if (validPoints.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(validPoints[0].x, validPoints[0].y);
      for (let i = 1; i < validPoints.length; i++) {
        ctx.lineTo(validPoints[i].x, validPoints[i].y);
      }
      ctx.lineTo(validPoints[validPoints.length - 1].x, PAD.top + chartH);
      ctx.lineTo(validPoints[0].x, PAD.top + chartH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
      grad.addColorStop(0, 'rgba(47,143,107,0.2)');
      grad.addColorStop(1, 'rgba(47,143,107,0.02)');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // 连线
    ctx.strokeStyle = '#2f8f6b';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    points.forEach(p => {
      if (p.y !== null) {
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      }
    });
    ctx.stroke();

    // 数据点
    points.forEach(p => {
      if (p.y !== null) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#2f8f6b';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        // 数值标签
        ctx.fillStyle = '#1f2937';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.pct + '%', p.x, p.y - 10);
      }
    });

    // X 轴标签
    points.forEach(p => {
      ctx.fillStyle = '#6b7280';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.label, p.x, H - 5);
    });
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
  /** 导出数据并触发浏览器下载 .json 文件 */
  function downloadJson(filename, data) {
    var blob = new Blob([data], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function openExport() {
    var data = TTStore.exportAll();
    var today = TTStore.todayStr();
    openModal(`
      <div class="modal-title">导出数据</div>
      <div class="form-group">
        <label class="form-label">导出方式：</label>
        <div style="display:flex;gap:10px;margin-top:8px">
          <button class="btn-primary" id="export-download" style="flex:1">⬇ 下载 JSON 文件</button>
          <button class="btn-cancel" id="export-copy" style="flex:1">📋 复制到剪贴板</button>
        </div>
        <div style="margin-top:12px;font-size:13px;color:var(--text-2)">
          数据包含：内容库、设置、学习记录、考试记录、经验值。<br>
          建议定期导出备份，以防浏览器数据丢失。
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" id="export-close">关闭</button>
      </div>
    `);
    $('#export-close').addEventListener('click', closeModal);
    $('#export-download').addEventListener('click', function () {
      downloadJson('天天滚动_备份_' + today + '.json', data);
      toast('已下载备份文件');
      closeModal();
    });
    $('#export-copy').addEventListener('click', function () {
      navigator.clipboard.writeText(data).then(function () {
        toast('已复制到剪贴板');
      }).catch(function () {
        // fallback for older browsers
        var ta = document.createElement('textarea');
        ta.value = data;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast('已复制到剪贴板'); } catch (e) { toast('复制失败，请手动复制'); }
        document.body.removeChild(ta);
      });
      closeModal();
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

  /* ================= 回收站 ================= */
  function openTrash() {
    const trash = TTStore.getTrash();
    if (trash.length === 0) {
      openModal(`
        <div class="modal-title">回收站</div>
        <div class="wrong-summary">回收站为空。</div>
        <div class="modal-actions"><button class="btn-primary" id="trash-close">关闭</button></div>
      `);
      $('#trash-close').addEventListener('click', closeModal);
      return;
    }
    openModal(`
      <div class="modal-title">回收站（${trash.length} 条）</div>
      <div class="wrong-summary">已删除的内容可在此恢复，最多保留 200 条。</div>
      <div class="wrong-list-wrap" style="max-height:300px;overflow-y:auto">
        ${trash.map(t => `
          <div class="wrong-row" style="display:flex;align-items:center;gap:8px">
            <span class="tag ${t.type === 'quiz' ? 'type' : ''}" style="flex-shrink:0">${t.type === 'quiz' ? '选择' : '记忆'}</span>
            <span class="wr-q" style="flex:1">${esc(truncate(t.question, 40))}</span>
            <button class="btn-ghost trash-restore" data-id="${t.id}" style="font-size:12px;padding:4px 8px">↩ 恢复</button>
          </div>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" id="trash-close">关闭</button>
        <button class="btn-ghost" id="trash-clear" style="color:var(--danger)">清空回收站</button>
      </div>
    `);
    $('#trash-close').addEventListener('click', closeModal);
    $('#trash-clear').addEventListener('click', () => {
      if (confirm('确定清空回收站？删除的内容将永久丢失。')) {
        TTStore.clearTrash();
        closeModal();
        toast('回收站已清空');
      }
    });
    $$('.trash-restore').forEach(btn => {
      btn.addEventListener('click', () => {
        TTStore.restoreFromTrash(btn.dataset.id);
        toast('已恢复');
        closeModal();
        openTrash();
        renderLibrary();
        renderToday();
      });
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
          <div class="radio-pill ${(!s.themeMode || s.themeMode === 'auto') ? 'active' : ''}" data-theme="auto">🔄 跟随系统</div>
          <div class="radio-pill ${s.themeMode === 'light' ? 'active' : ''}" data-theme="light">☀️ 浅色</div>
          <div class="radio-pill ${s.themeMode === 'dark' ? 'active' : ''}" data-theme="dark">🌙 深色</div>
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
        <label class="form-label" style="font-weight:700;color:var(--text)">🔔 每日提醒</label>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">提醒时间（24小时制）</label>
          <input class="form-input" type="time" id="set-remind-time" value="${s.remindTime || '20:00'}">
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end;padding-bottom:4px">
          <button class="btn-ghost" id="set-notify-test" style="font-size:13px">🔔 测试通知</button>
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
    // 通知测试按钮
    const notifyBtn = $('#set-notify-test');
    if (notifyBtn) {
      notifyBtn.addEventListener('click', () => {
        if (!('Notification' in window)) { toast('当前浏览器不支持通知'); return; }
        if (Notification.permission === 'denied') { toast('通知已被拒绝，请到浏览器设置中开启'); return; }
        if (Notification.permission === 'granted') {
          new Notification('天天滚动 · 测试通知', { body: '如果看到这条通知，说明提醒功能正常 ✅', icon: 'icons/icon.svg' });
          toast('测试通知已发送');
        } else {
          Notification.requestPermission().then(perm => {
            if (perm === 'granted') {
              new Notification('天天滚动', { body: '通知已开启，每天 ' + (TTStore.getSettings().remindTime || '20:00') + ' 提醒你学习 📚', icon: 'icons/icon.svg' });
              toast('通知已开启');
            } else {
              toast('通知被拒绝，可在设置中重新开启');
            }
          });
        }
      });
    }
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
      const themeMode = activeTheme ? activeTheme.dataset.theme : (s.themeMode || 'auto');
      const remindTime = $('#set-remind-time').value || '20:00';
      TTStore.saveSettings({
        dailyNew: daily,
        intervals,
        examMinutes: examMin,
        examCount,
        themeMode,
        remindTime,
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

  /* ================= 学习会话持久化（刷新续学 + 学习记录） ================= */
  const SESSION_KEY = 'ttgd.learnSession.v1';
  const HISTORY_KEY = 'ttgd.learnHistory.v1';
  const HISTORY_MAX = 30;

  function getLearnHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }
  function saveLearnHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch (e) {}
  }

  function fmtHistoryTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (sameDay) return '今天 ' + hm;
    const yd = new Date(now); yd.setDate(now.getDate() - 1);
    const isY = yd.getFullYear() === d.getFullYear() && yd.getMonth() === d.getMonth() && yd.getDate() === d.getDate();
    if (isY) return '昨天 ' + hm;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  }

  function currentSnapshot() {
    const firstItem = App.learnQueue[0] && App.learnQueue[0].item;
    return {
      id: App.learnHistoryId || (App.learnHistoryId = 'ls_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
      start: App.learnSessionStart || Date.now(),
      lastActive: Date.now(),
      source: App.learnSource,
      subject: (firstItem && firstItem.subject) || '',
      title: App.learnTitle,
      mode: App.learnMode,
      total: App.learnTotal || App.learnQueue.length,
      q: App.learnQueue.map(x => ({ id: x.item.id, isNew: !!x.isNew })),
      results: App.learnResults,
      done: false
    };
  }

  function saveLearnSession() {
    try {
      if (!App.learnQueue.length || App.learnSessionDone) return;
      const snap = currentSnapshot();
      localStorage.setItem(SESSION_KEY, JSON.stringify(snap));
      const hist = getLearnHistory();
      const idx = hist.findIndex(h => h.id === snap.id);
      if (idx >= 0) { hist[idx] = snap; } else { hist.unshift(snap); }
      saveLearnHistory(hist);
    } catch (e) { /* 存储失败忽略 */ }
  }
  function clearLearnSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  /** 标记当前会话已完成（保留记录在历史中） */
  function markLearnSessionDone() {
    try {
      if (App.learnHistoryId) {
        const hist = getLearnHistory();
        const idx = hist.findIndex(h => h.id === App.learnHistoryId);
        if (idx >= 0) {
          hist[idx].done = true;
          hist[idx].results = App.learnResults;
          hist[idx].lastActive = Date.now();
          saveLearnHistory(hist);
        }
      }
      clearLearnSession();
    } catch (e) { clearLearnSession(); }
  }
  /** 从一条历史记录恢复学习 */
  function resumeSession(sd) {
    const content = TTStore.getContent();
    const byId = {};
    content.forEach(c => { byId[c.id] = c; });
    const doneIds = new Set((sd.results || []).map(r => r.id));
    const queue = [];
    (sd.q || []).forEach(x => { const it = byId[x.id]; if (it) queue.push({ item: it, isNew: !!x.isNew }); });
    const remaining = queue.filter(x => !doneIds.has(x.item.id));
    if (remaining.length === 0) return false;
    clearExamTimer();
    App.exam = null;
    App.learnQueue = remaining;
    App.learnIndex = 0;
    App.learnResults = sd.results || [];
    App.learnSessionDone = false;
    App.learnSource = sd.source || 'today';
    App.learnBackTo = sd.backTo || 'today';
    App.learnTitle = sd.title || '学习完成！';
    App.learnSessionStart = sd.start || Date.now();
    App.learnMode = sd.mode || 'all';
    App.learnHistoryId = sd.id;
    App.learnTotal = sd.total || remaining.length + doneIds.size;
    saveLearnSession();
    switchTab('learn');
    renderLearn();
    return true;
  }
  /** 页面加载时检测未完成的学习会话，询问是否继续 */
  function tryRestoreLearnSession() {
    let raw = null;
    try { raw = localStorage.getItem(SESSION_KEY); } catch (e) {}
    if (!raw) return;
    let sd;
    try { sd = JSON.parse(raw); } catch (e) { clearLearnSession(); return; }
    if (!sd || !Array.isArray(sd.q) || sd.q.length === 0 || sd.done) { clearLearnSession(); return; }
    const content = TTStore.getContent();
    const byId = {};
    content.forEach(c => { byId[c.id] = c; });
    const doneIds = new Set((sd.results || []).map(r => r.id));
    const remaining = (sd.q || []).map(x => byId[x.id]).filter(Boolean).filter(it => !doneIds.has(it.id));
    if (remaining.length === 0) { clearLearnSession(); return; }
    const modeName = sd.mode === 'quiz' ? '刷题' : sd.mode === 'card' ? '看图卡' : sd.mode === 'wrong' ? '错题' : '学习';
    const srcName = sd.source === 'wrong' ? '错题重练' : (sd.source === 'subject' ? '科目练习' : '今日学习');
    if (confirm('上次学习还有 ' + remaining.length + ' 项未完成（' + srcName + ' · ' + modeName + '），是否继续？\n\n「确定」继续上次学习 ｜ 「取消」稍后可从「学习记录」选择')) {
      resumeSession(sd);
    } else {
      clearLearnSession();
      renderToday();
    }
  }
  /** 打开学习记录列表 */
  function openLearnHistory() {
    const hist = getLearnHistory();
    if (hist.length === 0) { toast('暂无学习记录'); return; }
    let html = '<div class="modal-title">📚 学习记录</div>';
    html += '<div class="learn-history-list">';
    hist.forEach(h => { html += historyItemHtml(h); });
    html += '</div>';
    html += '<div class="modal-actions"><button class="btn-cancel" id="lh-close">关闭</button></div>';
    openModal(html);
    document.getElementById('lh-close').addEventListener('click', closeModal);
    document.querySelectorAll('[data-resume]').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.resume;
        const sd = getLearnHistory().find(x => x.id === id);
        if (!sd) { closeModal(); toast('该记录已失效'); return; }
        closeModal();
        if (resumeSession(sd)) toast('已恢复上次学习');
        else toast('该记录无未完成内容');
      });
    });
    document.querySelectorAll('[data-delhist]').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.delhist;
        if (!confirm('删除这条学习记录？')) return;
        const hist = getLearnHistory().filter(x => x.id !== id);
        saveLearnHistory(hist);
        if (App.learnHistoryId === id) { App.learnHistoryId = null; clearLearnSession(); }
        renderToday();
        openLearnHistory();
      });
    });
  }
  function historyItemHtml(h) {
    const total = h.total || (h.q || []).length;
    const answered = (h.results || []).length;
    const remaining = Math.max(0, total - answered);
    const pct = total > 0 ? Math.round(answered / total * 100) : 0;
    const modeName = h.mode === 'quiz' ? '刷题' : h.mode === 'card' ? '看图卡' : h.mode === 'wrong' ? '错题' : '学习';
    const srcName = h.source === 'wrong' ? '错题重练' : (h.source === 'subject' ? '科目练习' : '今日学习');
    const time = fmtHistoryTime(h.start);
    const subject = h.subject ? '<span class="lhi-subj">' + esc(h.subject) + '</span>' : '';
    const status = (!h.done && remaining > 0)
      ? '<span class="lhi-badge doing">未完成 · 剩 ' + remaining + ' 项</span>'
      : '<span class="lhi-badge done">已完成</span>';
    return '' +
      '<div class="lhi-item' + (h.done ? ' done' : '') + '">' +
        '<div class="lhi-top">' +
          '<span class="lhi-time">' + time + '</span>' +
          subject +
          '<span class="lhi-src">' + srcName + (h.source !== 'wrong' && modeName !== '学习' ? ' · ' + modeName : '') + '</span>' +
          status +
        '</div>' +
        '<div class="lhi-title">' + esc(h.title || '学习记录') + '</div>' +
        '<div class="lhi-progress">' +
          '<div class="lhi-track"><div class="lhi-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="lhi-pct">' + answered + '/' + total + '</span>' +
        '</div>' +
        '<div class="lhi-actions">' +
          ((!h.done && remaining > 0)
            ? '<button class="btn-primary lhi-btn" data-resume="' + esc(h.id) + '">继续学习</button>'
            : '<span class="lhi-finished">已完成</span>') +
          '<button class="btn-ghost lhi-btn lhi-del" data-delhist="' + esc(h.id) + '">删除</button>' +
        '</div>' +
      '</div>';
  }

  /* ================= 学习计划（67天滚动表） ================= */
  const PLAN_KEY = 'ttgd.plan.v1';
  const PLAN_TOTAL = (window.TTPlanData && window.TTPlanData.length) || 67;

  function getPlan() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(PLAN_KEY) || 'null'); } catch (e) { p = null; }
    if (!p) p = { started: false, startDate: null, currentDay: 1, done: {}, rest: {}, paused: false };
    if (!p.done) p.done = {};
    if (!p.rest) p.rest = {};
    return p;
  }
  function savePlan(p) {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); } catch (e) {} 
  }
  function planDayRow(d) {
    const data = window.TTPlanData || [];
    return data.find(x => x.day === d) || null;
  }
  /** 某天的任务列表：第1轮新学 + 第2轮(D2次日) + 第3轮(D5隔4天) + 生化第4项 */
  function planDayTasks(day) {
    const row = planDayRow(day);
    if (!row) return [];
    const tasks = [];
    tasks.push({ key: 'new', round: '第1轮', title: row.content, sub: '看讲义，不懂的地方回看录播' });
    const d2 = planDayRow(day - 1);
    if (d2) tasks.push({ key: 'd2', round: '第2轮', title: d2.content, sub: '刷近20年真题，错题以题带动复习' });
    const d5 = planDayRow(day - 4);
    if (d5) tasks.push({ key: 'd5', round: '第3轮', title: d5.content, sub: '背讲义内容，重点关注红色等重点字词' });
    if (row.bio) tasks.push({ key: 'bio', round: '生化任务', bio: true, title: row.bio, sub: '完成每日生化任务' });
    tasks.forEach(t => { t.match = planMatchTask(t.title, t.bio ? '生物化学' : null); });
    return tasks;
  }
  function planDayDone(plan, day, key) {
    return !!(plan.done && plan.done[day] && plan.done[day][key]);
  }
  function planDayAllDone(plan, day) {
    const tasks = planDayTasks(day);
    if (!tasks.length) return false;
    return tasks.every(t => planDayDone(plan, day, t.key));
  }
  function planDateText(startDate, day) {
    const base = new Date(startDate + 'T00:00:00');
    if (isNaN(base.getTime())) return '';
    base.setDate(base.getDate() + (day - 1));
    return (base.getMonth() + 1) + '/' + base.getDate();
  }
  /* ---- 计划任务 → 内容库章节匹配（直达学习） ---- */
  const PLAN_ALL_SUBS = ['生理学', '病理学', '内科学', '外科学', '生物化学'];
  const PLAN_SUB_MAP = { '生理': '生理学', '病理': '病理学', '内科': '内科学', '外科': '外科学', '生化': '生物化学' };
  const PLAN_SYN = {
    '乳腺癌': '乳房疾病', '间质性肺疾病': '肺间质性疾病', '肺硅沉着病': '硅肺沉着病',
    'graves病': '甲亢', '甲状腺功能减退症': '甲减', '原发性醛固酮增多症': '原醛',
    '系统性红斑狼疮': 'sle', '类风湿性关节炎': '类风湿关节炎', '其他外科总论': '其他外科学总论',
    '细胞信号转导': '细胞信号传导', '原癌基因': '小基因', '抑癌基因': '小基因',
    '基因重组': '小基因', '分子生物学技术': '小基因', '糖代谢': '糖有氧氧化',
    '脂肪动员': '脂肪代谢', '甘油的利用': '脂肪代谢', '脂肪的合成': '脂肪代谢'
  };
  function planNorm(s) { return String(s || '').toLowerCase().replace(/[\s的、]/g, ''); }
  function planChaptersOf(sub) {
    return (TTStore.getContent() || [])
      .filter(x => x.subject === sub && Array.isArray(x.masks) && x.masks.length)
      .reduce((acc, x) => { acc.add(x.chapter || '未分章'); return acc; }, new Set());
  }
  /** 解析任务文本 → [{subject, chapter}]，用于点击任务直达学习 */
  function planMatchTask(text, subjectHint) {
    const chapterCache = {};
    const chs = sub => (chapterCache[sub] = chapterCache[sub] || planChaptersOf(sub));
    const matchLine = (subHints, content) => {
      const keys = content.split(/[；;＆&、+\-]/).map(planNorm).filter(k => k.length >= 2);
      keys.slice().forEach(k => { const v = PLAN_SYN[k]; if (v) keys.push(planNorm(v)); });
      const perSub = {};
      subHints.forEach(sub => {
        const matched = new Set();
        [...chs(sub)].forEach(ch => {
          const chn = planNorm(ch);
          keys.forEach(k => { if (chn.includes(k) || (k.includes(chn) && chn.length >= 2)) matched.add(ch); });
        });
        if (matched.size === 0 && subHints.length === 1) { [...chs(sub)].forEach(ch => matched.add(ch)); }
        perSub[sub] = matched;
      });
      if (subHints.length > 1) {
        let best = null, bestN = -1;
        subHints.forEach(sub => { if (perSub[sub].size > bestN) { bestN = perSub[sub].size; best = sub; } });
        if (best && bestN > 0) return [...perSub[best]].map(ch => ({ subject: best, chapter: ch }));
        return [];
      }
      const sub = subHints[0];
      return [...perSub[sub]].map(ch => ({ subject: sub, chapter: ch }));
    };
    const out = [];
    String(text || '').split('\n').forEach(line => {
      line = line.trim(); if (!line) return;
      let subHints = subjectHint ? [subjectHint] : PLAN_ALL_SUBS.slice();
      let content = line;
      const m = line.match(/^(生理|病理|内科|外科|生化)[：:](.*)$/);
      if (m) { subHints = [PLAN_SUB_MAP[m[1]]]; content = m[2]; }
      matchLine(subHints, content).forEach(x => out.push(x));
    });
    const seen = new Set(), res = [];
    out.forEach(x => { const k = x.subject + '|' + x.chapter; if (!seen.has(k)) { seen.add(k); res.push(x); } });
    return res;
  }

  const PLAN_ROUND_CLS = { new: 'r1', d2: 'r2', d5: 'r3', bio: 'r4' };
  function planTaskHtml(task, done) {
    const roundCls = 'pt-round ' + (PLAN_ROUND_CLS[task.key] || 'r1');
    const matched = task.match;
    const learnBtn = matched && matched.length
      ? '<button class="pt-learn" data-learn="1">📖 开始学习 · ' + matched.length + ' 个章节 ›</button>'
      : '';
    return '' +
      '<div class="plan-task' + (done ? ' done' : '') + '" data-key="' + task.key + '">' +
        '<div class="pt-top">' +
          '<span class="' + roundCls + '">' + task.round + '</span>' +
          '<span class="pt-check">' + (done ? '✓' : '○') + '</span>' +
        '</div>' +
        '<div class="pt-title">' + esc(task.title) + '</div>' +
        '<div class="pt-sub">' + esc(task.sub) + '</div>' +
        learnBtn +
      '</div>';
  }
  function planGridHtml(plan) {
    let cells = '';
    for (let d = 1; d <= PLAN_TOTAL; d++) {
      let cls = 'pg-cell';
      if (plan.rest && plan.rest[d]) cls += ' rest';
      else if (planDayAllDone(plan, d)) cls += ' ok';
      if (d === plan.currentDay) cls += ' now';
      const label = planDayAllDone(plan, d) ? '✓' : (plan.rest && plan.rest[d] ? '休' : d);
      cells += '<div class="' + cls + '"><span>' + label + '</span><span class="pg-d">D' + d + '</span></div>';
    }
    return '<div class="plan-grid">' + cells + '</div>' +
      '<div class="plan-grid-tip">绿框=今日 · 绿色=已完成 · 黄色=休息 · 点击任务可标记完成</div>';
  }
  function planWelcomeHtml(plan) {
    return '' +
      '<div class="modal-title">📅 学习计划</div>' +
      '<div class="plan-welcome">' +
        '<div class="pw-emoji">🗓️</div>' +
        '<div class="pw-title">天天·西综二轮 67 天滚动表</div>' +
        '<div class="pw-desc">按艾宾浩斯滚动复习：每天新学 1 个内容，' +
        '第 2 天复习前一天（第2轮）、第 5 天复习四天前（第3轮），' +
        '外加每日生化任务。完成当天全部任务后自动进入下一天。</div>' +
        '<button class="btn-primary" id="plan-start">🚀 开始第 1 天</button>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn-cancel" id="plan-close">关闭</button></div>';
  }
  function planPausedHtml(plan) {
    return '' +
      '<div class="modal-title">📅 学习计划</div>' +
      '<div class="plan-welcome">' +
        '<div class="pw-emoji">⏸️</div>' +
        '<div class="pw-title">计划已暂停</div>' +
        '<div class="pw-desc">当前进行到 Day ' + plan.currentDay + ' / ' + PLAN_TOTAL + '。' +
        '点击恢复继续按计划学习。</div>' +
        '<button class="btn-primary" id="plan-resume">▶ 恢复计划</button>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn-cancel" id="plan-close">关闭</button></div>';
  }
  function planFinishedHtml(plan) {
    return '' +
      '<div class="modal-title">📅 学习计划</div>' +
      '<div class="plan-welcome">' +
        '<div class="pw-emoji">🏆</div>' +
        '<div class="pw-title">67 天计划全部完成！</div>' +
        '<div class="pw-desc">恭喜你完成整个二轮滚动计划，坚持就是胜利！</div>' +
        planGridHtml(plan) +
        '<button class="btn-primary" id="plan-restart" style="margin-top:14px;width:100%">🔄 重新开始计划</button>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn-cancel" id="plan-close">关闭</button></div>';
  }
  function planTodayHtml(plan) {
    const day = plan.currentDay;
    const row = planDayRow(day);
    const tasks = planDayTasks(day);
    const allDone = planDayAllDone(plan, day);
    const doneCount = tasks.filter(t => planDayDone(plan, day, t.key)).length;
    const pct = Math.round(doneCount / tasks.length * 100);
    const rest = plan.rest && plan.rest[day];
    let listHtml;
    if (rest) {
      listHtml = '<div class="plan-done-banner"><b>😴 今日已休息</b><div style="font-size:12px;color:var(--text-2);margin-top:4px">休息日不计入学习任务，点下方按钮进入明天。</div>' +
        '<button class="btn-primary" id="plan-next">进入第 ' + (day + 1) + ' 天 ›</button></div>';
    } else {
      listHtml = '<div class="plan-task-list">' + tasks.map(t => planTaskHtml(t, planDayDone(plan, day, t.key))).join('') + '</div>';
      if (allDone) {
        listHtml += '<div class="plan-done-banner"><b>🎉 第 ' + day + ' 天任务完成！</b>' +
          '<div style="font-size:12px;color:var(--text-2);margin-top:4px">已掌握今天的内容，明天见。</div>' +
          '<button class="btn-primary" id="plan-next">进入第 ' + (day + 1) + ' 天 ›</button></div>';
      }
    }
    return '' +
      '<div class="plan-head">' +
        '<div class="plan-head-left">' +
          '<span class="plan-title">🗓️ 天天·67天滚动表</span>' +
          '<span class="plan-day-badge">Day ' + day + '</span>' +
          '<span class="plan-date">' + planDateText(plan.startDate, day) + '</span>' +
        '</div>' +
        '<div class="plan-actions">' +
          '<button class="plan-btn" id="plan-rest">休息1天</button>' +
          '<button class="plan-btn" id="plan-pause">暂停</button>' +
        '</div>' +
      '</div>' +
      '<div class="plan-progress">' +
        '<div class="plan-progress-track"><div class="plan-progress-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="plan-progress-text">今日完成 ' + doneCount + ' / ' + tasks.length + ' · 整体 Day ' + day + ' / ' + PLAN_TOTAL + '</div>' +
      '</div>' +
      listHtml +
      planGridHtml(plan) +
      '<div class="modal-actions"><button class="btn-cancel" id="plan-close">关闭</button></div>';
  }
  function bindPlanModal(plan) {
    const close = document.getElementById('plan-close');
    if (close) close.addEventListener('click', closeModal);
    const start = document.getElementById('plan-start');
    if (start) start.addEventListener('click', () => {
      const today = new Date();
      const pad = n => String(n).padStart(2, '0');
      plan.started = true;
      plan.startDate = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
      plan.currentDay = 1;
      plan.paused = false;
      savePlan(plan);
      renderToday();
      openPlan();
    });
    const resume = document.getElementById('plan-resume');
    if (resume) resume.addEventListener('click', () => {
      plan.paused = false;
      savePlan(plan);
      renderToday();
      openPlan();
    });
    const restart = document.getElementById('plan-restart');
    if (restart) restart.addEventListener('click', () => {
      if (!confirm('重新开始会清空当前计划进度，确定吗？')) return;
      plan.started = false; plan.currentDay = 1; plan.done = {}; plan.rest = {}; plan.paused = false;
      savePlan(plan);
      renderToday();
      openPlan();
    });
    const restBtn = document.getElementById('plan-rest');
    if (restBtn) restBtn.addEventListener('click', () => {
      const day = plan.currentDay;
      if (!plan.rest) plan.rest = {};
      plan.rest[day] = true;
      savePlan(plan);
      renderToday();
      openPlan();
    });
    const pauseBtn = document.getElementById('plan-pause');
    if (pauseBtn) pauseBtn.addEventListener('click', () => {
      plan.paused = true;
      savePlan(plan);
      renderToday();
      openPlan();
    });
    const next = document.getElementById('plan-next');
    if (next) next.addEventListener('click', () => {
      plan.currentDay += 1;
      savePlan(plan);
      renderToday();
      openPlan();
    });
    // 任务「开始学习」直达对应章节
    document.querySelectorAll('#modal-mask .pt-learn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const el = btn.closest('.plan-task');
        const key = el.dataset.key;
        const day = plan.currentDay;
        const task = planDayTasks(day).find(t => t.key === key);
        if (!task || !task.match || !task.match.length) { toast('暂无对应内容'); return; }
        closeModal();
        startImageStudy(task.match);
      });
    });
    // 任务点击：标记完成（划删除线变暗淡）
    document.querySelectorAll('#modal-mask .plan-task').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.key;
        const day = plan.currentDay;
        if (!plan.done[day]) plan.done[day] = {};
        if (planDayDone(plan, day, key)) delete plan.done[day][key];
        else plan.done[day][key] = true;
        savePlan(plan);
        renderToday();
        openPlan();
      });
    });
  }
  /** 打开学习计划 */
  function openPlan() {
    const plan = getPlan();
    let html;
    if (!plan.started) html = planWelcomeHtml(plan);
    else if (plan.paused) html = planPausedHtml(plan);
    else if (plan.currentDay > PLAN_TOTAL) html = planFinishedHtml(plan);
    else html = planTodayHtml(plan);
    openModal(html);
    bindPlanModal(getPlan());
  }

  /* ================= 事件绑定 & 启动 ================= */
  function exitLearn() {
    stopLearnTimer();
    if (App.exam && !App.exam.submitted) {
      if (confirm('退出考试？本次答题将不保存。')) {
        clearExamTimer();
        App.exam = null;
        App.learnQueue = [];
        App.learnSessionDone = false;
        clearLearnSession();
        switchTab('practice');
      }
      return;
    }
    if (confirm('退出本次学习？进度已保存。')) {
      App.learnQueue = [];
      App.learnSessionDone = false;
      clearLearnSession();
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
    on('#btn-trash', 'click', openTrash);

    // 练习中心入口
    $('#entry-record').addEventListener('click', () => openDailyRecord());
    const rcToday = document.getElementById('record-card-today');
    if (rcToday) rcToday.addEventListener('click', () => openDailyRecord());
    const rcLearn = document.getElementById('record-card-learn');
    if (rcLearn) rcLearn.addEventListener('click', openLearnHistory);
    const rcPlan = document.getElementById('record-card-plan');
    if (rcPlan) rcPlan.addEventListener('click', openPlan);
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
      // 输入框内不触发快捷键
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      // Anki 评级快捷键：1=重来 2=困难 3=良好 4=简单
      if (App.tab === 'learn' && !App.exam && !App.learnBusy && !App.learnSessionDone) {
        const map = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
        const r = map[e.key];
        if (r) {
          const btn = document.querySelector(`.anki-btn[data-r="${r}"]`);
          if (btn) { e.preventDefault(); btn.click(); }
        }
        // 选择题快捷键：A-D / a-d / 1-4 选答案
        if (!$('#btn-next') && !$('#btn-multi-submit')) {
          const optIdx = { a: 0, b: 1, c: 2, d: 3, A: 0, B: 1, C: 2, D: 3, '1': 0, '2': 1, '3': 2, '4': 3 }[e.key];
          if (optIdx !== undefined) {
            const opt = document.querySelector(`#opt-list .option[data-i="${optIdx}"]`);
            if (opt && !opt.classList.contains('disabled')) { e.preventDefault(); opt.click(); }
          }
        }
        // Space 翻面记忆卡
        if (e.key === ' ' || e.key === 'Space') {
          const fc = $('#flashcard');
          if (fc && !fc.classList.contains('flipped')) {
            e.preventDefault();
            fc.click();
          }
        }
      }
      // Enter 下一题（学习完成页）
      if (e.key === 'Enter' && App.tab === 'learn') {
        const next = $('#btn-next') || $('#btn-done-home');
        if (next) { e.preventDefault(); next.click(); }
      }
    });
  }

  /** 应用浅色/深色主题：跟随系统（默认）或手动选择 */
  function applyTheme() {
    try {
      const s = TTStore.getSettings();
      let dark;
      if (s.themeMode === 'auto' || !s.themeMode) {
        dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      } else {
        dark = s.themeMode === 'dark';
      }
      document.documentElement.classList.toggle('dark', dark);
      // 动态更新浏览器顶栏颜色
      var meta = document.getElementById('meta-theme-color');
      if (meta) {
        meta.content = dark ? '#1a251f' : '#2f8f6b';
      }
    } catch (e) { /* 忽略 */ }
  }
  /** 监听系统主题变化，仅在 auto 模式下生效 */
  function listenSystemTheme() {
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', () => {
        const s = TTStore.getSettings();
        if (s.themeMode === 'auto' || !s.themeMode) applyTheme();
      });
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 每日学习提醒 ---------- */
  function checkReminder() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const s = TTStore.getSettings();
    if (!s.remindTime) return;
    const now = new Date();
    const parts = s.remindTime.split(':').map(Number);
    const remindMinutes = parts[0] * 60 + parts[1];
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes < remindMinutes || nowMinutes > remindMinutes + 30) return;
    if (TTScheduler.hasStudiedToday()) return;
    const lastRemind = localStorage.getItem('ttgd.lastRemind');
    if (lastRemind === TTStore.todayStr()) return;
    localStorage.setItem('ttgd.lastRemind', TTStore.todayStr());
    new Notification('天天滚动 · 学习提醒', {
      body: '今天还没学习哦，来复习几张卡片吧！',
      icon: 'icons/icon.svg'
    });
  }

  function startReminderCheck() {
    if ('Notification' in window && Notification.permission === 'default') {
      document.addEventListener('click', function reqOnce() {
        Notification.requestPermission();
        document.removeEventListener('click', reqOnce);
      }, { once: true });
    }
    setInterval(checkReminder, 5 * 60 * 1000);
    setTimeout(checkReminder, 10000);
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
    listenSystemTheme();
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
    tryRestoreLearnSession();
    startReminderCheck();
    setupExamIdleTimeout();
    setupKeyboardShortcuts();
    setupSWUpdateListener();
  }

  /* ================= 考试空闲超时（离开标签页自动暂停） ================= */
  function setupExamIdleTimeout() {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && App.exam && App.exam.state === 'running') {
        // 记录离开时间，回来时自动暂停计时
        App.exam._hiddenSince = Date.now();
        App.exam._wasRunning = true;
      } else if (!document.hidden && App.exam && App.exam._hiddenSince) {
        // 回来时自动暂停，让用户选择继续
        var elapsed = Date.now() - App.exam._hiddenSince;
        if (elapsed > 30000 && App.exam._wasRunning) {
          // 离开超过 30 秒，自动暂停考试
          App.exam.state = 'paused';
          App.exam._hiddenSince = null;
          App.exam._wasRunning = false;
          toast('⏸ 检测到长时间离开，考试已自动暂停');
          var timerEl = document.getElementById('exam-timer');
          if (timerEl) timerEl.textContent = '已暂停';
        } else {
          App.exam._hiddenSince = null;
        }
      }
    });
  }

  /* ================= 键盘快捷键 ================= */
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function (e) {
      // 仅在非输入框中生效
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      var tab = App.tab;

      // 全局快捷键：Alt+数字 切换标签页
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        var tabs = ['today', 'practice', 'learn', 'library', 'stats'];
        var idx = parseInt(e.key, 10);
        if (idx >= 1 && idx <= tabs.length) {
          e.preventDefault();
          switchTab(tabs[idx - 1]);
          return;
        }
      }

      // 学习页面快捷键
      if (tab === 'learn') {
        if (e.key === 'Escape') {
          e.preventDefault();
          var exitBtn = document.getElementById('btn-exit-learn');
          if (exitBtn) exitBtn.click();
          return;
        }

        // 考试模式：空格暂停/继续
        if (e.key === ' ' && App.exam) {
          e.preventDefault();
          var pauseBtn = document.querySelector('.exam-toggle-btn');
          if (pauseBtn) pauseBtn.click();
          return;
        }

        // 选择题：1-4 快速选择
        if (e.key >= '1' && e.key <= '4' && !App.exam) {
          var opts = document.querySelectorAll('.learn-body .option');
          var idx = parseInt(e.key, 10) - 1;
          if (opts[idx]) { opts[idx].click(); return; }
        }

        // 记忆卡：空格翻面，1-4 评级
        if (e.key === ' ' && !App.exam) {
          var flashcard = document.querySelector('.flashcard');
          if (flashcard) {
            e.preventDefault();
            flashcard.click();
            return;
          }
        }
        if (e.key >= '1' && e.key <= '4' && !App.exam) {
          var gradeBtns = document.querySelectorAll('.grade-btn');
          var idx = parseInt(e.key, 10) - 1;
          if (gradeBtns[idx]) { gradeBtns[idx].click(); return; }
        }
      }

      // 内容库：Ctrl+F 聚焦搜索
      if (tab === 'library' && (e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        var searchInput = document.getElementById('lib-search');
        if (searchInput) searchInput.focus();
      }
    });
  }

  /* ================= Service Worker 更新监听 ================= */
  function setupSWUpdateListener() {
    if (!('serviceWorker' in navigator)) return;

    // 监听 SW 发来的更新消息
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'SW_UPDATED') {
        // 有更新可用，提示用户刷新
        var banner = document.createElement('div');
        banner.style.cssText = 'position:fixed;bottom:80px;left:16px;right:16px;z-index:9999;background:#2f8f6b;color:#fff;border-radius:14px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 20px rgba(0,0,0,0.2);animation:fadeIn .3s ease';
        banner.innerHTML = '<span style="font-size:14px;font-weight:600">🔄 新版本可用</span><button style="background:#fff;color:#2f8f6b;border:none;border-radius:8px;padding:6px 16px;font-size:14px;font-weight:600;cursor:pointer" id="sw-refresh-btn">刷新</button>';
        document.body.appendChild(banner);
        document.getElementById('sw-refresh-btn').addEventListener('click', function () {
          banner.remove();
          window.location.reload();
        });
        // 10 秒后自动消失
        setTimeout(function () { if (banner.parentNode) banner.remove(); }, 10000);
      }
    });

    // 检查 SW 是否有待更新
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(function (reg) {
        reg.addEventListener('updatefound', function () {
          var newSW = reg.installing;
          newSW.addEventListener('statechange', function () {
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              // 新 SW 已安装，向它发送跳过等待消息
              newSW.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      });
    }
  }

  /** 移除初始示例题（按 _sample 标记，幂等；只删最初生成的 22 条） */
  function removeSamples() {
    try {
      const list = TTStore.getContent();
      const toRemove = list.filter(x => x._sample).map(x => x.id);
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
      // 清理旧版本地地址（127.0.0.1 / localhost）的图片卡，保留用户导入的卡片
      const stale = TTStore.getContent().filter(x =>
        x.masks && x.masks.length && x.image && 
        (x.image.indexOf('127.0.0.1') >= 0 || x.image.indexOf('localhost') >= 0)
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



  /** 动态加载 JS 脚本，返回 Promise */
  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function() { reject(new Error('加载失败: ' + src)); };
      document.body.appendChild(s);
    });
  }

  /** 确保题库（bundled_questions.js）已加载，未加载则动态加载 */
  var _qbankLoading = null;
  function ensureBundledQuestions() {
    if (window.TTBundledQuestionBank) return Promise.resolve();
    if (_qbankLoading) return _qbankLoading;
    _qbankLoading = loadScript('js/bundled_questions.js').then(function() {
      _qbankLoading = null;
      try { renderPractice(); } catch(e) {}
    }).catch(function(err) {
      console.warn('题库加载失败，2秒后重试', err);
      _qbankLoading = null;
      // 2秒后自动重试
      setTimeout(function() { ensureBundledQuestions(); }, 2000);
    });
    return _qbankLoading;
  }

  // 延迟加载图片挖空卡（不阻塞首屏渲染）
  function lazyLoadImageCards() {
    if (window.TTBundledImageCards) {
      importBundled();
      return;
    }
    loadScript('js/bundled_imagecards.js').then(function() {
      importBundled();
    }).catch(function(e) {
      console.warn('图片挖空卡延迟加载失败', e);
    });
  }

  // 暴露给 onclick 使用
  window.TTApp = {
    goToday: () => switchTab('today'),
    goPractice: () => switchTab('practice')
  };

  document.addEventListener('DOMContentLoaded', function() { init(); setTimeout(lazyLoadImageCards, 100); });
})();

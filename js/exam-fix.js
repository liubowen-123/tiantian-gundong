/* ============================================================
   天天滚动 · 整卷考试增强层（独立补丁 js/exam-fix.js）
   1. 交卷后把成绩同步写入「考试记录」(ttgd.exam.v1)，修复考试无记录
   2. 错题回顾：逐选项列表 + 🤖 AI 逐选项解析 + 📎 对应导图片段
   纯 DOM/存储层补丁，不改 app.js；由 index.html 在 app.js 之后加载。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function ossThumb(url, w, q) {
    var u = String(url || '');
    if (u.indexOf('aliyuncs.com') < 0 || u.indexOf('?') >= 0) return u;
    return u + '?x-oss-process=image/resize,w_' + w + '/format,jpg/quality,q_' + (q || 82);
  }
  function cleanChapter(ch) {
    if (!ch) return ch;
    var s = String(ch).trim();
    s = s.replace(/^(第[一二三四五六七八九十百零〇\d]+篇)[、\s]*/, '');
    s = s.replace(/^(第[一二三四五六七八九十百零〇\d]+章)[、\s]*/, '');
    s = s.replace(/^(第[一二三四五六七八九十百零〇\d]+节)[、\s]*/, '');
    s = s.replace(/^[：:\-—\s]+/, '').trim();
    return s || '未分章';
  }
  function fmtDate(dateStr) {
    var s = String(dateStr || '');
    var d;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s + 'T00:00:00');
    else d = new Date(Number(s) || Date.now());
    if (isNaN(d.getTime())) d = new Date();
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function ansLetters(ans) {
    if (ans == null) return '';
    var a = Array.isArray(ans) ? ans : [ans];
    return a.map(function (i) { return 'ABCDEFGH'[i]; }).join('');
  }

  /* ================= 1. 考试记录修复 =================
     app.js submitPaper 只写 ttgd.paper.result.<id>，
     练习中心的「考试记录」读的是 ttgd.exam.v1 —— 两键不一致导致记录不显示。
     这里在结果页出现时把最新一次成绩合并进 ttgd.exam.v1。 */
  function syncExamRecord() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('ttgd.paper.result.') === 0) keys.push(k);
      }
      if (!keys.length) return;
      var latest = null, latestDate = 0;
      for (var j = 0; j < keys.length; j++) {
        var arr = [];
        try { arr = JSON.parse(localStorage.getItem(keys[j])) || []; } catch (e) { arr = []; }
        if (arr.length && arr[0] && arr[0].date > latestDate) {
          latestDate = arr[0].date;
          latest = arr[0];
        }
      }
      if (!latest) return;
      if (typeof TTStore === 'undefined' || !TTStore.getExam) return;
      var exam = TTStore.getExam() || [];
      var dup = exam.some(function (e) {
        return e.date === latest.date && e.score === latest.score && e.correct === latest.correct;
      });
      if (dup) return;
      var d = new Date();
      var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      TTStore.addExam({
        score: latest.score,
        correct: latest.correct,
        total: latest.total,
        seconds: latest.seconds,
        date: dateStr,
        pct: latest.score
      });
    } catch (e) { /* 记录同步失败不阻断考试 */ }
  }

  /* ================= 2. 错题回顾增强 ================= */
  function parseSelStr(wrongEl) {
    var ansEl = wrongEl.querySelector('.res-wrong-ans');
    if (!ansEl) return '';
    var txt = ansEl.textContent || '';
    var m = /你的答案：([^·\s]*)/.exec(txt);
    if (!m) return '';
    var v = (m[1] || '').trim();
    if (!v || v === '未作答') return '';
    return v;
  }
  function parseSelArr(wrongEl) {
    var s = parseSelStr(wrongEl);
    var arr = [];
    for (var i = 0; i < s.length; i++) {
      var idx = 'ABCDEFGH'.indexOf(s[i]);
      if (idx >= 0) arr.push(idx);
    }
    return arr;
  }

  /* ---- AI 逐选项解析（流式，复用服务端代理） ---- */
  function aiExplainOptions(q, userSel, btn, box) {
    if (!q) return;
    if (box.getAttribute('data-running') === '1') return;
    var out = box.querySelector('.ai-explain-box');
    if (btn) { btn.disabled = true; btn.textContent = '解析中…'; }
    if (!out) {
      out = document.createElement('div');
      out.className = 'ai-explain-box';
      box.appendChild(out);
    }
    out.innerHTML = '<span class="cur"></span>';
    box.setAttribute('data-running', '1');
    var letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    var optsText = (q.options || []).map(function (o, i) { return letters[i] + '. ' + o; }).join('\n');
    var correctText = ansLetters(q.answer);
    var userText = userSel ? (userSel === correctText ? '（我选对了）' : '（我选了 ' + userSel + ' ，答错了）') : '（未作答）';
    var sys = '你是「天天滚动」西综考研网站的 AI 解析助手，帮助医学生理解西医综合考研真题。请逐选项解析：对每个选项用「A. 对/错：原因」的格式逐行说明；最后给出考点总结。正文不超过 450 字，不要客套。';
    var userMsg = '题目（' + (q.subject || '') + '）：\n' + q.question +
      '\n选项：\n' + optsText +
      '\n正确答案：' + correctText +
      '\n我的答案：' + userText +
      (q.explain ? '\n\n官方解析供参考：\n' + q.explain : '') +
      '\n\n请给出逐选项解析。';
    var FN = 'https://edxrlkfdijlydajjxxwv.supabase.co/functions/v1/ai';
    var key = (window.TT_SUPABASE && window.TT_SUPABASE.anonKey) || '';
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 30000) : null;
    var reqOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }] })
    };
    if (ctrl) reqOpts.signal = ctrl.signal;
    fetch(FN, reqOpts).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error((d && d.error) || 'AI 解析服务不可用'); });
      return r;
    }).then(function (r) {
      var reader = r.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buf = '', acc = '';
      function renderOut(t) {
        out.textContent = t;
        var c = document.createElement('span');
        c.className = 'cur';
        out.appendChild(c);
        out.scrollTop = out.scrollHeight;
      }
      function finish(t) {
        if (timer) clearTimeout(timer);
        out.textContent = t || '（AI 未返回内容，请重试）';
        box.setAttribute('data-running', '0');
        if (btn) { btn.disabled = false; btn.textContent = '🔄 再解析一次'; }
      }
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) return null;
          buf += decoder.decode(res.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('data:') !== 0) continue;
            var data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              var j = JSON.parse(data);
              var d = j.choices && j.choices[0] && j.choices[0].delta ? (j.choices[0].delta.content || '') : '';
              if (d) { acc += d; renderOut(acc); }
            } catch (e) { /* 忽略半行 */ }
          }
          return pump();
        });
      }
      return pump().then(function () {
        if (buf.trim()) {
          try {
            var j = JSON.parse(buf.replace(/^data:\s*/, '').trim());
            var d = j.choices && j.choices[0] && j.choices[0].delta ? (j.choices[0].delta.content || '') : '';
            if (d) acc += d;
          } catch (e) { /* ignore */ }
        }
        finish(acc);
      });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      out.textContent = (e && e.name === 'AbortError') ? '⏱ 解析超时（30 秒），请重试' : ('⚠ ' + (e && e.message || e));
      box.setAttribute('data-running', '0');
      if (btn) { btn.disabled = false; btn.textContent = '🤖 AI 逐选项解析'; }
    });
  }

  /* ---- 对应导图片段（OCR 索引匹配；科目不在导图集合时全库匹配） ---- */
  function _snGrams(src) {
    var s2 = String(src || '').replace(/[\s，。、（）()：:；;,.!?！？·①-⑩\[\]【】“”‘’\-—_]/g, '');
    var g = {};
    for (var i = 0; i < s2.length - 1; i++) g[s2.substr(i, 2)] = 1;
    for (var j = 0; j < s2.length; j++) g[s2[j]] = 1;
    return g;
  }
  function _snBlockScore(qg, t) {
    var bg = _snGrams(t);
    var inter = 0;
    Object.keys(bg).forEach(function (k) { if (qg[k]) inter++; });
    var t2 = String(t || '').replace(/[\s，。、（）()：:；;,.!?！？·\[\]【】“”‘’\-—_]/g, '');
    var longHit = 0;
    for (var i = 0; i < t2.length - 2; i++) {
      var g3 = t2.substr(i, 3), ok = true;
      for (var a = 0; a < 2; a++) if (!qg[g3.substr(a, 2)]) { ok = false; break; }
      if (ok) longHit++;
    }
    var lenPen = t2.length > 38 ? 0.7 : 1;
    return (inter + longHit * 1.5) * lenPen;
  }
  function findImgSnippet(it) {
    var IDX = window.TTImgOcrIndex, CARDS = window.TTBundledImageCards;
    if (!IDX || !CARDS || !it) return null;
    var ch = cleanChapter(it.chapter || '');
    var subjSet = {};
    for (var s = 0; s < CARDS.length; s++) subjSet[CARDS[s].subject] = 1;
    var restrict = !!subjSet[it.subject];
    var sameCh = [], sameSubj = [];
    for (var i = 0; i < CARDS.length; i++) {
      var card = CARDS[i];
      if (restrict && card.subject !== it.subject) continue;
      var key = String(card.image).split('/').pop();
      var ent = IDX[key];
      if (!ent || !ent.b || !ent.b.length) continue;
      if (cleanChapter(card.chapter || '') === ch) sameCh.push({ card: card, ent: ent });
      else sameSubj.push({ card: card, ent: ent });
    }
    var cands = sameCh.length ? sameCh : sameSubj;
    if (!cands.length) return null;
    var qText = it.question + ' ' + (it.options || []).join(' ') + ' ' + (it.explain || '');
    var qg = _snGrams(qText);
    var best = null;
    cands.forEach(function (cand) {
      cand.ent.b.forEach(function (b) {
        var sc = _snBlockScore(qg, b[4]);
        if (!best || sc > best.sc) best = { sc: sc, cand: cand, b: b };
      });
    });
    if (!best || best.sc < 4.5) return null;
    var bx = best.b[0], by = best.b[1], bw = best.b[2], bh = best.b[3];
    var y0 = Math.max(0, by - bh * 0.5), y1 = Math.min(1, by + bh * 2.6);
    var x0 = Math.max(0, bx - 0.012), x1 = Math.min(1, bx + bw + 0.012);
    best.cand.ent.b.forEach(function (b) {
      var cy = b[1] + b[3] / 2;
      if (cy >= y0 && cy <= y1) {
        x0 = Math.min(x0, Math.max(0, b[0] - 0.008));
        x1 = Math.max(x1, Math.min(1, b[0] + b[2] + 0.008));
      }
    });
    var ent = best.cand.ent;
    var iw = ent.W || 2416, ih = ent.H || 1313;
    var cw = Math.min(1, x1 - x0), chh = y1 - y0;
    return { card: best.cand.card, x: x0, y: y0, w: cw, h: chh, iw: iw, ih: ih,
      text: best.b[4], sc: best.sc, sameCh: sameCh.length > 0 };
  }
  function openZoomViewer(card) {
    try {
      var img = new Image();
      img.onload = function () {
        var w = Math.min(1200, img.width || 1200);
        var h = Math.round((img.height || 800) * w / (img.width || 1200));
        var ov = document.createElement('div');
        ov.className = 'tt-zoom-ov';
        ov.innerHTML = '<div class="tt-zoom-box"><img src="' + esc(card.image) + '" style="max-width:92vw;width:' + w + 'px" alt="导图全图"><button class="tt-zoom-close">✕</button></div>';
        document.body.appendChild(ov);
        ov.querySelector('.tt-zoom-close').onclick = function () { ov.remove(); };
        ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
      };
      img.src = card.image;
    } catch (e) { /* ignore */ }
  }
  function bindImgSnippet(it, host) {
    try {
      var sn = findImgSnippet(it);
      if (!sn) return;
      var wrap = document.createElement('div');
      wrap.className = 'img-snippet';
      var iwPct = (100 / sn.w).toFixed(2), ihPct = (100 / sn.h).toFixed(2);
      var lPct = (-100 * sn.x / sn.w).toFixed(2), tPct = (-100 * sn.y / sn.h).toFixed(2);
      var ratio = (sn.w * sn.iw) / (sn.h * sn.ih);
      wrap.innerHTML =
        '<div class="img-snippet-label">📎 对应导图片段 · 点击看全图</div>' +
        '<div class="img-snippet-viewport" style="aspect-ratio:' + ratio.toFixed(3) + '">' +
        '<img src="' + esc(ossThumb(sn.card.image, 1400, 85)) + '" alt="导图片段" loading="lazy" style="width:' + iwPct + '%;height:' + ihPct + '%;left:' + lPct + '%;top:' + tPct + '%">' +
        '</div>' +
        '<div class="img-snippet-foot">' + esc(cleanChapter(sn.card.chapter || '')) + ' 导图' + (sn.sameCh ? '' : '（跨科目匹配）') + '</div>';
      wrap.querySelector('.img-snippet-viewport').addEventListener('click', function () { openZoomViewer(sn.card); });
      host.appendChild(wrap);
    } catch (e) { /* 片段是增强功能，失败不影响回顾 */ }
  }

  /* ---- 单张错题卡增强 ---- */
  function enhanceWrong(wrongEl) {
    if (wrongEl.getAttribute('data-exfix') === '1') return;
    wrongEl.setAttribute('data-exfix', '1');
    var badge = wrongEl.querySelector('.paper-q-badge');
    var m = badge && /第\s*(\d+)\s*题/.exec(badge.textContent || '');
    var qnum = m ? parseInt(m[1], 10) : 0;
    if (!qnum || !window.TTBundledPaper) return;
    var q = null;
    for (var i = 0; i < window.TTBundledPaper.length; i++) {
      if (window.TTBundledPaper[i].qnum === qnum) { q = window.TTBundledPaper[i]; break; }
    }
    if (!q) return;

    // 3. 逐选项列表（对错 + 你的选择）
    if (q.options && q.options.length) {
      var ansArr = Array.isArray(q.answer) ? q.answer : [q.answer];
      var selArr = parseSelArr(wrongEl);
      var optsHtml = q.options.map(function (o, idx) {
        var isRight = ansArr.indexOf(idx) >= 0;
        var isSel = selArr.indexOf(idx) >= 0;
        var cls = isRight ? 'res-opt-ok' : (isSel ? 'res-opt-bad' : '');
        var tag = isRight ? '✓ 正确' : (isSel ? '✗ 你选' : '');
        return '<div class="res-opt ' + cls + '"><span class="res-opt-key">' + 'ABCDEFGH'[idx] + '</span>' +
          '<span class="res-opt-text">' + esc(o) + '</span>' +
          (tag ? '<span class="res-opt-tag">' + tag + '</span>' : '') + '</div>';
      }).join('');
      var div = document.createElement('div');
      div.className = 'res-opts';
      div.innerHTML = optsHtml;
      var qEl = wrongEl.querySelector('.res-wrong-q');
      if (qEl && qEl.nextSibling) wrongEl.insertBefore(div, qEl.nextSibling);
      else wrongEl.appendChild(div);
    }

    // 4. AI 逐选项解析
    var aiZone = document.createElement('div');
    aiZone.className = 'res-ai-zone';
    var btn = document.createElement('button');
    btn.className = 'ai-explain-btn res-ai-btn';
    btn.textContent = '🤖 AI 逐选项解析';
    btn.addEventListener('click', function () {
      aiExplainOptions(q, parseSelStr(wrongEl), btn, aiZone);
    });
    aiZone.appendChild(btn);
    wrongEl.appendChild(aiZone);

    // 5. 对应导图片段
    bindImgSnippet(q, wrongEl);
  }

  /* ================= 观察器 ================= */
  function observe() {
    var mo = new MutationObserver(function () {
      try {
        // 结果页出现 → 同步考试记录（有去重，重复触发安全）
        if (document.querySelector('#paper-body .res-score')) syncExamRecord();
        // 错题卡出现 → 增强
        var wrongs = document.querySelectorAll('#paper-body .res-wrong');
        for (var i = 0; i < wrongs.length; i++) enhanceWrong(wrongs[i]);
      } catch (e) { /* ignore */ }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe);
  } else {
    observe();
  }
})();
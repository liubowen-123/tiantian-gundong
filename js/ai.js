/* ============================================================
   AI 助教：经 Supabase Edge Function 代理调用硅基流动免费模型（流式）
   模型：Qwen/Qwen2.5-7B-Instruct（完全免费）
   Key 存于服务端环境变量，前端只持 Supabase anon key
   ============================================================ */
(function () {
  var FN_URL = 'https://edxrlkfdijlydajjxxwv.supabase.co/functions/v1/ai';
  function anonKey() {
    try { return (window.TT_SUPABASE && window.TT_SUPABASE.anonKey) || ''; } catch (e) { return ''; }
  }
  var history = [];
  var panel = null, msgsEl = null, inputEl = null, sendBtn = null;

  /* ---------- 样式（绿色主题，与网站一致） ---------- */
  var CSS = '' +
    '.tt-ai-fab{position:fixed;right:16px;bottom:84px;z-index:150;width:52px;height:52px;border-radius:50%;' +
    'background:linear-gradient(135deg,#1f7a58,#2f8f6b);color:#fff;font-size:22px;border:none;cursor:pointer;' +
    'box-shadow:0 8px 24px rgba(31,122,88,.4);display:flex;align-items:center;justify-content:center;' +
    'transition:transform .15s,box-shadow .15s;}' +
    '.tt-ai-fab:active{transform:scale(.92);}' +
    '.tt-ai-fab .dot{position:absolute;top:4px;right:4px;width:10px;height:10px;border-radius:50%;' +
    'background:#ffb020;border:2px solid #fff;}' +
    '.tt-ai-panel{position:fixed;right:16px;bottom:148px;z-index:160;width:min(380px,calc(100vw - 32px));' +
    'height:min(560px,calc(100vh - 190px));background:#fff;border-radius:20px;box-shadow:0 20px 60px rgba(20,40,30,.3);' +
    'display:flex;flex-direction:column;overflow:hidden;animation:ttAiIn .22s ease;}' +
    '@keyframes ttAiIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}' +
    '.tt-ai-head{display:flex;align-items:center;gap:8px;padding:13px 16px;' +
    'background:linear-gradient(135deg,#14533d,#1f7a58);color:#fff;}' +
    '.tt-ai-head .t{font-size:15px;font-weight:800;flex:1;}' +
    '.tt-ai-head .s{font-size:11px;opacity:.85;}' +
    '.tt-ai-head button{background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:2px 6px;opacity:.85;}' +
    '.tt-ai-head button:hover{opacity:1;}' +
    '.tt-ai-msgs{flex:1;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:10px;' +
    'background:#f7faf8;}' +
    '.tt-ai-msg{max-width:88%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.65;' +
    'white-space:pre-wrap;word-break:break-word;}' +
    '.tt-ai-msg.user{align-self:flex-end;background:linear-gradient(135deg,#1f7a58,#2f8f6b);color:#fff;' +
    'border-bottom-right-radius:4px;}' +
    '.tt-ai-msg.bot{align-self:flex-start;background:#fff;color:#243b31;border:1px solid #e3efe9;' +
    'border-bottom-left-radius:4px;box-shadow:0 1px 3px rgba(20,60,40,.06);}' +
    '.tt-ai-msg.bot.typing:empty::after{content:"…";}' +
    '.tt-ai-msg.err{align-self:flex-start;background:#fdecec;color:#b03a2e;border:1px solid #f5c6c0;}' +
    '.tt-ai-msg .cur{display:inline-block;width:7px;height:14px;background:#2f8f6b;margin-left:1px;' +
    'vertical-align:-2px;animation:ttAiBlink 1s steps(2) infinite;}' +
    '@keyframes ttAiBlink{0%,100%{opacity:1}50%{opacity:0}}' +
    '.tt-ai-inputbar{display:flex;gap:8px;padding:10px 12px 12px;border-top:1px solid #eef3f0;background:#fff;}' +
    '.tt-ai-inputbar textarea{flex:1;border:1px solid #dfe9e3;border-radius:12px;padding:9px 12px;font-size:13.5px;' +
    'resize:none;outline:none;font-family:inherit;min-height:40px;max-height:110px;color:#243b31;background:#fbfdfb;}' +
    '.tt-ai-inputbar textarea:focus{border-color:#2f8f6b;background:#fff;}' +
    '.tt-ai-inputbar button{width:46px;border-radius:12px;border:none;background:linear-gradient(135deg,#1f7a58,#2f8f6b);' +
    'color:#fff;font-size:17px;cursor:pointer;flex-shrink:0;}' +
    '.tt-ai-inputbar button:disabled{opacity:.5;cursor:not-allowed;}' +
    '.tt-ai-foot{display:flex;justify-content:space-between;align-items:center;padding:0 12px 9px;' +
    'font-size:11px;color:#9fb3aa;background:#fff;}' +
    '.tt-ai-foot a{color:#1f7a58;cursor:pointer;text-decoration:none;}' +
    '';

  /* ---------- UI ---------- */
  function ensureUI() {
    if (panel) return;
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var fab = document.createElement('button');
    fab.className = 'tt-ai-fab';
    fab.innerHTML = '🤖<span class="dot"></span>';
    fab.title = 'AI 助教';
    fab.addEventListener('click', toggle);
    document.body.appendChild(fab);

    panel = document.createElement('div');
    panel.className = 'tt-ai-panel';
    panel.style.display = 'none';
    panel.innerHTML =
      '<div class="tt-ai-head">' +
        '<span class="t">AI 助教</span>' +
        '<span class="s">Qwen2.5 · 免费</span>' +
        '<button id="tt-ai-clear" title="清空对话">🗑</button>' +
        '<button id="tt-ai-close" title="关闭">✕</button>' +
      '</div>' +
      '<div class="tt-ai-msgs" id="tt-ai-msgs"></div>' +
      '<div class="tt-ai-inputbar">' +
        '<textarea id="tt-ai-input" placeholder="问任何西综知识点，例如：帮我讲讲心力衰竭的机制…" rows="1"></textarea>' +
        '<button id="tt-ai-send">➤</button>' +
      '</div>' +
      '<div class="tt-ai-foot"><span>经 Supabase 代理 · Key 安全不暴露</span><a id="tt-ai-clear2">清空对话</a></div>';
    document.body.appendChild(panel);

    msgsEl = panel.querySelector('#tt-ai-msgs');
    inputEl = panel.querySelector('#tt-ai-input');
    sendBtn = panel.querySelector('#tt-ai-send');

    panel.querySelector('#tt-ai-close').addEventListener('click', close);
    panel.querySelector('#tt-ai-clear').addEventListener('click', clearChat);
    panel.querySelector('#tt-ai-clear2').addEventListener('click', clearChat);
    sendBtn.addEventListener('click', ask);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
    });
    if (history.length === 0) {
      appendMsg('bot', '你好！我是你的 AI 助教 🤖\n可以问我任何西综考研知识点，比如：\n· 帮我解释一下心肌梗死的分期\n· 葡萄糖有氧氧化的步骤\n· 这道题选什么，为什么');
    }
  }
  function toggle() { if (panel.style.display === 'none') openPanel(); else close(); }
  function openPanel() { ensureUI(); panel.style.display = 'flex'; inputEl.focus(); }
  function close() { if (panel) panel.style.display = 'none'; }
  function clearChat() { history = []; if (msgsEl) msgsEl.innerHTML = ''; appendMsg('bot', '已清空，开始新对话吧～'); }

  function appendMsg(role, text) {
    if (!msgsEl) return null;
    var d = document.createElement('div');
    d.className = 'tt-ai-msg ' + role;
    d.textContent = text;
    msgsEl.appendChild(d);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return d;
  }
  function setBusy(b) {
    sendBtn.disabled = b;
    sendBtn.textContent = b ? '…' : '➤';
    inputEl.disabled = b;
    if (!b) inputEl.focus();
  }

  /* ---------- 流式请求 ---------- */
  function ask() {
    if (!panel) ensureUI();
    var text = inputEl.value.trim();
    if (!text || sendBtn.disabled) return;
    inputEl.value = '';
    history.push({ role: 'user', content: text });
    appendMsg('user', text);
    var bubble = appendMsg('bot', '');
    bubble.classList.add('typing');
    setBusy(true);

    fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + anonKey(),
      },
      body: JSON.stringify({ messages: history.slice(-10) }),
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.json().then(function (d) {
          throw new Error((d && d.error) || 'AI 服务暂时不可用');
        });
      }
      return resp;
    }).then(function (resp) {
      if (!resp.body) throw new Error('当前浏览器不支持流式读取');
      var reader = resp.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buf = '';
      var acc = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return null;
          buf += decoder.decode(r.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('data:') !== 0) continue;
            var data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              var j = JSON.parse(data);
              var delta = j.choices && j.choices[0] && j.choices[0].delta
                ? (j.choices[0].delta.content || '') : '';
              if (delta) {
                acc += delta;
                bubble.classList.remove('typing');
                bubble.textContent = acc;
                msgsEl.scrollTop = msgsEl.scrollHeight;
              }
            } catch (e) { /* 忽略半行 */ }
          }
          return pump();
        });
      }
      return pump().then(function () {
        // 尾部残留数据
        if (buf.trim()) {
          try {
            var j = JSON.parse(buf.replace(/^data:\s*/, '').trim());
            var delta = j.choices && j.choices[0] && j.choices[0].delta
              ? (j.choices[0].delta.content || '') : '';
            if (delta) { acc += delta; bubble.textContent = acc; }
          } catch (e) { /* ignore */ }
        }
        if (!acc) {
          bubble.textContent = '（无回复，请重试）';
        } else {
          history.push({ role: 'assistant', content: acc });
        }
        bubble.classList.remove('typing');
        setBusy(false);
      });
    }).catch(function (e) {
      bubble.classList.remove('typing');
      bubble.textContent = '⚠ ' + (e && e.message || e);
      setBusy(false);
    });
  }

  /* ---------- 对外 API ---------- */
  window.TTAI = { ask: ask, open: openPanel, close: close };

  function init() { ensureUI(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 800); });
  } else {
    setTimeout(init, 800);
  }
})();

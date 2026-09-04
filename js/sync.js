/* ============================================================
   天天滚动 · Supabase 云同步层
   - 邮箱注册 / 登录 / 登出（会话自动恢复）
   - 本地数据（TTStore.exportAll）↔ 云端 user_data 表同步
   - 首次登录防误覆盖：让用户选择「从云端恢复」或「保留本地上传」
   - 使用中每 20s 检测本地变化并防抖推送，离开页面时兜底推送
   依赖：js/vendor/supabase.min.js（全局 supabase）、js/supabase-config.js
   ============================================================ */
(function () {
  var CFG = window.TT_SUPABASE || {};
  var client = null;
  var user = null;
  var authed = false;
  var lastExportHash = '';
  var watchTimer = null;
  var pendingPush = false;
  var listeners = [];

  var META_KEY = 'ttgd.sync.meta';

  /* ---------- 工具 ---------- */
  function configured() {
    return CFG.enabled && CFG.url && CFG.anonKey &&
      CFG.url.indexOf('YOUR-') < 0 && CFG.anonKey.indexOf('YOUR-') < 0;
  }
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36);
  }
  function meta() { try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch (e) { return null; } }
  function saveMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) {} }
  function currentExportHash() {
    try {
      // exportAll 里的 exportedAt 每次不同，去掉后再做 hash，保证同数据 hash 稳定
      var raw = JSON.parse(TTStore.exportAll());
      delete raw.exportedAt;
      return hash(JSON.stringify(raw));
    } catch (e) { return ''; }
  }
  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i]({ authed: authed, user: user }); } catch (e) {}
    }
  }

  /* ---------- 认证 ---------- */
  function register(email, pwd) { return client.auth.signUp({ email: email, password: pwd }); }
  function login(email, pwd) { return client.auth.signInWithPassword({ email: email, password: pwd }); }
  function logout() { return client.auth.signOut(); }

  /* ---------- 云端读写 ---------- */
  function fetchCloud() {
    return client.from('user_data').select('payload, updated_at').eq('user_id', user.id).maybeSingle();
  }
  function pushCloud() {
    return client.from('user_data').upsert({
      user_id: user.id,
      payload: JSON.parse(TTStore.exportAll()),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
  }

  /* ---------- 登录后流程 ---------- */
  function onSignedIn(session) {
    user = session.user;
    authed = true;
    hideLogin();
    var m = meta();
    if (!m || !m.lastPushAt) {
      askRestore();            // 首次登录：防误覆盖
    } else {
      syncOnce();              // 非首次：云端/本地按时间合并
    }
    startWatch();
    emit();
  }

  function startWatch() {
    stopWatch();
    watchTimer = setInterval(function () {
      if (!authed) return;
      var h = currentExportHash();
      if (h && h !== lastExportHash) { lastExportHash = h; schedulePush(); }
    }, 20000);
    window.addEventListener('beforeunload', function () {
      if (authed) {
        var h = currentExportHash();
        if (h && h !== lastExportHash) { try { pushCloud(); } catch (e) {} }
      }
    });
  }
  function stopWatch() { if (watchTimer) { clearInterval(watchTimer); watchTimer = null; } }

  function schedulePush() {
    if (pendingPush || !authed) return;
    pendingPush = true;
    setTimeout(function () {
      pendingPush = false;
      if (!authed) return;
      pushCloud().then(function (res) {
        if (!res.error) {
          lastExportHash = currentExportHash();
          var m = meta() || {}; m.lastPushAt = new Date().toISOString(); saveMeta(m);
        } else {
          console.warn('cloud push failed', res.error);
        }
      }).catch(function () {});
    }, 3000);
  }

  /* 非首次登录：按更新时间决定云端优先 or 本地优先 */
  function syncOnce() {
    fetchCloud().then(function (res) {
      if (res.error) { console.warn('cloud fetch failed', res.error); return; }
      var row = res.data;
      var m = meta() || {};
      if (row && row.updated_at) {
        var cloudT = new Date(row.updated_at).getTime();
        var pushT = m.lastPushAt ? new Date(m.lastPushAt).getTime() : 0;
        if (cloudT > pushT) {
          // 云端更新 → 覆盖本地
          try {
            TTStore.importAll(row.payload);
            m.lastPushAt = row.updated_at; m.lastPullAt = new Date().toISOString(); saveMeta(m);
            lastExportHash = currentExportHash();
            notify('已从云端恢复数据');
          } catch (e) { console.error('cloud restore failed', e); }
        } else {
          schedulePush();
        }
      } else {
        schedulePush();
      }
    }).catch(function () {});
  }

  /* 首次登录：选择恢复来源（防误覆盖） */
  function askRestore() {
    fetchCloud().then(function (res) {
      if (res.error) return;
      var hasCloud = !!(res.data && res.data.payload);
      var localEmpty = !(TTStore.getContent().length > 0);
      if (!hasCloud) { uploadLocal(); return; }   // 云端空 → 直接上传本地
      if (localEmpty) { restoreFromCloud(); return; } // 本地空 → 直接恢复云端
      // 两边都有数据 → 让用户选
      showRestoreChoice();
    });
  }

  function restoreFromCloud() {
    fetchCloud().then(function (res) {
      if (!res.error && res.data && res.data.payload) {
        try { TTStore.importAll(res.data.payload); } catch (e) {}
      }
      var m = meta() || {}; m.lastPushAt = new Date().toISOString(); saveMeta(m);
      lastExportHash = currentExportHash();
      schedulePush();
      notify('已从云端恢复数据');
    }).catch(function () {});
  }
  function uploadLocal() {
    var m = meta() || {}; m.lastPushAt = new Date().toISOString(); saveMeta(m);
    lastExportHash = currentExportHash();
    schedulePush();
    notify('本地数据已上传云端');
  }

  /* ---------- 首次登录选择 UI ---------- */
  function showRestoreChoice() {
    var card = document.getElementById('tt-login-card');
    if (!card) return;
    card.innerHTML =
      '<div class="tt-login-logo">🕊️ 天天滚动</div>' +
      '<div class="tt-login-title">发现云端已有数据</div>' +
      '<div class="tt-login-sub">云端和本机都有学习数据，选择用哪一份：</div>' +
      '<button class="btn-primary" id="tt-restore-cloud">从云端恢复（覆盖本机）</button>' +
      '<button class="btn-ghost" id="tt-restore-local">保留本机数据（覆盖云端）</button>' +
      '<div class="tt-login-tip">建议选数据更新的那一份</div>';
    document.getElementById('tt-restore-cloud').addEventListener('click', function () { restoreFromCloud(); });
    document.getElementById('tt-restore-local').addEventListener('click', function () { uploadLocal(); });
  }

  /* ---------- 登录界面 ---------- */
  function showLogin() {
    if (document.getElementById('tt-login-mask')) { return; }
    var mask = document.createElement('div');
    mask.id = 'tt-login-mask';
    mask.className = 'tt-login-mask';
    mask.innerHTML =
      '<div class="tt-login-card" id="tt-login-card">' +
        '<div class="tt-login-logo">🕊️ 天天滚动</div>' +
        '<div class="tt-login-title">账号登录 · 云端同步</div>' +
        '<div class="tt-login-sub">登录后学习数据自动同步到云端，换设备不丢失</div>' +
        '<div class="tt-login-field"><input class="form-input" id="tt-email" type="email" placeholder="邮箱" autocomplete="email"></div>' +
        '<div class="tt-login-field"><input class="form-input" id="tt-pwd" type="password" placeholder="密码（至少 6 位）" autocomplete="current-password"></div>' +
        '<div class="tt-login-err" id="tt-login-err"></div>' +
        '<button class="btn-primary" id="tt-submit">登 录</button>' +
        '<button class="btn-ghost" id="tt-toggle">没有账号？去注册</button>' +
        '<div class="tt-login-tip">首次使用点「去注册」，注册即自动登录</div>' +
      '</div>';
    document.body.appendChild(mask);
    var mode = 'login';
    var err = mask.querySelector('#tt-login-err');
    var btn = mask.querySelector('#tt-submit');
    var toggle = mask.querySelector('#tt-toggle');
    var email = mask.querySelector('#tt-email');
    var pwd = mask.querySelector('#tt-pwd');
    function setMode(m) {
      mode = m;
      btn.textContent = m === 'login' ? '登 录' : '注 册';
      toggle.textContent = m === 'login' ? '没有账号？去注册' : '已有账号？去登录';
      err.textContent = '';
    }
    function submit() {
      var e = email.value.trim(); var p = pwd.value;
      if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { err.textContent = '请输入正确的邮箱'; return; }
      if (!p || p.length < 6) { err.textContent = '密码至少 6 位'; return; }
      err.textContent = '';
      btn.disabled = true; btn.textContent = '请稍候…';
      var action = mode === 'login' ? login(e, p) : register(e, p);
      action.then(function (res) {
        btn.disabled = false;
        if (res.error) {
          err.textContent = res.error.message || '操作失败，请重试';
          btn.textContent = mode === 'login' ? '登 录' : '注 册';
          return;
        }
        if (mode === 'register') {
          // 注册：若项目开了邮箱验证会返回无会话，提示去验证；否则直接进入
          if (res.data && res.data.session) { /* SIGNED_IN 事件接管 */ }
          else {
            err.style.color = '#159a9a';
            err.textContent = '注册成功！若已开启邮箱验证，请到邮箱点击确认链接后登录';
            setMode('login');
            btn.disabled = false;
          }
        }
      }).catch(function (e2) {
        btn.disabled = false;
        err.textContent = '网络异常：' + (e2 && e2.message ? e2.message : '请稍后再试');
        btn.textContent = mode === 'login' ? '登 录' : '注 册';
      });
    }
    btn.addEventListener('click', submit);
    toggle.addEventListener('click', function () { setMode(mode === 'login' ? 'register' : 'login'); });
    pwd.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });
    email.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') submit(); });
    setTimeout(function () { email.focus(); }, 100);
  }
  function hideLogin() {
    var m = document.getElementById('tt-login-mask');
    if (m) m.parentNode.removeChild(m);
  }
  function notify(msg) {
    if (window.toast) { try { window.toast(msg); } catch (e) {} }
  }

  /* ---------- 对外 API ---------- */
  window.TTSync = {
    configured: configured,
    isAuthed: function () { return authed; },
    getUser: function () { return user; },
    login: login,
    register: register,
    logout: function () { return logout(); },
    syncNow: function () { if (authed) syncOnce(); },
    restoreFromCloud: restoreFromCloud,
    uploadLocal: uploadLocal,
    showLoginUI: function () { if (configured()) showLogin(); },
    onState: function (fn) { listeners.push(fn); }
  };

  /* ---------- 初始化 ---------- */
  function init() {
    if (!configured()) {
      console.info('天天滚动：Supabase 未配置，云同步未启用');
      return;
    }
    if (!window.supabase || !window.supabase.createClient) {
      console.error('supabase-js 未加载');
      return;
    }
    try {
      client = window.supabase.createClient(CFG.url, CFG.anonKey);
    } catch (e) { console.error('supabase init failed', e); return; }
    var uiShown = false;
    function showIdle() {
      if (uiShown) return;
      uiShown = true;
      // 必须登录才能使用：未登录时弹出全屏登录入口，登录成功后才放行
      if (!authed) showLogin();
      startWatch();
      emit();
    }
    function finish(res) {
      if (res && res.data && res.data.session) { onSignedIn(res.data.session); }
      showIdle();
    }
    client.auth.getSession().then(finish).catch(finish);
    // 兜底：网络慢时 getSession 未及时返回也先弹登录入口，避免长时间白屏
    setTimeout(showIdle, 6000);
    client.auth.onAuthStateChange(function (event, session) {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) { onSignedIn(session); }
      else if (event === 'SIGNED_OUT') {
        authed = false; user = null; stopWatch(); emit();
        showLogin();   // 退出登录后回到登录入口（必须登录才能使用）
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 600); });
  } else {
    setTimeout(init, 600);
  }
})();

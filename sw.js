/* 天天滚动 · Service Worker（PWA 离线缓存 + 版本更新提示） */
const CACHE = 'ttgd-v4';
const IMG_CACHE = 'ttgd-img-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/storage.js',
  './js/scheduler.js',
  './js/anki.js',
  './js/data.js',
  './js/bundled_questions.js',
  './js/bundled_imagecards.js',
  './js/plan-data.js',
  './js/app.js',
  './js/vendor/supabase.min.js',
  './js/supabase-config.js',
  './js/sync.js',
  './icons/icon.svg'
];

self.addEventListener('install', e => {
  self.skipWaiting(); // 立即激活新版本
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .catch(err => {
        // 个别资源缓存失败不影响 SW 安装
        console.warn('SW 缓存部分资源失败:', err);
      })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== IMG_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      // 通知所有客户端有新版本可用
      .then(() => {
        self.clients.matchAll().then(clients => {
          clients.forEach(client => {
            client.postMessage({ type: 'SW_UPDATED', cache: CACHE });
          });
        });
      })
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // OSS 图片：缓存优先，失败回源
  if (url.hostname === 'ttgd-images.oss-cn-hongkong.aliyuncs.com') {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(IMG_CACHE).then(c => c.put(e.request, clone)); }
        return res;
      }).catch(() => caches.match(e.request)))
    );
    return;
  }

  // 同源资源：网络优先（确保内容最新），离线时回退到缓存
  if (url.origin === location.origin) {
    // 对 API 类请求不走缓存（纯静态站点暂不需要，但保留扩展性）
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});

// 监听来自页面的消息（如跳过更新、刷新页面等）
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
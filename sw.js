/* 天天滚动 · Service Worker（PWA 离线缓存） */
const CACHE = 'ttgd-v2';
const IMG_CACHE = 'ttgd-img-v2';
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
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== IMG_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
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

  // 同源资源：缓存优先（应用壳离线可用）
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }))
    );
  }
});

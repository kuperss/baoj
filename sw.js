// sw.js — 離線快取
const CACHE = 'baoj-v5';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/calc.js',
  './js/storage.js',
  './js/camera.js',
  './js/ocr.js',
  './js/icons.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 個別 add,單檔失敗不影響全部
    await Promise.all(CORE.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Tesseract CDN / 語言模型 → stale-while-revalidate
  if (url.host.includes('jsdelivr.net') || url.host.includes('tessdata.projectnaptha.com') ||
      url.host.includes('unpkg.com') || /\.traineddata(\.gz)?$/.test(url.pathname)) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 同源:cache-first,失敗回退網路
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(req));
    return;
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const fetchP = fetch(req).then(res => {
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || fetchP || Response.error();
}

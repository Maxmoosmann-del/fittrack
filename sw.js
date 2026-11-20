/* FitTrack Service Worker - offline cache */
const CACHE = 'fittrack-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

function putInCache(req, res) {
  if (res && res.status === 200 && res.type === 'basic') {
    const clone = res.clone();
    caches.open(CACHE).then(c => c.put(req, clone));
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // API-Aufrufe (OpenFoodFacts, Gemini) nicht anfassen

  // App-Dateien: erst Netz, dann Cache. Sonst bleibt eine installierte PWA
  // ewig auf dem alten Stand, bis man CACHE hochzaehlt.
  const isAppShell = req.mode === 'navigate' || /\.(html|css|js|json)$/.test(url.pathname);
  if (isAppShell) {
    e.respondWith(
      fetch(req)
        .then(res => putInCache(req, res))
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // Bilder/Icons aendern sich praktisch nie: erst Cache, dann Netz.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => putInCache(req, res)))
  );
});

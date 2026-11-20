/* FitTrack Service Worker – offline cache */
const CACHE = 'fittrack-v10';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png',
  './icons/favicon.svg',
  './js/main.js',
  './js/store.js',
  './js/util.js',
  './js/nutrition.js',
  './js/habits.js',
  './js/backup.js',
  './js/api.js',
  './js/presets.js',
  './js/catalog.js',
  './data/catalog-de.json',
  './js/ui/dom.js',
  './js/ui/render.js',
  './js/ui/header.js',
  './js/ui/today.js',
  './js/ui/foods.js',
  './js/ui/workouts.js',
  './js/ui/settings.js',
  './js/ui/scan.js',
  './js/ui/update.js'
];

// Updates kommen über eine neue CACHE-Version: Dann lädt der Browser diese Datei neu,
// holt ALLE Dateien frisch und schaltet erst danach um. So passen die Module immer
// zusammen (eine Mischung aus alten und neuen ES-Modulen würde die App lahmlegen),
// und der Start ist auch bei schlechtem Netz sofort da (Cache zuerst).

self.addEventListener('install', e => {
  // Kein .catch: Scheitert eine Datei, scheitert die Installation, die alte Version
  // bleibt aktiv und der Browser versucht es später erneut.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // API-Aufrufe (OpenFoodFacts, Gemini) nicht anfassen

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return fetch(req);
    })
  );
});

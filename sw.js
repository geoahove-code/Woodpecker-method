// Offline support: precache the whole app shell plus the puzzle corpus.
const VERSION = 'wp-v1';
const ASSETS = [
  './',
  'index.html',
  'train.html',
  'sets.html',
  'stats.html',
  'css/main.css',
  'css/components.css',
  'css/board.css',
  'js/app.js',
  'js/i18n.js',
  'js/storage.js',
  'js/puzzle-db.js',
  'js/puzzle-engine.js',
  'js/woodpecker.js',
  'js/board.js',
  'js/charts.js',
  'js/sound.js',
  'js/train.js',
  'js/sets.js',
  'js/stats.js',
  'lib/chess.js',
  'lib/chessground.min.js',
  'lib/chessground.base.css',
  'lib/chessground.brown.css',
  'lib/chessground.cburnett.css',
  'assets/fonts/inter.css',
  'assets/board.svg',
  'data/puzzles.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ASSETS).catch(() => undefined)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());
    })
  );
});

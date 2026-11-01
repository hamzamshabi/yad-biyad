// Serves the MediaPipe files from the copy camera.js keeps on the phone, so they are downloaded once. It only reads that copy,
// and it leaves every other request alone, so a new page or script always comes from the site. CACHE must match camera.js.
const CACHE = 'holistic-0.5.1675471629';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.includes('/vendor/holistic/')) return;
  e.respondWith(caches.open(CACHE).then((cache) => cache.match(url.pathname)).then((hit) => hit || fetch(e.request)));
});

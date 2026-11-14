// Offline cache for Jìyì. Bump VERSION whenever you upload changed files,
// so phones pick up the new version on their next launch.
const VERSION = 'jiyi-v10';
const FILES = ['./', './index.html', './app.js', './speech-sdk.js', './decks.js', './pinyin-pro.js', './pinyin-auto.js', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never starts with old files.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Serve from the cache straight away (works offline), refresh the cache in the background.
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const network = fetch(req).then(async res => {
    if (res && res.ok) { const c = await caches.open(VERSION); await c.put(req, res.clone()); }
    return res;
  }).catch(() => null);
  e.waitUntil(network.then(() => {}));
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    let hit = await c.match(req, { ignoreSearch: true });
    if (!hit && req.mode === 'navigate') hit = (await c.match('./index.html')) || (await c.match('./'));
    return hit || (await network) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })());
});

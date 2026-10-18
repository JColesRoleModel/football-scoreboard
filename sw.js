// Service worker: offline app shell, cached logos, network-first data, and notification clicks.
const VERSION = 'v3';
const SHELL = `shell-${VERSION}`;
const RUNTIME = 'runtime';
const LOGOS = 'logos';

const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/api.js', 'js/normalize.js', 'js/ui.js', 'js/starfield.js', 'js/prefs.js', 'js/alerts.js',
  'js/views/scoreboard.js', 'js/views/standings.js', 'js/views/poll.js', 'js/views/team.js', 'js/views/myteams.js', 'js/views/livenow.js',
  'assets/icon.svg', 'assets/favicon.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('shell-') && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(RUNTIME);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'a.espncdn.com') return e.respondWith(cacheFirst(req, LOGOS));
  if (url.hostname.endsWith('espn.com') || url.pathname.includes('/data/')) return e.respondWith(networkFirst(req));
  if (url.origin === location.origin) {
    // App code: serve fresh when online so updates land right away, fall back to the cached shell offline.
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
      return res;
    }).catch(async () => (await caches.match(req)) || caches.match('index.html')));
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || './';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); w.navigate?.(target); return; }
    }
    await self.clients.openWindow(target);
  })());
});

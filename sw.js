/* Caches the app so it opens with no signal. Bump CACHE after any change,
   or browsers keep serving the copy they already have. */
const CACHE = "recipe-cloud-v9";
const SHELL = [
  './',
  './index.html',
  './cloud-store.js',
  './supabase-config.js',
  './vendor/supabase-2.117.3.js',
  './manifest.webmanifest',
  './healthy-kitchen-vegetables.webp',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(path => new Request(path, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('recipe-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const shellUrls = SHELL.map(path => new URL(path, self.registration.scope).href);
  if (url.origin !== self.location.origin || !shellUrls.includes(url.href)) return;
  e.respondWith((async () => {
    try {
      const live = await fetch(new Request(e.request, { cache: 'no-cache' }));
      if (!live.ok) throw new Error('App file unavailable');
      const cache = await caches.open(CACHE);
      await cache.put(e.request, live.clone());
      return live;
    } catch (error) {
      const hit = await caches.match(e.request);
      return hit || Response.error();
    }
  })());
});

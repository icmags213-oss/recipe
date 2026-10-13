/* Caches the app so it opens with no signal. Bump CACHE after any change,
   or browsers keep serving the copy they already have. */
const CACHE = "recipe-cloud-v4";
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
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const shellUrls = SHELL.map(path => new URL(path, self.registration.scope).href);
  if (url.origin !== self.location.origin || !shellUrls.includes(url.href)) return;
  e.respondWith(caches.match(e.request).then(hit => {
    const live = fetch(e.request).then(res => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => hit);
    return hit || live;
  }));
});

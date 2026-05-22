const CACHE = 'delve-v2';

// Install: cache core assets using relative paths
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll([
        'dungeon.html',
        'manifest.json',
        'icon-192.png',
        'icon-512.png',
        'favicon.ico',
        'favicon-32.png',
      ]).catch(() => {})
    )
  );
  self.skipWaiting();
});

// Activate: delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: serve from cache, fall back to network, cache new responses
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const url = e.request.url;
          if (url.startsWith(self.location.origin) || url.includes('fonts.g')) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(e.request, clone));
          }
        }
        return response;
      }).catch(() => {
        // Offline fallback — use relative path matching how install cached it
        if (e.request.mode === 'navigate') {
          return caches.match('dungeon.html');
        }
      });
    })
  );
});

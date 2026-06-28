const CACHE = 'delve-pixed-v0.2';

async function cachePixedAssets(cache) {
  try {
    const response = await fetch('src/assets/pixed/pixed_manifest.json', { cache: 'no-store' });
    if (!response.ok) return;
    const manifest = await response.json();
    const assetPaths = [...new Set(Object.values(manifest).map(meta => `src/assets/pixed/${meta.src}`))];
    await cache.addAll(assetPaths);
  } catch (err) {
    console.warn('DELVE pixed asset cache warm failed', err);
  }
}

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
        'src/index.html',
        'src/css/style.css',
        'src/js/constants.js',
        'src/js/data.js',
        'src/js/state.js',
        'src/js/map.js',
        'src/js/vision.js',
        'src/js/iso.js',
        'src/js/pathing.js',
        'src/js/animation.js',
        'src/js/canvas-renderer.js',
        'src/js/render.js',
        'src/js/combat.js',
        'src/js/items.js',
        'src/js/shop.js',
        'src/js/movement.js',
        'src/js/emergency.js',
        'src/js/ui.js',
        'src/js/sfx.js',
        'src/js/fx.js',
        'src/js/input.js',
        'src/js/pwa.js',
        'src/js/main.js',
        'src/js/assets.js',
        'src/assets/pixed/pixed_manifest.json',
      ]).catch(err => {
        console.warn('DELVE cache warm failed', err);
        throw err;
      }).then(() => cachePixedAssets(cache))
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

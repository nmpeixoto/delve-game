const CACHE = 'delve-pixed-v0.2';
const PIXED_ASSET_CACHE = [
  'src/assets/pixed/class_barbarian_attack.png',
  'src/assets/pixed/class_barbarian_death.png',
  'src/assets/pixed/class_barbarian_hurt.png',
  'src/assets/pixed/class_barbarian_idle.png',
  'src/assets/pixed/class_barbarian_walk.png',
  'src/assets/pixed/class_mage_attack.png',
  'src/assets/pixed/class_mage_death.png',
  'src/assets/pixed/class_mage_hurt.png',
  'src/assets/pixed/class_mage_idle.png',
  'src/assets/pixed/class_mage_walk.png',
  'src/assets/pixed/class_monk_attack.png',
  'src/assets/pixed/class_monk_death.png',
  'src/assets/pixed/class_monk_hurt.png',
  'src/assets/pixed/class_monk_idle.png',
  'src/assets/pixed/class_monk_walk.png',
  'src/assets/pixed/class_necromancer_attack.png',
  'src/assets/pixed/class_necromancer_death.png',
  'src/assets/pixed/class_necromancer_hurt.png',
  'src/assets/pixed/class_necromancer_idle.png',
  'src/assets/pixed/class_necromancer_walk.png',
  'src/assets/pixed/class_paladin_attack.png',
  'src/assets/pixed/class_paladin_death.png',
  'src/assets/pixed/class_paladin_hurt.png',
  'src/assets/pixed/class_paladin_idle.png',
  'src/assets/pixed/class_paladin_walk.png',
  'src/assets/pixed/class_ranger_attack.png',
  'src/assets/pixed/class_ranger_death.png',
  'src/assets/pixed/class_ranger_hurt.png',
  'src/assets/pixed/class_ranger_idle.png',
  'src/assets/pixed/class_ranger_walk.png',
  'src/assets/pixed/class_rogue_attack.png',
  'src/assets/pixed/class_rogue_death.png',
  'src/assets/pixed/class_rogue_hurt.png',
  'src/assets/pixed/class_rogue_idle.png',
  'src/assets/pixed/class_rogue_walk.png',
  'src/assets/pixed/class_warrior_attack.png',
  'src/assets/pixed/class_warrior_death.png',
  'src/assets/pixed/class_warrior_hurt.png',
  'src/assets/pixed/class_warrior_idle.png',
  'src/assets/pixed/class_warrior_walk.png',
  'src/assets/pixed/enemy_bones_attack.png',
  'src/assets/pixed/enemy_bones_death.png',
  'src/assets/pixed/enemy_bones_hurt.png',
  'src/assets/pixed/enemy_bones_idle.png',
  'src/assets/pixed/enemy_bones_move.png',
  'src/assets/pixed/enemy_demon_attack.png',
  'src/assets/pixed/enemy_demon_death.png',
  'src/assets/pixed/enemy_demon_hurt.png',
  'src/assets/pixed/enemy_demon_idle.png',
  'src/assets/pixed/enemy_demon_move.png',
  'src/assets/pixed/enemy_dungeonLord_attack.png',
  'src/assets/pixed/enemy_dungeonLord_death.png',
  'src/assets/pixed/enemy_dungeonLord_hurt.png',
  'src/assets/pixed/enemy_dungeonLord_idle.png',
  'src/assets/pixed/enemy_dungeonLord_move.png',
  'src/assets/pixed/enemy_goblin_attack.png',
  'src/assets/pixed/enemy_goblin_death.png',
  'src/assets/pixed/enemy_goblin_hurt.png',
  'src/assets/pixed/enemy_goblin_idle.png',
  'src/assets/pixed/enemy_goblin_move.png',
  'src/assets/pixed/enemy_lich_attack.png',
  'src/assets/pixed/enemy_lich_death.png',
  'src/assets/pixed/enemy_lich_hurt.png',
  'src/assets/pixed/enemy_lich_idle.png',
  'src/assets/pixed/enemy_lich_move.png',
  'src/assets/pixed/enemy_orc_attack.png',
  'src/assets/pixed/enemy_orc_death.png',
  'src/assets/pixed/enemy_orc_hurt.png',
  'src/assets/pixed/enemy_orc_idle.png',
  'src/assets/pixed/enemy_orc_move.png',
  'src/assets/pixed/enemy_rat_attack.png',
  'src/assets/pixed/enemy_rat_death.png',
  'src/assets/pixed/enemy_rat_hurt.png',
  'src/assets/pixed/enemy_rat_idle.png',
  'src/assets/pixed/enemy_rat_move.png',
  'src/assets/pixed/enemy_skeleton_attack.png',
  'src/assets/pixed/enemy_skeleton_death.png',
  'src/assets/pixed/enemy_skeleton_hurt.png',
  'src/assets/pixed/enemy_skeleton_idle.png',
  'src/assets/pixed/enemy_skeleton_move.png',
  'src/assets/pixed/enemy_troll_attack.png',
  'src/assets/pixed/enemy_troll_death.png',
  'src/assets/pixed/enemy_troll_hurt.png',
  'src/assets/pixed/enemy_troll_idle.png',
  'src/assets/pixed/enemy_troll_move.png',
  'src/assets/pixed/environment_door_locked.png',
  'src/assets/pixed/environment_door_secret.png',
  'src/assets/pixed/environment_floor.png',
  'src/assets/pixed/environment_floor_cracked.png',
  'src/assets/pixed/environment_shop.png',
  'src/assets/pixed/environment_shrine.png',
  'src/assets/pixed/environment_stairs.png',
  'src/assets/pixed/environment_trap_alarm.png',
  'src/assets/pixed/environment_trap_bear.png',
  'src/assets/pixed/environment_trap_gas.png',
  'src/assets/pixed/environment_trap_spike.png',
  'src/assets/pixed/environment_wall.png',
  'src/assets/pixed/fx_fireball.png',
  'src/assets/pixed/fx_heal.png',
  'src/assets/pixed/fx_hit.png',
  'src/assets/pixed/fx_levelUp.png',
  'src/assets/pixed/fx_poison.png',
  'src/assets/pixed/item_armor.png',
  'src/assets/pixed/item_bomb.png',
  'src/assets/pixed/item_key.png',
  'src/assets/pixed/item_potion.png',
  'src/assets/pixed/item_scroll.png',
  'src/assets/pixed/item_upgrade.png',
  'src/assets/pixed/item_weapon.png',
  'src/assets/pixed/ui_gold.png',
  'src/assets/pixed/ui_hp.png',
  'src/assets/pixed/ui_xp.png',
];

async function cachePixedAssets(cache) {
  try {
    const response = await fetch('src/assets/pixed/pixed_manifest.json', { cache: 'no-store' });
    if (!response.ok) return;
    const manifest = await response.json();
    const assetPaths = [...new Set([
      ...PIXED_ASSET_CACHE,
      ...Object.values(manifest).map(meta => `src/assets/pixed/${meta.src}`),
    ])];
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
        ...PIXED_ASSET_CACHE,
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

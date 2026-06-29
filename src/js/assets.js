// ===================== PIXED ASSETS =====================
const PIXED_ASSET_BASE = location.pathname.includes('/src/index.html') ? 'assets/pixed/' : 'src/assets/pixed/';
const PIXED_ASSETS = {
  manifest: null,
  images: {},
  ready: false,
  error: null,
};

function assetUrl(src) {
  if (window.PIXED_INLINE_ASSETS && window.PIXED_INLINE_ASSETS[src]) return window.PIXED_INLINE_ASSETS[src];
  return PIXED_ASSET_BASE + src;
}

async function loadPixedAssets() {
  try {
    const manifest = window.PIXED_INLINE_MANIFEST || await fetch(PIXED_ASSET_BASE + 'pixed_manifest.json').then(r => r.json());
    PIXED_ASSETS.manifest = manifest;
    const entries = Object.entries(manifest);
    await Promise.all(entries.map(([key, meta]) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        PIXED_ASSETS.images[key] = img;
        resolve();
      };
      img.onerror = () => reject(new Error(`Failed to load pixed asset ${key}`));
      img.src = assetUrl(meta.src);
    })));
    PIXED_ASSETS.ready = true;
    return PIXED_ASSETS;
  } catch (err) {
    PIXED_ASSETS.error = err;
    throw err;
  }
}

function getPixedAsset(key) {
  if (!PIXED_ASSETS.manifest) return null;
  const meta = PIXED_ASSETS.manifest[key];
  const image = PIXED_ASSETS.images[key];
  return meta && image ? { ...meta, image } : null;
}

function playerAssetKey(anim = 'idle') {
  const cls = typeof G !== 'undefined' && G && G.player && G.player.class ? G.player.class : 'warrior';
  return `class.${cls}.${anim}`;
}

function enemyAssetSlug(enemy) {
  if (!enemy) return 'goblin';
  if (enemy.boss) return 'dungeonLord';
  const normalized = String(enemy.name || enemy.sym || 'goblin').toLowerCase();
  if (normalized.includes('bones')) return 'bones';
  if (normalized.includes('skeleton')) return 'skeleton';
  if (normalized.includes('rat')) return 'rat';
  if (normalized.includes('orc')) return 'orc';
  if (normalized.includes('troll')) return 'troll';
  if (normalized.includes('demon')) return 'demon';
  if (normalized.includes('lich')) return 'lich';
  return 'goblin';
}

function enemyAssetKey(enemy, anim = 'idle') {
  return `enemy.${enemyAssetSlug(enemy)}.${anim}`;
}

function itemAssetKey(item) {
  if (!item) return 'item.upgrade';
  if (item.type === 'weapon') return 'item.weapon';
  if (item.type === 'armor') return 'item.armor';
  if (item.type === 'potion' || item.type === 'potion_buff') return 'item.potion';
  if (item.type === 'bomb') return 'item.bomb';
  if (item.type === 'scroll' || item.type === 'scroll_teleport') return 'item.scroll';
  if (item.type === 'key') return 'item.key';
  return 'item.upgrade';
}

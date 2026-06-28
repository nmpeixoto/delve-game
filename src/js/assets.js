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

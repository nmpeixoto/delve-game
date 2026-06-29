// ===================== PIXED CANVAS RENDERER =====================
const PixedRenderer = {
  canvas: null,
  ctx: null,
  camera: null,
  lastFrame: 0,
  initialized: false,
};

if (typeof window !== 'undefined') window.PixedRenderer = PixedRenderer;

function initPixedRenderer() {
  const canvas = document.getElementById('game-canvas');
  const area = document.getElementById('map-area');
  if (!canvas || !area) return;
  PixedRenderer.canvas = canvas;
  PixedRenderer.ctx = canvas.getContext('2d');
  PixedRenderer.camera = createIsoCamera({ viewportWidth: area.clientWidth, viewportHeight: area.clientHeight });
  resizePixedCanvas();
  PixedRenderer.initialized = true;
}

function resizePixedCanvas() {
  if (!PixedRenderer.canvas) return;
  const area = document.getElementById('map-area');
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const width = Math.max(1, area.clientWidth);
  const height = Math.max(1, area.clientHeight);
  PixedRenderer.canvas.width = Math.floor(width * dpr);
  PixedRenderer.canvas.height = Math.floor(height * dpr);
  PixedRenderer.canvas.style.width = `${width}px`;
  PixedRenderer.canvas.style.height = `${height}px`;
  if (PixedRenderer.ctx) {
    PixedRenderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    PixedRenderer.ctx.imageSmoothingEnabled = false;
  }
  if (PixedRenderer.camera) {
    PixedRenderer.camera.viewportWidth = width;
    PixedRenderer.camera.viewportHeight = height;
  }
}

function drawDebugDiamond(ctx, screen, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(screen.x, screen.y);
  ctx.lineTo(screen.x + ISO_HALF_W, screen.y + ISO_HALF_H);
  ctx.lineTo(screen.x, screen.y + ISO_TILE_H);
  ctx.lineTo(screen.x - ISO_HALF_W, screen.y + ISO_HALF_H);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function drawPixedImage(ctx, key, x, y, frame = 0) {
  const asset = typeof getPixedAsset === 'function' ? getPixedAsset(key) : null;
  if (!asset) return false;
  const sx = Math.min(asset.frames - 1, frame) * asset.frameWidth;
  const sy = 0;
  ctx.drawImage(
    asset.image,
    sx,
    sy,
    asset.frameWidth,
    asset.frameHeight,
    Math.round(x - asset.anchorX),
    Math.round(y - asset.anchorY),
    asset.frameWidth,
    asset.frameHeight
  );
  return true;
}

function tileAssetKey(tile) {
  if (tile === TILE.WALL || tile === TILE.SECRET_DOOR) return 'environment.wall';
  if (tile === TILE.STAIRS) return 'environment.stairs';
  if (tile === TILE.SHOP) return 'environment.shop';
  if (tile === TILE.LOCKED_DOOR) return 'environment.doorLocked';
  return 'environment.floor';
}

function renderPixedScene() {
  if (!PixedRenderer.initialized) initPixedRenderer();
  const ctx = PixedRenderer.ctx;
  const canvas = PixedRenderer.canvas;
  if (!ctx || !canvas || !G.map || !G.player) return;
  resizePixedCanvas();
  centerCameraOnGrid(PixedRenderer.camera, G.player.x, G.player.y);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#050507';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < G.map.length; y++) {
    for (let x = 0; x < G.map[y].length; x++) {
      const seen = G.seen && G.seen.has(y * MAP_W + x);
      if (!seen) continue;
      const tile = G.map[y][x];
      const world = gridToIso(x, y);
      const screen = worldToScreen(world, PixedRenderer.camera);
      const key = tileAssetKey(tile);
      if (!drawPixedImage(ctx, key, screen.x, screen.y + 32)) {
        const fill = tile === TILE.WALL ? '#11131b' : tile === TILE.STAIRS ? '#1f3b2a' : tile === TILE.SHOP ? '#3b2b12' : '#202231';
        drawDebugDiamond(ctx, screen, fill, '#050507');
      }
    }
  }

  const drawables = [];
  (G.traps || []).forEach(trap => {
    const key = trap.y * MAP_W + trap.x;
    if (!G.seen || !G.seen.has(key)) return;
    if (!trap.revealed && !trap.triggered) return;
    const trapKey = trap.type === 'spike' ? 'environment.trapSpike'
      : trap.type === 'gas' ? 'environment.trapGas'
      : trap.type === 'alarm' ? 'environment.trapAlarm'
      : 'environment.trapBear';
    drawables.push({ kind: 'item', x: trap.x, y: trap.y, key: trapKey });
  });
  (G.items || []).filter(item => !item.carried && item.type === 'shrine').forEach(item => {
    const key = item.y * MAP_W + item.x;
    if (!G.seen || !G.seen.has(key)) return;
    if (!G.visible || !G.visible.has(key)) return;
    drawables.push({ kind: 'item', x: item.x, y: item.y, key: 'environment.shrine' });
  });
  drawables.sort((a, b) => isoDepthKey(a) - isoDepthKey(b)).forEach(d => {
    const screen = worldToScreen(gridToIso(d.x, d.y), PixedRenderer.camera);
    drawPixedImage(ctx, d.key, screen.x, screen.y + 32);
  });

  const player = worldToScreen(gridToIso(G.player.x, G.player.y), PixedRenderer.camera);
  ctx.fillStyle = '#d7b46a';
  ctx.fillRect(Math.round(player.x - 8), Math.round(player.y - 28), 16, 24);
}

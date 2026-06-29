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

function drawFallbackMarker(ctx, screen, fill, stroke, size = 6, offsetY = 16) {
  const cx = Math.round(screen.x);
  const cy = Math.round(screen.y + offsetY);
  const canRestore = typeof ctx.save === 'function' && typeof ctx.restore === 'function';
  if (canRestore) ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size, cy);
  ctx.lineTo(cx, cy + size);
  ctx.lineTo(cx - size, cy);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  if (canRestore) ctx.restore();
}

function getPixedFallbackStyle(drawable) {
  const key = drawable && drawable.key ? drawable.key : '';
  if (key === 'environment.trapSpike') return { fill: '#f87171', stroke: '#7f1d1d', size: 7, offsetY: 16 };
  if (key === 'environment.trapGas') return { fill: '#4ade80', stroke: '#14532d', size: 7, offsetY: 16 };
  if (key === 'environment.trapAlarm') return { fill: '#fde047', stroke: '#854d0e', size: 7, offsetY: 16 };
  if (key === 'environment.trapBear') return { fill: '#d1d5db', stroke: '#374151', size: 7, offsetY: 16 };
  if (key === 'environment.shrine') return { fill: '#c084fc', stroke: '#6d28d9', size: 8, offsetY: 16 };
  if (drawable && drawable.kind === 'fx') {
    return { fill: drawable.color || (drawable.fx && drawable.fx.color) || '#ffffff', stroke: '#050507', size: 5, offsetY: 16 };
  }
  if (drawable && drawable.kind === 'actor') {
    if (drawable.enemy && drawable.enemy.boss) return { fill: '#c084fc', stroke: '#4c1d95', size: 7, offsetY: 24 };
    if (drawable.enemy && drawable.enemy.isPet) return { fill: '#4ade80', stroke: '#14532d', size: 7, offsetY: 24 };
    if (drawable.enemy) return { fill: '#f87171', stroke: '#7f1d1d', size: 7, offsetY: 24 };
    return { fill: '#d7b46a', stroke: '#6b4f1d', size: 7, offsetY: 24 };
  }
  if (drawable && drawable.kind === 'item') {
    const type = drawable.item && drawable.item.type;
    if (type === 'weapon') return { fill: '#fb923c', stroke: '#7c2d12', size: 6, offsetY: 24 };
    if (type === 'armor') return { fill: '#60a5fa', stroke: '#1d4ed8', size: 6, offsetY: 24 };
    if (type === 'potion' || type === 'potion_buff') return { fill: '#4ade80', stroke: '#14532d', size: 6, offsetY: 24 };
    if (type === 'bomb') return { fill: '#f87171', stroke: '#7f1d1d', size: 6, offsetY: 24 };
    if (type === 'scroll' || type === 'scroll_teleport') return { fill: '#c084fc', stroke: '#6d28d9', size: 6, offsetY: 24 };
    if (type === 'key') return { fill: '#fde047', stroke: '#854d0e', size: 6, offsetY: 24 };
    return { fill: '#d7b46a', stroke: '#6b4f1d', size: 6, offsetY: 24 };
  }
  return { fill: '#c084fc', stroke: '#3b0764', size: 6, offsetY: 16 };
}

function drawPixedFallback(ctx, drawable, screen) {
  const style = getPixedFallbackStyle(drawable);
  drawFallbackMarker(ctx, screen, style.fill, style.stroke, style.size, style.offsetY);
}

function drawPixedImage(ctx, key, x, y, frame = 0) {
  const asset = typeof getPixedAsset === 'function' ? getPixedAsset(key) : null;
  if (!asset) return false;
  const frameCount = Number.isFinite(asset.frames) ? Math.floor(asset.frames) : 0;
  if (frameCount < 1) return false;
  const rawFrame = Number.isFinite(frame) ? Math.floor(frame) : 0;
  const clampedFrame = Math.max(0, Math.min(frameCount - 1, rawFrame));
  const sx = clampedFrame * asset.frameWidth;
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
  if (!ctx || !canvas || typeof G === 'undefined' || !G.map || !G.player) return;
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
    drawables.push({ kind: 'item', x: trap.x, y: trap.y, key: trapKey, trap });
  });
  (G.items || []).filter(item => !item.carried && item.type === 'shrine').forEach(item => {
    const key = item.y * MAP_W + item.x;
    if (!G.seen || !G.seen.has(key)) return;
    if (!G.visible || !G.visible.has(key)) return;
    drawables.push({ kind: 'item', x: item.x, y: item.y, key: 'environment.shrine', item });
  });
  drawables.sort((a, b) => isoDepthKey(a) - isoDepthKey(b)).forEach(d => {
    const screen = worldToScreen(gridToIso(d.x, d.y), PixedRenderer.camera);
    if (!drawPixedImage(ctx, d.key, screen.x, screen.y + 32)) {
      drawPixedFallback(ctx, d, screen);
    }
  });

  const actors = [];
  const playerAnim = typeof getEntityAnimation === 'function' ? getEntityAnimation('player') : null;
  const playerAnimName = (playerAnim || {}).name || 'idle';
  const playerKey = typeof playerAssetKey === 'function' ? playerAssetKey(playerAnimName) : `class.warrior.${playerAnimName}`;
  actors.push({ kind: 'actor', x: G.player.x, y: G.player.y, key: playerKey, tall: true });
  (G.enemies || []).forEach(enemy => {
    const key = enemy.y * MAP_W + enemy.x;
    if (!G.visible || !G.visible.has(key)) return;
    const animState = typeof getEntityAnimation === 'function' ? getEntityAnimation(`enemy:${enemy.id}`) : null;
    if (enemy.dying && !(animState || {}).name) return;
    const animName = (animState || {}).name || 'idle';
    const enemySlug = typeof enemyAssetSlug === 'function' ? enemyAssetSlug(enemy) : 'goblin';
    const enemyKey = typeof enemyAssetKey === 'function' ? enemyAssetKey(enemy, animName) : `enemy.${enemySlug}.${animName}`;
    actors.push({ kind: 'actor', x: enemy.x, y: enemy.y, key: enemyKey, enemy });
  });
  (G.items || []).filter(item => !item.carried && item.type !== 'shrine').forEach(item => {
    const key = item.y * MAP_W + item.x;
    if (!G.visible || !G.visible.has(key)) return;
    const itemKey = typeof itemAssetKey === 'function' ? itemAssetKey(item) : 'item.upgrade';
    actors.push({ kind: 'item', x: item.x, y: item.y, key: itemKey, item });
  });
  actors.sort((a, b) => isoDepthKey(a) - isoDepthKey(b)).forEach(d => {
    const screen = worldToScreen(gridToIso(d.x, d.y), PixedRenderer.camera);
    if (!drawPixedImage(ctx, d.key, screen.x, screen.y + 32)) {
      drawPixedFallback(ctx, d, screen);
    }
  });

  const fxList = typeof PIXED_ANIM !== 'undefined' && PIXED_ANIM && Array.isArray(PIXED_ANIM.fx) ? PIXED_ANIM.fx : [];
  const now = typeof nowMs === 'function' ? nowMs() : Date.now();
  fxList.forEach(fx => {
    const screen = worldToScreen(gridToIso(fx.x, fx.y), PixedRenderer.camera);
    if (!drawPixedImage(ctx, fx.key, screen.x, screen.y + 16)) {
      drawPixedFallback(ctx, { kind: 'fx', key: fx.key, color: fx.color, fx }, screen);
    }
    if (fx.text) {
      const age = now - fx.startedAt;
      const canRestore = typeof ctx.save === 'function' && typeof ctx.restore === 'function';
      if (canRestore) ctx.save();
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.fillStyle = fx.color || '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(fx.text, screen.x, screen.y - 28 - age / 30);
      if (canRestore) ctx.restore();
    }
  });
}

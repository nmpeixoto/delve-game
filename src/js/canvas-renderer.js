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

function pixedHash(x, y, salt = 0) {
  let n = (x + 101) * 374761393 + (y + 257) * 668265263 + salt * 1442695041;
  n = (n ^ (n >>> 13)) * 1274126177;
  return Math.abs(n ^ (n >>> 16));
}

function pixedDiamondPoints(screen, offsetY = 0) {
  const y = screen.y + offsetY;
  return {
    top: { x: screen.x, y },
    right: { x: screen.x + ISO_HALF_W, y: y + ISO_HALF_H },
    bottom: { x: screen.x, y: y + ISO_TILE_H },
    left: { x: screen.x - ISO_HALF_W, y: y + ISO_HALF_H },
  };
}

function drawPixedPolygon(ctx, points, fill, stroke = null, lineWidth = 1) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(Math.round(points[0].x), Math.round(points[0].y));
  for (let i = 1; i < points.length; i++) ctx.lineTo(Math.round(points[i].x), Math.round(points[i].y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function drawPixedLine(ctx, a, b, stroke, width = 1, alpha = 1) {
  const canRestore = typeof ctx.save === 'function' && typeof ctx.restore === 'function';
  if (canRestore) ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(Math.round(a.x), Math.round(a.y));
  ctx.lineTo(Math.round(b.x), Math.round(b.y));
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  if (canRestore) ctx.restore();
}

function isPixedSurfaceTile(tile) {
  return tile !== TILE.WALL && tile !== TILE.SECRET_DOOR;
}

function isPixedSolidWallTile(tile) {
  return tile === TILE.WALL || tile === TILE.SECRET_DOOR;
}

function getPixedMapTile(map, x, y) {
  if (!map || y < 0 || x < 0 || y >= map.length || x >= map[y].length) return TILE.WALL;
  return map[y][x];
}

const PIXED_WALL_EDGE_DEFS = [
  { dir: 'north', dx: 0, dy: -1, from: 'top', to: 'right', height: 44, fill: '#302828', shade: '#171114', cap: '#493a32' },
  { dir: 'west', dx: -1, dy: 0, from: 'left', to: 'top', height: 44, fill: '#2a2528', shade: '#141014', cap: '#3e332f' },
  { dir: 'east', dx: 1, dy: 0, from: 'right', to: 'bottom', height: 26, fill: '#251f22', shade: '#0f0d11', cap: '#332a29' },
  { dir: 'south', dx: 0, dy: 1, from: 'bottom', to: 'left', height: 26, fill: '#221d20', shade: '#0f0c10', cap: '#302727' },
];

function getPixedWallEdges(map, x, y) {
  const tile = getPixedMapTile(map, x, y);
  if (!isPixedSurfaceTile(tile)) return [];
  return PIXED_WALL_EDGE_DEFS
    .filter(edge => isPixedSolidWallTile(getPixedMapTile(map, x + edge.dx, y + edge.dy)))
    .map(edge => ({
      ...edge,
      neighborX: x + edge.dx,
      neighborY: y + edge.dy,
    }));
}

function drawPixedFloorTile(ctx, tile, x, y, screen) {
  const points = pixedDiamondPoints(screen);
  const hash = pixedHash(x, y);
  const base = hash % 5 === 0 ? '#302a29' : hash % 3 === 0 ? '#2a2628' : '#262328';
  const edge = '#07070a';
  const bevel = tile === TILE.SHOP ? '#8a5b20' : tile === TILE.STAIRS ? '#3c5b40' : '#5b4d48';
  const canRestore = typeof ctx.save === 'function' && typeof ctx.restore === 'function';

  if (canRestore) ctx.save();
  drawPixedPolygon(ctx, [
    { x: points.top.x, y: points.top.y + 4 },
    { x: points.right.x, y: points.right.y + 4 },
    { x: points.bottom.x, y: points.bottom.y + 4 },
    { x: points.left.x, y: points.left.y + 4 },
  ], 'rgba(0,0,0,0.42)');
  drawPixedPolygon(ctx, [points.top, points.right, points.bottom, points.left], base, edge);

  ctx.globalAlpha = 0.72;
  drawPixedLine(ctx, points.left, points.top, '#66554b', 1);
  drawPixedLine(ctx, points.top, points.right, '#3b3435', 1);
  drawPixedLine(ctx, points.left, points.bottom, '#171316', 1);
  drawPixedLine(ctx, points.right, points.bottom, '#120f13', 1);

  const center = { x: points.top.x, y: points.top.y + ISO_HALF_H };
  if (hash % 2 === 0) drawPixedLine(ctx, center, points.right, '#18171d', 1, 0.65);
  if (hash % 3 === 0) drawPixedLine(ctx, points.left, center, '#18171d', 1, 0.58);
  if (hash % 7 === 0) {
    drawPixedLine(ctx, { x: center.x - 10, y: center.y + 2 }, { x: center.x + 8, y: center.y - 1 }, '#0d0c10', 1, 0.68);
  }

  if (tile === TILE.SHOP || tile === TILE.STAIRS || tile === TILE.LOCKED_DOOR) {
    drawPixedLine(ctx, points.left, points.right, bevel, 2, 0.45);
  }
  if (canRestore) ctx.restore();
}

function drawPixedWallFace(ctx, screen, edge, x, y) {
  const points = pixedDiamondPoints(screen);
  const a = points[edge.from];
  const b = points[edge.to];
  const topA = { x: a.x, y: a.y - edge.height };
  const topB = { x: b.x, y: b.y - edge.height };
  const hash = pixedHash(x, y, edge.dir.length);
  const canRestore = typeof ctx.save === 'function' && typeof ctx.restore === 'function';

  if (canRestore) ctx.save();
  drawPixedPolygon(ctx, [topA, topB, b, a], edge.fill, '#07070a');
  drawPixedPolygon(ctx, [
    { x: topA.x, y: topA.y - 4 },
    { x: topB.x, y: topB.y - 4 },
    topB,
    topA,
  ], edge.cap, '#151217');

  drawPixedLine(ctx, topA, topB, '#705a48', 2, 0.55);
  drawPixedLine(ctx, a, b, edge.shade, 2, 0.8);

  const mortarCount = edge.height > 30 ? 3 : 2;
  for (let i = 1; i <= mortarCount; i++) {
    const t = i / (mortarCount + 1);
    const yOffset = Math.round(edge.height * t);
    drawPixedLine(
      ctx,
      { x: topA.x, y: topA.y + yOffset },
      { x: topB.x, y: topB.y + yOffset },
      '#151014',
      1,
      0.72
    );
  }

  const splitT = (hash % 3 + 1) / 4;
  const splitTop = {
    x: topA.x + (topB.x - topA.x) * splitT,
    y: topA.y + (topB.y - topA.y) * splitT + 3,
  };
  const splitBottom = {
    x: a.x + (b.x - a.x) * splitT,
    y: a.y + (b.y - a.y) * splitT - 3,
  };
  drawPixedLine(ctx, splitTop, splitBottom, '#161014', 1, 0.58);
  if (hash % 5 === 0) {
    drawPixedLine(
      ctx,
      { x: splitTop.x - 5, y: splitTop.y + 9 },
      { x: splitTop.x + 7, y: splitTop.y + 8 },
      '#5a453b',
      1,
      0.45
    );
  }
  if (edge.height > 30 && hash % 13 === 0) {
    const mid = {
      x: topA.x + (topB.x - topA.x) * 0.5,
      y: topA.y + (topB.y - topA.y) * 0.5 + edge.height * 0.55,
    };
    if (typeof ctx.createRadialGradient === 'function') {
      const glow = ctx.createRadialGradient(mid.x, mid.y, 1, mid.x, mid.y, 20);
      glow.addColorStop(0, 'rgba(245,158,11,0.26)');
      glow.addColorStop(1, 'rgba(245,158,11,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = glow;
      ctx.fillRect(Math.round(mid.x - 22), Math.round(mid.y - 22), 44, 44);
      ctx.globalCompositeOperation = 'source-over';
    }
    drawPixedPolygon(ctx, [
      { x: mid.x - 2, y: mid.y - 6 },
      { x: mid.x + 2, y: mid.y - 6 },
      { x: mid.x + 2, y: mid.y + 7 },
      { x: mid.x - 2, y: mid.y + 7 },
    ], '#382014');
    drawPixedPolygon(ctx, [
      { x: mid.x, y: mid.y - 12 },
      { x: mid.x + 4, y: mid.y - 5 },
      { x: mid.x, y: mid.y },
      { x: mid.x - 4, y: mid.y - 5 },
    ], '#f59e0b');
    drawPixedPolygon(ctx, [
      { x: mid.x, y: mid.y - 10 },
      { x: mid.x + 2, y: mid.y - 6 },
      { x: mid.x, y: mid.y - 3 },
      { x: mid.x - 2, y: mid.y - 6 },
    ], '#fde68a');
  }
  if (canRestore) ctx.restore();
}

function drawPixedWallEdgesForTile(ctx, map, x, y, screen, seen, visible) {
  const tileKey = y * MAP_W + x;
  const edges = getPixedWallEdges(map, x, y);
  for (const edge of edges) {
    const neighborKey = edge.neighborY * MAP_W + edge.neighborX;
    if (seen && !seen.has(neighborKey) && (!visible || !visible.has(tileKey))) continue;
    drawPixedWallFace(ctx, screen, edge, x, y);
  }
}

function drawPixedSceneLighting(ctx) {
  if (!PixedRenderer.camera || !G || !G.player || typeof getIsoTileCenter !== 'function') return;
  const width = PixedRenderer.camera.viewportWidth;
  const height = PixedRenderer.camera.viewportHeight;
  const playerScreen = worldToScreen(getIsoTileCenter(G.player.x, G.player.y), PixedRenderer.camera);
  const canRestore = typeof ctx.save === 'function' && typeof ctx.restore === 'function';
  if (canRestore) ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, width, height);
  if (typeof ctx.createRadialGradient === 'function') {
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(playerScreen.x, playerScreen.y + 10, 8, playerScreen.x, playerScreen.y + 10, 260);
    glow.addColorStop(0, 'rgba(214,138,55,0.23)');
    glow.addColorStop(0.35, 'rgba(126,71,35,0.10)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }
  if (canRestore) ctx.restore();
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
  return drawPixedImageScaled(ctx, key, x, y, frame, 1);
}

function drawPixedImageScaled(ctx, key, x, y, frame = 0, scale = 1) {
  const asset = typeof getPixedAsset === 'function' ? getPixedAsset(key) : null;
  if (!asset) return false;
  const frameCount = Number.isFinite(asset.frames) ? Math.floor(asset.frames) : 0;
  if (frameCount < 1) return false;
  const rawFrame = Number.isFinite(frame) ? Math.floor(frame) : 0;
  const clampedFrame = Math.max(0, Math.min(frameCount - 1, rawFrame));
  const sx = clampedFrame * asset.frameWidth;
  const sy = 0;
  const drawScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const drawWidth = Math.round(asset.frameWidth * drawScale);
  const drawHeight = Math.round(asset.frameHeight * drawScale);
  ctx.drawImage(
    asset.image,
    sx,
    sy,
    asset.frameWidth,
    asset.frameHeight,
    Math.round(x - asset.anchorX * drawScale),
    Math.round(y - asset.anchorY * drawScale),
    drawWidth,
    drawHeight
  );
  return true;
}

function getPixedPropScale(tile) {
  if (tile === TILE.SHOP) return 1.45;
  if (tile === TILE.STAIRS) return 1.25;
  if (tile === TILE.LOCKED_DOOR) return 1.35;
  return 1;
}

function getPixedDrawableScale(drawable) {
  if (!drawable) return 1;
  if (drawable.kind === 'actor') {
    if (drawable.enemy && drawable.enemy.boss) return 1.75;
    if (drawable.enemy && drawable.enemy.name === 'Dungeon Lord') return 1.9;
    if (drawable.enemy && (drawable.enemy.name || '').toLowerCase().includes('troll')) return 1.65;
    return drawable.enemy ? 1.45 : 1.55;
  }
  if (drawable.kind === 'item') {
    if (drawable.item && drawable.item.type === 'shrine') return 1.35;
    if (drawable.trap) return 1.15;
    return 1.3;
  }
  if (drawable.kind === 'fx') return 1.35;
  return 1;
}

function getPixedGlowColor(drawable) {
  if (!drawable) return null;
  if (drawable.trap) {
    if (drawable.trap.type === 'gas') return '#4ade80';
    if (drawable.trap.type === 'alarm') return '#f87171';
    return '#fb923c';
  }
  const type = drawable.item && drawable.item.type;
  if (type === 'weapon') return '#fb923c';
  if (type === 'armor') return '#60a5fa';
  if (type === 'potion' || type === 'potion_buff') return '#ef4444';
  if (type === 'bomb') return '#f97316';
  if (type === 'scroll' || type === 'scroll_teleport') return '#d7b46a';
  if (type === 'key') return '#fbbf24';
  if (type === 'upgrade') return '#c084fc';
  if (type === 'shrine') return '#c084fc';
  return drawable.kind === 'item' ? '#d7b46a' : null;
}

function drawPixedGroundGlow(ctx, screen, color, radius = 24, alpha = 0.28) {
  if (!screen || !color || typeof ctx.createRadialGradient !== 'function') return;
  const canRestore = typeof ctx.save === 'function' && typeof ctx.restore === 'function';
  if (canRestore) ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cx = screen.x;
  const cy = screen.y + 30;
  const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, radius);
  glow.addColorStop(0, `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(Math.round(cx - radius), Math.round(cy - radius), Math.round(radius * 2), Math.round(radius * 2));
  if (canRestore) ctx.restore();
}

function normalizePixedFxText(text) {
  return String(text == null ? '' : text)
    .replace(/\uD83D\uDCB0/g, 'G')
    .replace(/\s+/g, ' ')
    .trim();
}

function drawPixedFloatingText(ctx, fx, screen, age) {
  if (!fx || !fx.text || !screen) return;
  const canRestore = typeof ctx.save === 'function' && typeof ctx.restore === 'function';
  const progress = Math.max(0, Math.min(1, age / Math.max(1, fx.durationMs || 650)));
  const y = screen.y - 56 - progress * 32;
  const text = normalizePixedFxText(fx.text);
  if (!text) return;
  if (canRestore) ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - progress);
  ctx.font = 'bold 13px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.95)';
  ctx.strokeText(text, Math.round(screen.x), Math.round(y));
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,244,214,0.35)';
  ctx.strokeText(text, Math.round(screen.x), Math.round(y));
  ctx.fillStyle = fx.color || '#ffffff';
  ctx.fillText(text, Math.round(screen.x), Math.round(y));
  if (canRestore) ctx.restore();
}

function tileAssetKey(tile) {
  if (tile === TILE.STAIRS) return 'environment.stairs';
  if (tile === TILE.SHOP) return 'environment.shop';
  if (tile === TILE.LOCKED_DOOR) return 'environment.doorLocked';
  if (tile === TILE.WALL || tile === TILE.SECRET_DOOR) return 'environment.wall';
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

  const surfaceTiles = [];
  const propTiles = [];
  for (let y = 0; y < G.map.length; y++) {
    for (let x = 0; x < G.map[y].length; x++) {
      const seen = G.seen && G.seen.has(y * MAP_W + x);
      if (!seen) continue;
      const tile = G.map[y][x];
      if (!isPixedSurfaceTile(tile)) continue;
      const world = gridToIso(x, y);
      const screen = worldToScreen(world, PixedRenderer.camera);
      drawPixedFloorTile(ctx, tile, x, y, screen);
      surfaceTiles.push({ x, y, screen });
      if (tile === TILE.STAIRS || tile === TILE.SHOP || tile === TILE.LOCKED_DOOR) propTiles.push({ x, y, tile, screen });
    }
  }

  surfaceTiles
    .sort((a, b) => isoDepthKey({ kind: 'wall', x: a.x, y: a.y }) - isoDepthKey({ kind: 'wall', x: b.x, y: b.y }))
    .forEach(tile => drawPixedWallEdgesForTile(ctx, G.map, tile.x, tile.y, tile.screen, G.seen, G.visible));

  propTiles.forEach(({ tile, screen }) => {
    const key = tileAssetKey(tile);
    const scale = getPixedPropScale(tile);
    if (tile === TILE.SHOP) drawPixedGroundGlow(ctx, screen, '#fbbf24', 34, 0.28);
    if (tile === TILE.STAIRS) drawPixedGroundGlow(ctx, screen, '#4ade80', 26, 0.2);
    if (!drawPixedImageScaled(ctx, key, screen.x, screen.y + 32, 0, scale)) {
      const fill = tile === TILE.STAIRS ? '#1f3b2a' : tile === TILE.SHOP ? '#3b2b12' : '#3f2717';
      drawDebugDiamond(ctx, screen, fill, '#050507');
    }
  });

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
    drawPixedGroundGlow(ctx, screen, getPixedGlowColor(d), 25, 0.22);
    if (!drawPixedImageScaled(ctx, d.key, screen.x, screen.y + 32, 0, getPixedDrawableScale(d))) {
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
    if (d.kind === 'item') drawPixedGroundGlow(ctx, screen, getPixedGlowColor(d), 26, 0.24);
    const scale = getPixedDrawableScale(d);
    if (!drawPixedImageScaled(ctx, d.key, screen.x, screen.y + 32, 0, scale)) {
      drawPixedFallback(ctx, d, screen);
    }
  });

  drawPixedSceneLighting(ctx);

  const fxList = typeof PIXED_ANIM !== 'undefined' && PIXED_ANIM && Array.isArray(PIXED_ANIM.fx) ? PIXED_ANIM.fx : [];
  const now = typeof nowMs === 'function' ? nowMs() : Date.now();
  fxList.forEach(fx => {
    const screen = worldToScreen(gridToIso(fx.x, fx.y), PixedRenderer.camera);
    if (!drawPixedImageScaled(ctx, fx.key, screen.x, screen.y + 16, 0, getPixedDrawableScale({ kind: 'fx' }))) {
      drawPixedFallback(ctx, { kind: 'fx', key: fx.key, color: fx.color, fx }, screen);
    }
    drawPixedFloatingText(ctx, fx, screen, now - fx.startedAt);
  });
}

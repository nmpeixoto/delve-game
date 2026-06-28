// ===================== ISOMETRIC HELPERS =====================
const ISO_TILE_W = 64;
const ISO_TILE_H = 32;
const ISO_HALF_W = ISO_TILE_W / 2;
const ISO_HALF_H = ISO_TILE_H / 2;

// Create plain objects in the active realm so vm-based tests compare cleanly.
function makeIsoPoint(x, y) {
  const point = new Math.constructor();
  point.x = x;
  point.y = y;
  return point;
}

function gridToIso(x, y) {
  return makeIsoPoint((x - y) * ISO_HALF_W, (x + y) * ISO_HALF_H);
}

function getIsoTileCenter(x, y) {
  const p = gridToIso(x, y);
  return makeIsoPoint(p.x, p.y + ISO_HALF_H);
}

function isoToGrid(worldX, worldY) {
  const adjustedY = worldY - ISO_HALF_H;
  const gx = (worldX / ISO_HALF_W + adjustedY / ISO_HALF_H) / 2;
  const gy = (adjustedY / ISO_HALF_H - worldX / ISO_HALF_W) / 2;
  return makeIsoPoint(Math.round(gx), Math.round(gy));
}

function createIsoCamera(opts = {}) {
  const camera = new Math.constructor();
  camera.x = Number(opts.x) || 0;
  camera.y = Number(opts.y) || 0;
  camera.zoom = Number(opts.zoom) || 1;
  camera.viewportWidth = Number(opts.viewportWidth) || 1;
  camera.viewportHeight = Number(opts.viewportHeight) || 1;
  return camera;
}

function centerCameraOnGrid(camera, gridX, gridY) {
  const center = getIsoTileCenter(gridX, gridY);
  camera.x = center.x - camera.viewportWidth / (2 * camera.zoom);
  camera.y = center.y - camera.viewportHeight / (2 * camera.zoom);
  return camera;
}

function worldToScreen(point, camera) {
  return makeIsoPoint((point.x - camera.x) * camera.zoom, (point.y - camera.y) * camera.zoom);
}

function screenToWorld(screenX, screenY, camera) {
  return makeIsoPoint(screenX / camera.zoom + camera.x, screenY / camera.zoom + camera.y);
}

function screenToGrid(screenX, screenY, camera) {
  const world = screenToWorld(screenX, screenY, camera);
  return isoToGrid(world.x, world.y);
}

function isoDepthKey(drawable) {
  const base = (drawable.x + drawable.y) * 100;
  const layer = drawable.kind === 'floor' ? 0
    : drawable.kind === 'item' ? 20
    : drawable.kind === 'actor' ? 40
    : drawable.kind === 'fx' ? 60
    : drawable.kind === 'wall' ? 80
    : 50;
  return base + layer + (drawable.tall ? 10 : 0);
}

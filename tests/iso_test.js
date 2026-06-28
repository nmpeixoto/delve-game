const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadIso() {
  const context = { Math };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/iso.js'), 'utf8'), context);
  return context;
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

test('gridToIso projects a tile to a 2:1 isometric diamond origin', () => {
  const context = loadIso();
  assert.deepStrictEqual(context.gridToIso(0, 0), { x: 0, y: 0 });
  assert.deepStrictEqual(context.gridToIso(1, 0), { x: 32, y: 16 });
  assert.deepStrictEqual(context.gridToIso(0, 1), { x: -32, y: 16 });
  assert.deepStrictEqual(context.gridToIso(4, 3), { x: 32, y: 112 });
});

test('isoToGrid rounds diamond centers back to the source tile', () => {
  const context = loadIso();
  for (const tile of [{ x: 0, y: 0 }, { x: 5, y: 2 }, { x: 17, y: 9 }, { x: 55, y: 35 }]) {
    const center = context.getIsoTileCenter(tile.x, tile.y);
    assert.deepStrictEqual(context.isoToGrid(center.x, center.y), tile);
  }
});

test('camera transform keeps the player centered in the viewport', () => {
  const context = loadIso();
  const camera = context.createIsoCamera({ viewportWidth: 800, viewportHeight: 600 });
  context.centerCameraOnGrid(camera, 10, 8);
  const screen = context.worldToScreen(context.getIsoTileCenter(10, 8), camera);
  assert.strictEqual(Math.round(screen.x), 400);
  assert.strictEqual(Math.round(screen.y), 300);
});

test('depth key sorts floor first, items next, actors above, tall walls last', () => {
  const context = loadIso();
  const drawables = [
    { kind: 'actor', x: 3, y: 2 },
    { kind: 'floor', x: 3, y: 2 },
    { kind: 'wall', x: 3, y: 2, tall: true },
    { kind: 'item', x: 3, y: 2 },
  ].sort((a, b) => context.isoDepthKey(a) - context.isoDepthKey(b));

  assert.deepStrictEqual(drawables.map(d => d.kind), ['floor', 'item', 'actor', 'wall']);
});

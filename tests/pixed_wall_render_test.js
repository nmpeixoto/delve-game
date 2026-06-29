const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2, SHOP: 3, LOCKED_DOOR: 4, SECRET_DOOR: 5 };

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadRenderer() {
  const context = {
    TILE,
    MAP_W: 8,
    MAP_H: 8,
    Math,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/iso.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/canvas-renderer.js'), 'utf8'), context);
  return context;
}

function makeMap(fill = TILE.WALL) {
  return Array.from({ length: 5 }, () => Array(5).fill(fill));
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

test('pixed wall faces are derived from walkable tile boundaries', () => {
  const context = loadRenderer();
  const map = makeMap(TILE.WALL);
  map[2][2] = TILE.FLOOR;
  map[2][3] = TILE.FLOOR;
  map[1][2] = TILE.FLOOR;

  const dirs = context.getPixedWallEdges(map, 2, 2).map(edge => edge.dir).sort();

  assert.deepStrictEqual(normalize(dirs), ['south', 'west']);
});

test('pixed renderer treats locked doors as surfaces and secret doors as solid walls', () => {
  const context = loadRenderer();

  assert.strictEqual(context.isPixedSurfaceTile(TILE.FLOOR), true);
  assert.strictEqual(context.isPixedSurfaceTile(TILE.STAIRS), true);
  assert.strictEqual(context.isPixedSurfaceTile(TILE.SHOP), true);
  assert.strictEqual(context.isPixedSurfaceTile(TILE.LOCKED_DOOR), true);
  assert.strictEqual(context.isPixedSurfaceTile(TILE.WALL), false);
  assert.strictEqual(context.isPixedSurfaceTile(TILE.SECRET_DOOR), false);
});

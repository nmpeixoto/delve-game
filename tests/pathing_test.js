const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MAP_W = 8;
const MAP_H = 8;
const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2, SHOP: 3, LOCKED_DOOR: 4, SECRET_DOOR: 5 };

function makeMap(tile = TILE.FLOOR) {
  return Array.from({ length: MAP_H }, () => Array(MAP_W).fill(tile));
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadPathing(overrides = {}) {
  const context = { MAP_W, MAP_H, TILE, Math, ...overrides };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/pathing.js'), 'utf8'), context);
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

test('findGridPath routes around walls and returns each step after the start', () => {
  const context = loadPathing();
  const map = makeMap();
  map[1][2] = TILE.WALL;
  map[2][2] = TILE.WALL;
  map[3][2] = TILE.WALL;

  const pathResult = normalize(context.findGridPath({ map, start: { x: 1, y: 1 }, goal: { x: 3, y: 3 } }));

  assert.ok(pathResult.length > 0);
  assert.deepStrictEqual(pathResult[0], { x: 1, y: 2 });
  assert.deepStrictEqual(pathResult[pathResult.length - 1], { x: 3, y: 3 });
  assert.strictEqual(pathResult.some(step => step.x === 2 && step.y === 2), false);
});

test('findGridPath refuses locked doors when no key is available', () => {
  const context = loadPathing();
  const map = makeMap(TILE.WALL);
  map[1][1] = TILE.FLOOR;
  map[1][2] = TILE.LOCKED_DOOR;
  map[1][3] = TILE.FLOOR;

  assert.deepStrictEqual(normalize(context.findGridPath({ map, start: { x: 1, y: 1 }, goal: { x: 3, y: 1 }, hasKey: false })), []);
  assert.deepStrictEqual(normalize(context.findGridPath({ map, start: { x: 1, y: 1 }, goal: { x: 3, y: 1 }, hasKey: true })), [
    { x: 2, y: 1 },
    { x: 3, y: 1 },
  ]);
});

test('pathToAdjacentTarget routes to a tile beside the target', () => {
  const context = loadPathing();
  const map = makeMap();
  const result = normalize(context.pathToAdjacentTarget({
    map,
    player: { x: 1, y: 1, class: 'warrior', weapon: null },
    target: { x: 4, y: 1 },
    hasKey: false,
  }));

  assert.deepStrictEqual(result[result.length - 1], { x: 3, y: 1 });
});

test('pathToAdjacentTarget returns [] when the player is already adjacent to the target', () => {
  const context = loadPathing();
  const map = makeMap();
  const result = normalize(context.pathToAdjacentTarget({
    map,
    player: { x: 3, y: 1, class: 'warrior', weapon: null },
    target: { x: 4, y: 1 },
    hasKey: false,
  }));

  assert.deepStrictEqual(result, []);
});

test('pathToEnemyTarget stops adjacent to melee enemies', () => {
  const context = loadPathing();
  const map = makeMap();
  const result = normalize(context.pathToEnemyTarget({
    map,
    player: { x: 1, y: 1, class: 'warrior', weapon: null },
    enemy: { x: 4, y: 1 },
    hasKey: false,
  }));

  assert.deepStrictEqual(result[result.length - 1], { x: 3, y: 1 });
});

test('pathToEnemyTarget returns [] when the player is already in bow range', () => {
  const context = loadPathing();
  const map = makeMap();
  const result = normalize(context.pathToEnemyTarget({
    map,
    player: { x: 2, y: 1, class: 'ranger', weapon: { sym: '\uD83C\uDFF9' } },
    enemy: { x: 5, y: 1 },
    hasKey: false,
  }));

  assert.deepStrictEqual(result, []);
});

test('pathToEnemyTarget allows ranger bow range three', () => {
  const context = loadPathing();
  const map = makeMap();
  const result = normalize(context.pathToEnemyTarget({
    map,
    player: { x: 1, y: 1, class: 'ranger', weapon: { sym: '\uD83C\uDFF9' } },
    enemy: { x: 5, y: 1 },
    hasKey: false,
  }));

  assert.deepStrictEqual(result[result.length - 1], { x: 2, y: 1 });
});

test('getBlockedEntityTiles excludes the selected enemy target', () => {
  const context = loadPathing();
  const blocked = normalize(context.getBlockedEntityTiles([
    { id: 'a', x: 2, y: 2 },
    { id: 'b', x: 3, y: 2 },
  ], 'b'));

  assert.deepStrictEqual(blocked, [{ x: 2, y: 2 }]);
});

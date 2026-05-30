const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MAP_W = 56;
const MAP_H = 36;
const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2, SHOP: 3 };

function loadMapContext() {
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0.5;

  const context = {
    G: {
      floor: 1,
      player: { x: 0, y: 0, hp: 20, maxHp: 20, class: 'warrior' },
      enemies: [],
      items: [],
      traps: [],
      map: null,
      rooms: [],
      shops: [],
      visible: new Set([999999]),
      seen: new Set([999999]),
      log: [],
    },
    TIPS: {
      firstEnemy: { shown: false },
      firstShop: { shown: false },
      firstStairs: { shown: false },
    },
    MAP_W,
    MAP_H,
    TILE,
    FLOORS: 6,
    rr: (a, b) => a + Math.floor(deterministicMath.random() * (b - a + 1)),
    rand: n => Math.floor(deterministicMath.random() * n),
    ch: () => false,
    uid: () => 'uid-' + Math.random().toString(36).slice(2),
    render: () => {},
    addLog: () => {},
    fireTip: () => {},
    resetTips: () => {},
    generateShopStock: () => [],
    spawnItem: () => {},
    computeVision: null,
    setTimeout: fn => fn(),
    Math: deterministicMath,
    Set,
  };

  vm.createContext(context);
  const visionCode = fs.readFileSync(path.join(__dirname, 'src/js/vision.js'), 'utf8');
  vm.runInContext(visionCode, context);
  const mapCode = fs.readFileSync(path.join(__dirname, 'src/js/map.js'), 'utf8');
  vm.runInContext(mapCode, context);
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

test('new floors do not inherit seen tiles from the previous floor', () => {
  const context = loadMapContext();

  context.buildFloor();

  assert.strictEqual(context.G.seen.has(999999), false);
  assert.ok(context.G.seen.size > 0);
});

test('rogue starts with light armor for melee survivability', () => {
  const context = loadMapContext();

  context.initGame('rogue');

  assert.strictEqual(context.G.player.maxHp, 22);
  assert.strictEqual(context.G.player.weapon.atk, 4);
  assert.ok(context.G.player.armor);
  assert.strictEqual(context.G.player.armor.name, 'Leather Vest');
  assert.strictEqual(context.G.player.armor.def, 2);
});

test('ranger starts with a tunic and stronger bow ladder', () => {
  const context = loadMapContext();

  context.initGame('ranger');

  assert.strictEqual(context.G.player.maxHp, 17);
  assert.strictEqual(context.G.player.atk, 4);
  assert.strictEqual(context.G.player.def, 1);
  assert.strictEqual(context.G.player.weapon.name, 'Shortbow');
  assert.strictEqual(context.G.player.weapon.atk, 4);
  assert.strictEqual(context.G.player.weapon.sym, '🏹');
  assert.strictEqual(context.G.player.armor.name, 'Ranger Tunic');
  assert.strictEqual(context.G.player.armor.def, 3);
});

test('mage starts with a robe so floor 4 pressure does not erase it instantly', () => {
  const context = loadMapContext();

  context.initGame('mage');

  assert.ok(context.G.player.armor);
  assert.strictEqual(context.G.player.armor.name, 'Apprentice Robe');
  assert.strictEqual(context.G.player.armor.def, 2);
});

test('necromancer starts with a robe for early floor sustain', () => {
  const context = loadMapContext();

  context.initGame('necromancer');

  assert.strictEqual(context.G.player.maxHp, 16);
  assert.ok(context.G.player.armor);
  assert.strictEqual(context.G.player.armor.name, 'Apprentice Robe');
  assert.strictEqual(context.G.player.armor.def, 2);
});

test('monk starts with a gi to survive the late floor melee checks', () => {
  const context = loadMapContext();

  context.initGame('monk');

  assert.strictEqual(context.G.player.maxHp, 22);
  assert.ok(context.G.player.armor);
  assert.strictEqual(context.G.player.armor.name, 'Gi');
  assert.strictEqual(context.G.player.armor.def, 3);
});

test('barbarian starts with furs for full-clear durability', () => {
  const context = loadMapContext();

  context.initGame('barbarian');

  assert.ok(context.G.player.armor);
  assert.strictEqual(context.G.player.armor.name, 'Furs');
  assert.strictEqual(context.G.player.armor.def, 4);
});

test('floor 5 enemy profile reaches lich tier and a harder stat scale', () => {
  const context = loadMapContext();

  assert.strictEqual(typeof context.getFloorEnemyProfile, 'function');

  const floor4 = context.getFloorEnemyProfile(4);
  const floor5 = context.getFloorEnemyProfile(5);

  assert.strictEqual(floor5.tierMin, 4);
  assert.strictEqual(floor5.tierMax, 6);
  assert.strictEqual(floor4.tierMax, 4);
  assert.strictEqual(floor4.scale, 2.0);
  assert.strictEqual(floor5.scale, 2.4);
});

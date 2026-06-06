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
    getStat: (statName) => {
      let base = context.G.player[statName] || 0;
      let w = context.G.player.weapon ? (context.G.player.weapon[statName] || 0) : 0;
      let a = context.G.player.armor ? (context.G.player.armor[statName] || 0) : 0;
      return base + w + a;
    },
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
    floatText: () => {},
    SFX: { click: () => {}, pickup: () => {} },
    setTimeout: fn => fn(),
    Math: deterministicMath,
    Set,
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/main.js'), 'utf8'), context);
  const visionCode = fs.readFileSync(path.join(__dirname, '..', 'src/js/vision.js'), 'utf8');
  vm.runInContext(visionCode, context);
  const mapCode = fs.readFileSync(path.join(__dirname, '..', 'src/js/map.js'), 'utf8');
  vm.runInContext(mapCode, context);
  return context;
}

function loadSpawnContext() {
  const context = {
    G: {
      player: { class: 'warrior', lvl: 1 },
      items: [],
    },
    rr: (a) => a,
    rand: () => 0,
    ch: () => false,
    uid: () => 'spawned-item',
    Math,
    Set,
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/data.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/items.js'), 'utf8'), context);
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

  assert.strictEqual(context.G.player.maxHp, 24);
  assert.strictEqual(context.G.player.weapon.atk, 4);
  assert.ok(context.G.player.armor);
  assert.strictEqual(context.G.player.armor.name, 'Leather Vest');
  assert.strictEqual(context.G.player.armor.def, 2);
});

test('ranger starts with a tunic and stronger bow ladder', () => {
  const context = loadMapContext();

  context.initGame('ranger');

  assert.strictEqual(context.G.player.maxHp, 20);
  assert.strictEqual(context.G.player.atk, 2);
  assert.strictEqual(context.G.player.def, 1);
  assert.strictEqual(context.G.player.critChance, 0.1);
  assert.strictEqual(context.G.player.weapon.name, 'Shortbow');
  assert.strictEqual(context.G.player.weapon.atk, 5);
  assert.strictEqual(context.G.player.weapon.sym, '🏹');
  assert.strictEqual(context.G.player.armor.name, 'Ranger Tunic');
  assert.strictEqual(context.G.player.armor.def, 3);
});

test('warrior starts with enough base damage for normal mode pacing', () => {
  const context = loadMapContext();

  context.initGame('warrior');

  assert.strictEqual(context.G.player.maxHp, 32);
  assert.strictEqual(context.G.player.atk, 4);
  assert.strictEqual(context.G.player.def, 3);
  assert.ok(context.G.player.armor);
  assert.strictEqual(context.G.player.armor.name, 'Chain Mail');
  assert.strictEqual(context.G.player.armor.def, 4);
});

test('paladin starts with an iron mace and plate for sustain', () => {
  const context = loadMapContext();

  context.initGame('paladin');

  assert.strictEqual(context.G.player.maxHp, 26);
  assert.strictEqual(context.G.player.atk, 4);
  assert.strictEqual(context.G.player.def, 1);
  assert.strictEqual(context.G.player.weapon.name, 'Iron Mace');
  assert.strictEqual(context.G.player.weapon.atk, 5);
  assert.ok(context.G.player.armor);
  assert.strictEqual(context.G.player.armor.name, 'Iron Plate');
  assert.strictEqual(context.G.player.armor.def, 5);
});

test('mage starts with a robe so floor 4 pressure does not erase it instantly', () => {
  const context = loadMapContext();

  context.initGame('mage');

  assert.strictEqual(context.G.player.maxHp, 20);
  assert.strictEqual(context.G.player.def, 2);
  assert.ok(context.G.player.armor);
  assert.strictEqual(context.G.player.armor.name, 'Apprentice Robe');
  assert.strictEqual(context.G.player.armor.def, 2);
});

test('necromancer starts with a robe for early floor sustain', () => {
  const context = loadMapContext();

  context.initGame('necromancer');

  assert.strictEqual(context.G.player.maxHp, 18);
  assert.ok(context.G.player.armor);
  assert.strictEqual(context.G.player.armor.name, 'Apprentice Robe');
  assert.strictEqual(context.G.player.armor.def, 2);
});

test('monk starts with a gi to survive the late floor melee checks', () => {
  const context = loadMapContext();

  context.initGame('monk');

  assert.strictEqual(context.G.player.maxHp, 28);
  assert.strictEqual(context.G.player.atk, 4);
  assert.strictEqual(context.G.player.def, 2);
  assert.ok(context.G.player.armor);
  assert.strictEqual(context.G.player.armor.name, 'Gi');
  assert.strictEqual(context.G.player.armor.def, 4);
});

test('barbarian starts with furs for full-clear durability', () => {
  const context = loadMapContext();

  context.initGame('barbarian');

  assert.strictEqual(context.G.player.maxHp, 42);
  assert.strictEqual(context.G.player.atk, 5);
  assert.strictEqual(context.G.player.def, 2);
  assert.strictEqual(context.G.player.critChance, 0.15);
  assert.strictEqual(context.G.player.weapon.name, 'Great Axe');
  assert.strictEqual(context.G.player.weapon.atk, 4);
  assert.ok(context.G.player.armor);
  assert.strictEqual(context.G.player.armor.name, 'Furs');
  assert.strictEqual(context.G.player.armor.def, 4);
});

test('normal enemy profiles use the first-pass lower pressure scale', () => {
  const context = loadMapContext();

  assert.strictEqual(typeof context.getFloorEnemyProfile, 'function');

  const floor1 = context.getFloorEnemyProfile(1);
  const floor2 = context.getFloorEnemyProfile(2);
  const floor3 = context.getFloorEnemyProfile(3);
  const floor4 = context.getFloorEnemyProfile(4);
  const floor5 = context.getFloorEnemyProfile(5);

  assert.strictEqual(floor1.scale, 0.9);
  assert.strictEqual(floor2.scale, 1.2);
  assert.strictEqual(floor3.scale, 1.45);
  assert.strictEqual(floor5.tierMin, 4);
  assert.strictEqual(floor5.tierMax, 6);
  assert.strictEqual(floor4.tierMax, 4);
  assert.strictEqual(floor4.scale, 1.7);
  assert.strictEqual(floor5.scale, 2.05);
});

test('normal mode applies a stronger XP boost only on floors 3 and 4', () => {
  const context = loadMapContext();

  assert.strictEqual(context.getNormalXpScale(1, false), 1);
  assert.strictEqual(context.getNormalXpScale(2, false), 1);
  assert.strictEqual(context.getNormalXpScale(3, false), 1.35);
  assert.strictEqual(context.getNormalXpScale(4, false), 1.6);
  assert.strictEqual(context.getNormalXpScale(5, false), 1);
});

test('normal mode eases only floor 4 enemy pressure without reducing XP density', () => {
  const context = loadMapContext();

  assert.strictEqual(context.getNormalEnemyPressureScale(1, false), 1);
  assert.strictEqual(context.getNormalEnemyPressureScale(3, false), 1);
  assert.strictEqual(context.getNormalEnemyPressureScale(4, false), 0.9);
  assert.strictEqual(context.getNormalEnemyPressureScale(5, false), 1);
  assert.strictEqual(context.getNormalEnemyPressureScale(4, true), 1);
});

test('normal mode places floor 4 stairs earlier on the main path', () => {
  const context = loadMapContext();

  assert.strictEqual(context.getStairsCandidateOffset(3, false, 8), 5);
  assert.strictEqual(context.getStairsCandidateOffset(4, false, 8), 3);
  assert.strictEqual(context.getStairsCandidateOffset(4, true, 8), 5);
  assert.strictEqual(context.getStairsCandidateOffset(4, false, 2), 1);
});

test('hard mode does not receive the normal-mode XP pacing boost', () => {
  const context = loadMapContext();

  assert.strictEqual(context.getNormalXpScale(3, true), 1);
  assert.strictEqual(context.getNormalXpScale(4, true), 1);
});

test('initGame persists hard mode state for balance gates', () => {
  const context = loadMapContext();

  context.initGame('warrior', true);
  assert.strictEqual(context.G.hardMode, true);

  context.initGame('warrior', false);
  assert.strictEqual(context.G.hardMode, false);
});

test('normal melee underdogs start with one carried health potion', () => {
  const context = loadMapContext();

  for (const className of ['warrior', 'paladin', 'monk']) {
    context.initGame(className, false);
    const potions = context.G.items.filter(item => item.carried && item.type === 'potion');

    assert.strictEqual(potions.length, 1);
    assert.strictEqual(potions[0].name, 'Health Potion');
    assert.strictEqual(potions[0].id, `starter-potion-${className}`);
  }
});

test('hard mode does not grant the normal starter potion', () => {
  const context = loadMapContext();

  context.initGame('monk', true);

  assert.strictEqual(context.G.items.some(item => item.carried && item.type === 'potion'), false);
});

test('dungeon lord uses normal-mode boss tuning knobs', () => {
  const context = loadMapContext();
  const boss = vm.runInContext('ENEMIES.find(enemy => enemy.boss)', context);

  assert.ok(boss);
  assert.strictEqual(boss.hp, 260);
  assert.strictEqual(boss.atk, 24);
  assert.strictEqual(boss.def, 6);
  assert.strictEqual(boss.phaseAtkMult, 1.3);
  assert.strictEqual(boss.phaseDefMult, 1.25);
  assert.strictEqual(boss.phaseSummons, 1);
});

test('shop placement does not overwrite the stairs tile', () => {
  const { createRuntime } = require('../automation/headless-balance/headless_balance');
  const runtime = createRuntime(1001);

  runtime.context.initGame('mage');
  runtime.flushTimers();

  const G = runtime.context.G;
  const stairs = [];
  for (let y = 0; y < G.map.length; y++) {
    for (let x = 0; x < G.map[y].length; x++) {
      if (G.map[y][x] === TILE.STAIRS) stairs.push({ x, y });
    }
  }

  assert.strictEqual(stairs.length, 1);
  assert.ok(!G.shops.some(shop => shop.x === stairs[0].x && shop.y === stairs[0].y));
});

test('non-boss floors guarantee every designed special room type', () => {
  const { createRuntime } = require('../automation/headless-balance/headless_balance');
  const requiredTypes = ['armory', 'crypt', 'shrine', 'treasure', 'secret'];

  for (let seed = 1000; seed < 1010; seed++) {
    const runtime = createRuntime(seed);
    const { context, flushTimers } = runtime;
    context.initGame('warrior');
    flushTimers();

    const types = new Set(context.G.rooms.map(room => room.type));
    for (const type of requiredTypes) {
      assert.ok(types.has(type), `seed ${seed} missing ${type}`);
    }
  }
});

test('locked doors always have at least one key somewhere on the floor', () => {
  const { createRuntime } = require('../automation/headless-balance/headless_balance');
  const runtime = createRuntime(2);
  const { context, flushTimers } = runtime;

  context.initGame('warrior');
  flushTimers();

  const keys = context.G.items.filter(item => item.type === 'key');
  assert.ok(keys.length >= 1, 'expected at least one key on the generated floor');
});

test('spawnItem keeps data-layer filtering and supports exact coordinate spawns', () => {
  const context = loadSpawnContext();

  context.spawnItem({ x: 10, y: 11 }, item => item.type === 'potion', false);

  assert.strictEqual(context.G.items.length, 1);
  assert.strictEqual(context.G.items[0].type, 'potion');
  assert.strictEqual(context.G.items[0].x, 10);
  assert.strictEqual(context.G.items[0].y, 11);

  context.spawnItem({ x: 20, y: 20, w: 5, h: 5 }, item => item.type === 'armor', true);

  assert.strictEqual(context.G.items.length, 2);
  assert.strictEqual(context.G.items[1].type, 'armor');
  assert.ok(Number.isFinite(context.G.items[1].x));
  assert.ok(Number.isFinite(context.G.items[1].y));
});

test('spawnItem can require class-usable gear for armory slots', () => {
  const context = loadSpawnContext();
  context.G.player.class = 'monk';
  context.G.player.lvl = 5;

  context.spawnItem(
    { x: 12, y: 13 },
    item => item.type === 'weapon' || item.type === 'armor',
    false,
    { preferClassGear: true }
  );

  assert.strictEqual(context.G.items.length, 1);
  assert.strictEqual(context.G.items[0].type, 'armor');
  assert.ok(!context.G.items[0].reqClass || context.G.items[0].reqClass.includes('monk'));
});

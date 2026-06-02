const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MAP_W = 56;
const MAP_H = 36;
const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2, SHOP: 3, LOCKED_DOOR: 4, SECRET_DOOR: 5 };

function makeMap(tile = TILE.FLOOR) {
  return Array.from({ length: MAP_H }, () => Array(MAP_W).fill(tile));
}

function loadMovement(overrides = {}) {
  const context = {
    G: {
      floor: 3,
      player: {
        x: 5,
        y: 5,
        hp: 20,
        maxHp: 20,
        xp: 0,
        xpNext: 10,
        gold: 0,
        class: 'warrior',
        weapon: null,
        armor: null,
        rootedTurns: 0,
      },
      enemies: [],
      items: [],
      traps: [],
      map: makeMap(),
      gameOver: false,
      won: false,
    },
    MAP_W,
    MAP_H,
    TILE,
    getStat: (statName) => {
      let base = context.G.player[statName] || 0;
      let w = context.G.player.weapon ? (context.G.player.weapon[statName] || 0) : 0;
      let a = context.G.player.armor ? (context.G.player.armor[statName] || 0) : 0;
      return base + w + a;
    },
    rr: a => a,
    ch: () => false,
    uid: () => 'spawned-item',
    round1: value => {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      return Math.round((n + Number.EPSILON) * 10) / 10;
    },
    fmt1: value => {
      let n = context.round1(value);
      if (Object.is(n, -0)) n = 0;
      return Number.isInteger(n) ? `${n}` : n.toFixed(1);
    },
    addLog: () => {},
    floatText: () => {},
    computeVision: () => {},
    render: () => {},
    advanceTurn: () => {},
    attackEnemy: () => {},
    pickupItem: () => {},
    interactShrine: () => {},
    spawnItem: (r) => context.G.items.push({ id: 'spawned-item', type: 'potion', x: r.x, y: r.y }),
    offerEmergencyPotion: (_dmg, afterFn) => afterFn(),
    showDeath: () => {},
    flashDamage: () => {},
    consumeRootedTurn: () => {},
    checkLevelUp: () => {},
    SFX: {
      click: () => {},
      hit: () => {},
    },
    Math,
    Set,
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/movement.js'), 'utf8'), context);
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

test('successful trap disarms always grant floor-scaled XP and gold', () => {
  let chCalls = 0;
  let turns = 0;
  const logs = [];
  const context = loadMovement({
    ch: () => {
      chCalls++;
      return chCalls === 1;
    },
    addLog: msg => logs.push(msg),
    advanceTurn: () => { turns++; },
  });
  context.G.traps = [{ x: 6, y: 5, type: 'spike', revealed: true, triggered: false }];

  context.move(1, 0);

  assert.strictEqual(context.G.traps.length, 0);
  assert.strictEqual(context.G.player.xp, 8);
  assert.strictEqual(context.G.player.gold, 11);
  assert.strictEqual(context.G.items.length, 0);
  assert.strictEqual(turns, 1);
  assert.ok(logs.some(msg => msg.includes('+8 XP') && msg.includes('+11')));
});

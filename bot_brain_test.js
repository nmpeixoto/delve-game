const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MAP_W = 56;
const MAP_H = 36;
const WALL = 0;
const FLOOR = 1;
const STAIRS = 2;
const SHOP = 3;

function classList(open = false) {
  return { contains: cls => cls === 'open' && open };
}

function makeDocument(options = {}) {
  const elements = {
    'emergency-overlay': { style: { display: 'none' }, classList: classList(false) },
    'shop-overlay': { style: { display: 'none' }, classList: classList(false) },
    'inv-drawer': { style: { display: 'none' }, classList: classList(options.bagOpen || false) },
  };

  return {
    getElementById: id => elements[id] || { style: {}, classList: classList(false) },
    querySelector: () => null,
  };
}

function makeMap() {
  return Array.from({ length: MAP_H }, () => Array(MAP_W).fill(WALL));
}

function setFloor(map, coords) {
  coords.forEach(([x, y, tile = FLOOR]) => {
    map[y][x] = tile;
  });
}

function loadBrain(options = {}) {
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0;
  const context = {
    window: {},
    document: makeDocument(options),
    console,
    Math: deterministicMath,
    Set,
  };
  vm.createContext(context);
  const code = fs.readFileSync(path.join(__dirname, 'bot_brain.js'), 'utf8');
  vm.runInContext(code, context);
  return context;
}

function baseGame(map, overrides = {}) {
  const player = {
    x: 5,
    y: 5,
    hp: 20,
    maxHp: 20,
    gold: 0,
    lvl: 1,
    xp: 0,
    xpNext: 10,
    weapon: null,
    armor: null,
    ...overrides.player,
  };

  return {
    floor: 1,
    player,
    map,
    enemies: overrides.enemies || [],
    items: overrides.items || [],
    shops: overrides.shops || [],
    visible: overrides.visible || new Set([player.y * MAP_W + player.x]),
    seen: overrides.seen || new Set([player.y * MAP_W + player.x]),
    ability1Cooldown: overrides.ability1Cooldown || 0,
    ability2Cooldown: overrides.ability2Cooldown || 0,
    ...overrides.G,
  };
}

function decide(G, options = {}) {
  const context = loadBrain(options);
  context.G = G;
  return context.window.botDecisionLogic();
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

test('ignores dying enemies instead of bashing or bump-attacking them', () => {
  const map = makeMap();
  setFloor(map, [[4, 5], [5, 5], [6, 5]]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 4, 5 * MAP_W + 6]);
  const seen = new Set(visible);
  const G = baseGame(map, {
    visible,
    seen,
    enemies: [{ id: 'dead-goblin', name: 'Goblin', x: 4, y: 5, hp: -3, dying: true }],
  });

  const decision = decide(G);

  assert.notStrictEqual(decision.val, 'b');
  assert.notStrictEqual(decision.val, 'ArrowLeft');
});

test('heads to known stairs at 70 percent hp with no potion instead of exploring unseen tiles', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [6, 5],
    [7, 5, STAIRS],
  ]);
  const seen = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { hp: 13, maxHp: 20 },
    seen,
    visible: new Set(seen),
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowRight');
});

test('does not bash a range enemy while weak with no potion and known stairs', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5, STAIRS],
    [5, 7],
  ]);
  const seen = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7, 7 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { hp: 13, maxHp: 20 },
    seen,
    visible: new Set(seen),
    enemies: [{ id: 'goblin-1', name: 'Goblin', x: 5, y: 7, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowRight');
});

test('drinks a potion before voluntary combat when critically hurt in combat', () => {
  const map = makeMap();
  setFloor(map, [[5, 5], [5, 6], [5, 7]]);
  const visible = new Set([5 * MAP_W + 5, 6 * MAP_W + 5, 7 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { hp: 20, maxHp: 84 },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'troll-1', name: 'Troll', x: 5, y: 7, hp: 104, maxHp: 104, atk: 12, def: 4 }],
    items: [{ id: 'elixir-1', type: 'potion', heal: 60, carried: true }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('finishes an adjacent killable enemy instead of oscillating toward stairs', () => {
  const map = makeMap();
  setFloor(map, [[4, 5], [5, 5], [6, 5], [7, 5, STAIRS]]);
  const seen = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { hp: 12, maxHp: 20, atk: 4, weapon: { atk: 4 } },
    seen,
    visible: new Set(seen),
    enemies: [{ id: 'rat-1', name: 'Rat', x: 4, y: 5, hp: 5, maxHp: 5, atk: 2, def: 0 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowLeft');
});

test('resupplies at an affordable shop before exiting weak with no potion', () => {
  const map = makeMap();
  setFloor(map, [[3, 5, SHOP], [4, 5], [5, 5], [6, 5], [7, 5, STAIRS]]);
  const seen = new Set([5 * MAP_W + 3, 5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { hp: 13, maxHp: 20, gold: 15 },
    seen,
    visible: new Set(seen),
    shops: [{ x: 3, y: 5, stock: [{ id: 'potion-1', type: 'potion', price: 15, sold: false }] }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowLeft');
});

test('explores unseen floor 5 tiles before descending when healthy', () => {
  const map = makeMap();
  setFloor(map, [[5, 5, STAIRS], [5, 4]]);
  const seen = new Set([5 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { hp: 20, maxHp: 20 },
    seen,
    visible: new Set(seen),
    enemies: [{ id: 'demon-1', name: 'Demon', x: 5, y: 4, hp: 143, maxHp: 143, atk: 15, def: 5 }],
    G: { floor: 5 },
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowUp');
});

test('attacks a weak visible floor 5 enemy before taking known stairs', () => {
  const map = makeMap();
  setFloor(map, [[5, 5], [6, 5], [7, 5, STAIRS], [5, 7]]);
  const seen = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7, 7 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'mage', hp: 15, maxHp: 15, weapon: { atk: 5, sym: '♦' } },
    seen,
    visible: new Set(seen),
    enemies: [{ id: 'rat-1', name: 'Rat', x: 5, y: 7, hp: 3, maxHp: 3, atk: 2, def: 0 }],
    ability1Cooldown: 5,
    G: { floor: 5 },
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'attack');
  assert.strictEqual(decision.target, 'rat-1');
});

test('ignores known weaker gear while exploring useful unseen tiles', () => {
  const map = makeMap();
  setFloor(map, [[5, 5], [6, 5], [5, 6], [5, 7]]);
  const seen = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'warrior', weapon: { atk: 10 } },
    seen,
    visible: new Set(seen),
    items: [{ id: 'weak-sword', name: 'Short Sword', type: 'weapon', atk: 4, x: 6, y: 5 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowDown');
});

test('paths to nearest unseen tile instead of falling back to random movement', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 5],
    [6, 5],
    [7, 5],
  ]);
  const seen = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    seen,
    visible: new Set(seen),
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowRight');
});

test('derives map dimensions from the active game map', () => {
  const map = [
    [WALL, WALL, WALL],
    [WALL, FLOOR, STAIRS],
    [WALL, WALL, WALL],
  ];
  const G = {
    floor: 5,
    player: {
      x: 1,
      y: 1,
      hp: 20,
      maxHp: 20,
      gold: 0,
      lvl: 1,
      xp: 0,
      xpNext: 10,
      weapon: null,
      armor: null,
    },
    map,
    enemies: [],
    items: [],
    shops: [],
    visible: new Set([1 * 3 + 1, 1 * 3 + 2]),
    seen: new Set([1 * 3 + 1, 1 * 3 + 2]),
    ability1Cooldown: 0,
    ability2Cooldown: 0,
  };

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowRight');
});

test('ignores weaker adjacent floor gear when exploring', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 5],
    [6, 5],
    [5, 4],
  ]);
  const seen = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { weapon: { name: 'Longsword', type: 'weapon', atk: 4 }, armor: null },
    seen,
    visible: new Set(seen),
    items: [{ id: 'rusty-1', name: 'Rusty Dagger', type: 'weapon', atk: 1, x: 6, y: 5, carried: false }],
  });

  const decision = decide(G);

  assert.notStrictEqual(decision.val, 'ArrowRight');
});

test('ignores shop gear the current class can never equip', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5, SHOP],
    [5, 5],
    [6, 5],
  ]);
  const seen = new Set([5 * MAP_W + 4, 5 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'warrior', gold: 100 },
    seen,
    visible: new Set(seen),
    shops: [{
      x: 4,
      y: 5,
      stock: [{ id: 'rogue-blade', type: 'weapon', atk: 99, price: 1, sold: false, reqClass: ['rogue'] }],
    }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowRight');
});

test('attacks a killable adjacent enemy before trying to kite', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [4, 5],
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 4, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'rogue', atk: 6, hp: 6, maxHp: 18, weapon: { atk: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'goblin-1', name: 'Goblin', x: 4, y: 5, hp: 2, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowLeft');
});

test('rogue uses dash proactively when not adjacent to enemies', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 5],
    [6, 5],
  ]);
  const seen = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { class: 'rogue', hp: 18, maxHp: 18, weapon: { atk: 2 } },
    seen,
    visible: new Set(seen),
    enemies: [{ id: 'far-goblin', name: 'Goblin', x: 8, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'b');
});

test('rogue does not dash into a visible pack', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 5],
    [6, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 8, 6 * MAP_W + 8]);
  const G = baseGame(map, {
    player: { class: 'rogue', hp: 18, maxHp: 18, weapon: { atk: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [
      { id: 'g1', name: 'Goblin', x: 8, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 },
      { id: 'g2', name: 'Goblin', x: 8, y: 6, hp: 10, maxHp: 10, atk: 4, def: 1 },
    ],
  });

  const decision = decide(G);

  assert.notStrictEqual(decision.val, 'b');
});

test('rogue does not exit early at 72 percent hp without a potion', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5, STAIRS],
    [6, 5],
    [7, 5],
    [10, 10],
  ]);
  const seen = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'rogue', hp: 13, maxHp: 18, weapon: { atk: 2 } },
    seen,
    visible: new Set(seen),
  });

  const decision = decide(G);

  assert.notStrictEqual(decision.val, '>');
});

test('rogue kites a visible enemy at distance 2 instead of walking into it', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 5],
    [6, 5],
    [7, 5],
    [8, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'rogue', hp: 10, maxHp: 18, weapon: { atk: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 7, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.notStrictEqual(decision.val, 'ArrowRight');
});

test('rogue dashes out of melee when wounded and adjacent to one enemy', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 4],
    [5, 5],
    [5, 6],
    [6, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'rogue', hp: 10, maxHp: 18, weapon: { atk: 2 } },
    seen: new Set([4 * MAP_W + 5, 5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 6 * MAP_W + 5]),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'b');
});

test('rogue attacks adjacent enemies while healthy instead of dash-kiting', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'rogue', atk: 6, hp: 17, maxHp: 20, weapon: { atk: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowDown');
});

test('rogue attacks adjacent enemies at mid hp when a strong hit can kill', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'rogue', atk: 7, hp: 15, maxHp: 28, weapon: { atk: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowDown');
});

test('rogue fights instead of dash-spamming when critical with no known exit', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'rogue', atk: 6, hp: 6, maxHp: 18, weapon: { atk: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowDown');
});

test('rogue uses vanish before dash when wounded at level 5 in melee', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 4],
    [5, 5],
    [5, 6],
    [6, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'rogue', lvl: 5, hp: 10, maxHp: 18, weapon: { atk: 2 } },
    seen: new Set([4 * MAP_W + 5, 5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 6 * MAP_W + 5]),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 14, maxHp: 14, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('rogue uses vanish offensively on late-floor visible threats before dash', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'rogue', lvl: 5, hp: 28, maxHp: 28, weapon: { atk: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'orc-1', name: 'Orc', x: 7, y: 5, hp: 45, maxHp: 45, atk: 8, def: 2 }],
    G: { floor: 5 },
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('rogue attacks from vanish when the sneak attack can kill', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'rogue', lvl: 5, atk: 6, hp: 10, maxHp: 18, weapon: { atk: 2 }, vanishTurns: 2 },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 13, maxHp: 13, atk: 4, def: 1 }],
    ability1Cooldown: 0,
    ability2Cooldown: 8,
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowDown');
});

test('mage attacks a weak visible enemy at range instead of kiting forever', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
    [5, 6],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'mage', hp: 15, maxHp: 15, weapon: { atk: 5, sym: '♦' } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Rat', x: 7, y: 5, hp: 5, maxHp: 5, atk: 2, def: 0 }],
    ability1Cooldown: 5,
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'attack');
  assert.strictEqual(decision.target, 'g1');
});

test('mage fireballs a healthy single visible threat instead of kiting forever', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'mage', hp: 15, maxHp: 15, weapon: { atk: 5, sym: '♦' } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'orc-1', name: 'Orc', x: 7, y: 5, hp: 45, maxHp: 45, atk: 8, def: 2 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'b');
});

test('ranger uses bow range on visible enemies before walking toward them', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'ranger', hp: 15, maxHp: 15, weapon: { atk: 3, sym: '🏹' } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 7, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 }],
    ability1Cooldown: 4,
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'attack');
  assert.strictEqual(decision.target, 'g1');
});

test('warrior uses shield wall before bashing when outnumbered at level 5', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 5],
    [6, 5],
    [5, 6],
  ]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'warrior', lvl: 5, hp: 24, maxHp: 30, weapon: { atk: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [
      { id: 'g1', name: 'Goblin', x: 4, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 },
      { id: 'g2', name: 'Goblin', x: 6, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 },
    ],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('mage blinks instead of fireballing when cornered at low hp', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [4, 5],
    [5, 5],
    [6, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'mage', lvl: 5, hp: 8, maxHp: 15, weapon: { atk: 5, sym: '♦' } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('paladin heals before smiting when below the lay on hands threshold', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'paladin', lvl: 5, hp: 16, maxHp: 25, weapon: { atk: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('ranger uses bear trap before piercing shot when an enemy is adjacent', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
    [5, 7],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5, 7 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'ranger', lvl: 5, hp: 15, maxHp: 15, weapon: { atk: 3 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('barbarian uses bloodlust before cleaving into a crowd', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 4],
    [5, 5],
    [6, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'barbarian', lvl: 5, hp: 35, maxHp: 40, weapon: { atk: 4 } },
    seen: new Set(visible),
    visible,
    enemies: [
      { id: 'g1', name: 'Goblin', x: 4, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 },
      { id: 'g2', name: 'Goblin', x: 6, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 },
    ],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('necromancer primes corpse explosion before siphoning into a cluster', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
    [6, 6],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7, 6 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { class: 'necromancer', lvl: 5, hp: 15, maxHp: 15, weapon: { atk: 4, sym: '♦' } },
    seen: new Set(visible),
    visible,
    enemies: [
      { id: 'g1', name: 'Goblin', x: 6, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 },
      { id: 'g2', name: 'Goblin', x: 7, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 },
    ],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('monk uses flurry before push kick when healthy in melee', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'monk', lvl: 5, hp: 18, maxHp: 20, weapon: null },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('necromancer uses siphon life even at full health when a target is in range', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 5],
    [6, 5],
  ]);
  const seen = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { class: 'necromancer', hp: 15, maxHp: 15, weapon: { atk: 4 } },
    seen,
    visible: new Set(seen),
    enemies: [{ id: 'far-goblin', name: 'Goblin', x: 6, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'b');
});

test('necromancer does not try to siphon life on targets outside the real range', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 5],
    [6, 5],
    [7, 5],
    [8, 5],
  ]);
  const seen = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7, 5 * MAP_W + 8]);
  const G = baseGame(map, {
    player: { class: 'necromancer', hp: 15, maxHp: 15, weapon: { atk: 4 } },
    seen,
    visible: new Set(seen),
    enemies: [{ id: 'far-goblin', name: 'Goblin', x: 8, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.notStrictEqual(decision.val, 'b');
});

test('clicks the visible representative id for grouped potion stacks', () => {
  const map = makeMap();
  setFloor(map, [[5, 5]]);
  const visible = new Set([5 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { hp: 1, maxHp: 100 },
    seen: new Set(visible),
    visible,
    items: [
      { id: 'visible-elixir', name: 'Elixir of Life', type: 'potion', heal: 15, carried: true },
      { id: 'hidden-elixir', name: 'Elixir of Life', type: 'potion', heal: 60, carried: true },
    ],
  });

  const decision = decide(G, { bagOpen: true });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '.inv-slot[onclick*="visible-elixir"]');
});

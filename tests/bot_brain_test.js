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
const SECRET_DOOR = 5;

function classList(open = false) {
  return { contains: cls => cls === 'open' && open };
}

function makeDocument(options = {}) {
  const elements = {
    'emergency-overlay': { style: { display: 'none' }, classList: classList(false) },
    'shop-overlay': { style: { display: 'none' }, classList: classList(options.shopOpen || false) },
    'inv-drawer': { style: { display: 'none' }, classList: classList(options.bagOpen || false) },
    'shrine-overlay': { style: { display: options.shrineOpen ? 'flex' : 'none' }, classList: classList(false) },
    'shrine-modal': { style: { display: options.shrineModalDisplay || '' }, classList: classList(false) },
    'shrine-title': { textContent: options.shrineTitle || '' },
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
  const code = fs.readFileSync(path.join(__dirname, '..', 'automation', 'bot_brain.js'), 'utf8');
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

test('heads to known stairs after the exploration threshold instead of full-clearing leftovers', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [6, 5],
    [7, 5, STAIRS],
  ]);
  const seen = new Set(Array.from({ length: 720 }, (_, i) => i));
  seen.add(5 * MAP_W + 5);
  seen.add(5 * MAP_W + 6);
  seen.add(5 * MAP_W + 7);
  seen.delete(4 * MAP_W + 5);
  const G = baseGame(map, {
    player: { hp: 20, maxHp: 20 },
    seen,
    visible: new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]),
    G: { floor: 2 },
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowRight');
});

test('does not rush known stairs after the exploration threshold while enemies remain', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [6, 5],
    [7, 5, STAIRS],
  ]);
  const seen = new Set(Array.from({ length: 720 }, (_, i) => i));
  seen.add(5 * MAP_W + 5);
  seen.add(5 * MAP_W + 6);
  seen.add(5 * MAP_W + 7);
  seen.add(4 * MAP_W + 5);
  const G = baseGame(map, {
    player: { hp: 20, maxHp: 20, atk: 4, weapon: { atk: 4 } },
    seen,
    visible: new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7, 4 * MAP_W + 5]),
    enemies: [{ id: 'rat-1', name: 'Rat', x: 5, y: 4, hp: 5, maxHp: 5, atk: 2, def: 0 }],
    G: { floor: 2 },
  });

  const decision = decide(G);

  assert.notStrictEqual(decision.val, 'ArrowRight');
});

test('heads to known stairs when low on HP and out of potions if danger is not adjacent', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5, STAIRS],
    [7, 3],
  ]);
  const seen = new Set([5 * MAP_W + 5, 6 * MAP_W + 5, 7 * MAP_W + 5, 7 * MAP_W + 3]);
  const G = baseGame(map, {
    player: { class: 'rogue', hp: 9, maxHp: 48 },
    seen,
    visible: new Set(seen),
    enemies: [{ id: 'goblin-1', name: 'Goblin', x: 7, y: 3, hp: 18, maxHp: 18, atk: 6, def: 1 }],
    G: { floor: 2 },
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowRight');
});

test('warrior heads to known stairs instead of kiting while low with no potion', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5, STAIRS],
    [7, 3],
    [5, 6],
    [4, 5],
  ]);
  const seen = new Set([5 * MAP_W + 5, 6 * MAP_W + 5, 7 * MAP_W + 5, 7 * MAP_W + 3, 5 * MAP_W + 6, 5 * MAP_W + 4]);
  const G = baseGame(map, {
    player: { class: 'warrior', hp: 9, maxHp: 48, weapon: { atk: 5 }, armor: { def: 4 } },
    seen,
    visible: new Set([5 * MAP_W + 5, 6 * MAP_W + 5, 7 * MAP_W + 3]),
    enemies: [{ id: 'goblin-1', name: 'Goblin', x: 7, y: 3, hp: 18, maxHp: 18, atk: 6, def: 1 }],
    G: { floor: 2 },
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

test('mage explores instead of fireballing nonadjacent enemies while weak with no potion and unknown stairs', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
    [5, 6],
  ]);
  const seen = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'mage', hp: 8, maxHp: 30, weapon: { atk: 5, sym: 'â™¦' } },
    seen,
    visible: new Set(seen),
    enemies: [{ id: 'orc-1', name: 'Orc', x: 7, y: 5, hp: 30, maxHp: 30, atk: 12, def: 2 }],
    ability1Cooldown: 0,
    G: { floor: 4 },
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.notStrictEqual(decision.val, 'ArrowUp');
  assert.notStrictEqual(decision.val, 'ArrowLeft');
});

test('paths to unseen tiles before nonblocking enemies while weak with no potion and unknown stairs', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
    [5, 6],
  ]);
  const seen = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'warrior', hp: 14, maxHp: 40, weapon: { atk: 5 }, armor: { def: 4 } },
    seen,
    visible: new Set(seen),
    enemies: [{ id: 'orc-1', name: 'Orc', x: 7, y: 5, hp: 30, maxHp: 30, atk: 12, def: 2 }],
    ability1Cooldown: 5,
    G: { floor: 4 },
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.notStrictEqual(decision.val, 'ArrowUp');
  assert.notStrictEqual(decision.val, 'ArrowLeft');
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

test('heads to stairs instead of detouring to a shop once the floor is clear', () => {
  const map = makeMap();
  setFloor(map, [[3, 5, SHOP], [4, 5], [5, 5], [6, 5], [7, 5, STAIRS]]);
  const seen = new Set(Array.from({ length: 720 }, (_, i) => i));
  seen.add(5 * MAP_W + 3);
  seen.add(5 * MAP_W + 7);
  const G = baseGame(map, {
    player: { class: 'mage', hp: 25, maxHp: 25, gold: 60 },
    seen,
    visible: new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]),
    shops: [{
      x: 3,
      y: 5,
      stock: [{ id: 'shop-potion', type: 'potion', price: 15, sold: false, heal: 15 }],
    }],
    G: { floor: 1 },
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowRight');
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

test('buys teleportation scrolls from shops as strategic escape items', () => {
  const map = makeMap();
  setFloor(map, [[4, 5, SHOP], [5, 5], [6, 5]]);
  const seen = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { class: 'ranger', gold: 200, hp: 18, maxHp: 24 },
    seen,
    visible: new Set(seen),
    items: [{ id: 'escape-1', name: 'Scroll of Teleportation', type: 'scroll_teleport', carried: true }],
    shops: [{
      x: 4,
      y: 5,
      stock: [{
        id: 'teleport-scroll',
        name: 'Scroll of Teleportation',
        type: 'scroll_teleport',
        price: 150,
        sold: false,
      }, {
        id: 'def-upgrade',
        type: 'upgrade',
        stat: 'def',
        amount: 1,
        price: 40,
        sold: false,
      }],
    }],
  });

  const decision = decide(G, { shopOpen: true });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '.shop-item[onclick*="teleport-scroll"]');
});

test('rogue keeps a fourth potion stocked before upgrades', () => {
  const map = makeMap();
  setFloor(map, [[4, 5, SHOP], [5, 5], [6, 5]]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { class: 'rogue', hp: 15, maxHp: 20, gold: 200 },
    seen: new Set(visible),
    visible,
    items: [
      { id: 'backup-potion-1', type: 'potion', heal: 20, carried: true },
      { id: 'backup-potion-2', type: 'potion', heal: 20, carried: true },
      { id: 'backup-potion-3', type: 'potion', heal: 20, carried: true },
    ],
    shops: [{
      x: 4,
      y: 5,
      stock: [
        { id: 'potion-2', type: 'potion', heal: 20, price: 15, sold: false },
        { id: 'def-upgrade', type: 'upgrade', stat: 'def', amount: 1, price: 40, sold: false },
      ],
    }],
  });

  const decision = decide(G, { shopOpen: true });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '.shop-item[onclick*="potion-2"]');
});

test('mage keeps a third potion stocked before upgrades', () => {
  const map = makeMap();
  setFloor(map, [[4, 5, SHOP], [5, 5], [6, 5]]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { class: 'mage', hp: 11, maxHp: 20, gold: 200 },
    seen: new Set(visible),
    visible,
    items: [
      { id: 'backup-potion-1', type: 'potion', heal: 20, carried: true },
      { id: 'backup-potion-2', type: 'potion', heal: 20, carried: true },
    ],
    shops: [{
      x: 4,
      y: 5,
      stock: [
        { id: 'potion-3', type: 'potion', heal: 20, price: 15, sold: false },
        { id: 'def-upgrade', type: 'upgrade', stat: 'def', amount: 1, price: 40, sold: false },
      ],
    }],
  });

  const decision = decide(G, { shopOpen: true });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '.shop-item[onclick*="potion-3"]');
});

test('barbarian keeps a third potion stocked before upgrades', () => {
  const map = makeMap();
  setFloor(map, [[4, 5, SHOP], [5, 5], [6, 5]]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { class: 'barbarian', hp: 26, maxHp: 60, gold: 200 },
    seen: new Set(visible),
    visible,
    items: [
      { id: 'backup-potion-1', type: 'potion', heal: 20, carried: true },
      { id: 'backup-potion-2', type: 'potion', heal: 20, carried: true },
    ],
    shops: [{
      x: 4,
      y: 5,
      stock: [
        { id: 'potion-3', type: 'potion', heal: 20, price: 15, sold: false },
        { id: 'def-upgrade', type: 'upgrade', stat: 'def', amount: 1, price: 40, sold: false },
      ],
    }],
  });

  const decision = decide(G, { shopOpen: true });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '.shop-item[onclick*="potion-3"]');
});

test('buys a potion before an upgrade when wounded and out of healing', () => {
  const map = makeMap();
  setFloor(map, [[4, 5, SHOP], [5, 5], [6, 5]]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { class: 'ranger', hp: 12, maxHp: 40, gold: 200 },
    seen: new Set(visible),
    visible,
    shops: [{
      x: 4,
      y: 5,
      stock: [
        { id: 'def-upgrade', type: 'upgrade', stat: 'def', amount: 1, price: 40, sold: false },
        { id: 'potion-1', type: 'potion', heal: 20, price: 15, sold: false },
      ],
    }],
  });

  const decision = decide(G, { shopOpen: true });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '.shop-item[onclick*="potion-1"]');
});

test('rogue drinks a potion when below the combat floor threshold', () => {
  const map = makeMap();
  setFloor(map, [[5, 5], [6, 5], [7, 5], [5, 6]]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'rogue', hp: 7, maxHp: 20, weapon: { atk: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 7, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 }],
    items: [{ id: 'potion-1', type: 'potion', heal: 20, carried: true }],
    G: { floor: 4 },
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('warrior prioritizes defense upgrades over perception in shops', () => {
  const map = makeMap();
  setFloor(map, [[4, 5, SHOP], [5, 5], [6, 5]]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { class: 'warrior', gold: 220 },
    seen: new Set(visible),
    visible,
    shops: [{
      x: 4,
      y: 5,
      stock: [
        { id: 'def-upgrade', type: 'upgrade', stat: 'def', amount: 1, price: 40, sold: false },
        { id: 'perception-upgrade', type: 'upgrade', stat: 'perception', amount: 1, price: 40, sold: false },
      ],
    }],
  });

  const decision = decide(G, { shopOpen: true });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '.shop-item[onclick*="def-upgrade"]');
});

test('ranger prioritizes perception upgrades over defense in shops', () => {
  const map = makeMap();
  setFloor(map, [[4, 5, SHOP], [5, 5], [6, 5]]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { class: 'ranger', gold: 220 },
    seen: new Set(visible),
    visible,
    shops: [{
      x: 4,
      y: 5,
      stock: [
        { id: 'def-upgrade', type: 'upgrade', stat: 'def', amount: 1, price: 40, sold: false },
        { id: 'perception-upgrade', type: 'upgrade', stat: 'perception', amount: 1, price: 40, sold: false },
      ],
    }],
  });

  const decision = decide(G, { shopOpen: true });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '.shop-item[onclick*="perception-upgrade"]');
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
  assert.notStrictEqual(decision.val, 'ArrowUp');
  assert.notStrictEqual(decision.val, 'ArrowLeft');
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

test('avoids chasing a visible enemy when wounded but still carrying a potion', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
    [5, 6],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'warrior', hp: 23, maxHp: 40, weapon: { atk: 4 } },
    seen: new Set([5 * MAP_W + 5, 5 * MAP_W + 7]),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 7, y: 5, hp: 20, maxHp: 20, atk: 8, def: 2 }],
    items: [{ id: 'potion-1', type: 'potion', heal: 20, carried: true }],
    G: { floor: 4 },
  });

  const decision = decide(G);

  assert.notStrictEqual(decision.label, 'path to enemy');
  assert.strictEqual(decision.val, 'ArrowDown');
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

test('monk values level 3 bare hands above equal low-tier weapons while exploring', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
  ]);
  const seen = new Set([5 * MAP_W + 5, 4 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'monk', lvl: 3, weapon: null, armor: null },
    seen,
    visible: new Set(seen),
    items: [{ id: 'training-sword', name: 'Training Sword', type: 'weapon', atk: 2, x: 5, y: 4, carried: false }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowDown');
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
    [8, 5],
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
  assert.notStrictEqual(decision.val, 'b');
});

test('rogue does not dash into melee when low on hp, out of potions, and known stairs already exist', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
    [7, 5, STAIRS],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'rogue', hp: 16, maxHp: 32, weapon: { atk: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.notStrictEqual(decision.val, 'b');
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
    [8, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7, 5 * MAP_W + 8]);
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

test('rogue explores instead of kiting while critically low with no potions and no known stairs', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 4],
    [5, 5],
    [5, 6],
    [5, 7, SHOP],
    [6, 5],
  ]);
  const seen = new Set([4 * MAP_W + 5, 5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const visible = new Set([5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'rogue', hp: 6, maxHp: 64, lvl: 6, gold: 50, weapon: { atk: 8 } },
    seen,
    visible,
    enemies: [{ id: 'orc-1', name: 'Orc', x: 6, y: 5, hp: 20, maxHp: 20, atk: 8, def: 2 }],
    ability2Cooldown: 1,
    shops: [{
      x: 5,
      y: 7,
      stock: [
        { id: 'potion-1', type: 'potion', heal: 20, price: 15, sold: false },
      ],
    }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.notStrictEqual(decision.val, 'ArrowUp');
  assert.notStrictEqual(decision.val, 'ArrowLeft');
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
    [8, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7, 5 * MAP_W + 8]);
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
    [8, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7, 5 * MAP_W + 8]);
  const G = baseGame(map, {
    player: { class: 'ranger', hp: 15, maxHp: 15, weapon: { atk: 3, sym: '🏹' } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 8, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 }],
    ability1Cooldown: 4,
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'attack');
  assert.strictEqual(decision.target, 'g1');
});

test('mage does not spend blink when the only safe visible tile is the current tile', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'mage', lvl: 5, hp: 8, maxHp: 15, weapon: { atk: 5 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.notStrictEqual(decision.val, 'v');
});

test('uses a teleportation scroll when surrounded without healing', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 5],
    [6, 5],
    [5, 4],
    [5, 6],
  ]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 4 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { hp: 8, maxHp: 24 },
    seen: new Set(visible),
    visible,
    enemies: [
      { id: 'orc-1', name: 'Orc', x: 4, y: 5, hp: 40, maxHp: 40, atk: 12, def: 3 },
      { id: 'orc-2', name: 'Orc', x: 6, y: 5, hp: 40, maxHp: 40, atk: 12, def: 3 },
    ],
    items: [{ id: 'teleport-1', name: 'Scroll of Teleportation', type: 'scroll_teleport', carried: true }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('uses a teleportation scroll against a single lethal adjacent threat without healing', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { hp: 8, maxHp: 24, def: 1, armor: { def: 1 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'orc-1', name: 'Orc', x: 5, y: 6, hp: 40, maxHp: 40, atk: 12, def: 3 }],
    items: [{ id: 'teleport-1', name: 'Scroll of Teleportation', type: 'scroll_teleport', carried: true }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('uses a detection scroll before exploring when hidden secrets remain', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5, SECRET_DOOR],
    [5, 6],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { hp: 18, maxHp: 18 },
    seen: new Set(visible),
    visible,
    items: [{ id: 'detect-1', name: 'Scroll of Detection', type: 'scroll', carried: true }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('clicks the carried teleportation scroll once the bag is open', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 5],
    [6, 5],
  ]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { hp: 8, maxHp: 24 },
    seen: new Set(visible),
    visible,
    enemies: [
      { id: 'orc-1', name: 'Orc', x: 4, y: 5, hp: 40, maxHp: 40, atk: 12, def: 3 },
      { id: 'orc-2', name: 'Orc', x: 6, y: 5, hp: 40, maxHp: 40, atk: 12, def: 3 },
    ],
    items: [{ id: 'teleport-1', name: 'Scroll of Teleportation', type: 'scroll_teleport', carried: true }],
  });

  const decision = decide(G, { bagOpen: true });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '.inv-slot[onclick*="teleport-1"]');
});

test('uses a teleportation scroll proactively when critically wounded beside a threat', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { hp: 12, maxHp: 90, def: 4, armor: { def: 4 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'orc-1', name: 'Orc', x: 5, y: 6, hp: 40, maxHp: 40, atk: 16, def: 3 }],
    items: [{ id: 'teleport-1', name: 'Scroll of Teleportation', type: 'scroll_teleport', carried: true }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('uses a teleportation scroll when out of potions and below the combat floor', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
    [5, 6],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'ranger', hp: 7, maxHp: 20, weapon: { atk: 3, sym: '🏹' } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 7, y: 5, hp: 12, maxHp: 12, atk: 5, def: 1 }],
    items: [{ id: 'teleport-1', name: 'Scroll of Teleportation', type: 'scroll_teleport', carried: true }],
    G: { floor: 4 },
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('uses a bomb when wounded and it can remove adjacent pressure', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { hp: 12, maxHp: 60, def: 2, armor: { def: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'orc-1', name: 'Orc', x: 5, y: 6, hp: 25, maxHp: 40, atk: 16, def: 3 }],
    items: [{ id: 'bomb-1', name: 'Bomb', type: 'bomb', carried: true }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('mage uses a bomb when panic-low and two adjacent enemies remain', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
    [6, 5],
    [4, 5],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'mage', hp: 8, maxHp: 30, weapon: { atk: 4 } },
    seen: new Set(visible),
    visible,
    enemies: [
      { id: 'orc-1', name: 'Orc', x: 5, y: 4, hp: 40, maxHp: 40, atk: 12, def: 3 },
      { id: 'orc-2', name: 'Orc', x: 5, y: 6, hp: 40, maxHp: 40, atk: 12, def: 3 },
    ],
    items: [{ id: 'bomb-1', name: 'Bomb', type: 'bomb', carried: true }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('clicks the carried bomb once the bag is open to remove adjacent pressure', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { hp: 12, maxHp: 60, def: 2, armor: { def: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'orc-1', name: 'Orc', x: 5, y: 6, hp: 25, maxHp: 40, atk: 16, def: 3 }],
    items: [{ id: 'bomb-1', name: 'Bomb', type: 'bomb', carried: true }],
  });

  const decision = decide(G, { bagOpen: true });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '.inv-slot[onclick*="bomb-1"]');
});

test('drinks a strength potion before engaging a durable visible threat', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { hp: 18, maxHp: 24, atk: 5, weapon: { atk: 4 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'orc-1', name: 'Orc', x: 7, y: 5, hp: 40, maxHp: 40, atk: 12, def: 3 }],
    items: [{ id: 'strength-1', name: 'Potion of Giant Strength', type: 'potion_buff', buff: 'strength', carried: true }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('warrior drinks strength before a durable visible threat', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'warrior', hp: 18, maxHp: 30, weapon: { atk: 5 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'ogre-1', name: 'Ogre', x: 7, y: 5, hp: 24, maxHp: 24, atk: 8, def: 2 }],
    items: [{ id: 'strength-warrior-1', name: 'Potion of Giant Strength', type: 'potion_buff', buff: 'strength', carried: true }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('mage drinks strength before a durable visible threat', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'mage', hp: 18, maxHp: 30, weapon: { atk: 5, sym: 'â™¦' } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'ogre-1', name: 'Ogre', x: 7, y: 5, hp: 24, maxHp: 24, atk: 8, def: 2 }],
    items: [{ id: 'strength-mage-1', name: 'Potion of Giant Strength', type: 'potion_buff', buff: 'strength', carried: true }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('monk drinks strength before a durable visible threat', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'monk', hp: 18, maxHp: 28, weapon: { atk: 3 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'ogre-1', name: 'Ogre', x: 7, y: 5, hp: 24, maxHp: 24, atk: 8, def: 2 }],
    items: [{ id: 'strength-monk-1', name: 'Potion of Giant Strength', type: 'potion_buff', buff: 'strength', carried: true }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('prioritizes a valuable strength buff over a nearby shop detour', () => {
  const map = makeMap();
  setFloor(map, [[4, 5, SHOP], [5, 5], [6, 5]]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { class: 'paladin', hp: 23, maxHp: 77, gold: 120, weapon: { atk: 5 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'ogre-1', name: 'Ogre', x: 6, y: 5, hp: 24, maxHp: 24, atk: 8, def: 2 }],
    items: [{ id: 'strength-paladin-1', name: 'Potion of Giant Strength', type: 'potion_buff', buff: 'strength', carried: true }],
    shops: [{
      x: 4,
      y: 5,
      stock: [
        { id: 'def-upgrade', type: 'upgrade', stat: 'def', amount: 1, price: 40, sold: false },
      ],
    }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'i');
});

test('does not shop for a strength buff while enemies are already visible', () => {
  const map = makeMap();
  setFloor(map, [[4, 5, SHOP], [5, 5], [6, 5], [7, 5]]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'monk', hp: 67, maxHp: 132, gold: 120, weapon: { atk: 4 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'ogre-1', name: 'Ogre', x: 7, y: 5, hp: 24, maxHp: 24, atk: 8, def: 2 }],
    shops: [{
      x: 4,
      y: 5,
      stock: [
        { id: 'strength-shop-1', name: 'Potion of Giant Strength', type: 'potion_buff', buff: 'strength', price: 30, sold: false },
      ],
    }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.notStrictEqual(decision.val, 't');
});

test('clicks the carried strength potion once the bag is open', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { hp: 18, maxHp: 24, atk: 5, weapon: { atk: 4 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'orc-1', name: 'Orc', x: 7, y: 5, hp: 40, maxHp: 40, atk: 12, def: 3 }],
    items: [{ id: 'strength-1', name: 'Potion of Giant Strength', type: 'potion_buff', buff: 'strength', carried: true }],
  });

  const decision = decide(G, { bagOpen: true });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '.inv-slot[onclick*="strength-1"]');
});

test('accepts a low-cost greed shrine through the live shrine overlay', () => {
  const map = makeMap();
  setFloor(map, [[5, 5]]);
  const visible = new Set([5 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { gold: 25 },
    seen: new Set(visible),
    visible,
  });

  const decision = decide(G, { shrineOpen: true, shrineTitle: 'GREED SHRINE' });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '#shrine-accept-btn');
});

test('paladin accepts a greed shrine late when the gold payout is worth the detour', () => {
  const map = makeMap();
  setFloor(map, [[5, 5]]);
  const visible = new Set([5 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'paladin', lvl: 5, hp: 24, maxHp: 24, gold: 240 },
    seen: new Set(visible),
    visible,
    G: { floor: 4 },
  });

  const decision = decide(G, { shrineOpen: true, shrineTitle: 'GREED SHRINE' });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '#shrine-accept-btn');
});

test('rejects a cursed shrine when already healthy', () => {
  const map = makeMap();
  setFloor(map, [[5, 5]]);
  const visible = new Set([5 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { hp: 20, maxHp: 20 },
    seen: new Set(visible),
    visible,
  });

  const decision = decide(G, { shrineOpen: true, shrineTitle: 'CURSED SHRINE' });

  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '#shrine-decline-btn');
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

test('warrior uses shield wall on floor 5 instead of kiting while critically low', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 4],
    [5, 5],
    [5, 6],
    [6, 5],
    [7, 5],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'warrior', lvl: 12, hp: 7, maxHp: 116, weapon: { atk: 8 }, armor: { def: 8 } },
    seen: new Set(visible),
    visible,
    enemies: [
      { id: 'g1', name: 'Goblin', x: 5, y: 4, hp: 20, maxHp: 20, atk: 6, def: 1 },
      { id: 'g2', name: 'Goblin', x: 7, y: 5, hp: 20, maxHp: 20, atk: 6, def: 1 },
    ],
    G: { floor: 5 },
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('warrior does not bash while critically low with no potions and known stairs', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [6, 5],
    [7, 5, STAIRS],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'warrior', lvl: 12, hp: 17, maxHp: 116, weapon: { atk: 8 }, armor: { def: 8 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 6, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 }],
    G: { floor: 4 },
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.notStrictEqual(decision.val, 'b');
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
    player: { class: 'paladin', lvl: 5, hp: 10, maxHp: 25, weapon: { atk: 2 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 10, maxHp: 10, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('paladin smites to survive when surrounded with no known stairs', () => {
  const map = makeMap();
  setFloor(map, [
    [22, 20],
    [23, 19],
    [23, 20],
    [23, 21],
  ]);
  const visible = new Set([20 * MAP_W + 23, 19 * MAP_W + 23, 21 * MAP_W + 23]);
  const G = baseGame(map, {
    player: { class: 'paladin', x: 23, y: 20, lvl: 3, hp: 5, maxHp: 40, gold: 30, weapon: { atk: 5 }, armor: { def: 5 } },
    seen: new Set(visible),
    visible,
    enemies: [
      { id: 'g1', name: 'Goblin', x: 23, y: 19, hp: 10, maxHp: 10, atk: 4, def: 1 },
      { id: 'g2', name: 'Goblin', x: 23, y: 21, hp: 10, maxHp: 10, atk: 4, def: 1 },
    ],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'b');
});

test('paladin does not smite while weak with no potions and known stairs', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5, STAIRS],
    [5, 5],
    [6, 5],
  ]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    floor: 2,
    player: { class: 'paladin', x: 5, y: 5, lvl: 3, hp: 20, maxHp: 50, weapon: { atk: 5 }, armor: { def: 5 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 6, y: 5, hp: 18, maxHp: 18, atk: 6, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.notStrictEqual(decision.val, 'b');
});

test('does not pick up non-recovery loot while escaping weak in melee', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 4, STAIRS],
    [5, 5],
    [6, 5],
  ]);
  const visible = new Set([5 * MAP_W + 4, 4 * MAP_W + 5, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    floor: 2,
    player: { class: 'paladin', x: 5, y: 5, lvl: 4, hp: 6, maxHp: 50, weapon: { atk: 5 }, armor: { def: 5 } },
    seen: new Set(visible),
    visible,
    items: [{ id: 'nearby-key', name: 'Key', type: 'key', x: 4, y: 5, carried: false }],
    enemies: [{ id: 'g1', name: 'Goblin', x: 6, y: 5, hp: 18, maxHp: 18, atk: 6, def: 1 }],
  });

  const decision = decide(G);

  assert.notStrictEqual(decision.label, 'pickup');
});

test('does not pick up a strength buff while escaping weak in melee', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 4, STAIRS],
    [5, 5],
    [6, 5],
  ]);
  const visible = new Set([5 * MAP_W + 4, 4 * MAP_W + 5, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    floor: 2,
    player: { class: 'paladin', x: 5, y: 5, lvl: 4, hp: 6, maxHp: 50, weapon: { atk: 5 }, armor: { def: 5 } },
    seen: new Set(visible),
    visible,
    items: [{ id: 'nearby-strength', name: 'Potion of Giant Strength', type: 'potion_buff', buff: 'strength', x: 4, y: 5, carried: false }],
    enemies: [{ id: 'g1', name: 'Goblin', x: 6, y: 5, hp: 18, maxHp: 18, atk: 6, def: 1 }],
  });

  const decision = decide(G);

  assert.notStrictEqual(decision.label, 'pickup');
});

test('moves toward adjacent known stairs while kiting weak with no potions', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5, STAIRS],
    [5, 4],
    [5, 5],
    [5, 6],
    [6, 5],
  ]);
  const visible = new Set([5 * MAP_W + 4, 4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    floor: 2,
    player: { class: 'paladin', x: 5, y: 5, lvl: 4, hp: 6, maxHp: 50, weapon: { atk: 5 }, armor: { def: 5 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 6, y: 5, hp: 18, maxHp: 18, atk: 6, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowLeft');
});

test('moves toward known stairs instead of trading melee while weak with no potions', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5, STAIRS],
    [5, 5],
    [6, 5],
  ]);
  const visible = new Set([5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    floor: 2,
    player: { class: 'paladin', x: 5, y: 5, lvl: 4, hp: 25, maxHp: 50, weapon: { atk: 5 }, armor: { def: 5 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 6, y: 5, hp: 18, maxHp: 18, atk: 6, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowLeft');
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

test('ranger uses bear trap to create space while panicked with no potion', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
    [6, 5],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5, 5 * MAP_W + 6]);
  const G = baseGame(map, {
    player: { class: 'ranger', lvl: 5, hp: 6, maxHp: 20, weapon: { atk: 3, sym: '🏹' } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 14, maxHp: 14, atk: 6, def: 1 }],
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

test('barbarian does not bloodlust while critically low and unrecovered', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'barbarian', lvl: 5, hp: 4, maxHp: 40, weapon: { atk: 8 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'ogre-1', name: 'Ogre', x: 5, y: 6, hp: 30, maxHp: 30, atk: 10, def: 2 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.notStrictEqual(decision.val, 'v');
});

test('barbarian does not bloodlust while escaping with no potions and visible enemies', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'barbarian', lvl: 5, hp: 18, maxHp: 40, weapon: { atk: 8 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'ogre-1', name: 'Ogre', x: 5, y: 6, hp: 30, maxHp: 30, atk: 10, def: 2 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.notStrictEqual(decision.val, 'v');
});

test('barbarian explores instead of kiting while critically low with no potions and no known stairs', () => {
  const map = makeMap();
  setFloor(map, [
    [4, 5],
    [5, 4],
    [5, 5],
    [5, 6],
    [5, 7, SHOP],
    [6, 5],
  ]);
  const seen = new Set([4 * MAP_W + 5, 5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const visible = new Set([5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'barbarian', hp: 6, maxHp: 64, lvl: 6, gold: 50, weapon: { atk: 8 } },
    seen,
    visible,
    enemies: [{ id: 'orc-1', name: 'Orc', x: 6, y: 5, hp: 20, maxHp: 20, atk: 8, def: 2 }],
    ability2Cooldown: 1,
    shops: [{
      x: 5,
      y: 7,
      stock: [
        { id: 'potion-1', type: 'potion', heal: 20, price: 15, sold: false },
      ],
    }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.notStrictEqual(decision.val, 'ArrowUp');
  assert.notStrictEqual(decision.val, 'ArrowLeft');
});

test('necromancer primes raise dead before siphoning when multiple enemies are visible', () => {
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
      { id: 'g1', name: 'Goblin', x: 6, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1, raiseCorpseTarget: false },
      { id: 'g2', name: 'Goblin', x: 7, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1 },
    ],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('necromancer does not prime raise dead again when the visible target is already marked', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [6, 5],
    [7, 5],
  ]);
  const visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  const G = baseGame(map, {
    player: { class: 'necromancer', lvl: 5, hp: 15, maxHp: 15, weapon: { atk: 4, sym: 'â™¦' } },
    seen: new Set(visible),
    visible,
    enemies: [
      { id: 'g1', name: 'Goblin', x: 6, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1, raiseCorpseTarget: true },
      { id: 'g2', name: 'Goblin', x: 7, y: 5, hp: 10, maxHp: 10, atk: 4, def: 1, raiseCorpseTarget: true },
    ],
  });

  const decision = decide(G);

  assert.notStrictEqual(decision && decision.val, 'v');
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

test('monk saves push kick when a basic attack can finish the adjacent enemy', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [5, 6],
    [5, 7],
  ]);
  const visible = new Set([5 * MAP_W + 5, 6 * MAP_W + 5, 7 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'monk', lvl: 3, hp: 26, maxHp: 28, atk: 4, def: 2, weapon: null, armor: { def: 4 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 4, maxHp: 12, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'ArrowDown');
});

test('monk uses push kick to create space against a healthy adjacent enemy', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [5, 6],
    [5, 7],
  ]);
  const visible = new Set([5 * MAP_W + 5, 6 * MAP_W + 5, 7 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'monk', lvl: 3, hp: 26, maxHp: 28, atk: 4, def: 2, weapon: null, armor: { def: 4 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'g1', name: 'Goblin', x: 5, y: 6, hp: 12, maxHp: 12, atk: 4, def: 1 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'b');
});

test('monk uses flurry to finish a dangerous adjacent enemy while wounded', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 5],
    [5, 6],
  ]);
  const visible = new Set([5 * MAP_W + 5, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'monk', lvl: 5, hp: 12, maxHp: 32, atk: 7, def: 2, weapon: null, armor: { def: 4 } },
    seen: new Set(visible),
    visible,
    enemies: [{ id: 'orc-1', name: 'Orc', x: 5, y: 6, hp: 18, maxHp: 40, atk: 14, def: 3 }],
  });

  const decision = decide(G);

  assert.strictEqual(decision.type, 'key');
  assert.strictEqual(decision.val, 'v');
});

test('monk does not spend push kick or flurry while critically low with no potions and no known stairs', () => {
  const map = makeMap();
  setFloor(map, [
    [5, 4],
    [5, 5],
    [5, 6],
    [4, 5],
    [6, 5],
  ]);
  const visible = new Set([4 * MAP_W + 5, 5 * MAP_W + 4, 5 * MAP_W + 5, 5 * MAP_W + 6, 6 * MAP_W + 5]);
  const G = baseGame(map, {
    player: { class: 'monk', lvl: 11, hp: 7, maxHp: 96, atk: 7, def: 3, weapon: { atk: 9 }, armor: { def: 7 } },
    seen: new Set(visible),
    visible,
    enemies: [
      { id: 'orc-north', name: 'Orc', x: 5, y: 4, hp: 120, maxHp: 120, atk: 17, def: 3 },
      { id: 'orc-south', name: 'Orc', x: 5, y: 6, hp: 120, maxHp: 120, atk: 17, def: 3 },
    ],
  });

  const decision = decide(G);

  if (decision) {
    assert.strictEqual(decision.type, 'key');
    assert.notStrictEqual(decision.val, 'b');
    assert.notStrictEqual(decision.val, 'v');
  }
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

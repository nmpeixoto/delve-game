const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MAP_W = 56;
const MAP_H = 36;
const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2, SHOP: 3 };

function makeMap(tile = TILE.FLOOR) {
  return Array.from({ length: MAP_H }, () => Array(MAP_W).fill(tile));
}

function loadCombat(overrides = {}) {
  const context = {
    G: {
      player: {
        x: 5,
        y: 5,
        hp: 20,
        maxHp: 20,
        atk: 4,
        def: 1,
        lvl: 1,
        xp: 0,
        xpNext: 10,
        kills: 0,
        gold: 0,
        damageDealt: 0,
        class: 'warrior',
        weapon: null,
        armor: null,
        shieldWallTurns: 0,
        vanishTurns: 0,
        freeMoves: 0,
        bloodlustTurns: 0,
        rootedTurns: 0,
        vampirism: 0,
        regen: 0,
        swiftness: 0,
      },
      enemies: [],
      items: [],
      traps: [],
      map: makeMap(),
      rooms: [{ cx: 5, cy: 5 }],
      shops: [],
      ability1Cooldown: 0,
      ability2Cooldown: 0,
      turn: 0,
      gameOver: false,
      won: false,
      visible: new Set([5 * MAP_W + 5]),
      seen: new Set([5 * MAP_W + 5]),
    },
    MAP_W,
    MAP_H,
    TILE,
    TIPS: {
      firstEnemy: { shown: false },
      firstStairs: { shown: false },
      firstShop: { shown: false },
    },
    gatk: () => 4,
    getStat: (statName) => {
      let base = context.G.player[statName] || 0;
      let w = context.G.player.weapon ? (context.G.player.weapon[statName] || 0) : 0;
      let a = context.G.player.armor ? (context.G.player.armor[statName] || 0) : 0;
      return base + w + a;
    },
    gdef: () => 1,
    rand: () => 0,
    ch: () => false,
    canAct: () => true,
    SFX: {
      hit: () => {},
      bash: () => {},
      damage: () => {},
      enemyDeath: () => {},
      levelUp: () => {},
    },
    floatText: () => {},
    addLog: () => {},
    fireTip: () => {},
    render: () => {},
    computeVision: () => {},
    checkLevelUp: () => {},
    checkBagUpgrades: () => {},
    checkEmergencyPotion: (_enemy, _dmg, afterFn) => afterFn(),
    showDeath: () => {},
    updateActBtns: () => {},
    consumeRootedTurn: () => {},
    popText: () => {},
    shakeMap: () => {},
    flashDamage: () => {},
    setTimeout: () => {
      throw new Error('dying enemies should not schedule another removal');
    },
    Math,
    Set,
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'src/js/combat.js'), 'utf8'), context);
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

test('attackEnemy ignores enemies already marked dying', () => {
  const context = loadCombat();
  context.G.enemies = [{
    id: 'goblin-1',
    name: 'Goblin',
    hp: -3,
    maxHp: 10,
    atk: 4,
    def: 1,
    xp: 6,
    gold: 4,
    x: 4,
    y: 5,
    dying: true,
  }];

  context.attackEnemy('goblin-1');

  assert.strictEqual(context.G.player.kills, 0);
  assert.strictEqual(context.G.player.xp, 0);
  assert.strictEqual(context.G.player.gold, 0);
  assert.strictEqual(context.G.player.damageDealt, 0);
  assert.strictEqual(context.G.enemies.length, 1);
});

test('paladin smite prevents the target immediate counterattack', () => {
  const context = loadCombat({
    G: {
      player: {
        x: 5,
        y: 5,
        hp: 20,
        maxHp: 20,
        atk: 4,
        def: 1,
        lvl: 1,
        xp: 0,
        xpNext: 10,
        kills: 0,
        gold: 0,
        damageDealt: 0,
        class: 'paladin',
        weapon: null,
        armor: null,
        shieldWallTurns: 0,
        vanishTurns: 0,
        freeMoves: 0,
        bloodlustTurns: 0,
        rootedTurns: 0,
        vampirism: 0,
        regen: 0,
        swiftness: 0,
      },
      enemies: [{
        id: 'goblin-1',
        name: 'Goblin',
        hp: 20,
        maxHp: 20,
        atk: 6,
        def: 0,
        xp: 6,
        gold: 4,
        x: 6,
        y: 5,
        stunnedTurns: 0,
      }],
      items: [],
      traps: [],
      map: makeMap(),
      rooms: [{ cx: 5, cy: 5 }],
      shops: [],
      ability1Cooldown: 0,
      ability2Cooldown: 0,
      turn: 0,
      gameOver: false,
      won: false,
      visible: new Set([5 * MAP_W + 5, 5 * MAP_W + 6]),
      seen: new Set([5 * MAP_W + 5, 5 * MAP_W + 6]),
    },
  });

  context.doAbility1();

  assert.strictEqual(context.G.player.hp, 20);
});

test('mage fireball hits enemies around the selected target, not around the player', () => {
  const context = loadCombat({
    G: {
      player: {
        x: 5,
        y: 5,
        hp: 20,
        maxHp: 20,
        atk: 4,
        def: 1,
        lvl: 1,
        xp: 0,
        xpNext: 10,
        kills: 0,
        gold: 0,
        damageDealt: 0,
        class: 'mage',
        weapon: { sym: '♦' },
        armor: null,
        shieldWallTurns: 0,
        vanishTurns: 0,
        freeMoves: 0,
        bloodlustTurns: 0,
        rootedTurns: 0,
        vampirism: 0,
        regen: 0,
        swiftness: 0,
      },
      enemies: [
        {
          id: 'target-1',
          name: 'Goblin',
          hp: 10,
          maxHp: 10,
          atk: 0,
          def: 0,
          xp: 6,
          gold: 4,
          x: 6,
          y: 5,
          stunnedTurns: 0,
        },
        {
          id: 'target-2',
          name: 'Goblin',
          hp: 10,
          maxHp: 10,
          atk: 0,
          def: 0,
          xp: 6,
          gold: 4,
          x: 7,
          y: 5,
          stunnedTurns: 0,
        },
      ],
      items: [],
      traps: [],
      map: makeMap(),
      rooms: [{ cx: 5, cy: 5 }],
      shops: [],
      ability1Cooldown: 0,
      ability2Cooldown: 0,
      turn: 0,
      gameOver: false,
      won: false,
      visible: new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]),
      seen: new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]),
    },
  });

  context.doAbility1();

  assert.strictEqual(context.G.ability1Cooldown, 4);
  assert.strictEqual(context.G.turn, 1);
  assert.ok(context.G.enemies[0].hp < 10);
  assert.ok(context.G.enemies[1].hp < 10);
});

test('necromancer corpse explosion mark survives the setup turn', () => {
  const context = loadCombat({
    G: {
      player: {
        x: 5,
        y: 5,
        hp: 20,
        maxHp: 20,
        atk: 4,
        def: 1,
        lvl: 5,
        xp: 0,
        xpNext: 10,
        kills: 0,
        gold: 0,
        damageDealt: 0,
        class: 'necromancer',
        weapon: null,
        armor: null,
        shieldWallTurns: 0,
        vanishTurns: 0,
        freeMoves: 0,
        bloodlustTurns: 0,
        rootedTurns: 0,
        vampirism: 0,
        regen: 0,
        swiftness: 0,
      },
      enemies: [{
        id: 'goblin-1',
        name: 'Goblin',
        hp: 20,
        maxHp: 20,
        atk: 0,
        def: 0,
        xp: 6,
        gold: 4,
        x: 6,
        y: 5,
        stunnedTurns: 0,
      }],
      items: [],
      traps: [],
      map: makeMap(),
      rooms: [{ cx: 5, cy: 5 }],
      shops: [],
      ability1Cooldown: 0,
      ability2Cooldown: 0,
      turn: 0,
      gameOver: false,
      won: false,
      visible: new Set([5 * MAP_W + 5, 5 * MAP_W + 6]),
      seen: new Set([5 * MAP_W + 5, 5 * MAP_W + 6]),
    },
  });

  context.doAbility2();

  assert.strictEqual(context.G.enemies[0].corpseExplosionTarget, true);
});

test('monk flurry leaves the player rooted for the next movement attempt', () => {
  const context = loadCombat({
    G: {
      player: {
        x: 5,
        y: 5,
        hp: 20,
        maxHp: 20,
        atk: 4,
        def: 1,
        lvl: 5,
        xp: 0,
        xpNext: 10,
        kills: 0,
        gold: 0,
        damageDealt: 0,
        class: 'monk',
        weapon: null,
        armor: null,
        shieldWallTurns: 0,
        vanishTurns: 0,
        freeMoves: 0,
        bloodlustTurns: 0,
        rootedTurns: 0,
        vampirism: 0,
        regen: 0,
        swiftness: 0,
      },
      enemies: [{
        id: 'goblin-1',
        name: 'Goblin',
        hp: 50,
        maxHp: 50,
        atk: 0,
        def: 0,
        xp: 6,
        gold: 4,
        x: 6,
        y: 5,
        stunnedTurns: 0,
      }],
      items: [],
      traps: [],
      map: makeMap(),
      rooms: [{ cx: 5, cy: 5 }],
      shops: [],
      ability1Cooldown: 0,
      ability2Cooldown: 0,
      turn: 0,
      gameOver: false,
      won: false,
      visible: new Set([5 * MAP_W + 5, 5 * MAP_W + 6]),
      seen: new Set([5 * MAP_W + 5, 5 * MAP_W + 6]),
    },
  });

  context.doAbility2();

  assert.strictEqual(context.G.player.rootedTurns, 1);
});

test('ranger bow attacks from 2 tiles away still trigger a counterattack', () => {
  const context = loadCombat({
    G: {
      player: {
        x: 5,
        y: 5,
        hp: 20,
        maxHp: 20,
        atk: 4,
        def: 1,
        lvl: 1,
        xp: 0,
        xpNext: 10,
        kills: 0,
        gold: 0,
        damageDealt: 0,
        class: 'ranger',
        weapon: { name: 'Shortbow', type: 'weapon', atk: 3, sym: '🏹' },
        armor: null,
        shieldWallTurns: 0,
        vanishTurns: 0,
        freeMoves: 0,
        bloodlustTurns: 0,
        rootedTurns: 0,
        vampirism: 0,
        regen: 0,
        swiftness: 0,
      },
      enemies: [{
        id: 'goblin-1',
        name: 'Goblin',
        hp: 50,
        maxHp: 50,
        atk: 6,
        def: 0,
        xp: 6,
        gold: 4,
        x: 7,
        y: 5,
        stunnedTurns: 0,
      }],
      items: [],
      traps: [],
      map: makeMap(),
      rooms: [{ cx: 5, cy: 5 }],
      shops: [],
      ability1Cooldown: 0,
      ability2Cooldown: 0,
      turn: 0,
      gameOver: false,
      won: false,
      visible: new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]),
      seen: new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]),
    },
  });

  context.tileAttack('goblin-1');

  assert.strictEqual(context.G.player.hp, 15);
  assert.strictEqual(context.G.turn, 1);
});

test('free moves do not make attacks free actions', () => {
  const context = loadCombat();
  context.G.player.freeMoves = 1;
  context.G.visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6]);
  context.G.enemies = [{
    id: 'goblin-1',
    name: 'Goblin',
    hp: 20,
    maxHp: 20,
    atk: 0,
    def: 0,
    xp: 6,
    gold: 4,
    x: 6,
    y: 5,
    stunnedTurns: 1,
  }];

  context.attackEnemy('goblin-1');

  assert.strictEqual(context.G.turn, 1);
  assert.strictEqual(context.G.player.freeMoves, 1);
});

test('rogue dodge still ends the turn after a counterattack is avoided', () => {
  const context = loadCombat({
    ch: () => true,
  });
  context.G.player.class = 'rogue';
  context.G.visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 4]);
  context.G.seen = new Set([5 * MAP_W + 5, 5 * MAP_W + 4]);
  context.G.enemies = [{
    id: 'goblin-1',
    name: 'Goblin',
    hp: 20,
    maxHp: 20,
    atk: 4,
    def: 1,
    xp: 6,
    gold: 4,
    x: 4,
    y: 5,
    stunnedTurns: 0,
  }];
  let advances = 0;
  context.advanceTurn = () => { advances += 1; };

  context.attackEnemy('goblin-1');

  assert.strictEqual(advances, 1);
});

test('rogue dodge during the enemy phase does not recurse the turn engine', () => {
  const context = loadCombat({
    ch: () => true,
  });
  context.G.player.class = 'rogue';
  context.G.visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 4]);
  context.G.seen = new Set([5 * MAP_W + 5, 5 * MAP_W + 4]);
  context.G.enemies = [{
    id: 'goblin-1',
    name: 'Goblin',
    hp: 20,
    maxHp: 20,
    atk: 4,
    def: 1,
    xp: 6,
    gold: 4,
    x: 4,
    y: 5,
    stunnedTurns: 0,
  }];

  context.advanceTurn();

  assert.strictEqual(context.G.turn, 1);
  assert.strictEqual(context.G.player.hp, 20);
});

test('unaware enemies do not wander onto the player tile', () => {
  const context = loadCombat({
    ch: () => true,
    rand: n => n === 4 ? 1 : 0,
  });
  context.G.enemies = [{
    id: 'goblin-1',
    name: 'Goblin',
    hp: 20,
    maxHp: 20,
    atk: 0,
    def: 0,
    xp: 6,
    gold: 4,
    x: 4,
    y: 5,
    stunnedTurns: 0,
  }];
  context.G.visible = new Set([5 * MAP_W + 5]);

  context.advanceTurn();

  assert.notStrictEqual(`${context.G.enemies[0].x},${context.G.enemies[0].y}`, '5,5');
});

test('ranger piercing shot does not fire when no visible enemy is in line', () => {
  const context = loadCombat();
  context.G.player.class = 'ranger';
  context.G.enemies = [{
    id: 'goblin-1',
    name: 'Goblin',
    hp: 20,
    maxHp: 20,
    atk: 0,
    def: 0,
    xp: 6,
    gold: 4,
    x: 7,
    y: 6,
    stunnedTurns: 0,
  }];
  context.G.visible = new Set([5 * MAP_W + 5, 6 * MAP_W + 7]);

  context.doAbility1();

  assert.strictEqual(context.G.turn, 0);
  assert.strictEqual(context.G.ability1Cooldown, 0);
  assert.strictEqual(context.G.player.damageDealt, 0);
  assert.strictEqual(context.G.enemies[0].hp, 20);
});

test('lethal poison shows the death screen without calling an undefined game-over path', () => {
  let deaths = 0;
  const context = loadCombat({
    showDeath: () => { deaths += 1; },
  });
  context.G.player.hp = 1;
  context.G.player.poisonedTurns = 1;
  context.G.enemies = [];

  context.advanceTurn();

  assert.strictEqual(context.G.gameOver, true);
  assert.strictEqual(deaths, 1);
});

test('mage blink does not spend a turn or cooldown when no alternate safe visible tile exists', () => {
  const context = loadCombat();
  context.G.player.class = 'mage';
  context.G.player.lvl = 5;
  context.G.player.x = 5;
  context.G.player.y = 5;
  context.G.map = makeMap(TILE.WALL);
  context.G.map[5][5] = TILE.FLOOR;
  context.G.visible = new Set([5 * MAP_W + 5]);
  context.G.seen = new Set([5 * MAP_W + 5]);
  context.G.enemies = [];

  context.doAbility2();

  assert.strictEqual(context.G.player.x, 5);
  assert.strictEqual(context.G.player.y, 5);
  assert.strictEqual(context.G.turn, 0);
  assert.strictEqual(context.G.ability2Cooldown, 0);
});

function loadItems(overrides = {}) {
  const context = {
    G: {
      player: {
        class: 'monk',
        lvl: 4,
        weapon: null,
        armor: null,
        bestWeapon: 'Bare hands',
      },
      items: [],
    },
    SFX: { pickup: () => {} },
    addLog: () => {},
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'src/js/items.js'), 'utf8'), context);
  return context;
}

test('monk does not auto-equip a weapon weaker than unarmed scaling', () => {
  const context = loadItems();
  context.G.items = [{
    id: 'dagger-1',
    name: 'Rusty Dagger',
    type: 'weapon',
    atk: 2,
    carried: true,
  }];

  context.checkBagUpgrades();

  assert.strictEqual(context.G.player.weapon, null);
  assert.strictEqual(context.G.items[0].carried, true);
});

test('full-health potion use is ignored instead of wasting the potion and a turn', () => {
  let turns = 0;
  const logs = [];
  const context = loadItems({
    G: {
      player: {
        class: 'warrior',
        lvl: 1,
        x: 5,
        y: 5,
        hp: 20,
        maxHp: 20,
        weapon: null,
        armor: null,
        bestWeapon: 'Bare hands',
      },
      items: [{
        id: 'potion-1',
        name: 'Health Potion',
        type: 'potion',
        heal: 15,
        carried: true,
      }],
    },
    addLog: msg => logs.push(msg),
    floatText: () => {},
    advanceTurn: () => { turns += 1; },
    closeInv: () => {},
  });

  context.useItem('potion-1');

  assert.strictEqual(context.G.items.length, 1);
  assert.strictEqual(context.G.player.hp, 20);
  assert.strictEqual(turns, 0);
  assert.strictEqual(logs[0], 'Already at full HP.');
});

function loadEmergency(overrides = {}) {
  const elements = {
    'emergency-overlay': { style: { display: 'none' } },
    'emergency-msg': { innerHTML: '' },
    'emergency-potion': { innerHTML: '' },
  };
  const context = {
    G: {
      player: {
        hp: 5,
        maxHp: 20,
        shieldWallTurns: 0,
        bloodlustTurns: 0,
      },
      items: [{ id: 'potion-1', type: 'potion', heal: 15, carried: true }],
    },
    document: { getElementById: id => elements[id] },
    gdef: () => 1,
    addLog: () => {},
    floatText: () => {},
    updateHUD: () => {},
    ...overrides,
  };
  context.elements = elements;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'src/js/emergency.js'), 'utf8'), context);
  return context;
}

test('shield wall modifier is included in fatal-hit prompt math', () => {
  let afterCalled = false;
  const context = loadEmergency({
    G: {
      player: { hp: 5, maxHp: 20, shieldWallTurns: 1, bloodlustTurns: 0 },
      items: [{ id: 'potion-1', type: 'potion', heal: 15, carried: true }],
    },
  });

  context.checkEmergencyPotion({ name: 'Goblin', atk: 4 }, 2, () => { afterCalled = true; });

  assert.strictEqual(afterCalled, true);
  assert.strictEqual(context.elements['emergency-overlay'].style.display, 'none');
});

test('bloodlust modifier is included in fatal-hit prompt math', () => {
  let afterCalled = false;
  const context = loadEmergency({
    G: {
      player: { hp: 6, maxHp: 20, shieldWallTurns: 0, bloodlustTurns: 1 },
      items: [{ id: 'potion-1', type: 'potion', heal: 15, carried: true }],
    },
  });

  context.checkEmergencyPotion({ name: 'Goblin', atk: 4 }, 10, () => { afterCalled = true; });

  assert.strictEqual(afterCalled, false);
  assert.strictEqual(context.elements['emergency-overlay'].style.display, 'flex');
});

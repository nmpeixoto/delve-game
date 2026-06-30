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
    fmtPct: value => `${context.fmt1(Number(value) * 100)}%`,
    addDamageDealt: amount => {
      context.G.player.damageDealt = context.round1((context.G.player.damageDealt || 0) + amount);
    },
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
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/combat.js'), 'utf8'), context);
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

test('attackEnemy ignores direct calls after the run has ended', () => {
  const context = loadCombat();
  context.G.gameOver = true;
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

  context.attackEnemy('goblin-1');

  assert.strictEqual(context.G.enemies[0].hp, 20);
  assert.strictEqual(context.G.player.damageDealt, 0);
  assert.strictEqual(context.G.turn, 0);

  context.G.gameOver = false;
  context.G.won = true;
  context.attackEnemy('goblin-1');

  assert.strictEqual(context.G.enemies[0].hp, 20);
  assert.strictEqual(context.G.player.damageDealt, 0);
  assert.strictEqual(context.G.turn, 0);
});

test('attackEnemy stores cumulative damage rounded to one decimal place', () => {
  const context = loadCombat({
    gatk: () => 2.1,
  });
  context.G.player.damageDealt = 496.1;
  context.G.enemies = [{
    id: 'goblin-1',
    name: 'Goblin',
    hp: 999,
    maxHp: 999,
    atk: 0,
    def: 0,
    xp: 6,
    gold: 4,
    x: 6,
    y: 5,
    stunnedTurns: 0,
  }];

  context.attackEnemy('goblin-1', 1, { skipCounter: true });

  assert.strictEqual(context.G.player.damageDealt, 498.2);
});

test('attackEnemy does not emit enemy hurt FX on a dodge', () => {
  const animations = [];
  const fx = [];
  const context = loadCombat({
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    setEntityAnimation: (key, name, durationMs) => animations.push({ key, name, durationMs }),
    spawnPixedFx: payload => fx.push(payload),
  });
  context.G.enemies = [{
    id: 'goblin-1',
    name: 'Goblin',
    hp: 20,
    maxHp: 20,
    atk: 4,
    def: 1,
    dodge: 1,
    xp: 6,
    gold: 4,
    x: 4,
    y: 5,
    stunnedTurns: 0,
  }];

  context.attackEnemy('goblin-1');

  assert.ok(animations.some(anim => anim.key === 'player' && anim.name === 'attack'));
  assert.ok(!animations.some(anim => anim.key === 'enemy:goblin-1' && anim.name === 'hurt'));
  assert.ok(!fx.some(entry => entry.key === 'fx.hit' && entry.text === 'hit'));
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

test('necromancer raise dead mark survives the setup turn', () => {
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

  assert.strictEqual(context.G.enemies[0].raiseCorpseTarget, true);
  assert.strictEqual(context.G.enemies[0].raiseCorpseTurns, 2);
});

test('necromancer raise dead turns the marked enemy into a temporary pet when it dies', () => {
  const context = loadCombat({
    setTimeout: fn => {
      fn();
      return 1;
    },
  });
  context.G.player.class = 'necromancer';
  context.G.enemies = [
    {
      id: 'marked',
      name: 'Marked Goblin',
      hp: 1,
      maxHp: 10,
      atk: 0,
      def: 0,
      xp: 6,
      gold: 4,
      x: 6,
      y: 5,
      stunnedTurns: 0,
      raiseCorpseTarget: true,
      raiseCorpseTurns: 2,
    },
    {
      id: 'adjacent',
      name: 'Adjacent Goblin',
      hp: 20,
      maxHp: 20,
      atk: 0,
      def: 0,
      xp: 6,
      gold: 4,
      x: 7,
      y: 5,
      stunnedTurns: 0,
    },
    {
      id: 'distant',
      name: 'Distant Goblin',
      hp: 20,
      maxHp: 20,
      atk: 0,
      def: 0,
      xp: 6,
      gold: 4,
      x: 10,
      y: 5,
      stunnedTurns: 0,
    },
  ];

  context.attackEnemy('marked');

  const pet = context.G.enemies.find(enemy => enemy.id === 'marked');
  const distant = context.G.enemies.find(enemy => enemy.id === 'distant');
  assert.strictEqual(pet.isPet, true);
  assert.strictEqual(pet.name, 'Pet Marked Goblin');
  assert.strictEqual(pet.hp, 5);
  assert.strictEqual(pet.maxHp, 5);
  assert.strictEqual(pet.lifespanTurns, 25);
  assert.strictEqual(pet.dying, false);
  assert.strictEqual(distant.hp, 20);
});

test('necromancer raise dead turns destroyed bones into a stable pet skeleton', () => {
  const context = loadCombat({
    setTimeout: fn => {
      fn();
      return 1;
    },
  });
  context.G.player.class = 'necromancer';
  context.G.player.hp = 40;
  context.G.player.maxHp = 40;
  context.G.visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6]);
  context.G.seen = new Set([5 * MAP_W + 5, 5 * MAP_W + 6]);
  context.G.enemies = [{
    id: 'skeleton',
    name: 'Skeleton',
    sym: 's',
    hp: 1,
    maxHp: 25,
    atk: 0,
    def: 0,
    xp: 10,
    gold: 6,
    color: '#e2e8f0',
    revive: true,
    x: 6,
    y: 5,
    stunnedTurns: 0,
    raiseCorpseTarget: true,
    raiseCorpseTurns: 3,
  }];

  context.attackEnemy('skeleton');

  const bones = context.G.enemies.find(enemy => enemy.id === 'skeleton');
  assert.strictEqual(bones.name, 'Bones');
  assert.strictEqual(bones.isPet, undefined);
  assert.strictEqual(bones.raiseCorpseTarget, true);

  context.attackEnemy('skeleton');

  const pet = context.G.enemies.find(enemy => enemy.id === 'skeleton');
  assert.strictEqual(pet.isPet, true);
  assert.strictEqual(pet.name, 'Pet Skeleton');
  assert.strictEqual(pet.sym, 's');
  assert.strictEqual(pet.color, '#a78bfa');
  assert.strictEqual(pet.revive, false);
  assert.strictEqual(pet.reviveTurns, 0);
  assert.strictEqual(pet.lifespanTurns, 25);
  assert.strictEqual(pet.dying, false);
});

test('collapsing a skeleton into bones does not counterattack', () => {
  const context = loadCombat();
  context.G.player.hp = 20;
  context.G.enemies = [{
    id: 'skeleton',
    name: 'Skeleton',
    sym: 's',
    hp: 1,
    maxHp: 25,
    atk: 12,
    def: 0,
    xp: 10,
    gold: 6,
    color: '#e2e8f0',
    revive: true,
    x: 6,
    y: 5,
    stunnedTurns: 0,
  }];

  context.attackEnemy('skeleton');

  const bones = context.G.enemies[0];
  assert.strictEqual(context.G.player.hp, 20);
  assert.strictEqual(context.G.turn, 1);
  assert.strictEqual(bones.name, 'Bones');
  assert.strictEqual(bones.hp, 0);
  assert.strictEqual(bones.reviveTurns, 1);
});

test('necromancer raise dead still works when the marked enemy dies during enemy processing', () => {
  let queuedDeathFlush = null;
  const context = loadCombat({
    setTimeout: fn => {
      queuedDeathFlush = fn;
      return 1;
    },
    clearTimeout: () => {},
  });
  context.G.player.class = 'necromancer';
  context.G.visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  context.G.seen = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  context.G.enemies = [
    {
      id: 'pet',
      name: 'Pet Skeleton',
      hp: 5,
      maxHp: 5,
      atk: 10,
      def: 0,
      x: 6,
      y: 5,
      isPet: true,
      lifespanTurns: 10,
      stunnedTurns: 0,
    },
    {
      id: 'marked',
      name: 'Marked Goblin',
      hp: 1,
      maxHp: 10,
      atk: 0,
      def: 0,
      xp: 6,
      gold: 4,
      x: 7,
      y: 5,
      stunnedTurns: 0,
      raiseCorpseTarget: true,
      raiseCorpseTurns: 1,
    },
  ];

  context.advanceTurn();
  assert.strictEqual(typeof queuedDeathFlush, 'function');
  queuedDeathFlush();

  const raised = context.G.enemies.find(enemy => enemy.id === 'marked');
  assert.strictEqual(raised.isPet, true);
  assert.strictEqual(raised.name, 'Pet Marked Goblin');
  assert.strictEqual(raised.dying, false);
});

test('raised pets attack visible hostile enemies instead of the player', () => {
  const context = loadCombat();
  context.G.player.hp = 20;
  context.G.visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  context.G.enemies = [
    {
      id: 'pet',
      name: 'Pet Goblin',
      hp: 5,
      maxHp: 5,
      atk: 4,
      def: 0,
      x: 6,
      y: 5,
      isPet: true,
      lifespanTurns: 10,
      stunnedTurns: 0,
    },
    {
      id: 'hostile',
      name: 'Hostile Goblin',
      hp: 20,
      maxHp: 20,
      atk: 0,
      def: 0,
      x: 7,
      y: 5,
      stunnedTurns: 0,
    },
  ];

  context.advanceTurn();

  const hostile = context.G.enemies.find(enemy => enemy.id === 'hostile');
  assert.strictEqual(hostile.hp, 16);
  assert.strictEqual(context.G.player.hp, 20);
});

test('hostile enemies can target raised pets before the player', () => {
  const context = loadCombat();
  context.G.player.hp = 20;
  context.G.visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6, 5 * MAP_W + 7]);
  context.G.enemies = [
    {
      id: 'hostile',
      name: 'Hostile Goblin',
      hp: 20,
      maxHp: 20,
      atk: 5,
      def: 0,
      x: 7,
      y: 5,
      stunnedTurns: 0,
    },
    {
      id: 'pet',
      name: 'Pet Goblin',
      hp: 20,
      maxHp: 20,
      atk: 0,
      def: 0,
      x: 6,
      y: 5,
      isPet: true,
      lifespanTurns: 10,
      stunnedTurns: 0,
    },
  ];

  context.advanceTurn();

  const pet = context.G.enemies.find(enemy => enemy.id === 'pet');
  assert.strictEqual(pet.hp, 15);
  assert.strictEqual(context.G.player.hp, 20);
});

test('raised pets follow then hold near the player when no hostile is visible', () => {
  const context = loadCombat();
  context.G.player.x = 5;
  context.G.player.y = 5;
  context.G.player.hp = 20;
  context.G.visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 8]);
  context.G.enemies = [{
    id: 'pet',
    name: 'Pet Goblin',
    hp: 5,
    maxHp: 5,
    atk: 4,
    def: 0,
    x: 8,
    y: 5,
    isPet: true,
    lifespanTurns: 10,
    stunnedTurns: 0,
  }];

  context.advanceTurn();

  const pet = context.G.enemies[0];
  assert.strictEqual(pet.x, 7);
  assert.strictEqual(pet.y, 5);
  assert.strictEqual(context.G.player.hp, 20);

  context.advanceTurn();

  assert.strictEqual(pet.x, 7);
  assert.strictEqual(pet.y, 5);
  assert.strictEqual(context.G.player.hp, 20);
});

test('players swap positions with adjacent raised pets instead of attacking them', () => {
  const context = loadCombat();
  context.G.player.x = 5;
  context.G.player.y = 5;
  context.G.visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 6]);
  context.G.enemies = [{
    id: 'pet',
    name: 'Pet Goblin',
    hp: 5,
    maxHp: 5,
    atk: 4,
    def: 0,
    x: 6,
    y: 5,
    isPet: true,
    lifespanTurns: 10,
    stunnedTurns: 0,
  }];

  context.tileAttack('pet');

  const pet = context.G.enemies[0];
  assert.strictEqual(context.G.player.x, 6);
  assert.strictEqual(context.G.player.y, 5);
  assert.strictEqual(pet.x, 5);
  assert.strictEqual(pet.y, 5);
  assert.strictEqual(pet.hp, 5);
});

test('raised pets crumble once and leave play when their lifespan expires', () => {
  let queuedDeathFlush = null;
  const logs = [];
  const animations = [];
  const fx = [];
  const context = loadCombat({
    addLog: msg => logs.push(msg),
    setEntityAnimation: (key, name, durationMs) => animations.push({ key, name, durationMs }),
    spawnPixedFx: payload => fx.push(payload),
    setTimeout: fn => {
      queuedDeathFlush = fn;
      return 1;
    },
    clearTimeout: () => {},
  });
  context.G.player.hp = 20;
  context.G.visible = new Set([5 * MAP_W + 5, 5 * MAP_W + 7]);
  context.G.enemies = [{
    id: 'pet',
    name: 'Pet Goblin',
    hp: 5,
    maxHp: 5,
    atk: 0,
    def: 0,
    x: 7,
    y: 5,
    isPet: true,
    lifespanTurns: 1,
    stunnedTurns: 0,
  }];

  context.advanceTurn();

  const pet = context.G.enemies[0];
  assert.strictEqual(pet.dying, true);
  assert.strictEqual(logs.filter(msg => msg.includes('crumbled to dust')).length, 1);
  assert.ok(animations.some(anim => anim.key === 'enemy:pet' && anim.name === 'death' && anim.durationMs === 420));
  assert.ok(fx.some(entry => entry.key === 'fx.hit' && entry.x === 7 && entry.y === 5 && entry.text === 'loot'));
  assert.strictEqual(typeof queuedDeathFlush, 'function');

  queuedDeathFlush();

  assert.strictEqual(context.G.enemies.some(enemy => enemy.id === 'pet'), false);
  assert.strictEqual(context.G.player.hp, 20);
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

test('monk flurry collapsing a skeleton into bones does not trigger a counterattack', () => {
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
        id: 'skeleton',
        name: 'Skeleton',
        sym: 's',
        hp: 1,
        maxHp: 25,
        atk: 12,
        def: 0,
        xp: 10,
        gold: 6,
        color: '#e2e8f0',
        revive: true,
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

  const bones = context.G.enemies[0];
  assert.strictEqual(context.G.player.hp, 20);
  assert.strictEqual(context.G.player.rootedTurns, 1);
  assert.strictEqual(context.G.turn, 1);
  assert.strictEqual(bones.name, 'Bones');
  assert.strictEqual(bones.hp, 0);
  assert.strictEqual(bones.reviveTurns, 1);
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

test('boss phase two summons avoid the boss occupied tile', () => {
  let nextId = 0;
  const context = loadCombat({
    rand: () => 1,
    uid: () => `summon-${++nextId}`,
    ENEMIES: [{
      name: 'Skeleton',
      sym: 's',
      hp: 8,
      atk: 3,
      def: 1,
      xp: 5,
      gold: 2,
      color: '#e2e8f0',
    }],
  });
  context.G.player.x = 5;
  context.G.player.y = 5;
  context.G.visible = new Set([5 * MAP_W + 5]);
  context.G.seen = new Set([5 * MAP_W + 5]);
  context.G.enemies = [{
    id: 'boss',
    name: 'Dungeon Lord',
    hp: 50,
    maxHp: 100,
    atk: 0,
    def: 0,
    xp: 250,
    gold: 150,
    x: 8,
    y: 5,
    boss: true,
    phase: 1,
    stunnedTurns: 0,
  }];

  context.advanceTurn();

  const summons = context.G.enemies.filter(enemy => enemy.id !== 'boss');
  assert.strictEqual(context.G.enemies.find(enemy => enemy.id === 'boss').phase, 2);
  assert.strictEqual(summons.length, 2);
  assert.strictEqual(summons.some(enemy => enemy.x === 8 && enemy.y === 5), false);
});

test('boss phase two respects configured normal-mode pressure knobs', () => {
  let nextId = 0;
  const context = loadCombat({
    rand: () => 1,
    uid: () => `summon-${++nextId}`,
    ENEMIES: [{
      name: 'Skeleton',
      sym: 's',
      hp: 8,
      atk: 3,
      def: 1,
      xp: 5,
      gold: 2,
      color: '#e2e8f0',
    }],
  });
  context.G.player.x = 5;
  context.G.player.y = 5;
  context.G.visible = new Set([5 * MAP_W + 5]);
  context.G.seen = new Set([5 * MAP_W + 5]);
  context.G.enemies = [{
    id: 'boss',
    name: 'Dungeon Lord',
    hp: 50,
    maxHp: 100,
    atk: 20,
    def: 8,
    xp: 250,
    gold: 150,
    x: 8,
    y: 5,
    boss: true,
    phase: 1,
    phaseAtkMult: 1.3,
    phaseDefMult: 1.25,
    phaseSummons: 1,
    stunnedTurns: 0,
  }];

  context.advanceTurn();

  const boss = context.G.enemies.find(enemy => enemy.id === 'boss');
  const summons = context.G.enemies.filter(enemy => enemy.id !== 'boss');
  assert.strictEqual(boss.phase, 2);
  assert.strictEqual(boss.atk, 26);
  assert.strictEqual(boss.def, 10);
  assert.strictEqual(summons.length, 1);
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
    round1: value => {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      return Math.round((n + Number.EPSILON) * 10) / 10;
    },
    fmt1: value => {
      const n = Math.round((Number(value) + Number.EPSILON) * 10) / 10;
      return Number.isInteger(n) ? `${n}` : n.toFixed(1);
    },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/items.js'), 'utf8'), context);
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

test('monk unarmed weapon power rounds up by level', () => {
  const context = loadItems();

  context.G.player.lvl = 1;
  assert.strictEqual(context.weaponPower(null), 1);

  context.G.player.lvl = 2;
  assert.strictEqual(context.weaponPower(null), 1);

  context.G.player.lvl = 3;
  assert.strictEqual(context.weaponPower(null), 2);
});

function loadAttackStats(overrides = {}) {
  const context = {
    G: {
      player: {
        class: 'warrior',
        lvl: 1,
        hp: 20,
        maxHp: 20,
        atk: 4,
        def: 1,
        weapon: null,
        armor: null,
        strengthTurns: 0,
      },
    },
    MAP_W,
    MAP_H,
    TILE,
    document: { getElementById: () => null, querySelector: () => null },
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
    fmtPct: value => `${context.fmt1(Number(value) * 100)}%`,
    getStat: () => 0,
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/items.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/render.js'), 'utf8'), context);
  return context;
}

test('combat attack stat excludes secondary weapon valuation bonuses', () => {
  const context = loadAttackStats();
  context.G.player.weapon = {
    name: 'Drain Blade',
    type: 'weapon',
    atk: 5,
    vampirism: 2,
    critChance: 0.25,
    dodgeBonus: 0.1,
  };

  assert.ok(vm.runInContext('weaponPower(G.player.weapon)', context) > 5);
  assert.strictEqual(vm.runInContext('gatk()', context), 9);
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

test('teleport scroll avoids isolated floor pockets that would strand the player', () => {
  const map = Array.from({ length: 8 }, () => Array(8).fill(TILE.WALL));
  map[1][1] = TILE.FLOOR;
  map[1][2] = TILE.FLOOR;
  map[1][3] = TILE.FLOOR;
  map[6][6] = TILE.FLOOR;

  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0.99;
  const context = loadItems({
    MAP_W: 8,
    MAP_H: 8,
    TILE,
    Math: deterministicMath,
    G: {
      player: {
        class: 'warrior',
        lvl: 1,
        x: 1,
        y: 1,
        hp: 20,
        maxHp: 20,
        weapon: null,
        armor: null,
        bestWeapon: 'Bare hands',
      },
      map,
      enemies: [],
      items: [{
        id: 'teleport-1',
        name: 'Scroll of Teleportation',
        type: 'scroll_teleport',
        carried: true,
      }],
    },
    addLog: () => {},
    floatText: () => {},
    computeVision: () => {},
    advanceTurn: () => {},
    closeInv: () => {},
  });

  context.useItem('teleport-1');

  assert.notDeepStrictEqual([context.G.player.x, context.G.player.y], [6, 6]);
  assert.strictEqual(context.G.player.y, 1);
  assert.ok([2, 3].includes(context.G.player.x));
});

test('teleport scroll prefers rooms without enemies', () => {
  const map = Array.from({ length: 10 }, () => Array(10).fill(TILE.WALL));
  for(let y=1; y<=3; y++) {
    for(let x=1; x<=3; x++) map[y][x] = TILE.FLOOR;
    for(let x=5; x<=7; x++) map[y][x] = TILE.FLOOR;
  }
  map[2][4] = TILE.FLOOR;

  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0.99;
  const context = loadItems({
    MAP_W: 10,
    MAP_H: 10,
    TILE,
    Math: deterministicMath,
    G: {
      player: {
        class: 'warrior',
        lvl: 1,
        x: 2,
        y: 2,
        hp: 20,
        maxHp: 20,
        weapon: null,
        armor: null,
        bestWeapon: 'Bare hands',
      },
      map,
      rooms: [
        { x: 1, y: 1, w: 3, h: 3 },
        { x: 5, y: 1, w: 3, h: 3 },
      ],
      enemies: [{
        id: 'enemy-room-goblin',
        name: 'Goblin',
        hp: 10,
        maxHp: 10,
        x: 6,
        y: 2,
      }],
      items: [{
        id: 'teleport-1',
        name: 'Scroll of Teleportation',
        type: 'scroll_teleport',
        carried: true,
      }],
    },
    addLog: () => {},
    floatText: () => {},
    computeVision: () => {},
    advanceTurn: () => {},
    closeInv: () => {},
  });

  context.useItem('teleport-1');

  assert.strictEqual(context.G.player.x >= 5 && context.G.player.x <= 7 && context.G.player.y >= 1 && context.G.player.y <= 3, false);
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
    ...overrides,
  };
  context.elements = elements;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/emergency.js'), 'utf8'), context);
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

test('fatal emergency hit with no potions logs why no prompt is shown', () => {
  let afterCalled = false;
  const logs = [];
  const context = loadEmergency({
    G: {
      player: { hp: 2, maxHp: 20, shieldWallTurns: 0, bloodlustTurns: 0 },
      items: [],
    },
    addLog: msg => logs.push(msg),
  });

  context.checkEmergencyPotion({ name: 'Goblin', atk: 8 }, 8, () => { afterCalled = true; });

  assert.strictEqual(afterCalled, true);
  assert.strictEqual(context.elements['emergency-overlay'].style.display, 'none');
  assert.ok(logs.includes('No potions available.'));
});

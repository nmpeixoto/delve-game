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

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    contains: token => set.has(token),
    add: token => set.add(token),
    remove: token => set.delete(token),
    toggle: (token, force) => {
      if (force === true) {
        set.add(token);
        return true;
      }
      if (force === false) {
        set.delete(token);
        return false;
      }
      if (set.has(token)) {
        set.delete(token);
        return false;
      }
      set.add(token);
      return true;
    },
  };
}

function createDomElement(overrides = {}) {
  return {
    style: { display: '', ...(overrides.style || {}) },
    classList: overrides.classList || createClassList(overrides.classTokens || []),
    addEventListener: overrides.addEventListener || (() => {}),
    getBoundingClientRect: overrides.getBoundingClientRect || (() => ({ left: 0, top: 0 })),
    closest: overrides.closest || (() => null),
    scrollIntoView: overrides.scrollIntoView || (() => {}),
    ...overrides,
  };
}

function loadInput(overrides = {}) {
  const calls = [];
  const elements = {
    'game-screen': createDomElement({ classList: createClassList([]) }),
    'title-screen': createDomElement({ classList: createClassList(['hidden']) }),
    'shop-overlay': createDomElement({ classList: createClassList([]) }),
    'help-overlay': createDomElement({ classList: createClassList([]), style: { display: 'none' } }),
    'inv-drawer': createDomElement({ classList: createClassList([]) }),
    'emergency-overlay': createDomElement({ classList: createClassList([]), style: { display: 'none' } }),
    'shrine-overlay': createDomElement({ classList: createClassList([]), style: { display: 'none' } }),
    'map-area': createDomElement(),
    'game-canvas': createDomElement(),
  };

  const document = {
    getElementById: id => elements[id] || createDomElement(),
    addEventListener: () => {},
  };

  let context = {
    MAP_W,
    MAP_H,
    TILE,
    Math,
    console,
    Set,
    clearInterval: id => calls.push(['clearInterval', id]),
    setInterval: () => 1,
    document,
    window: {},
    navigator: {},
    G: {
      gameOver: false,
      won: false,
      player: {
        x: 1,
        y: 1,
        class: 'warrior',
        weapon: null,
      },
      map: makeMap(),
      items: [],
      enemies: [],
    },
    move: (...args) => calls.push(['move', ...args]),
    tileAttack: id => calls.push(['attack', id]),
    tilePickup: id => calls.push(['pickup', id]),
    openShop: () => calls.push(['shop']),
    descend: () => calls.push(['descend']),
    openInv: () => calls.push(['inv']),
    openHelp: () => calls.push(['help']),
    doAbility1: () => calls.push(['ability1']),
    doAbility2: () => calls.push(['ability2']),
    screenToGrid: () => context._grid || { x: 0, y: 0 },
    PixedRenderer: { camera: {} },
    _grid: { x: 0, y: 0 },
    ...overrides,
  };

  if (!context.window) context.window = {};
  if (!context.PixedRenderer) context.PixedRenderer = { camera: {} };
  if (!context.screenToGrid) context.screenToGrid = () => context._grid || { x: 0, y: 0 };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/pathing.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/input.js'), 'utf8'), context);
  context.calls = calls;
  context.elements = elements;
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

test('clicking an unreachable enemy no longer resolves to tileAttack', () => {
  const context = loadInput({
    G: {
      gameOver: false,
      won: false,
      player: {
        x: 1,
        y: 1,
        class: 'warrior',
        weapon: null,
      },
      map: (() => {
        const map = makeMap(TILE.WALL);
        map[1][1] = TILE.FLOOR;
        map[3][3] = TILE.FLOOR;
        return map;
      })(),
      items: [],
      enemies: [{
        id: 'sealed-enemy',
        x: 3,
        y: 3,
        dying: false,
      }],
    },
    _grid: { x: 3, y: 3 },
    screenToGrid: () => ({ x: 3, y: 3 }),
  });

  context.handleCanvasPointer({
    button: 0,
    clientX: 0,
    clientY: 0,
    currentTarget: context.elements['game-canvas'],
  });

  assert.deepStrictEqual(context.calls, []);
});

test('clicking an enemy already in interaction range still resolves an empty path', () => {
  const context = loadInput({
    G: {
      gameOver: false,
      won: false,
      player: {
        x: 2,
        y: 1,
        class: 'warrior',
        weapon: null,
      },
      map: makeMap(),
      items: [],
      enemies: [{
        id: 'adjacent-enemy',
        x: 3,
        y: 1,
        dying: false,
      }],
    },
    _grid: { x: 3, y: 1 },
    screenToGrid: () => ({ x: 3, y: 1 }),
  });

  context.handleCanvasPointer({
    button: 0,
    clientX: 0,
    clientY: 0,
    currentTarget: context.elements['game-canvas'],
  });

  assert.deepStrictEqual(context.calls, [['attack', 'adjacent-enemy']]);
});

test('clicking an unreachable item no longer resolves to tilePickup', () => {
  const context = loadInput({
    G: {
      gameOver: false,
      won: false,
      player: {
        x: 1,
        y: 1,
        class: 'warrior',
        weapon: null,
      },
      map: (() => {
        const map = makeMap(TILE.WALL);
        map[1][1] = TILE.FLOOR;
        map[4][4] = TILE.FLOOR;
        return map;
      })(),
      items: [{
        id: 'sealed-item',
        x: 4,
        y: 4,
        carried: false,
      }],
      enemies: [],
    },
    _grid: { x: 4, y: 4 },
    screenToGrid: () => ({ x: 4, y: 4 }),
  });

  context.handleCanvasPointer({
    button: 0,
    clientX: 0,
    clientY: 0,
    currentTarget: context.elements['game-canvas'],
  });

  assert.deepStrictEqual(context.calls, []);
});

test('clicking an item already beside the player still resolves an empty path', () => {
  const context = loadInput({
    G: {
      gameOver: false,
      won: false,
      player: {
        x: 2,
        y: 1,
        class: 'warrior',
        weapon: null,
      },
      map: makeMap(),
      items: [{
        id: 'adjacent-item',
        x: 3,
        y: 1,
        carried: false,
      }],
      enemies: [],
    },
    _grid: { x: 3, y: 1 },
    screenToGrid: () => ({ x: 3, y: 1 }),
  });

  context.handleCanvasPointer({
    button: 0,
    clientX: 0,
    clientY: 0,
    currentTarget: context.elements['game-canvas'],
  });

  assert.deepStrictEqual(context.calls, [['pickup', 'adjacent-item']]);
});

test('clicking stairs on the current tile still resolves an empty path', () => {
  const context = loadInput({
    G: {
      gameOver: false,
      won: false,
      player: {
        x: 2,
        y: 2,
        class: 'warrior',
        weapon: null,
      },
      map: (() => {
        const map = makeMap(TILE.FLOOR);
        map[2][2] = TILE.STAIRS;
        return map;
      })(),
      items: [],
      enemies: [],
    },
    _grid: { x: 2, y: 2 },
    screenToGrid: () => ({ x: 2, y: 2 }),
  });

  context.handleCanvasPointer({
    button: 0,
    clientX: 0,
    clientY: 0,
    currentTarget: context.elements['game-canvas'],
  });

  assert.deepStrictEqual(context.calls, [['descend']]);
});

test('manualMove cancels an active path before moving', () => {
  const context = loadInput();
  vm.runInContext('_pathTimer = 17', context);

  context.manualMove(1, 0);

  assert.deepStrictEqual(context.calls, [['clearInterval', 17], ['move', 1, 0]]);
});

test('manualAbility1 cancels an active path and preserves long-press suppression', () => {
  const context = loadInput();
  context.window._lpFiredUI = true;
  vm.runInContext('_pathTimer = 29', context);

  context.manualAbility1();

  assert.deepStrictEqual(context.calls, [['clearInterval', 29]]);
  assert.strictEqual(context.window._lpFiredUI, false);
});

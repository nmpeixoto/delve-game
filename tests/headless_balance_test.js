const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRuntime, runSingle } = require('../automation/headless-balance/headless_balance');

function loadShrineUiContext() {
  const elements = new Map();
  const makeElement = id => {
    const listeners = {};
    return {
      id,
      style: { display: '', left: '', top: '' },
      classList: {
        add() {},
        remove() {},
        contains() { return false; },
        toggle() {},
      },
      textContent: '',
      innerHTML: '',
      addEventListener(type, fn) {
        listeners[type] = fn;
      },
      click() {
        if (listeners.click) listeners.click();
      },
    };
  };

  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    addEventListener() {},
  };

  const context = {
    document,
    window: {},
    navigator: { vibrate() {} },
    G: {
      player: { hp: 120, maxHp: 120, atk: 4, x: 5, y: 5 },
      items: [],
      floor: 1,
      log: [],
      enemies: [],
    },
    fmt1: n => String(Math.round(n)),
    round1: n => Math.round(n * 10) / 10,
    floatText: () => {},
    flashDamage: () => {},
    addLog: () => {},
    advanceTurn: () => {},
    getFloorEnemyProfile: () => ({ tierMin: 0, tierMax: 0, scale: 1 }),
    rr: (a) => a,
    ENEMIES: [{ hp: 1, atk: 1, def: 0, xp: 1, gold: 1, name: 'Slime' }],
    MAP_W: 10,
    MAP_H: 10,
    TILE: { FLOOR: 1 },
    uid: () => 'uid-1',
    SFX: { hit() {}, levelUp() {} },
    Set,
    Math,
  };

  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/ui.js'), 'utf8'), context);
  return { context, document };
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

test('headless runner does not crash when the bot reaches a shrine', () => {
  const result = runSingle({
    className: 'warrior',
    seed: 7000,
    maxTurns: 160,
    trace: false,
    verbose: false,
  });

  assert.strictEqual(
    result.errors.includes('showShrinePrompt is not defined'),
    false,
    JSON.stringify(result, null, 2)
  );
});

test('headless runner lets the shared bot decide shrine prompts', () => {
  const runtime = createRuntime(1, { verbose: false });
  const { context, document, interpretDecision, flushTimers } = runtime;
  context.initGame('warrior');
  flushTimers();
  context.G.player.gold = 25;
  context.G.player.lvl = 1;
  const shrine = {
    id: 'headless-greed-shrine',
    name: 'Greed Shrine',
    type: 'shrine',
    shrineType: 'Greed',
    x: context.G.player.x,
    y: context.G.player.y,
  };
  context.G.items.push(shrine);

  context.showShrinePrompt(shrine);

  assert.strictEqual(document.getElementById('shrine-overlay').style.display, 'flex');
  const decision = context.window.botDecisionLogic();
  assert.strictEqual(decision.type, 'click');
  assert.strictEqual(decision.target, '#shrine-accept-btn');

  interpretDecision(decision);

  assert.strictEqual(document.getElementById('shrine-overlay').style.display, 'none');
  assert.strictEqual(context.G.player.gold, 0);
  assert.strictEqual(context.G.player.lvl, 3);
  assert.strictEqual(context.G.items.some(item => item.id === shrine.id), false);
});

test('blood shrine scales the attack payout with the sacrifice', () => {
  const { context, document } = loadShrineUiContext();
  const initialAtk = context.G.player.atk;

  const shrine = {
    id: 'ui-blood-shrine',
    name: 'Blood Shrine',
    type: 'shrine',
    shrineType: 'Blood',
    x: context.G.player.x,
    y: context.G.player.y,
  };
  context.G.items.push(shrine);

  context.showShrinePrompt(shrine);

  const shrineMsg = document.getElementById('shrine-msg').textContent;
  assert.ok(shrineMsg.includes('36 Max HP'));
  assert.ok(shrineMsg.includes('+3 ATK'));

  document.getElementById('shrine-accept-btn').click();

  assert.strictEqual(context.G.player.maxHp, 84);
  assert.strictEqual(context.G.player.atk, initialAtk + 3);
  assert.strictEqual(context.G.items.some(item => item.id === shrine.id), false);
});

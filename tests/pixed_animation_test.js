const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadAnimation() {
  const context = { performance: { now: () => 1000 }, Math };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/animation.js'), 'utf8'), context);
  return context;
}

function loadRenderContext() {
  const calls = { advance: 0, scene: 0 };
  const context = {
    G: {},
    MAP_W: 56,
    MAP_H: 36,
    TILE: {},
    performance: { now: () => 1000 },
    Math,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/render.js'), 'utf8'), context);
  context.drawMinimap = () => {};
  context.updateHUD = () => {};
  context.updateInvDrawer = () => {};
  context.updateActBtns = () => {};
  context.renderPixedScene = () => { calls.scene += 1; };
  context.advanceAnimations = () => { calls.advance += 1; };
  context.__calls = calls;
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

test('setEntityAnimation stores animation state by stable entity key', () => {
  const context = loadAnimation();
  context.setEntityAnimation('enemy:goblin-1', 'attack', 250);
  assert.strictEqual(context.getEntityAnimation('enemy:goblin-1').name, 'attack');
  assert.strictEqual(context.getEntityAnimation('enemy:goblin-1').durationMs, 250);
});

test('advanceAnimations clears expired entity animations', () => {
  const context = loadAnimation();
  context.setEntityAnimation('player', 'hurt', 100);
  context.advanceAnimations(1200);
  assert.strictEqual(context.getEntityAnimation('player'), null);
});

test('spawnPixedFx creates expiring effects with grid coordinates', () => {
  const context = loadAnimation();
  const id = context.spawnPixedFx({ key: 'fx.hit', x: 4, y: 5, durationMs: 200 });
  assert.ok(context.PIXED_ANIM.fx.some(fx => fx.id === id && fx.key === 'fx.hit' && fx.x === 4 && fx.y === 5));
  context.advanceAnimations(1300);
  assert.strictEqual(context.PIXED_ANIM.fx.length, 0);
});

test('resetPixedAnimations clears state and rewinds fx ids', () => {
  const context = loadAnimation();
  context.setEntityAnimation('player', 'attack', 180);
  const firstFx = context.spawnPixedFx({ key: 'fx.hit', x: 1, y: 2, durationMs: 250 });
  assert.strictEqual(firstFx, 'fx-1');
  context.resetPixedAnimations();
  assert.strictEqual(Object.keys(context.PIXED_ANIM.entities).length, 0);
  assert.strictEqual(context.PIXED_ANIM.fx.length, 0);
  const nextFx = context.spawnPixedFx({ key: 'fx.hit', x: 3, y: 4, durationMs: 250 });
  assert.strictEqual(nextFx, 'fx-1');
});

test('render advances animation state once per frame', () => {
  const context = loadRenderContext();
  context.render();
  assert.strictEqual(context.__calls.advance, 1);
  assert.strictEqual(context.__calls.scene, 1);
});

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

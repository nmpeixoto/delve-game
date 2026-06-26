const assert = require('assert');
const { createRuntime } = require('../automation/headless_rl_runner');

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

test('preserves pending emergency hit until explicit emergency action resolves it', () => {
  const runtime = createRuntime(123);
  runtime.context.initGame('warrior');
  runtime.flushTimers();

  const G = runtime.context.G;
  const potion = {
    id: 'test-potion',
    name: 'Health Potion',
    type: 'potion',
    carried: true,
    heal: 15,
  };
  G.player.hp = 5;
  G.player.maxHp = 20;
  G.items.push(potion);
  G.pendingHit = {
    dmg: 12,
    potionChain: [potion],
    afterFn: () => {
      G.player.hp = Math.max(0, G.player.hp - 12);
      if (G.player.hp <= 0) G.gameOver = true;
    },
  };

  const pending = runtime.captureSnapshot().pendingHit;
  assert.deepStrictEqual(pending, {
    dmg: 12,
    potionChain: ['test-potion'],
  });

  runtime.interpretDecision({ type: 'emergency', drink: true });
  runtime.flushTimers();

  const after = runtime.captureSnapshot();
  assert.strictEqual(after.pendingHit, null);
  assert.strictEqual(after.player.hp, 8);
  assert.strictEqual(after.items.some(item => item.id === 'test-potion'), false);
});

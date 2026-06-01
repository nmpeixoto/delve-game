const assert = require('assert');
const { createRuntime, runSingle } = require('./skills/headless-balance/scripts/headless_balance');

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

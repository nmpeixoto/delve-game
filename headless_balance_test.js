const assert = require('assert');
const { runSingle } = require('./skills/headless-balance/scripts/headless_balance');

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

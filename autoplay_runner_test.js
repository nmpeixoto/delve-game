const assert = require('assert');
const { isRetryableStartupResult, hasActionResolved } = require('./autoplay_test');

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

test('retries zero-turn startup failures from transient browser/server errors', () => {
  assert.strictEqual(isRetryableStartupResult({
    status: 'fatal_script_error',
    turns: 0,
    errors: ['Waiting for selector `#class-select-overlay` failed'],
  }), true);

  assert.strictEqual(isRetryableStartupResult({
    status: 'error',
    turns: 0,
    errors: ['[Error]: Failed to load resource: net::ERR_CONNECTION_REFUSED'],
  }), true);
});

test('does not retry real gameplay failures or clean terminal outcomes', () => {
  assert.strictEqual(isRetryableStartupResult({
    status: 'dead',
    turns: 42,
    errors: [],
  }), false);

  assert.strictEqual(isRetryableStartupResult({
    status: 'error',
    turns: 10,
    errors: ['[Exception]: real runtime failure'],
  }), false);
});

test('resolves free movement even when the turn counter does not advance', () => {
  assert.strictEqual(hasActionResolved({
    turn: 12,
    floor: 1,
    x: 10,
    y: 10,
    hp: 20,
    ability1Cooldown: 3,
    ability2Cooldown: 0,
    enemyState: '1:5:10,11:0',
  }, {
    turn: 12,
    floor: 1,
    x: 10,
    y: 9,
    hp: 20,
    ability1Cooldown: 3,
    ability2Cooldown: 0,
    enemyState: '1:5:10,11:0',
  }), true);
});

test('does not resolve an unchanged action snapshot', () => {
  const snapshot = {
    turn: 12,
    floor: 1,
    x: 10,
    y: 10,
    hp: 20,
    ability1Cooldown: 3,
    ability2Cooldown: 0,
    enemyState: '1:5:10,11:0',
  };
  assert.strictEqual(hasActionResolved(snapshot, { ...snapshot }), false);
});

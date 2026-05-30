const assert = require('assert');
const { isRetryableStartupResult } = require('./autoplay_test');

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

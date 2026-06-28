const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src/index.html'), 'utf8');

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

test('source HTML includes the pixed canvas inside the map area', () => {
  assert.ok(html.includes('<canvas id="game-canvas"'));
  assert.ok(html.indexOf('<canvas id="game-canvas"') > html.indexOf('<div id="map-area">'));
});

test('source HTML loads pixed modules before render and input modules', () => {
  const order = [
    'js/iso.js',
    'js/pathing.js',
    'js/assets.js',
    'js/animation.js',
    'js/canvas-renderer.js',
    'js/render.js',
    'js/input.js',
  ].map(src => html.indexOf(`src="${src}"`));

  for (const index of order) assert.ok(index > -1, `missing script index ${index}`);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `script order wrong at ${i}`);
});

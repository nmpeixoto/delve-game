const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src/index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src/js/canvas-renderer.js'), 'utf8');
const fx = fs.readFileSync(path.join(__dirname, '..', 'src/js/fx.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src/css/style.css'), 'utf8');
const pwa = fs.readFileSync(path.join(__dirname, '..', 'src/js/pwa.js'), 'utf8');

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

test('pixed renderer scales detailed sprites and outlines canvas combat text', () => {
  assert.ok(renderer.includes('function drawPixedImageScaled'));
  assert.ok(renderer.includes('getPixedDrawableScale'));
  assert.ok(renderer.includes('drawPixedFloatingText'));
  assert.ok(renderer.includes('strokeText(text'));
});

test('pixed HUD uses stable readable control text sizing', () => {
  assert.ok(css.includes('#game-screen{position:fixed;inset:0;z-index:10;display:flex;flex-direction:column;padding-bottom:108px;}'));
  assert.ok(css.includes('.act-btn{font-family:\'Press Start 2P\',monospace;font-size:10px'));
  assert.ok(css.includes('white-space:pre-line'));
  assert.ok(/return;\s*}\s*const p = getFxPoint/.test(fx));
});

test('install banner is hidden while a run is active', () => {
  assert.ok(pwa.includes('function syncInstallBanner'));
  assert.ok(pwa.includes("!game.classList.contains('hidden')"));
  assert.ok(pwa.includes("attributeFilter:['class']"));
});

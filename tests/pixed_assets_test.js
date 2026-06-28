const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const manifestPath = path.join(repoRoot, 'src/assets/pixed/pixed_manifest.json');

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

const requiredKeys = [
  'environment.floor',
  'environment.floorCracked',
  'environment.wall',
  'environment.doorLocked',
  'environment.doorSecret',
  'environment.stairs',
  'environment.shop',
  'environment.shrine',
  'environment.trapSpike',
  'environment.trapGas',
  'environment.trapAlarm',
  'environment.trapBear',
  'item.weapon',
  'item.armor',
  'item.potion',
  'item.bomb',
  'item.scroll',
  'item.key',
  'item.upgrade',
  'ui.hp',
  'ui.xp',
  'ui.gold',
  'fx.hit',
  'fx.fireball',
  'fx.heal',
  'fx.poison',
  'fx.levelUp',
  ...['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk'].flatMap(cls =>
    ['idle', 'walk', 'attack', 'hurt', 'death'].map(anim => `class.${cls}.${anim}`)
  ),
  ...['rat', 'goblin', 'skeleton', 'bones', 'orc', 'troll', 'demon', 'lich', 'dungeonLord'].flatMap(enemy =>
    ['idle', 'move', 'attack', 'hurt', 'death'].map(anim => `enemy.${enemy}.${anim}`)
  ),
];

test('pixed manifest contains every required first-pass asset key', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const key of requiredKeys) {
    assert.ok(manifest[key], `missing ${key}`);
    assert.strictEqual(typeof manifest[key].src, 'string', `missing src for ${key}`);
    assert.strictEqual(typeof manifest[key].frameWidth, 'number', `missing frameWidth for ${key}`);
    assert.strictEqual(typeof manifest[key].frameHeight, 'number', `missing frameHeight for ${key}`);
    assert.strictEqual(typeof manifest[key].frames, 'number', `missing frames for ${key}`);
  }
});

test('every manifest source file exists under src/assets/pixed', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const [key, value] of Object.entries(manifest)) {
    const assetPath = path.join(repoRoot, 'src/assets/pixed', value.src);
    assert.ok(fs.existsSync(assetPath), `${key} source missing: ${value.src}`);
    assert.ok(fs.statSync(assetPath).size > 40, `${key} source is empty: ${value.src}`);
  }
});

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCombat(overrides = {}) {
  const context = {
    G: {
      player: {
        hp: 20,
        maxHp: 20,
        atk: 4,
        def: 1,
        xp: 0,
        kills: 0,
        gold: 0,
        damageDealt: 0,
      },
      enemies: [],
      bashCooldown: 0,
      gameOver: false,
      won: false,
      visible: new Set(),
    },
    MAP_W: 28,
    MAP_H: 18,
    gatk: () => 4,
    gdef: () => 1,
    rand: () => 0,
    ch: () => false,
    SFX: {
      hit: () => {},
      bash: () => {},
      damage: () => {},
      enemyDeath: () => {},
      levelUp: () => {},
    },
    floatText: () => {},
    addLog: () => {},
    fireTip: () => {},
    render: () => {},
    advanceTurn: () => {},
    checkLevelUp: () => {},
    checkEmergencyPotion: (_enemy, _dmg, afterFn) => afterFn(),
    setTimeout: () => {
      throw new Error('dying enemies should not schedule another removal');
    },
    Math,
    Set,
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'src/js/combat.js'), 'utf8'), context);
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

test('attackEnemy ignores enemies already marked dying', () => {
  const context = loadCombat();
  context.G.enemies = [{
    id: 'goblin-1',
    name: 'Goblin',
    hp: -3,
    maxHp: 10,
    atk: 4,
    def: 1,
    xp: 6,
    gold: 4,
    x: 4,
    y: 5,
    dying: true,
  }];

  context.attackEnemy('goblin-1');

  assert.strictEqual(context.G.player.kills, 0);
  assert.strictEqual(context.G.player.xp, 0);
  assert.strictEqual(context.G.player.gold, 0);
  assert.strictEqual(context.G.player.damageDealt, 0);
  assert.strictEqual(context.G.enemies.length, 1);
});

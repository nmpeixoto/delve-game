const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

function loadScreenContext() {
  const elements = [];
  const initialG = {
    floor: 2,
    turn: 677,
    hardMode: false,
    player: {
      lvl: 5,
      kills: 24,
      damageDealt: 498.20000000000004,
      bestWeapon: 'Skull Rod (ATK+5)',
      gold: 329,
    },
  };
  const context = {
    initialG,
    SFX: { playerDeath: () => {} },
    document: {
      createElement: () => ({ className: '', innerHTML: '' }),
      body: {
        appendChild: el => elements.push(el),
      },
    },
    window: { addEventListener: () => {} },
    render: () => {},
  };

  context.elements = elements;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/state.js'), 'utf8'), context);
  vm.runInContext('G = initialG;', context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/main.js'), 'utf8'), context);
  return context;
}

test('death summary limits damage dealt to one decimal place', () => {
  const context = loadScreenContext();

  context.showDeath();

  assert.ok(context.elements[0].innerHTML.includes('Damage dealt: <span>498.2</span>'));
  assert.strictEqual(context.elements[0].innerHTML.includes('498.20000000000004'), false);
});

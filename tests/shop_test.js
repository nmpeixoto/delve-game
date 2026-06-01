const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadShopContext(overrides = {}) {
  const elements = {
    'shop-gold-val': { textContent: '', innerHTML: '' },
    'sell-items': { innerHTML: '' },
    'shop-items': { innerHTML: '' },
    'tab-buy': { classList: { toggle: () => {} } },
    'tab-sell': { classList: { toggle: () => {} } },
    'shop-buy-panel': { style: { display: '' } },
    'shop-sell-panel': { style: { display: '' } },
    'shop-overlay': { classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false } },
  };

  const context = {
    G: {
      player: {
        class: 'warrior',
        lvl: 3,
        gold: 0,
        weapon: { id: 'current-weapon', name: 'Short Sword', type: 'weapon', atk: 4 },
        armor: { id: 'current-armor', name: 'Leather Vest', type: 'armor', def: 2 },
      },
      items: [],
    },
    getStat: (statName) => {
      let base = context.G.player[statName] || 0;
      let w = context.G.player.weapon ? (context.G.player.weapon[statName] || 0) : 0;
      let a = context.G.player.armor ? (context.G.player.armor[statName] || 0) : 0;
      return base + w + a;
    },
    _lastAction: 0,
    addLog: () => {},
    floatText: () => {},
    fireTip: () => {},
    updateBestWeapon: () => {},
    renderSellPanel: () => {},
    renderShop: () => {},
    updateHUD: () => {},
    updateActBtns: () => {},
    SFX: { buy: () => {}, sell: () => {} },
    document: {
      getElementById: id => elements[id] || { textContent: '', innerHTML: '', style: {}, classList: { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false } },
    },
    Math,
    Set,
    ...overrides,
  };

  context.canAct = overrides.canAct || (() => {
    const now = Date.now();
    if (now - context._lastAction < 400) return false;
    context._lastAction = now;
    return true;
  });

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/items.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/js/shop.js'), 'utf8'), context);
  context.renderSellPanel = () => {};
  context.renderShop = () => {};
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

test('sellWeakerGear keeps level-locked upgrades that are stronger than current gear', () => {
  const context = loadShopContext();
  context.G.items = [
    {
      id: 'future-sword',
      name: 'Steel Glaive',
      type: 'weapon',
      atk: 9,
      price: 80,
      reqLvl: 6,
      carried: true,
    },
    {
      id: 'future-armor',
      name: 'Mithril Shirt',
      type: 'armor',
      def: 7,
      price: 80,
      reqLvl: 6,
      carried: true,
    },
  ];

  context.sellWeakerGear();

  assert.strictEqual(context.G.player.gold, 0);
  assert.strictEqual(context.G.items.length, 2);
  assert.strictEqual(context.G.items.some(item => item.id === 'future-sword'), true);
  assert.strictEqual(context.G.items.some(item => item.id === 'future-armor'), true);
});

test('opening the merchant clears the action lock so sell-all works immediately', () => {
  const context = loadShopContext();
  context.G.shops = [{ x: 5, y: 5, stock: [] }];
  context.G.player.x = 5;
  context.G.player.y = 5;
  context.G.items = [
    {
      id: 'old-sword',
      name: 'Rusty Sword',
      type: 'weapon',
      atk: 2,
      price: 10,
      carried: true,
    },
  ];

  context._lastAction = Date.now();
  context.openShop();
  context.sellWeakerGear();

  assert.strictEqual(context.G.currentShop, context.G.shops[0]);
  assert.strictEqual(context.G.player.gold, 5);
  assert.strictEqual(context.G.items.length, 0);
});

test('shop actions opt into the shop overlay action guard', () => {
  const context = loadShopContext({
    canAct: opts => opts && opts.allowShopOverlay === true,
    uid: () => 'new-item-id',
  });
  context.G.player.gold = 100;
  context.G.currentShop = {
    x: 5,
    y: 5,
    stock: [{
      id: 'shop-potion',
      name: 'Health Potion',
      type: 'potion',
      heal: 15,
      sym: '!',
      rarity: 'common',
      price: 25,
      sold: false,
    }],
  };
  context.G.items = [{
    id: 'sell-potion',
    name: 'Sell Potion',
    type: 'potion',
    heal: 15,
    sym: '!',
    rarity: 'common',
    price: 20,
    carried: true,
  }];

  context.buyItem('shop-potion');

  assert.strictEqual(context.G.player.gold, 75);
  assert.strictEqual(context.G.currentShop.stock[0].sold, true);
  assert.strictEqual(context.G.items.filter(item => item.carried).length, 2);

  context.sellItem('sell-potion', '');

  assert.strictEqual(context.G.player.gold, 85);
  assert.strictEqual(context.G.items.some(item => item.id === 'sell-potion'), false);
});

test('buyItem carries special consumables instead of only marking them sold', () => {
  let nextId = 0;
  const context = loadShopContext({
    canAct: opts => opts && opts.allowShopOverlay === true,
    uid: () => `new-special-${++nextId}`,
  });
  context.G.player.gold = 600;
  context.G.currentShop = {
    x: 5,
    y: 5,
    stock: [
      {
        id: 'shop-strength',
        name: 'Potion of Giant Strength',
        type: 'potion_buff',
        buff: 'strength',
        price: 75,
        sold: false,
      },
      {
        id: 'shop-bomb',
        name: 'Bomb',
        type: 'bomb',
        price: 120,
        sold: false,
      },
      {
        id: 'shop-teleport',
        name: 'Scroll of Teleportation',
        type: 'scroll_teleport',
        price: 150,
        sold: false,
      },
      {
        id: 'shop-detect',
        name: 'Scroll of Detection',
        type: 'scroll',
        price: 200,
        sold: false,
      },
    ],
  };

  context.buyItem('shop-strength');
  context.buyItem('shop-bomb');
  context.buyItem('shop-teleport');
  context.buyItem('shop-detect');

  assert.strictEqual(context.G.player.gold, 55);
  assert.strictEqual(context.G.currentShop.stock.every(item => item.sold), true);
  assert.strictEqual(context.G.items.filter(item => item.carried && item.type === 'potion_buff').length, 1);
  assert.strictEqual(context.G.items.filter(item => item.carried && item.type === 'bomb').length, 1);
  assert.strictEqual(context.G.items.filter(item => item.carried && item.type === 'scroll_teleport').length, 1);
  assert.strictEqual(context.G.items.filter(item => item.carried && item.type === 'scroll').length, 1);
});

test('perception upgrades permanently increase the perception stat', () => {
  const context = loadShopContext();
  context.G.player.perception = 0;
  context.G.player.x = 5;
  context.G.player.y = 5;

  context.applyUpgrade({
    id: 'kit',
    name: "Dungeoneer's Kit",
    type: 'upgrade',
    stat: 'perception',
    amount: 1,
  });

  assert.strictEqual(context.G.player.perception, 1);
});

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '../../');
const DEFAULT_CLASSES = [
  'warrior',
  'rogue',
  'mage',
  'paladin',
  'ranger',
  'barbarian',
  'necromancer',
  'monk',
];

const SOURCE_FILES = [
  'src/js/constants.js',
  'src/js/data.js',
  'src/js/main.js',
  'src/js/state.js',
  'src/js/vision.js',
  'src/js/emergency.js',
  'src/js/movement.js',
  'src/js/items.js',
  'src/js/combat.js',
  'src/js/shop.js',
  'src/js/map.js',
  'automation/bot_brain.js',
].map(rel => path.join(REPO_ROOT, rel));

const COMPILED_SCRIPTS = SOURCE_FILES.map(file => ({
  file,
  script: new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }),
}));

function parseArgs(argv) {
  const out = {
    classes: DEFAULT_CLASSES.join(','),
    perClass: 20,
    seedBase: 1,
    maxTurns: 5000,
    output: '',
    trace: false,
    verbose: false,
    help: false,
  };

  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--classes' || arg === '-c') {
      out.classes = argv[++i] || '';
    } else if (arg.startsWith('--classes=')) {
      out.classes = arg.slice(10);
    } else if (arg === '--class') {
      out.classes = argv[++i] || '';
    } else if (arg.startsWith('--class=')) {
      out.classes = arg.slice(8);
    } else if (arg === '--per-class') {
      out.perClass = parseInt(argv[++i], 10);
    } else if (arg.startsWith('--per-class=')) {
      out.perClass = parseInt(arg.slice(12), 10);
    } else if (arg === '--seed-base') {
      out.seedBase = parseInt(argv[++i], 10);
    } else if (arg.startsWith('--seed-base=')) {
      out.seedBase = parseInt(arg.slice(12), 10);
    } else if (arg === '--max-turns') {
      out.maxTurns = parseInt(argv[++i], 10);
    } else if (arg.startsWith('--max-turns=')) {
      out.maxTurns = parseInt(arg.slice(12), 10);
    } else if (arg === '--output') {
      out.output = argv[++i] || '';
    } else if (arg.startsWith('--output=')) {
      out.output = arg.slice(9);
    } else if (arg === '--trace') {
      out.trace = true;
    } else if (arg === '--verbose' || arg === '-v') {
      out.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else {
      positional.push(arg);
    }
  }

  if ((!out.classes || !out.classes.trim()) && positional.length) {
    out.classes = positional.shift();
  }
  if (positional.length && /^\d+$/.test(positional[0])) {
    out.perClass = parseInt(positional.shift(), 10);
  }
  if (positional.length && /^\d+$/.test(positional[0])) {
    out.seedBase = parseInt(positional.shift(), 10);
  }
  if (positional.length && /^\d+$/.test(positional[0])) {
    out.maxTurns = parseInt(positional.shift(), 10);
  }

  if (!out.classes || out.classes.trim() === 'all') {
    out.classes = DEFAULT_CLASSES.join(',');
  }

  out.classList = out.classes
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  if (!out.classList.length) out.classList = [...DEFAULT_CLASSES];
  return out;
}

function printUsage() {
  console.log([
    'Usage:',
    '  node automation/headless-balance/headless_balance.js --classes warrior,rogue --per-class 20 --seed-base 1 --max-turns 5000 --output bot_findings.json',
    '',
    'Flags:',
    '  --classes, --class   Comma-separated class list',
    '  --per-class          Runs per class',
    '  --seed-base          Starting seed',
    '  --max-turns          Step cap per run',
    '  --output             Write JSON report',
    '  --trace              Include per-step traces',
    '  --verbose            Print per-run progress',
  ].join('\n'));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, '');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class FakeClassList {
  constructor() {
    this._set = new Set();
  }

  setFromString(value) {
    this._set = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  add(...classes) {
    classes.flat().filter(Boolean).forEach(cls => this._set.add(String(cls)));
    return this;
  }

  remove(...classes) {
    classes.flat().filter(Boolean).forEach(cls => this._set.delete(String(cls)));
    return this;
  }

  contains(cls) {
    return this._set.has(String(cls));
  }

  toggle(cls, force) {
    const key = String(cls);
    if (force === true) {
      this._set.add(key);
      return true;
    }
    if (force === false) {
      this._set.delete(key);
      return false;
    }
    if (this._set.has(key)) {
      this._set.delete(key);
      return false;
    }
    this._set.add(key);
    return true;
  }

  toString() {
    return [...this._set].join(' ');
  }
}

class FakeElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = String(tagName).toUpperCase();
    this.style = { display: '', transform: '', left: '', top: '', width: '', height: '' };
    this.dataset = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.scrollTop = 0;
    this.clientWidth = 1280;
    this.clientHeight = 800;
    this.offsetWidth = 1280;
    this.offsetHeight = 800;
    this.attributes = {};
    this._innerHTML = '';
    this._textContent = '';
    this._removed = false;
  }

  set className(value) {
    this.classList.setFromString(value);
  }

  get className() {
    return this.classList.toString();
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    this._textContent = stripTags(this._innerHTML);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this._innerHTML = escapeHtml(this._textContent);
  }

  get textContent() {
    return this._textContent;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = value;
    if (name === 'id') this.id = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  addEventListener() {}
  removeEventListener() {}

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  remove() {
    this._removed = true;
  }

  closest() {
    return null;
  }

  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight,
    };
  }

  click() {
    if (typeof this.onclick === 'function') {
      this.onclick({ target: this, preventDefault() {}, stopPropagation() {} });
    }
  }
}

function createDocument(state) {
  const elements = new Map();
  const body = new FakeElement('body', 'body');

  function configureElement(id, element) {
    switch (id) {
      case 'emergency-overlay':
      case 'help-overlay':
      case 'shrine-overlay':
      case 'death-modal':
      case 'victory-modal':
        element.style.display = 'none';
        break;
      default:
        break;
    }
    if (id === 'map-area') {
      element.clientWidth = 1280;
      element.clientHeight = 800;
      element.offsetWidth = 1280;
      element.offsetHeight = 800;
    }
    return element;
  }

  function ensureElement(id) {
    if (!elements.has(id)) {
      elements.set(id, configureElement(id, new FakeElement(id)));
    }
    return elements.get(id);
  }

  const document = {
    body,
    createElement: tag => new FakeElement('', tag),
    getElementById: id => ensureElement(id),
    querySelector: selector => {
      if (selector === '.modal.death') return state.deathShown || state.gameOver ? ensureElement('death-modal') : null;
      if (selector === '.modal.victory') return state.victoryShown || state.won ? ensureElement('victory-modal') : null;
      if (selector && selector.startsWith('#')) return ensureElement(selector.slice(1));
      return null;
    },
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };

  return { document, ensureElement, elements };
}

function createRuntime(seed, options = {}) {
  const random = mulberry32(seed);
  const baseNow = 1700000000000 + seed;
  const timerQueue = [];
  let nextTimerId = 1;
  let now = 0;
  const state = {
    deathShown: false,
    victoryShown: false,
    gameOver: false,
    won: false,
  };

  const { document, ensureElement } = createDocument(state);

  function schedule(fn, delay = 0, ...args) {
    const id = nextTimerId++;
    timerQueue.push({
      id,
      at: now + Math.max(0, Number(delay) || 0),
      fn,
      args,
      cancelled: false,
    });
    return id;
  }

  function cancel(id) {
    const task = timerQueue.find(t => t.id === id);
    if (task) task.cancelled = true;
  }

  function flushTimers(limit = 10000) {
    let iterations = 0;
    while (timerQueue.length && iterations < limit) {
      timerQueue.sort((a, b) => a.at - b.at || a.id - b.id);
      const task = timerQueue.shift();
      if (!task || task.cancelled) continue;
      now = Math.max(now, task.at);
      task.fn(...task.args);
      iterations++;
    }
    if (iterations >= limit) {
      throw new Error('Timer flush exceeded safety limit');
    }
    return iterations;
  }

  const math = Object.create(Math);
  math.random = random;

  class SeededDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(baseNow + now);
      } else {
        super(...args);
      }
    }

    static now() {
      return baseNow + now;
    }
  }

  const consoleProxy = {
    log: (...args) => {
      if (options.verbose) process.stdout.write(`${args.join(' ')}\n`);
    },
    warn: (...args) => {
      if (options.verbose) process.stderr.write(`${args.join(' ')}\n`);
    },
    error: (...args) => {
      process.stderr.write(`${args.join(' ')}\n`);
    },
  };

  const sandbox = {
    console: consoleProxy,
    document,
    navigator: {
      vibrate() {
        return false;
      },
      serviceWorker: {
        register: async () => ({}),
      },
    },
    performance: { now: () => now },
    Math: math,
    Date: SeededDate,
    setTimeout: schedule,
    clearTimeout: cancel,
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: cb => schedule(() => cb(now), 16),
    cancelAnimationFrame: cancel,
    localStorage: {
      _data: new Map(),
      getItem(key) {
        return this._data.has(key) ? this._data.get(key) : null;
      },
      setItem(key, value) {
        this._data.set(String(key), String(value));
      },
      removeItem(key) {
        this._data.delete(String(key));
      },
      clear() {
        this._data.clear();
      },
    },
    location: { href: 'http://127.0.0.1:8080/src/index.html' },
    SFX: {
      pickup() {},
      hit() {},
      bash() {},
      damage() {},
      enemyDeath() {},
      levelUp() {},
      buy() {},
      sell() {},
      playerDeath() {},
      click() {},
    },
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.__seed = seed;

  const tipKeys = [
    'firstEnemy',
    'firstPotion',
    'firstItem',
    'firstLevelUp',
    'firstShop',
    'firstStairs',
    'firstBag',
    'firstGold',
  ];
  sandbox.TIPS = Object.fromEntries(tipKeys.map(key => [key, { shown: false }]));
  sandbox.fireTip = key => {
    if (sandbox.TIPS[key]) sandbox.TIPS[key].shown = true;
  };
  sandbox.resetTips = () => {
    Object.values(sandbox.TIPS).forEach(t => {
      t.shown = false;
    });
  };

  sandbox.addLog = (msg, cls = '') => {
    if (!sandbox.G) return;
    sandbox.G.log.unshift({ msg, cls });
    if (sandbox.G.log.length > 40) sandbox.G.log.pop();
    ensureElement('log').innerHTML = sandbox.G.log
      .map((entry, idx) => `<div class="log-entry ${entry.cls} ${idx === 0 ? 'new' : ''}">${entry.msg}</div>`)
      .join('');
    ensureElement('log').scrollTop = 0;
  };

  sandbox.floatText = () => {};
  sandbox.popText = () => {};
  sandbox.shakeMap = () => {};
  sandbox.flashDamage = () => {};
  sandbox.render = () => {};
  sandbox.updateHUD = () => {};
  sandbox.updateActBtns = () => {};
  sandbox.updateInvDrawer = () => {};
  sandbox.showTip = () => {};
  sandbox.hideTip = () => {};
  sandbox.startLongPress = () => {};
  sandbox.endLongPress = () => {};
  sandbox.cancelLongPress = () => {};

  sandbox.openHelp = () => {
    ensureElement('help-overlay').style.display = 'flex';
    sandbox.switchHelpTab('controls');
  };
  sandbox.closeHelp = () => {
    ensureElement('help-overlay').style.display = 'none';
  };
  sandbox.switchHelpTab = () => {};

  sandbox.openInv = () => {
    if (sandbox.G && (sandbox.G.gameOver || sandbox.G.won)) return;
    ensureElement('inv-drawer').classList.add('open');
    ensureElement('drawer-backdrop').classList.add('open');
    sandbox.updateInvDrawer();
    sandbox.fireTip('firstBag');
  };
  sandbox.closeInv = () => {
    ensureElement('inv-drawer').classList.remove('open');
    ensureElement('drawer-backdrop').classList.remove('open');
  };

  let currentShrine = null;

  function removeShrine(shrine) {
    if (!sandbox.G || !shrine) return;
    const idx = sandbox.G.items.findIndex(item => item.id === shrine.id);
    if (idx > -1) sandbox.G.items.splice(idx, 1);
  }

  sandbox.closeShrinePrompt = () => {
    ensureElement('shrine-overlay').style.display = 'none';
    currentShrine = null;
  };

  sandbox.acceptShrinePrompt = () => {
    if (!sandbox.G || !currentShrine) return;
    const shrine = currentShrine;
    sandbox.closeShrinePrompt();
    removeShrine(shrine);

    const p = sandbox.G.player;
    if (shrine.shrineType === 'Blood') {
      const cost = Math.max(1, Math.floor(p.maxHp * 0.3));
      const atkGain = Math.max(1, Math.floor(cost / 12));
      p.maxHp = Math.max(1, p.maxHp - cost);
      p.hp = Math.min(p.hp, p.maxHp);
      p.atk += atkGain;
      sandbox.addLog(`Sacrificed ${cost} Max HP for +${atkGain} ATK!`, 'log-combat');
    } else if (shrine.shrineType === 'Greed') {
      const gold = p.gold;
      p.gold = 0;
      for (let i = 0; i < 2; i++) {
        p.lvl++;
        p.xpNext = Math.round(p.xpNext * 1.6);
        p.maxHp += 8;
        p.hp = Math.min(p.hp + 8, p.maxHp);
        p.atk += 1;
        p.def += 1;
        if (p.class === 'paladin') {
          p.maxHp += 2;
          p.hp = Math.min(p.hp + 2, p.maxHp);
        }
      }
      sandbox.addLog(`Sacrificed ${gold} Gold for 2 Levels!`, 'log-info');
      if (typeof sandbox.checkBagUpgrades === 'function') sandbox.checkBagUpgrades();
    } else if (shrine.shrineType === 'Cursed') {
      p.hp = p.maxHp;
      sandbox.addLog('Fully healed, but the curse awakens!', 'log-combat');
      let spawned = 0;
      const enemyProfile = sandbox.getFloorEnemyProfile ? sandbox.getFloorEnemyProfile(sandbox.G.floor) : { tierMin: 0, tierMax: 1, scale: 1 };
      for (let r = 1; r <= 2 && spawned < 3; r++) {
        for (let y = p.y - r; y <= p.y + r && spawned < 3; y++) {
          for (let x = p.x - r; x <= p.x + r && spawned < 3; x++) {
            if (
              x >= 0 && x < 56 && y >= 0 && y < 36 &&
              sandbox.G.map[y] && sandbox.G.map[y][x] === 1 &&
              !sandbox.G.enemies.some(e => e.x === x && e.y === y) &&
              (x !== p.x || y !== p.y)
            ) {
              const tier = Math.floor(sandbox.Math.random() * (enemyProfile.tierMax - enemyProfile.tierMin + 1)) + enemyProfile.tierMin;
              const baseEnemy = sandbox.ENEMIES[tier] || sandbox.ENEMIES[0];
              const scale = enemyProfile.scale;
              sandbox.G.enemies.push({
                id: `headless-cursed-${seed}-${spawned}`,
                name: 'Cursed ' + baseEnemy.name,
                sym: baseEnemy.sym,
                hp: Math.round(baseEnemy.hp * scale) * 2,
                maxHp: Math.round(baseEnemy.hp * scale) * 2,
                atk: Math.round(baseEnemy.atk * scale) * 2,
                def: Math.round(baseEnemy.def * scale),
                xp: Math.round(baseEnemy.xp * scale) * 2,
                gold: Math.round(baseEnemy.gold * scale) * 2,
                color: baseEnemy.color,
                x,
                y,
                stunnedTurns: 0,
                isElite: true,
              });
              spawned++;
            }
          }
        }
      }
    }

    if (typeof sandbox.advanceTurn === 'function') {
      sandbox.advanceTurn({ allowFreeMove: true });
    }
  };

  sandbox.showShrinePrompt = shrine => {
    if (!sandbox.G || !shrine) return;
    currentShrine = shrine;
    ensureElement('shrine-title').textContent = shrine.shrineType ? `${String(shrine.shrineType).toUpperCase()} SHRINE` : 'SHRINE';
    ensureElement('shrine-overlay').style.display = 'flex';
  };

  sandbox.showDeath = () => {
    state.deathShown = true;
    state.gameOver = true;
    const modal = ensureElement('death-modal');
    modal.classList.add('modal', 'death');
    modal.style.display = 'block';
  };
  sandbox.showVictory = () => {
    state.victoryShown = true;
    state.won = true;
    const modal = ensureElement('victory-modal');
    modal.classList.add('modal', 'victory');
    modal.style.display = 'block';
  };

  sandbox.gatk = () => {
    const p = sandbox.G && sandbox.G.player;
    if (!p) return 0;
    const weapon = p.weapon;
    const watk = typeof sandbox.weaponDamage === 'function'
      ? sandbox.weaponDamage(weapon)
      : (weapon ? sandbox.weaponPower(weapon) : 0);
    let total = p.atk + watk;
    if (p.class === 'barbarian') {
      total += Math.floor((p.maxHp - p.hp) / 6);
    }
    if (p.strengthTurns > 0) {
      total += 10;
    }
    if (p.magicMult && weapon && weapon.sym === '♦') {
      total = Math.floor(total * p.magicMult);
    }
    return total;
  };

  sandbox.gdef = () => {
    const p = sandbox.G && sandbox.G.player;
    if (!p) return 0;
    return p.def + (p.armor ? p.armor.def : 0);
  };

  sandbox.iDesc = item => {
    if (!item) return '';
    if (item.type === 'weapon') return `ATK+${item.atk || 0}`;
    if (item.type === 'armor') return `DEF+${item.def || 0}`;
    if (item.type === 'potion') return `Heal ${item.heal || 0} HP`;
    if (item.type === 'upgrade') return item.desc || '';
    return '';
  };

  const context = vm.createContext(sandbox);

  for (const { file, script } of COMPILED_SCRIPTS) {
    try {
      script.runInContext(context, { filename: file });
    } catch (err) {
      err.message = `${path.basename(file)}: ${err.message}`;
      throw err;
    }
  }

  vm.runInContext(`
    Object.defineProperty(window, 'G', {
      get() { return G; },
      set(v) { G = v; },
      configurable: true,
    });
  `, context);

  context.canAct = () => true;
  context.window.canAct = context.canAct;
  context._lastAction = 0;

  function captureSnapshot() {
    const G = context.G;
    if (!G || !G.player) {
      return {
        ready: false,
      };
    }

    const p = G.player;
    const shopOverlay = document.getElementById('shop-overlay');
    const invDrawer = document.getElementById('inv-drawer');
    const emergencyOverlay = document.getElementById('emergency-overlay');
    const helpOverlay = document.getElementById('help-overlay');
    const shrineOverlay = document.getElementById('shrine-overlay');
    const itemsHash = (G.items || [])
      .map(i => `${i.id}:${i.type}:${i.carried ? 1 : 0}:${i.name}:${i.x ?? ''},${i.y ?? ''}:${i.sold ? 1 : 0}:${i.used ? 1 : 0}`)
      .join('|');
    const enemyHash = (G.enemies || [])
      .map(e => `${e.id}:${e.name}:${e.hp}:${e.x},${e.y}:${e.dying ? 1 : 0}:${e.stunnedTurns || 0}:${e.raiseCorpseTurns || 0}:${e.raiseCorpseTarget ? 1 : 0}`)
      .join('|');
    const trapHash = (G.traps || [])
      .map(t => `${t.x},${t.y}:${t.type}:${t.revealed?1:0}:${t.triggered?1:0}`)
      .join('|');

    return {
      ready: true,
      floor: G.floor,
      turn: G.turn,
      hp: p.hp,
      maxHp: p.maxHp,
      lvl: p.lvl,
      xp: p.xp,
      xpNext: p.xpNext,
      gold: p.gold,
      atk: p.atk,
      def: p.def,
      x: p.x,
      y: p.y,
      weapon: p.weapon ? `${p.weapon.name}:${p.weapon.atk}:${p.weapon.sym}` : '',
      armor: p.armor ? `${p.armor.name}:${p.armor.def}:${p.armor.sym}` : '',
      weaponCount: p.weapon ? 1 : 0,
      armorCount: p.armor ? 1 : 0,
      ability1Cooldown: G.ability1Cooldown,
      ability2Cooldown: G.ability2Cooldown,
      freeMoves: p.freeMoves || 0,
      shieldWallTurns: p.shieldWallTurns || 0,
      vanishTurns: p.vanishTurns || 0,
      bloodlustTurns: p.bloodlustTurns || 0,
      rootedTurns: p.rootedTurns || 0,
      poisonedTurns: p.poisonedTurns || 0,
      vampirism: p.vampirism || 0,
      regen: p.regen || 0,
      swiftness: p.swiftness || 0,
      critChance: p.critChance || 0,
      dodgeBonus: p.dodgeBonus || 0,
      goldBonus: p.goldBonus || 0,
      xpMult: p.xpMult || 0,
      tilesExplored: p.tilesExplored || 0,
      shopOpen: shopOverlay.classList.contains('open'),
      invOpen: invDrawer.classList.contains('open'),
      emergencyOpen: emergencyOverlay.style.display === 'flex',
      helpOpen: helpOverlay.style.display === 'flex',
      shrineOpen: shrineOverlay.style.display === 'flex',
      deathShown: state.deathShown,
      victoryShown: state.victoryShown,
      pendingHit: !!G.pendingHit,
      carriedCount: (G.items || []).filter(i => i.carried).length,
      itemsHash,
      enemyHash,
      trapHash,
      currentShop: G.currentShop ? `${G.currentShop.x},${G.currentShop.y}` : '',
    };
  }

  function snapshotKey(snapshot) {
    return JSON.stringify(snapshot);
  }

  function interpretDecision(decision) {
    if (!decision) return { kind: 'none', label: 'none' };
    if (decision.type === 'status') {
      return { kind: 'status', label: decision.val };
    }

    if (decision.type === 'click') {
      const target = String(decision.target || '');
      if (target === '#emergency-drink-btn') {
        context.resolveEmergency(true);
        return { kind: 'click', label: 'emergency-drink' };
      }
      if (target === '#drawer-backdrop') {
        context.closeInv();
        return { kind: 'click', label: 'close-inv' };
      }
      if (target === '#shrine-accept-btn') {
        context.acceptShrinePrompt();
        return { kind: 'click', label: 'shrine-accept' };
      }
      if (target === '#shrine-decline-btn' || target === '#shrine-reject-btn') {
        context.closeShrinePrompt();
        return { kind: 'click', label: 'shrine-decline' };
      }

      const shopMatch = target.match(/\.shop-item\[onclick\*="([^"]+)"\]/) || target.match(/\.shop-item\[onclick\*='([^']+)'\]/);
      if (shopMatch) {
        context.buyItem(shopMatch[1]);
        return { kind: 'click', label: `buy:${shopMatch[1]}` };
      }

      const invMatch = target.match(/\.inv-slot\[onclick\*="([^"]+)"\]/) || target.match(/\.inv-slot\[onclick\*='([^']+)'\]/);
      if (invMatch) {
        context.useItem(invMatch[1]);
        return { kind: 'click', label: `use:${invMatch[1]}` };
      }

      if (target === 'button[onclick="sellWeakerGear()"]') {
        if (typeof context.sellWeakerGear === 'function') context.sellWeakerGear();
        return { kind: 'click', label: 'sell-unwanted-gear' };
      }

      return { kind: 'click', label: target || 'unknown-click' };
    }

    if (decision.type === 'attack') {
      context.tileAttack(decision.target);
      return { kind: 'attack', label: `attack:${decision.target}` };
    }

    if (decision.type === 'key') {
      const key = decision.val;
      const dirs = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };

      if (dirs[key]) {
        const [dx, dy] = dirs[key];
        context.move(dx, dy);
        return { kind: 'key', label: key };
      }
      if (key === 'b' || key === 'B' || key === '1') {
        context.doAbility1();
        return { kind: 'key', label: 'ability1' };
      }
      if (key === 'v' || key === 'V' || key === '2') {
        context.doAbility2();
        return { kind: 'key', label: 'ability2' };
      }
      if (key === '.' || key === '>') {
        context.descend();
        return { kind: 'key', label: 'descend' };
      }
      if (key === 'i' || key === 'I') {
        if (document.getElementById('inv-drawer').classList.contains('open')) context.closeInv();
        else context.openInv();
        return { kind: 'key', label: 'inventory' };
      }
      if (key === 't' || key === 'T') {
        context.openShop();
        return { kind: 'key', label: 'shop' };
      }
      if (key === 'Escape') {
        if (document.getElementById('shop-overlay').classList.contains('open')) context.closeShop();
        else if (document.getElementById('help-overlay').style.display === 'flex') context.closeHelp();
        else if (document.getElementById('inv-drawer').classList.contains('open')) context.closeInv();
        return { kind: 'key', label: 'escape' };
      }
      return { kind: 'key', label: String(key) };
    }

    return { kind: 'unknown', label: String(decision.type || 'unknown') };
  }

  return {
    context,
    document,
    state,
    flushTimers,
    captureSnapshot,
    snapshotKey,
    interpretDecision,
  };
}

function runSingle({ className, seed, maxTurns, trace, verbose }) {
  const runtime = createRuntime(seed, { verbose });
  const { context, flushTimers, captureSnapshot, snapshotKey, interpretDecision } = runtime;
  const runTrace = [];
  const errors = [];
  let status = 'max_turns';
  let decisionSteps = 0;
  let stagnantSteps = 0;

  try {
    context.initGame(className);
    flushTimers();

    while (decisionSteps < maxTurns) {
      const before = captureSnapshot();
      if (!before.ready) {
        status = 'fatal_script_error';
        errors.push('Game failed to initialize');
        break;
      }

      if (context.G.gameOver || context.G.won) {
        status = context.G.won ? 'won' : 'dead';
        break;
      }

      let decision;
      try {
        decision = context.window.botDecisionLogic();
      } catch (err) {
        status = 'fatal_script_error';
        errors.push(err.message);
        break;
      }

      if (!decision) {
        status = 'stuck';
        break;
      }

      const interpreted = interpretDecision(decision);
      if (interpreted.kind === 'status') {
        status = interpreted.label;
        break;
      }

      const beforeKey = snapshotKey(before);
      try {
        flushTimers();
      } catch (err) {
        status = 'fatal_script_error';
        errors.push(err.message);
        break;
      }

      const after = captureSnapshot();
      const afterKey = snapshotKey(after);

      if (trace) {
        runTrace.push({
          step: decisionSteps + 1,
          decision,
          action: interpreted.label,
          before,
          after,
        });
      }

      if (beforeKey === afterKey) {
        stagnantSteps += 1;
      } else {
        stagnantSteps = 0;
      }

      decisionSteps += 1;

      if (stagnantSteps >= 8) {
        status = 'stuck';
        break;
      }

      if (context.G.gameOver || context.G.won) {
        status = context.G.won ? 'won' : 'dead';
        break;
      }
    }
  } catch (err) {
    status = 'fatal_script_error';
    errors.push(err.message);
  }

  try {
    flushTimers();
  } catch (err) {
    errors.push(err.message);
    if (status === 'max_turns') status = 'fatal_script_error';
  }

  const finalState = captureSnapshot();
  const result = {
    class: className,
    seed,
    status,
    decisionSteps,
    gameTurns: finalState.turn || 0,
    finalFloor: finalState.floor || 0,
    floor5Reached: (finalState.floor || 0) >= 5,
    maxHp: finalState.maxHp || 0,
    hp: finalState.hp || 0,
    gold: finalState.gold || 0,
    errors,
  };

  if (trace) {
    result.trace = runTrace;
  }

  return result;
}

function aggregate(results, config) {
  const overall = {
    runs: 0,
    wins: 0,
    losses: 0,
    timeouts: 0,
    stuck: 0,
    errors: 0,
    maxFloor: 0,
    minFloor: Infinity,
    totalFloor: 0,
    totalTurns: 0,
    totalSteps: 0,
    floor5Hits: 0,
  };

  const byClass = {};
  for (const className of config.classList) {
    byClass[className] = {
      runs: 0,
      wins: 0,
      losses: 0,
      timeouts: 0,
      stuck: 0,
      errors: 0,
      maxFloor: 0,
      minFloor: Infinity,
      totalFloor: 0,
      totalTurns: 0,
      totalSteps: 0,
      floor5Hits: 0,
      statuses: {},
    };
  }

  for (const run of results) {
    const bucket = byClass[run.class] || (byClass[run.class] = {
      runs: 0,
      wins: 0,
      losses: 0,
      timeouts: 0,
      stuck: 0,
      errors: 0,
      maxFloor: 0,
      minFloor: Infinity,
      totalFloor: 0,
      totalTurns: 0,
      totalSteps: 0,
      floor5Hits: 0,
      statuses: {},
    });

    bucket.runs += 1;
    bucket.statuses[run.status] = (bucket.statuses[run.status] || 0) + 1;
    bucket.totalFloor += run.finalFloor;
    bucket.totalTurns += run.gameTurns;
    bucket.totalSteps += run.decisionSteps;
    bucket.maxFloor = Math.max(bucket.maxFloor, run.finalFloor);
    bucket.minFloor = Math.min(bucket.minFloor, run.finalFloor);
    bucket.floor5Hits += run.floor5Reached ? 1 : 0;
    if (run.status === 'won') bucket.wins += 1;
    else if (run.status === 'dead') bucket.losses += 1;
    else if (run.status === 'max_turns') bucket.timeouts += 1;
    else if (run.status === 'stuck') bucket.stuck += 1;
    else bucket.errors += 1;

    overall.runs += 1;
    overall.totalFloor += run.finalFloor;
    overall.totalTurns += run.gameTurns;
    overall.totalSteps += run.decisionSteps;
    overall.maxFloor = Math.max(overall.maxFloor, run.finalFloor);
    overall.minFloor = Math.min(overall.minFloor, run.finalFloor);
    overall.floor5Hits += run.floor5Reached ? 1 : 0;
    if (run.status === 'won') overall.wins += 1;
    else if (run.status === 'dead') overall.losses += 1;
    else if (run.status === 'max_turns') overall.timeouts += 1;
    else if (run.status === 'stuck') overall.stuck += 1;
    else overall.errors += 1;
  }

  function finalizeBucket(bucket) {
    if (!bucket.runs) {
      return {
        runs: 0,
        wins: 0,
        losses: 0,
        timeouts: 0,
        stuck: 0,
        errors: 0,
        winRate: 0,
        floor5Rate: 0,
        avgFloor: 0,
        avgTurns: 0,
        avgSteps: 0,
        maxFloor: 0,
        minFloor: 0,
        statuses: {},
      };
    }
    return {
      runs: bucket.runs,
      wins: bucket.wins,
      losses: bucket.losses,
      timeouts: bucket.timeouts,
      stuck: bucket.stuck,
      errors: bucket.errors,
      winRate: bucket.wins / bucket.runs,
      floor5Rate: bucket.floor5Hits / bucket.runs,
      avgFloor: round1(bucket.totalFloor / bucket.runs),
      avgTurns: round1(bucket.totalTurns / bucket.runs),
      avgSteps: round1(bucket.totalSteps / bucket.runs),
      maxFloor: bucket.maxFloor,
      minFloor: bucket.minFloor === Infinity ? 0 : bucket.minFloor,
      statuses: bucket.statuses,
    };
  }

  const finalByClass = {};
  for (const [className, bucket] of Object.entries(byClass)) {
    finalByClass[className] = finalizeBucket(bucket);
  }

  const finalOverall = finalizeBucket({
    runs: results.length,
    wins: overall.wins,
    losses: overall.losses,
    timeouts: overall.timeouts,
    stuck: overall.stuck,
    errors: overall.errors,
    totalFloor: overall.totalFloor,
    totalTurns: overall.totalTurns,
    totalSteps: overall.totalSteps,
    maxFloor: overall.maxFloor,
    minFloor: overall.minFloor,
    floor5Hits: overall.floor5Hits,
    statuses: {},
  });

  return {
    generatedAt: new Date().toISOString(),
    config,
    overall: finalOverall,
    byClass: finalByClass,
    runs: results,
  };
}

function printSummary(report) {
  const { config, overall, byClass } = report;
  console.log(`Headless balance report`);
  console.log(`  classes: ${config.classList.join(', ')}`);
  console.log(`  perClass: ${config.perClass}`);
  console.log(`  seedBase: ${config.seedBase}`);
  console.log(`  maxTurns: ${config.maxTurns}`);
  console.log('');
  console.log(
    `overall: wins ${overall.wins}/${overall.runs} (${pct(overall.winRate)}) | floor5 ${pct(overall.floor5Rate)} | avg floor ${overall.avgFloor} | avg turns ${overall.avgTurns} | avg steps ${overall.avgSteps} | timeouts ${overall.timeouts} | stuck ${overall.stuck} | errors ${overall.errors}`
  );
  console.log('');

  for (const className of config.classList) {
    const row = byClass[className];
    console.log(
      `${className.padEnd(12)} wins ${row.wins}/${row.runs} (${pct(row.winRate)}) | floor5 ${pct(row.floor5Rate)} | avg floor ${row.avgFloor} | avg turns ${row.avgTurns} | avg steps ${row.avgSteps} | timeouts ${row.timeouts} | stuck ${row.stuck} | errors ${row.errors}`
    );
  }
}

function writeOutput(report, outputPath) {
  const resolved = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(report, null, 2));
  return resolved;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printUsage();
    return;
  }

  const unknownClasses = args.classList.filter(cls => !DEFAULT_CLASSES.includes(cls));
  if (unknownClasses.length) {
    console.warn(`Skipping unknown class names: ${unknownClasses.join(', ')}`);
    args.classList = args.classList.filter(cls => DEFAULT_CLASSES.includes(cls));
  }
  if (!args.classList.length) {
    throw new Error('No valid classes selected');
  }

  const results = [];
  for (let classIndex = 0; classIndex < args.classList.length; classIndex++) {
    const className = args.classList[classIndex];
    for (let runIndex = 0; runIndex < args.perClass; runIndex++) {
      const seed = args.seedBase + classIndex * 100000 + runIndex;
      const result = runSingle({
        className,
        seed,
        maxTurns: args.maxTurns,
        trace: args.trace,
        verbose: args.verbose,
      });
      results.push(result);

      if (args.verbose) {
        console.log(
          `[${className} #${runIndex + 1}/${args.perClass}] seed=${seed} status=${result.status} floor=${result.finalFloor} turns=${result.gameTurns} steps=${result.decisionSteps}`
        );
        if (result.errors.length) {
          console.log(`  errors: ${result.errors.join(' | ')}`);
        }
      }
    }
  }

  const report = aggregate(results, args);
  printSummary(report);

  if (args.output) {
    const resolved = writeOutput(report, args.output);
    console.log('');
    console.log(`Wrote report to ${resolved}`);
  }

  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  createRuntime,
  runSingle,
  aggregate,
  main,
};

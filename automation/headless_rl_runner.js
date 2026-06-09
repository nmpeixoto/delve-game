#!/usr/bin/env node
/**
 * DELVE RL Runner - Modified headless runner for RL data collection.
 * Accepts actions from Python via stdin/stdout JSON lines.
 * Each worker runs multiple game VMs internally.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const readline = require('readline');

const REPO_ROOT = path.resolve(__dirname, '..');

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

function createRuntime(seed) {
  let now = seed * 1000;
  const baseNow = seed * 1000;
  const math = Object.create(Math);
  let _seed = seed;
  math.random = function() {
    _seed = (_seed * 16807 + 0) % 2147483647;
    return (_seed - 1) / 2147483646;
  };

  class SeededDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(baseNow + now);
      else super(...args);
    }
    static now() { return baseNow + now; }
  }

  let timers = [];
  let timerId = 1;
  const schedule = (fn, ms) => { const id = timerId++; timers.push({ id, fn, fireAt: now + ms }); return id; };
  const cancel = (id) => { timers = timers.filter(t => t.id !== id); };
  const flushTimers = () => {
    let safety = 0;
    while (timers.length > 0 && safety < 1000) {
      timers.sort((a, b) => a.fireAt - b.fireAt);
      const t = timers.shift();
      now = Math.max(now, t.fireAt);
      try { t.fn(); } catch(e) {}
      safety++;
    }
  };

  const elements = new Map();
  const makeElement = id => {
    const classes = new Set();
    return {
      id,
      style: { display: 'none', left: '', top: '' },
      classList: {
        contains: cls => classes.has(cls),
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        toggle(name, force) {
          if (force === true) { classes.add(name); return true; }
          if (force === false) { classes.delete(name); return false; }
          if (classes.has(name)) { classes.delete(name); return false; }
          classes.add(name);
          return true;
        },
      },
      dataset: {},
      textContent: '',
      innerHTML: '',
      appendChild() {},
      addEventListener() {},
      remove() {},
      closest: () => null,
    };
  };

  const document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeElement('anonymous'),
    addEventListener() {},
    body: { appendChild() {} },
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document,
    navigator: { vibrate() { return false; }, serviceWorker: { register: async () => ({}) } },
    performance: { now: () => now },
    Math: math,
    Date: SeededDate,
    setTimeout: schedule,
    clearTimeout: cancel,
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: cb => schedule(() => cb(now), 16),
    cancelAnimationFrame: cancel,
    localStorage: { _data: new Map(), getItem(k) { return this._data.get(k) || null; }, setItem(k, v) { this._data.set(String(k), String(v)); }, removeItem(k) { this._data.delete(k); }, clear() { this._data.clear(); } },
    location: { href: 'http://127.0.0.1:8080/src/index.html' },
    SFX: { pickup() {}, hit() {}, bash() {}, damage() {}, enemyDeath() {}, levelUp() {}, buy() {}, sell() {}, playerDeath() {}, click() {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  
  // Define missing sandbox functions needed by game source files
  sandbox.addLog = () => {};
  sandbox.render = () => {};
  sandbox.updateHUD = () => {};
  sandbox.updateActBtns = () => {};
  sandbox.closeInv = () => {};
  sandbox.openInv = () => {};
  sandbox.closeShop = () => {};
  sandbox.openShop = () => {};
  sandbox.resetTips = () => {};
  sandbox.fireTip = () => {};
  sandbox.TIPS = {};
  sandbox.closeHelp = () => {};
  sandbox.acceptShrinePrompt = () => {};
  sandbox.closeShrinePrompt = () => {};
  sandbox.sellWeakerGear = () => {};
  sandbox.buyItem = () => {};
  sandbox.sellItem = () => {};
  sandbox.switchShopTab = () => {};
  sandbox.renderShop = () => {};
  sandbox.renderSellPanel = () => {};
  sandbox.useItem = () => {};
  sandbox.interactShrine = () => {};
  sandbox.showShrinePrompt = () => {};
  sandbox.showDeath = () => {};
  sandbox.showVictory = () => {};
  sandbox.checkBagUpgrades = () => {};
  sandbox.fireTip = () => {};
  sandbox.TIPS = { firstEnemy: {shown:true}, firstPotion: {shown:true}, firstItem: {shown:true}, firstLevelUp: {shown:true}, firstShop: {shown:true}, firstStairs: {shown:true}, firstBag: {shown:true}, firstGold: {shown:true} };
  // Game functions needed by combat/shop/etc
  sandbox.gatk = () => { const p = sandbox.G && sandbox.G.player; if (!p) return 0; let total = p.atk + (p.weapon ? p.weapon.atk : 0); if (p.class === 'barbarian') total += Math.floor((p.maxHp - p.hp) / 6); if (p.strengthTurns > 0) total += 10; return total; };
  sandbox.gdef = () => { const p = sandbox.G && sandbox.G.player; if (!p) return 0; return p.def + (p.armor ? p.armor.def : 0); };
  sandbox.iDesc = () => '';
  sandbox.floatText = () => {};
  sandbox.popText = () => {};
  sandbox.shakeMap = () => {};
  sandbox.flashDamage = () => {};

  // Load strategy config
  const strategyConfigPath = path.join(REPO_ROOT, 'automation', 'strategy_config.json');
  if (fs.existsSync(strategyConfigPath)) {
    try {
      sandbox.STRATEGY_CONFIG = JSON.parse(fs.readFileSync(strategyConfigPath, 'utf8')).classes;
    } catch(e) {}
  }

  const tipKeys = ['firstEnemy','firstPotion','firstItem','firstLevelUp','firstShop','firstStairs','firstBag','firstGold'];
  sandbox.TIPS = {};
  tipKeys.forEach(k => sandbox.TIPS[k] = { shown: true });
  sandbox.resetTips = () => { Object.values(sandbox.TIPS).forEach(t => { t.shown = true; }); };
  sandbox.fireTip = key => { if (sandbox.TIPS[key]) sandbox.TIPS[key].shown = true; };

  const context = vm.createContext(sandbox);
  for (const { file, script } of COMPILED_SCRIPTS) {
    try { script.runInContext(context, { filename: file }); }
    catch (err) { err.message = `${path.basename(file)}: ${err.message}`; throw err; }
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
    if (!G || !G.player) return { ready: false };
    const p = G.player;
    const MAP_W = 56;
    const seen = G.seen || new Set();
    const shopOverlay = document.getElementById('shop-overlay');
    const invDrawer = document.getElementById('inv-drawer');
    const emergencyOverlay = document.getElementById('emergency-overlay');
    const shrineOverlay = document.getElementById('shrine-overlay');

    return {
      ready: true,
      floor: G.floor,
      turn: G.turn,
      player: {
        hp: p.hp, maxHp: p.maxHp, atk: p.atk, def: p.def, lvl: p.lvl,
        xp: p.xp, xpNext: p.xpNext, gold: p.gold,
        x: p.x, y: p.y, class: p.class,
        weapon: p.weapon ? { atk: p.weapon.atk, sym: p.weapon.sym, name: p.weapon.name, id: p.weapon.id } : null,
        armor: p.armor ? { def: p.armor.def, name: p.armor.name, id: p.armor.id } : null,
        shieldWallTurns: p.shieldWallTurns || 0, vanishTurns: p.vanishTurns || 0,
        freeMoves: p.freeMoves || 0, bloodlustTurns: p.bloodlustTurns || 0,
        rootedTurns: p.rootedTurns || 0, poisonedTurns: p.poisonedTurns || 0,
        strengthTurns: p.strengthTurns || 0,
        vampirism: p.vampirism || 0, regen: p.regen || 0, swiftness: p.swiftness || 0,
        critChance: p.critChance || 0, dodgeBonus: p.dodgeBonus || 0,
        goldBonus: p.goldBonus || 0, xpMult: p.xpMult || 0, perception: p.perception || 0,
      },
      ability1Cooldown: G.ability1Cooldown, ability2Cooldown: G.ability2Cooldown,
      enemies: (G.enemies || []).map(e => ({
        id: e.id, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp,
        atk: e.atk, def: e.def, xp: e.xp || 0,
        boss: !!e.boss, isElite: !!e.isElite,
        dying: !!e.dying, isPet: !!e.isPet,
      })),
      items: (G.items || []).map(i => ({
        id: i.id, name: i.name, type: i.type, carried: !!i.carried,
        x: i.x, y: i.y, heal: i.heal, price: i.price, atk: i.atk, def: i.def,
        sold: !!i.sold,
      })),
      traps: (G.traps || []).map(t => ({
        x: t.x, y: t.y, type: t.type,
        revealed: !!t.revealed,
        triggered: !!t.triggered,
      })),
      shops: (G.shops || []).map(s => ({ x: s.x, y: s.y, stock: (s.stock||[]).map(i => ({ id: i.id, type: i.type, price: i.price, heal: i.heal, atk: i.atk, def: i.def, sold: !!i.sold })) })),
      map: G.map,
      seen: Array.from(seen),
      visible: G.visible ? Array.from(G.visible) : [],
      seen_count: seen.size,
      known_stairs: (() => {
        for (let y = 0; y < (G.map||[]).length; y++)
          for (let x = 0; x < (G.map[0]||[]).length; x++)
            if (G.map[y][x] === 2 && seen.has(y * 56 + x)) return true;
        return false;
      })(),
      shopOpen: shopOverlay && shopOverlay.classList.contains('open'),
      gameOver: !!G.gameOver, won: !!G.won,
    };
  }

  function interpretDecision(decision) {
    if (!decision) return;
    if (decision.type === 'status') return;
    if (decision.type === 'click') {
      const t = decision.target || '';
      if (t === '#emergency-drink-btn') { context.resolveEmergency(true); return; }
      if (t === '#drawer-backdrop') { context.closeInv(); return; }
      if (t === '#shrine-accept-btn') { context.acceptShrinePrompt(); return; }
      if (t === '#shrine-decline-btn' || t === '#shrine-reject-btn') { context.closeShrinePrompt(); return; }
      const shopMatch = t.match(/\.shop-item\[onclick\*="([^"]+)"\]/);
      if (shopMatch) { context.buyItem(shopMatch[1]); return; }
      const invMatch = t.match(/\.inv-slot\[onclick\*="([^"]+)"\]/);
      if (invMatch) { context.useItem(invMatch[1]); return; }
      if (t === 'button[onclick="sellWeakerGear()"]') { if (typeof context.sellWeakerGear === 'function') context.sellWeakerGear(); return; }
      return;
    }
    if (decision.type === 'wait') { return; }
    if (decision.type === 'attack') { context.tileAttack(decision.target); return; }
    if (decision.type === 'key') {
      const key = decision.val;
      const dirs = { ArrowUp: [0,-1], ArrowDown: [0,1], ArrowLeft: [-1,0], ArrowRight: [1,0] };
      if (dirs[key]) { context.move(dirs[key][0], dirs[key][1]); return; }
      if (key === 'b' || key === 'B' || key === '1') { context.doAbility1(); return; }
      if (key === 'v' || key === 'V' || key === '2') { context.doAbility2(); return; }
      if (key === '.' || key === '>') { context.descend(); return; }
      if (key === 'i' || key === 'I') { if (document.getElementById('inv-drawer').classList.contains('open')) context.closeInv(); else context.openInv(); return; }
      if (key === 't' || key === 'T') { context.openShop(); return; }
      if (key === 'Escape') {
        if (document.getElementById('shop-overlay').classList.contains('open')) context.closeShop();
        else if (document.getElementById('inv-drawer').classList.contains('open')) context.closeInv();
        return;
      }
    }
  }

  return { context, flushTimers, captureSnapshot, interpretDecision };
}

// ── Worker mode: read actions from stdin, write results to stdout ──
function runWorker() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const envs = new Map();
  let nextEnvId = 0;

  function stepEnv(envId, decision) {
    const env = envs.get(envId);
    if (!env) return { envId, error: 'Unknown env', state: null, done: true, won: false };

    env.interpretDecision(decision);
    env.flushTimers();
    const after = env.captureSnapshot();
    const done = after.gameOver || after.won;
    return {
      envId,
      state: after,
      done,
      won: after.won,
    };
  }

  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      
      if (msg.type === 'init') {
        // Create new environment
        const envId = Number.isInteger(msg.envId) ? msg.envId : nextEnvId++;
        nextEnvId = Math.max(nextEnvId, envId + 1);
        const runtime = createRuntime(msg.seed || envId * 10000);
        runtime.context.initGame(msg.className || 'warrior');
        runtime.flushTimers();
        envs.set(envId, runtime);
        process.stdout.write(JSON.stringify({ type: 'ready', envId, state: runtime.captureSnapshot() }) + '\n');
      }
      else if (msg.type === 'step') {
        // Execute action in environment
        const result = stepEnv(msg.envId, msg.decision);
        process.stdout.write(JSON.stringify({ type: 'result', ...result }) + '\n');
      }
      else if (msg.type === 'stepBatch') {
        const results = (msg.steps || []).map(step => stepEnv(step.envId, step.decision));
        process.stdout.write(JSON.stringify({ type: 'results', results }) + '\n');
      }
      else if (msg.type === 'reset') {
        const env = envs.get(msg.envId);
        if (!env) {
          process.stdout.write(JSON.stringify({ type: 'error', envId: msg.envId, error: 'Unknown env' }) + '\n');
          return;
        }
        const runtime = createRuntime(msg.seed || msg.envId * 10000 + 9999);
        runtime.context.initGame(msg.className || 'warrior');
        runtime.flushTimers();
        envs.set(msg.envId, runtime);
        const state = runtime.captureSnapshot();
        process.stdout.write(JSON.stringify({ type: 'reset_done', envId: msg.envId, state }) + '\n');
      }
      else if (msg.type === 'getState') {
        const env = envs.get(msg.envId);
        if (!env) {
          process.stdout.write(JSON.stringify({ type: 'error', envId: msg.envId, error: 'Unknown env' }) + '\n');
          return;
        }
        process.stdout.write(JSON.stringify({ type: 'state', envId: msg.envId, state: env.captureSnapshot() }) + '\n');
      }
      else if (msg.type === 'shutdown') {
        process.exit(0);
      }
    } catch (err) {
      process.stdout.write(JSON.stringify({ type: 'error', error: err.message }) + '\n');
    }
  });

  rl.on('close', () => process.exit(0));
}

// ── Main: run worker mode if --worker flag, otherwise run single game ──
if (process.argv.includes('--worker')) {
  runWorker();
} else if (require.main === module) {
  // Single game mode (for testing)
  const seed = parseInt(process.argv[2] || '1');
  const className = process.argv[3] || 'warrior';
  const runtime = createRuntime(seed);
  runtime.context.initGame(className);
  runtime.flushTimers();
  
  let steps = 0;
  while (steps < 5000) {
    const state = runtime.captureSnapshot();
    if (state.gameOver || state.won) break;
    
    const decision = runtime.context.window.botDecisionLogic();
    if (!decision) break;
    
    runtime.interpretDecision(decision);
    runtime.flushTimers();
    steps++;
  }
  
  const final = runtime.captureSnapshot();
  console.log(`Status: ${final.won ? 'WON' : final.gameOver ? 'DEAD' : 'TIMEOUT'}`);
  console.log(`Floor: ${final.floor}, HP: ${final.hp}/${final.maxHp}, Steps: ${steps}`);
}

module.exports = { createRuntime };

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  createRuntime,
} = require('./headless-balance/headless_balance');

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

const EVENT_KEYS = [
  'missedHeal',
  'missedTeleport',
  'missedBomb',
  'missedBuff',
  'overclearSteps',
  'lowHpCombatNoHealing',
  'lethalNonEscape',
  'noOpStalls',
];

function round1(n) {
  return Math.round(n * 10) / 10;
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function parseNumberList(value) {
  return splitList(value)
    .map(n => parseInt(n, 10))
    .filter(Number.isFinite);
}

function parseArgs(argv) {
  const out = {
    classes: DEFAULT_CLASSES.join(','),
    perClass: 10,
    seedBases: [1000],
    maxTurns: 5000,
    output: '',
    verbose: false,
    trace: false,
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
    } else if (arg === '--seeds') {
      out.seedBases = parseNumberList(argv[++i] || '');
    } else if (arg.startsWith('--seeds=')) {
      out.seedBases = parseNumberList(arg.slice(8));
    } else if (arg === '--seed-base') {
      const seed = parseInt(argv[++i], 10);
      out.seedBases = Number.isFinite(seed) ? [seed] : [];
    } else if (arg.startsWith('--seed-base=')) {
      const seed = parseInt(arg.slice(12), 10);
      out.seedBases = Number.isFinite(seed) ? [seed] : [];
    } else if (arg === '--per-class') {
      out.perClass = parseInt(argv[++i], 10);
    } else if (arg.startsWith('--per-class=')) {
      out.perClass = parseInt(arg.slice(12), 10);
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
    out.seedBases = [parseInt(positional.shift(), 10)];
  }
  if (positional.length && /^\d+$/.test(positional[0])) {
    out.maxTurns = parseInt(positional.shift(), 10);
  }

  if (!out.classes || out.classes.trim().toLowerCase() === 'all') {
    out.classes = DEFAULT_CLASSES.join(',');
  }

  out.classList = splitList(out.classes).map(s => s.toLowerCase());
  if (!out.classList.length) out.classList = [...DEFAULT_CLASSES];
  if (!out.seedBases.length) out.seedBases = [1000];
  if (!Number.isFinite(out.perClass) || out.perClass < 1) out.perClass = 10;
  if (!Number.isFinite(out.maxTurns) || out.maxTurns < 1) out.maxTurns = 5000;

  return out;
}

function printUsage() {
  console.log([
    'Usage:',
    '  node automation/bot_behavior_audit.js --classes all --seeds 1000,2000 --per-class 10 --max-turns 5000 --output balance_reports/audit.json',
    '',
    'Flags:',
    '  --classes, --class   Comma-separated class list, or all',
    '  --seeds              Comma-separated seed bases',
    '  --seed-base          Single seed base alias',
    '  --per-class          Runs per class per seed base',
    '  --max-turns          Step cap per run',
    '  --output             Write JSON report',
    '  --trace              Include per-step trace snapshots',
    '  --verbose            Print per-run progress',
  ].join('\n'));
}

function zeroEvents() {
  return Object.fromEntries(EVENT_KEYS.map(key => [key, 0]));
}

function addEventCounts(target, events) {
  for (const key of EVENT_KEYS) {
    target[key] = (target[key] || 0) + (events[key] || 0);
  }
  for (const [key, value] of Object.entries(events || {})) {
    if (!EVENT_KEYS.includes(key)) target[key] = (target[key] || 0) + value;
  }
  return target;
}

function isInventoryUse(actionLabel) {
  const label = String(actionLabel || '');
  return label === 'inventory' ||
    label === 'emergency-drink' ||
    label.startsWith('use:') ||
    label.startsWith('buy:');
}

function isEscapeAction(actionLabel) {
  const label = String(actionLabel || '');
  return isInventoryUse(label) ||
    label === 'ability2' ||
    label === 'ArrowUp' ||
    label === 'ArrowDown' ||
    label === 'ArrowLeft' ||
    label === 'ArrowRight' ||
    label === 'descend';
}

function isCombatAction(actionLabel) {
  const label = String(actionLabel || '');
  return label === 'ability1' ||
    label === 'ability2' ||
    label.startsWith('attack:') ||
    label === 'ArrowUp' ||
    label === 'ArrowDown' ||
    label === 'ArrowLeft' ||
    label === 'ArrowRight';
}

function auditDecision(snapshot, decisionContext = {}) {
  const events = zeroEvents();
  const resources = snapshot.resources || {};
  const threats = snapshot.threats || {};
  const actionLabel = decisionContext.actionLabel || '';
  const policyLabel = decisionContext.policyLabel || '';
  const usingInventory = isInventoryUse(actionLabel);

  if ((resources.potions || 0) > 0 && (threats.incoming || 0) >= (snapshot.hp || 0) && !usingInventory) {
    events.missedHeal = 1;
  }

  if ((resources.teleports || 0) > 0 && (resources.potions || 0) === 0 && threats.lethalAdjacent && !usingInventory) {
    events.missedTeleport = 1;
  }

  if ((resources.bombs || 0) > 0 && threats.bombValuable && !usingInventory) {
    events.missedBomb = 1;
  }

  if ((resources.buffs || 0) > 0 && threats.buffValuable && (threats.visible || 0) > 0 && !usingInventory) {
    events.missedBuff = 1;
  }

  const headingToStairs = String(policyLabel).includes('stairs') || actionLabel === 'descend';
  if (
    (threats.live || 0) === 0 &&
    snapshot.knownStairs &&
    !snapshot.onStairs &&
    (snapshot.exploredRatio || 0) >= 0.35 &&
    !headingToStairs
  ) {
    events.overclearSteps = 1;
  }

  if (
    isCombatAction(actionLabel) &&
    (snapshot.hp || 0) < (snapshot.maxHp || 0) * 0.4 &&
    (resources.potions || 0) === 0
  ) {
    events.lowHpCombatNoHealing = 1;
  }

  if (threats.lethalAdjacent && !isEscapeAction(actionLabel)) {
    events.lethalNonEscape = 1;
  }

  return events;
}

function mapDimensions(G) {
  const height = G && G.map ? G.map.length : 36;
  const width = G && G.map && G.map[0] ? G.map[0].length : 56;
  return { width, height };
}

function tileKey(x, y, width) {
  return y * width + x;
}

function armorPower(item) {
  return item ? (item.def || 0) : 0;
}

function isMagicWeapon(item) {
  return !!item && (item.sym === '♦' || /staff|rod|wand|scythe/i.test(item.name || ''));
}

function weaponPower(item, p) {
  if (!item) return p.class === 'monk' ? Math.ceil((p.lvl || 1) / 2) : 0;
  let power = item.atk || 0;
  if (p.class === 'mage' && isMagicWeapon(item)) power += Math.floor(power / 5);
  return power;
}

function totalAtk(p) {
  let total = (p.atk || 0) + weaponPower(p.weapon, p);
  if (p.class === 'barbarian') total += Math.floor(((p.maxHp || 0) - (p.hp || 0)) / 6);
  if ((p.strengthTurns || 0) > 0) total += 10;
  if (p.magicMult && isMagicWeapon(p.weapon)) total = Math.floor(total * p.magicMult);
  return total;
}

function maxDamage(en, p) {
  return Math.max(1, totalAtk(p) - (en.def || 0) + 2);
}

function maxBuffDamage(en, p) {
  const bonus = (p.strengthTurns || 0) > 0 ? 0 : 10;
  return Math.max(1, totalAtk(p) + bonus - (en.def || 0) + 2);
}

function maxIncomingHit(en, p) {
  let hit = Math.max(1, (en.atk || 0) - ((p.def || 0) + armorPower(p.armor)) + 2);
  if ((p.shieldWallTurns || 0) > 0) hit = Math.ceil(hit * 3 / 5);
  if ((p.bloodlustTurns || 0) > 0) hit = Math.ceil(hit * 23 / 20);
  return hit;
}

function resourceCounts(G) {
  const carried = (G.items || []).filter(i => i.carried);
  return {
    potions: carried.filter(i => i.type === 'potion').length,
    buffs: carried.filter(i => i.type === 'potion_buff').length,
    teleports: carried.filter(i => i.type === 'scroll_teleport' || /teleport/i.test(i.name || '')).length,
    bombs: carried.filter(i => i.type === 'bomb').length,
    keys: carried.filter(i => i.type === 'key').length,
    detection: carried.filter(i => i.type === 'scroll' && /detection/i.test(i.name || '')).length,
    carried: carried.length,
  };
}

function knownStairs(G) {
  const { width, height } = mapDimensions(G);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (G.map[y][x] === 2 && G.seen && G.seen.has(tileKey(x, y, width))) return true;
    }
  }
  return false;
}

function onStairs(G) {
  return !!(G && G.player && G.map && G.map[G.player.y] && G.map[G.player.y][G.player.x] === 2);
}

function threatSummary(G) {
  const p = G.player;
  const { width } = mapDimensions(G);
  const live = (G.enemies || []).filter(e => !e.dying && !e.isPet);
  const visible = live.filter(e => G.visible && G.visible.has(tileKey(e.x, e.y, width)));
  const adjacent = live.filter(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1);
  const incoming = adjacent.reduce((sum, en) => sum + maxIncomingHit(en, p), 0);
  const lethalAdjacent = adjacent.some(en => maxIncomingHit(en, p) >= p.hp);
  const buffValuable = (p.strengthTurns || 0) <= 0 && visible.some(en => {
    if (en.isElite || en.boss) return true;
    const dist = Math.abs(en.x - p.x) + Math.abs(en.y - p.y);
    if (dist > 3) return false;
    const currentHits = Math.ceil(en.hp / maxDamage(en, p));
    const buffedHits = Math.ceil(en.hp / maxBuffDamage(en, p));
    const savesAttack = currentHits >= 3 && buffedHits < currentHits;
    const dangerousHit = maxIncomingHit(en, p) >= Math.max(6, p.maxHp * 0.18) || en.atk >= p.hp * 0.25;
    return savesAttack && (dangerousHit || G.floor >= 2 || p.hp < p.maxHp * 0.8);
  });
  const bombValuable = adjacent.some(en =>
    en.hp <= 30 &&
    ((p.hp || 0) <= incoming + Math.max(6, (p.maxHp || 0) * 0.08) ||
     (p.hp || 0) < (p.maxHp || 0) * 0.35 ||
     maxIncomingHit(en, p) >= (p.hp || 0) * 0.45)
  );

  return {
    live: live.length,
    visible: visible.length,
    adjacent: adjacent.length,
    incoming,
    lethalAdjacent,
    bombValuable,
    buffValuable,
    bossVisible: visible.some(e => e.boss),
    eliteVisible: visible.some(e => e.isElite),
  };
}

function createAuditSnapshot(context) {
  const G = context.G;
  if (!G || !G.player) return { ready: false };
  const p = G.player;
  const { width, height } = mapDimensions(G);
  return {
    ready: true,
    floor: G.floor || 0,
    turn: G.turn || 0,
    hp: p.hp || 0,
    maxHp: p.maxHp || 0,
    lvl: p.lvl || 0,
    gold: p.gold || 0,
    class: p.class || '',
    x: p.x,
    y: p.y,
    exploredRatio: G.seen ? G.seen.size / (width * height) : 0,
    knownStairs: knownStairs(G),
    onStairs: onStairs(G),
    resources: resourceCounts(G),
    threats: threatSummary(G),
    weapon: p.weapon ? `${p.weapon.name}:${p.weapon.atk || 0}:${p.weapon.sym || ''}` : '',
    armor: p.armor ? `${p.armor.name}:${p.armor.def || 0}:${p.armor.sym || ''}` : '',
  };
}

function terminalResourceCounts(snapshot) {
  const resources = snapshot && snapshot.resources ? snapshot.resources : {};
  return {
    potions: resources.potions || 0,
    buffs: resources.buffs || 0,
    teleports: resources.teleports || 0,
    bombs: resources.bombs || 0,
  };
}

function runAuditSingle({ className, seed, maxTurns = 5000, trace = false, verbose = false }) {
  const runtime = createRuntime(seed, { verbose });
  const { context, flushTimers, captureSnapshot, snapshotKey, interpretDecision } = runtime;
  const runTrace = [];
  const errors = [];
  const events = zeroEvents();
  const actions = {};
  let status = 'max_turns';
  let decisionSteps = 0;
  let stagnantSteps = 0;
  let beforeTerminal = null;

  try {
    context.initGame(className);
    flushTimers();

    while (decisionSteps < maxTurns) {
      const before = captureSnapshot();
      const auditBefore = createAuditSnapshot(context);
      if (!before.ready || !auditBefore.ready) {
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
        beforeTerminal = {
          ...auditBefore,
          action: 'none',
          policy: 'none',
        };
        break;
      }

      const interpreted = interpretDecision(decision);
      const policyLabel = decision.label || interpreted.label;
      if (interpreted.kind === 'status') {
        status = interpreted.label;
        beforeTerminal = {
          ...auditBefore,
          action: interpreted.label,
          policy: policyLabel,
        };
        break;
      }

      addEventCounts(events, auditDecision(auditBefore, {
        actionLabel: interpreted.label,
        policyLabel,
      }));

      actions[interpreted.label] = (actions[interpreted.label] || 0) + 1;
      const beforeKey = snapshotKey(before);

      try {
        flushTimers();
      } catch (err) {
        status = 'fatal_script_error';
        errors.push(err.message);
        beforeTerminal = {
          ...auditBefore,
          action: interpreted.label,
          policy: policyLabel,
        };
        break;
      }

      const after = captureSnapshot();
      const afterKey = snapshotKey(after);

      if (trace) {
        runTrace.push({
          step: decisionSteps + 1,
          decision,
          action: interpreted.label,
          policy: policyLabel,
          before: auditBefore,
          after: createAuditSnapshot(context),
        });
      }

      if (beforeKey === afterKey) {
        stagnantSteps += 1;
        events.noOpStalls += 1;
      } else {
        stagnantSteps = 0;
      }

      decisionSteps += 1;
      beforeTerminal = {
        ...auditBefore,
        action: interpreted.label,
        policy: policyLabel,
      };

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
  const auditFinal = createAuditSnapshot(context);
  const result = {
    class: className,
    seed,
    status,
    decisionSteps,
    gameTurns: finalState.turn || 0,
    finalFloor: finalState.floor || 0,
    floor5Reached: (finalState.floor || 0) >= 5,
    hp: finalState.hp || 0,
    maxHp: finalState.maxHp || 0,
    lvl: finalState.lvl || 0,
    gold: finalState.gold || 0,
    resources: auditFinal.ready ? auditFinal.resources : terminalResourceCounts(beforeTerminal),
    finalThreats: auditFinal.ready ? auditFinal.threats : {},
    beforeTerminal,
    events,
    actions,
    errors,
  };

  if (trace) result.trace = runTrace;
  return result;
}

function aggregateAudit(runs) {
  const aggregate = {
    runs: runs.length,
    wins: 0,
    dead: 0,
    timeouts: 0,
    stuck: 0,
    errors: 0,
    floor5Hits: 0,
    winRate: 0,
    floor5Rate: 0,
    avgFloor: 0,
    avgTurns: 0,
    avgSteps: 0,
    maxFloor: 0,
    minFloor: 0,
    statuses: {},
    events: zeroEvents(),
    deathsWithResources: {
      potions: 0,
      buffs: 0,
      teleports: 0,
      bombs: 0,
    },
    terminalActions: {},
  };

  let totalFloor = 0;
  let totalTurns = 0;
  let totalSteps = 0;
  let minFloor = Infinity;

  for (const run of runs) {
    aggregate.statuses[run.status] = (aggregate.statuses[run.status] || 0) + 1;
    if (run.status === 'won') aggregate.wins += 1;
    else if (run.status === 'dead') aggregate.dead += 1;
    else if (run.status === 'max_turns') aggregate.timeouts += 1;
    else if (run.status === 'stuck') aggregate.stuck += 1;
    else aggregate.errors += 1;

    const floor = run.finalFloor || 0;
    totalFloor += floor;
    totalTurns += run.gameTurns || 0;
    totalSteps += run.decisionSteps || 0;
    aggregate.maxFloor = Math.max(aggregate.maxFloor, floor);
    minFloor = Math.min(minFloor, floor);
    if (run.floor5Reached || floor >= 5) aggregate.floor5Hits += 1;
    addEventCounts(aggregate.events, run.events || {});

    const terminalAction = run.beforeTerminal && run.beforeTerminal.action;
    if (terminalAction) {
      aggregate.terminalActions[terminalAction] = (aggregate.terminalActions[terminalAction] || 0) + 1;
    }

    if (run.status === 'dead') {
      const resources = terminalResourceCounts(run.beforeTerminal || run);
      for (const key of Object.keys(aggregate.deathsWithResources)) {
        if ((resources[key] || 0) > 0) aggregate.deathsWithResources[key] += 1;
      }
    }
  }

  if (aggregate.runs) {
    aggregate.winRate = aggregate.wins / aggregate.runs;
    aggregate.floor5Rate = aggregate.floor5Hits / aggregate.runs;
    aggregate.avgFloor = round1(totalFloor / aggregate.runs);
    aggregate.avgTurns = round1(totalTurns / aggregate.runs);
    aggregate.avgSteps = round1(totalSteps / aggregate.runs);
    aggregate.minFloor = minFloor === Infinity ? 0 : minFloor;
  }

  return aggregate;
}

function aggregateByClass(runs, classList) {
  const byClass = {};
  for (const className of classList) {
    byClass[className] = aggregateAudit(runs.filter(run => run.class === className));
  }
  return byClass;
}

function runAuditBatch(config) {
  const runs = [];
  const bySeed = {};
  for (const seedBase of config.seedBases) {
    const seedRuns = [];
    for (const className of config.classList) {
      for (let runIndex = 0; runIndex < config.perClass; runIndex++) {
        const seed = seedBase + runIndex;
        const run = runAuditSingle({
          className,
          seed,
          maxTurns: config.maxTurns,
          trace: config.trace,
          verbose: config.verbose,
        });
        seedRuns.push(run);
        runs.push(run);

        if (config.verbose) {
          console.log(
            `[seedBase ${seedBase}] ${className} #${runIndex + 1}/${config.perClass} seed=${seed} status=${run.status} floor=${run.finalFloor} turns=${run.gameTurns} steps=${run.decisionSteps}`
          );
          if (run.errors.length) console.log(`  errors: ${run.errors.join(' | ')}`);
        }
      }
    }
    bySeed[seedBase] = {
      overall: aggregateAudit(seedRuns),
      byClass: aggregateByClass(seedRuns, config.classList),
      runs: seedRuns,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    config,
    overall: aggregateAudit(runs),
    byClass: aggregateByClass(runs, config.classList),
    bySeed,
    runs,
  };
}

function printSummary(report) {
  const { config, overall, byClass } = report;
  console.log('Bot behavior audit');
  console.log(`  classes: ${config.classList.join(', ')}`);
  console.log(`  seeds: ${config.seedBases.join(', ')}`);
  console.log(`  perClass: ${config.perClass}`);
  console.log(`  maxTurns: ${config.maxTurns}`);
  console.log('');
  console.log(
    `overall: wins ${overall.wins}/${overall.runs} (${pct(overall.winRate)}) | floor5 ${pct(overall.floor5Rate)} | avg floor ${overall.avgFloor} | timeouts ${overall.timeouts} | stuck ${overall.stuck} | errors ${overall.errors}`
  );
  console.log(
    `events: missed heal ${overall.events.missedHeal} | missed teleport ${overall.events.missedTeleport} | missed bomb ${overall.events.missedBomb} | missed buff ${overall.events.missedBuff} | overclear ${overall.events.overclearSteps} | low-hp combat no healing ${overall.events.lowHpCombatNoHealing} | stalls ${overall.events.noOpStalls}`
  );
  console.log('');

  for (const className of config.classList) {
    const row = byClass[className];
    console.log(
      `${className.padEnd(12)} wins ${row.wins}/${row.runs} (${pct(row.winRate)}) | floor5 ${pct(row.floor5Rate)} | avg floor ${row.avgFloor} | timeouts ${row.timeouts} | deaths+res ${JSON.stringify(row.deathsWithResources)} | missed H/T/B/Bomb ${row.events.missedHeal}/${row.events.missedTeleport}/${row.events.missedBuff}/${row.events.missedBomb}`
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
    return null;
  }

  const unknownClasses = args.classList.filter(cls => !DEFAULT_CLASSES.includes(cls));
  if (unknownClasses.length) {
    console.warn(`Skipping unknown class names: ${unknownClasses.join(', ')}`);
    args.classList = args.classList.filter(cls => DEFAULT_CLASSES.includes(cls));
  }
  if (!args.classList.length) throw new Error('No valid classes selected');

  const report = runAuditBatch(args);
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
  DEFAULT_CLASSES,
  EVENT_KEYS,
  parseArgs,
  auditDecision,
  aggregateAudit,
  runAuditSingle,
  runAuditBatch,
  createAuditSnapshot,
  weaponPower,
  main,
};

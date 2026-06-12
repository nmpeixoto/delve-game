#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { runAuditBatch } = require('./bot_behavior_audit');

const CONFIG_PATH = path.join(__dirname, 'strategy_config.json');
const LESSONS_PATH = path.join(__dirname, 'lessons_learned.json');
const REPORT_DIR = path.join(__dirname, '..', 'balance_reports');
const CLASSES = ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk'];

function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
function saveConfig(c) { c.lastImproved = new Date().toISOString(); fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2)); }
function loadLessons() { return fs.existsSync(LESSONS_PATH) ? JSON.parse(fs.readFileSync(LESSONS_PATH, 'utf8')) : { version: 1, totalRuns: 0, classStats: {}, iterations: [] }; }
function saveLessons(l) { fs.writeFileSync(LESSONS_PATH, JSON.stringify(l, null, 2)); }

function runTests(config, perClass, seedBase) {
  return runAuditBatch({ classes: CLASSES.join(','), classList: CLASSES, perClass, seedBases: [seedBase], maxTurns: 8000, trace: false, verbose: false });
}

function analyzeReport(report) {
  const results = {};
  for (const cls of CLASSES) {
    const d = report.byClass[cls];
    results[cls] = {
      winRate: d.winRate, floor5Rate: d.floor5Rate, avgFloor: d.avgFloor,
      stuck: d.stuck, timeouts: d.timeouts, errors: d.errors,
      events: d.events, deathsWithResources: d.deathsWithResources,
    };
  }
  return results;
}

function scoreClass(m) {
  return (m.winRate * 100) + (m.floor5Rate * 100) + (m.avgFloor * 10) - (m.stuck * 50) - (m.timeouts * 50);
}

function printResults(results, label) {
  let best = '', bestS = -Infinity, worst = '', worstS = Infinity;
  for (const cls of CLASSES) {
    const r = results[cls], s = scoreClass(r);
    console.log(`  ${cls.padEnd(12)} win ${(r.winRate*100).toFixed(1).padStart(5)}% | floor5 ${(r.floor5Rate*100).toFixed(1).padStart(5)}% | avg ${r.avgFloor.toFixed(1)} | score ${s.toFixed(0).padStart(4)}`);
    if (s > bestS) { bestS = s; best = cls; }
    if (s < worstS) { worstS = s; worst = cls; }
  }
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  Best: ${best} (${bestS.toFixed(0)}) | Worst: ${worst} (${worstS.toFixed(0)})`);
  return { best, bestS, worst, worstS };
}

// ── DEEP ANALYSIS: WHY is this class failing? ──
function deepAnalyze(cls, metrics, config) {
  const issues = [];
  const cd = config.classes[cls];

  if (metrics.deathsWithResources.potions > 0)
    issues.push({ severity: 'high', msg: `Died ${metrics.deathsWithResources.potions}x with potions`, fix: { param: 'combatPotionFloor', dir: -1 } });
  if (metrics.deathsWithResources.teleports > 0)
    issues.push({ severity: 'high', msg: `Died ${metrics.deathsWithResources.teleports}x with teleports`, fix: { param: 'exitHp', dir: -1 } });
  if (metrics.events.lowHpCombatNoHealing > 200)
    issues.push({ severity: 'high', msg: `${metrics.events.lowHpCombatNoHealing} turns fighting low HP no heal`, fix: { param: 'combatHpFloor', dir: -1 } });
  if (metrics.floor5Rate === 0 && metrics.avgFloor < 3.5)
    issues.push({ severity: 'high', msg: `Never floor 5 (avg ${metrics.avgFloor.toFixed(1)})`, fix: { param: 'exploreThreshold', dir: 1 } });
  if (metrics.floor5Rate > 0 && metrics.winRate === 0)
    issues.push({ severity: 'medium', msg: `Floor5 ${(metrics.floor5Rate*100).toFixed(0)}% but 0 wins`, fix: { param: 'weaponBias', dir: 1 } });
  if (metrics.stuck > 0)
    issues.push({ severity: 'high', msg: `Stuck ${metrics.stuck}x`, fix: { param: 'exploreThreshold', dir: -1 } });
  if (metrics.events.overclearSteps > 50)
    issues.push({ severity: 'medium', msg: `${metrics.events.overclearSteps} overclear steps`, fix: { param: 'exploreThreshold', dir: 1 } });
  if (metrics.avgFloor < 3.0)
    issues.push({ severity: 'medium', msg: `Avg floor ${metrics.avgFloor.toFixed(1)}`, fix: { param: 'potionTarget', dir: 1 } });
  if (cd.goldReserve > 60 && metrics.avgFloor < 3.3)
    issues.push({ severity: 'low', msg: `Gold reserve ${cd.goldReserve} too high`, fix: { param: 'goldReserve', dir: -1 } });

  return issues.sort((a, b) => ({ high: 3, medium: 2, low: 1 })[b.severity] - ({ high: 3, medium: 2, low: 1 })[a.severity]);
}

const TUNABLE = {
  exitHp:           { min: 0.50, max: 0.85, step: 0.03 },
  combatHpFloor:    { min: 0.35, max: 0.75, step: 0.03 },
  combatPotionFloor:{ min: 0.30, max: 0.70, step: 0.03 },
  exploreThreshold: { min: 0.15, max: 0.50, step: 0.03 },
  weaponBias:       { min: 1.0,  max: 2.0,  step: 0.1  },
  armorBias:        { min: 1.0,  max: 2.0,  step: 0.1  },
  potionTarget:     { min: 1,    max: 5,    step: 1    },
  goldReserve:      { min: 30,   max: 100,  step: 10   },
};

function varyParam(config, cls, paramName, direction) {
  const meta = TUNABLE[paramName]; if (!meta) return null;
  const current = config.classes[cls][paramName];
  const newVal = Math.round((current + direction * meta.step) * 1000) / 1000;
  if (newVal < meta.min || newVal > meta.max) return null;
  const c = JSON.parse(JSON.stringify(config));
  c.classes[cls][paramName] = newVal;
  return c;
}

function main() {
  const args = process.argv.slice(2);
  let perClass = 10, seedBase = 1000, continuous = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--per-class' || args[i] === '-p') perClass = parseInt(args[++i], 10) || 10;
    if (args[i] === '--seed-base') seedBase = parseInt(args[++i], 10) || 1000;
    if (args[i] === '--continuous' || args[i] === '-c') continuous = true;
  }

  let config = loadConfig();
  let lessons = loadLessons();
  let iteration = lessons.iterations ? lessons.iterations.length : 0;
  let totalImprovements = 0;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  DELVE Self-Improving Bot Loop                  ║');
  console.log(`║  Mode: ${continuous ? 'FOREVER (Ctrl+C to stop)' : 'Single cycle'}            ║`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  const maxIter = continuous ? Infinity : 1;

  while (iteration < maxIter) {
    iteration++;
    const iterSeed = seedBase + iteration * 1000;
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ITERATION ${iteration}`);
    console.log(`${'═'.repeat(60)}`);

    const report = runTests(config, perClass, iterSeed);
    const results = analyzeReport(report);
    const { best, bestS, worst, worstS } = printResults(results, `Iteration ${iteration}`);

    // Deep analysis
    const issues = deepAnalyze(worst, results[worst], config);
    if (issues.length > 0) {
      console.log(`\n  Analysis of ${worst}:`);
      for (const i of issues.slice(0, 3)) {
        console.log(`    [${i.severity.toUpperCase()}] ${i.msg}`);
      }
    }

    // Try top fix
    let applied = false;
    if (issues.length > 0 && issues[0].fix) {
      const fix = issues[0].fix;
      const nc = varyParam(config, worst, fix.param, fix.dir);
      if (nc) {
        const tr = runTests(nc, perClass, iterSeed + 500);
        const ts = analyzeReport(tr);
        const score = scoreClass(ts[worst]);
        const delta = (score - worstS).toFixed(1);
        if (score > worstS) {
          config = nc; saveConfig(config); totalImprovements++;
          applied = true;
          console.log(`\n  ✓ ${worst}.${fix.param} improved (${delta >= 0 ? '+' : ''}${delta})`);
        }
      }
    }

    // Save
    lessons.iterations = lessons.iterations || [];
    lessons.iterations.push({ iteration, ts: new Date().toISOString(), best, bestS, worst, worstS, improvements: totalImprovements });
    lessons.totalRuns = (lessons.totalRuns || 0) + report.runs.length;
    saveLessons(lessons);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, `iter_${iteration}.json`), JSON.stringify({ results, config: config.classes }, null, 2));

    console.log(`\n  improvements: ${totalImprovements} | runs: ${lessons.totalRuns}`);
    if (!continuous) break;
    // 1s pause
    const wait = Date.now() + 1000; while (Date.now() < wait) {}
  }
}

if (require.main === module) main();

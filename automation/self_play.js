#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { runAuditBatch } = require('./bot_behavior_audit');

const LESSONS_PATH = path.join(__dirname, 'lessons_learned.json');
const REPORT_PATH = path.join(__dirname, '..', 'balance_reports', 'self_play_latest.json');
const BOT_BRAIN_PATH = path.join(__dirname, 'bot_brain.js');

const TARGET_WIN_RATE = 0.05;
const CLASSES = ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk'];

function load() {
  if (fs.existsSync(LESSONS_PATH)) {
    return JSON.parse(fs.readFileSync(LESSONS_PATH, 'utf8'));
  }
  return { version: 1, totalRuns: 0, classStats: {}, strategies: {}, iteration: 0, lastUpdated: null };
}

function save(doc) {
  doc.lastUpdated = new Date().toISOString();
  fs.writeFileSync(LESSONS_PATH, JSON.stringify(doc, null, 2));
}

function runOnce(config) {
  const report = runAuditBatch({
    classes: CLASSES.join(','),
    classList: CLASSES,
    perClass: config.perClass || 10,
    seedBases: [1000],
    maxTurns: 5000,
    trace: false,
    verbose: false,
  });
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  return report;
}

function analyze(report, doc) {
  const out = [];
  for (const cls of CLASSES) {
    const data = report.byClass[cls];
    const running = doc.classStats[cls] || { wins: 0, runs: 0 };
    const allRuns = running.runs + data.runs;
    const allWins = running.wins + data.wins;
    const winRate = allRuns > 0 ? allWins / allRuns : 0;
    const events = data.events;

    out.push({
      class: cls,
      winRate,
      avgFloor: data.avgFloor,
      floor5Rate: data.floor5Rate,
      missedHeals: events.missedHeal,
      missedTeleports: events.missedTeleport,
      missedBombs: events.missedBomb,
      lowHpCombat: events.lowHpCombatNoHealing,
      lethalNonEscape: events.lethalNonEscape,
      stuckRate: data.stuck / data.runs,
    });
  }
  return out;
}

function suggestAdjustments(analysis, doc) {
  const suggestions = [];
  for (const a of analysis) {
    if (a.winRate < TARGET_WIN_RATE) {
      suggestions.push({
        class: a.class,
        issue: 'low_win_rate',
        details: `${a.class} win rate ${(a.winRate*100).toFixed(1)}% < target ${(TARGET_WIN_RATE*100).toFixed(1)}%`,
      });
    }
    if (a.missedHeals > a.class.runs * 0.3 && a.missedHeals > 0) {
      suggestions.push({ class: a.class, issue: 'missed_heals', details: `${a.missedHeals} missed heal opportunities` });
    }
    if (a.lethalNonEscape > 0) {
      suggestions.push({ class: a.class, issue: 'lethal_non_escape', details: `${a.lethalNonEscape} lethal situations not escaped` });
    }
  }
  return suggestions;
}

function main() {
  const args = process.argv.slice(2);
  const config = { perClass: 10, continuous: false, maxIterations: 1 };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--continuous' || args[i] === '-c') config.continuous = true;
    else if (args[i] === '--iterations' || args[i] === '-n') config.maxIterations = parseInt(args[++i], 10) || 1;
    else if (args[i] === '--per-class' || args[i] === '-p') config.perClass = parseInt(args[++i], 10) || 10;
  }

  const doc = load();
  let iter = doc.iteration || 0;
  const maxIter = config.continuous ? Infinity : config.maxIterations;

  while (iter < maxIter) {
    iter++;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Iteration ${iter} — ${CLASSES.length} classes × ${config.perClass} runs`);
    console.log(`${'='.repeat(60)}`);

    const report = runOnce(config);

    const analysis = analyze(report, doc);
    const suggestions = suggestAdjustments(analysis, doc);

    // Update running stats
    for (const cls of CLASSES) {
      if (!doc.classStats[cls]) doc.classStats[cls] = { wins: 0, runs: 0, deaths: 0, totalFloor: 0, bestFloor: 0 };
      const s = doc.classStats[cls];
      for (const run of report.runs.filter(r => r.class === cls)) {
        s.runs++;
        if (run.status === 'won') s.wins++;
        else if (run.status === 'dead') s.deaths++;
        s.totalFloor += run.finalFloor || 0;
        s.bestFloor = Math.max(s.bestFloor, run.finalFloor || 0);
      }
    }
    doc.totalRuns = (doc.totalRuns || 0) + report.runs.length;
    doc.iteration = iter;

    // Print summary
    console.log(`\nIteration ${iter} results (${CLASSES.length} classes, ${config.perClass} runs each):`);
    for (const a of analysis) {
      console.log(`  ${a.class.padEnd(12)} win ${(a.winRate*100).toFixed(1)}% | avg floor ${a.avgFloor} | floor5 ${(a.floor5Rate*100).toFixed(1)}% | missed heal ${a.missedHeals} | low HP combat ${a.lowHpCombat}`);
    }

    if (suggestions.length > 0) {
      console.log(`\nSuggestions for next iteration:`);
      for (const s of suggestions) {
        console.log(`  ${s.class}: ${s.issue} — ${s.details}`);
      }
    }

    save(doc);

    if (iter >= maxIter) break;
    console.log(`\n--- Waiting for next iteration ---\n`);
  }

  console.log(`\nCompleted ${iter} iterations. Total runs: ${doc.totalRuns}`);
}

if (require.main === module) main();

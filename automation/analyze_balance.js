#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function analyzeResults(report, lessons) {
  const analysis = {
    classPerformance: {},
    imbalances: [],
    bugs: [],
    recommendations: [],
  };
  
  const classes = Object.keys(report.byClass);
  const classMetrics = {};
  
  for (const cls of classes) {
    const data = report.byClass[cls];
    classMetrics[cls] = {
      winRate: data.winRate,
      floor5Rate: data.floor5Rate,
      avgFloor: data.avgFloor,
      avgTurns: data.avgTurns,
      stuckRate: data.stuck / data.runs,
      timeoutRate: data.timeouts / data.runs,
      deathsWithResources: data.deathsWithResources,
      missedHeals: data.events.missedHeal,
      missedTeleports: data.events.missedTeleport,
      missedBombs: data.events.missedBomb,
      missedBuffs: data.events.missedBuff,
      overclearSteps: data.events.overclearSteps,
    };
    analysis.classPerformance[cls] = classMetrics[cls];
  }
  
  const avgWinRate = classes.reduce((sum, c) => sum + classMetrics[c].winRate, 0) / classes.length;
  const avgFloor5Rate = classes.reduce((sum, c) => sum + classMetrics[c].floor5Rate, 0) / classes.length;
  
  for (const cls of classes) {
    const m = classMetrics[cls];
    
    if (m.winRate < avgWinRate - 0.15) {
      analysis.imbalances.push(`${cls} has significantly lower win rate (${(m.winRate*100).toFixed(1)}% vs avg ${(avgWinRate*100).toFixed(1)}%)`);
    }
    
    if (m.floor5Rate < avgFloor5Rate - 0.15) {
      analysis.imbalances.push(`${cls} reaches floor 5 less often (${(m.floor5Rate*100).toFixed(1)}% vs avg ${(avgFloor5Rate*100).toFixed(1)}%)`);
    }
    
    if (m.stuckRate > 0.1) {
      analysis.bugs.push(`${cls} gets stuck ${(m.stuckRate*100).toFixed(1)}% of the time - possible pathfinding or decision bug`);
    }
    
    if (m.timeoutRate > 0.15) {
      analysis.bugs.push(`${cls} times out ${(m.timeoutRate*100).toFixed(1)}% of the time - possible exploration inefficiency`);
    }
    
    const totalMissed = m.missedHeals + m.missedTeleports + m.missedBombs + m.missedBuffs;
    const runs = report.byClass[cls].runs;
    if (totalMissed > runs * 0.5) {
      analysis.recommendations.push(`${cls}: Bot missed ${totalMissed} opportunities - improve decision timing`);
    }
    
    if (m.deathsWithResources.potions > runs * 0.2) {
      analysis.recommendations.push(`${cls}: Died with potions ${m.deathsWithResources.potions} times - improve emergency healing`);
    }
    
    if (m.deathsWithResources.teleports > runs * 0.15) {
      analysis.recommendations.push(`${cls}: Died with teleports ${m.deathsWithResources.teleports} times - improve escape logic`);
    }
    
    if (m.overclearSteps > runs * 10) {
      analysis.recommendations.push(`${cls}: Excessive overclearing (${m.overclearSteps} steps) - head to stairs sooner`);
    }
  }
  
  const winRates = classes.map(c => classMetrics[c].winRate);
  const maxWin = Math.max(...winRates);
  const minWin = Math.min(...winRates);
  if (maxWin - minWin > 0.3) {
    analysis.imbalances.push(`Large win rate spread: ${classes[winRates.indexOf(maxWin)]} (${(maxWin*100).toFixed(1)}%) vs ${classes[winRates.indexOf(minWin)]} (${(minWin*100).toFixed(1)}%)`);
  }
  
  return analysis;
}

function generateStrategyUpdates(analysis, lessons) {
  const updates = [];
  
  for (const rec of analysis.recommendations) {
    if (rec.includes('missed') && rec.includes('opportunities')) {
      updates.push(`Improve ability/consumable timing: ${rec.split(':')[0]}`);
    }
    if (rec.includes('Died with potions')) {
      updates.push(`Lower emergency healing threshold: ${rec.split(':')[0]}`);
    }
    if (rec.includes('Died with teleports')) {
      updates.push(`Use teleports more aggressively when cornered: ${rec.split(':')[0]}`);
    }
    if (rec.includes('overclearing')) {
      updates.push(`Reduce exploration threshold, head to stairs sooner: ${rec.split(':')[0]}`);
    }
  }
  
  for (const imb of analysis.imbalances) {
    if (imb.includes('significantly lower win rate')) {
      const cls = imb.split(' ')[0];
      updates.push(`Buff ${cls} strategy or investigate class weakness`);
    }
  }
  
  for (const bug of analysis.bugs) {
    if (bug.includes('gets stuck')) {
      updates.push(`Fix pathfinding: ${bug.split(' ')[0]}`);
    }
    if (bug.includes('times out')) {
      updates.push(`Improve exploration efficiency: ${bug.split(' ')[0]}`);
    }
  }
  
  return updates;
}

function main() {
  const reportPath = process.argv[2] || path.join(__dirname, '..', 'balance_reports', 'self_play_latest.json');
  const lessonsPath = process.argv[3] || path.join(__dirname, 'lessons_learned.json');
  
  if (!fs.existsSync(reportPath)) {
    console.error(`Report not found: ${reportPath}`);
    process.exit(1);
  }
  
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const lessons = fs.existsSync(lessonsPath) ? JSON.parse(fs.readFileSync(lessonsPath, 'utf8')) : {};
  
  const analysis = analyzeResults(report, lessons);
  console.log(JSON.stringify(analysis, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  analyzeResults,
  generateStrategyUpdates,
};

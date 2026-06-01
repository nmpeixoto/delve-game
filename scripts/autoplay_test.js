const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function waitForServer(url, attempts = 12, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return;
    } catch (err) {
      // keep retrying
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw new Error(`Server not reachable at ${url}`);
}

async function waitForGameStable(page) {
  await page.waitForFunction(() => {
    return typeof G === 'undefined' || !G.enemies || !G.enemies.some(e => e.dying);
  }, { timeout: 1500 }).catch(() => {});
}

function hasActionResolved(before, after) {
  if (!before || !after) return true;
  if (after.gameOver || after.won) return true;
  return before.turn !== after.turn
    || before.floor !== after.floor
    || before.x !== after.x
    || before.y !== after.y
    || before.hp !== after.hp
    || before.ability1Cooldown !== after.ability1Cooldown
    || before.ability2Cooldown !== after.ability2Cooldown
    || before.enemyState !== after.enemyState;
}

async function getActionSnapshot(page) {
  return page.evaluate(() => {
    if (typeof G === 'undefined' || !G || !G.player) return null;
    return {
      turn: G.turn,
      floor: G.floor,
      gameOver: G.gameOver,
      won: G.won,
      x: G.player.x,
      y: G.player.y,
      hp: G.player.hp,
      ability1Cooldown: G.ability1Cooldown,
      ability2Cooldown: G.ability2Cooldown,
      enemyState: G.enemies
        .map(e => `${e.id || e.name}:${e.hp}:${e.x},${e.y}:${e.dying ? 1 : 0}`)
        .join('|'),
    };
  });
}

async function waitForActionResolution(page, beforeSnapshot) {
  const timeoutAt = Date.now() + 350;
  while (Date.now() < timeoutAt) {
    const afterSnapshot = await getActionSnapshot(page).catch(() => null);
    if (hasActionResolved(beforeSnapshot, afterSnapshot)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

function isRetryableStartupResult(result) {
  if (!result || result.turns !== 0) return false;
  if (result.status !== 'error' && result.status !== 'fatal_script_error') return false;

  const retryable = [
    'ERR_CONNECTION_REFUSED',
    'unknown error occurred when fetching the script',
    'Waiting failed',
    'Waiting for selector',
    'Server not reachable',
  ];
  return result.errors.some(err => retryable.some(pattern => err.includes(pattern)));
}

async function runAutoBot(url, runIndex, heroClass = 'warrior') {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  await page.setViewport({ width: 1280, height: 800 });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(`[Error]: ${msg.text()}`);
  });
  page.on('pageerror', error => {
    errors.push(`[Exception]: ${error.message}`);
  });

  try {
    await waitForServer(url);
    await page.goto(url, { waitUntil: 'networkidle0' });

    // Click NEW GAME
    await page.waitForSelector('#title-screen .btn', { visible: true });
    await page.click('#title-screen .btn');

    // Wait for class select overlay
    await page.waitForSelector('#class-select-overlay', { visible: true });

    // Select the class
    await page.click(`#cbtn-${heroClass}`);

    // Click START
    await page.click('#class-select-modal .btn-gold');

    await page.waitForFunction(() => {
      const el = document.getElementById('game-screen');
      return el && !el.classList.contains('hidden');
    });

    // Inject the brain logic
    await page.addScriptTag({ path: path.join(__dirname, '..', 'bot_brain.js') });

    // Wait for game start and disable debounce
    await page.waitForFunction(() => typeof G !== 'undefined' && G.map && G.player);
    await page.evaluate(() => { window.canAct = () => true; });
    let turns = 0;
    const MAX_TURNS = parseInt(process.env.MAX_TURNS, 10) || 5000;
    let floor = 1;
    let finalStatus = 'max_turns';
    let decisions = [];
    while (turns < MAX_TURNS) {
      if (errors.length > 0) {
        finalStatus = 'error';
        break;
      }

      // Re-inject if the script was somehow lost, but since it's an SPA it should persist
      const isBrainLoaded = await page.evaluate(() => typeof window.botDecisionLogic === 'function');
      if (!isBrainLoaded) {
          await page.addScriptTag({ path: path.join(__dirname, '..', 'bot_brain.js') });
      }

      const step = await page.evaluate(() => {
        const decision = window.botDecisionLogic();
        if (typeof G === 'undefined' || !G.player) return { decision, trace: { decision } };

        const MAP_H = G.map ? G.map.length : 36;
        const MAP_W = G.map && G.map[0] ? G.map[0].length : 56;
        const STAIRS = 2;
        const p = G.player;
        const liveEnemies = G.enemies.filter(e => !e.dying);
        const visibleEnemies = liveEnemies
          .filter(e => G.visible.has(e.y * MAP_W + e.x))
          .map(e => ({
            name: e.name,
            hp: e.hp,
            dist: Math.abs(e.x - p.x) + Math.abs(e.y - p.y),
          }))
          .sort((a, b) => a.dist - b.dist || a.hp - b.hp)
          .slice(0, 4);
        const adjEnemies = liveEnemies.filter(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1).length;
        let seenStairs = false;
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            if (G.map[y][x] === STAIRS && G.seen.has(y * MAP_W + x)) seenStairs = true;
          }
        }

        return {
          decision,
          trace: {
            decision,
            floor: G.floor,
            turn: G.turn,
            hp: `${p.hp}/${p.maxHp}`,
            pos: `${p.x},${p.y}`,
            gold: p.gold,
            lvl: p.lvl,
            ability1Cooldown: G.ability1Cooldown,
            ability2Cooldown: G.ability2Cooldown,
            enemies: liveEnemies.length,
            dyingEnemies: G.enemies.length - liveEnemies.length,
            adjEnemies,
            visibleEnemies,
            seenStairs,
            onStairs: G.map[p.y][p.x] === STAIRS,
            potions: G.items.filter(i => i.carried && i.type === 'potion').map(i => i.heal),
            logs: G.log.map(l => l.msg).slice(0, 3),
          },
        };
      });
      const botDecision = step.decision;

      if (!botDecision) {
        finalStatus = 'stuck:' + JSON.stringify(step);
        break;
      }

      decisions.push(step.trace);
      if (decisions.length > 8) decisions.shift();

      if (botDecision.type === 'status') {
        finalStatus = botDecision.val;
        break;
      }

      const turnKeyActions = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'b', 'v', '.', '>']);
      const actionBefore = await getActionSnapshot(page);

      if (botDecision.type === 'click') {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.click();
        }, botDecision.target);
      } else if (botDecision.type === 'attack') {
        await page.evaluate((id) => tileAttack(id), botDecision.target);
      } else if (botDecision.type === 'key') {
        await page.keyboard.press(botDecision.val);
      }

      if (botDecision.type === 'attack' || (botDecision.type === 'key' && turnKeyActions.has(botDecision.val))) {
        await waitForActionResolution(page, actionBefore);
      }
      await waitForGameStable(page);

      const currentFloor = await page.evaluate(() => G.floor);
      if (currentFloor > floor) floor = currentFloor;

      turns++;
    }
    let logs = [];
    if (finalStatus !== 'fatal_script_error') {
      logs = await page.evaluate(() => {
        return typeof G !== 'undefined' && G.log ? G.log.map(l => l.msg).slice(0, 5) : [];
      }).catch(e => []);
    }

    return { run: runIndex, class: heroClass, turns, floor, status: finalStatus, errors, logs, decisions };
  } catch (err) {
    return { run: runIndex, class: heroClass, turns: 0, floor: 0, status: 'fatal_script_error', errors: [err.message], logs: [], decisions: [] };
  } finally {
    await browser.close();
  }
}

async function runAutoBotWithRetries(url, runIndex, heroClass = 'warrior') {
  const maxAttempts = parseInt(process.env.STARTUP_RETRIES, 10) || 3;
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await runAutoBot(url, runIndex, heroClass);
    if (!isRetryableStartupResult(lastResult)) return lastResult;
    if (attempt < maxAttempts) {
      console.log(`   -> Startup retry ${attempt}/${maxAttempts - 1} for ${heroClass.toUpperCase()}: ${lastResult.errors.join(' | ')}`);
    }
  }

  return lastResult;
}

async function runMany(count, classFilter = null) {
  console.log(`Starting ${count} automated bot runs using bot_brain.js...`);
  const results = [];
  const verbose = process.env.BOT_VERBOSE !== '0';
  const classes = classFilter ? [classFilter] : ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk'];
  for (let i = 1; i <= count; i++) {
    const cls = classes[(i - 1) % classes.length];
    console.log(`[Run ${i}/${count}] Playing as ${cls.toUpperCase()}...`);
    const res = await runAutoBotWithRetries('http://127.0.0.1:8080/src/index.html', i, cls);
    console.log(`   -> Ended with status: ${res.status.toUpperCase()} | Floor: ${res.floor} | Turns: ${res.turns} | Errors: ${res.errors.length}`);
    if (verbose && res.decisions.length > 0) {
      console.log(`   -> Last ${res.decisions.length} decisions: ${JSON.stringify(res.decisions)}`);
    }
    if (verbose && res.logs.length > 0) {
      console.log(`   -> Last 5 logs:`);
      res.logs.forEach(l => console.log(`      ${l}`));
    }
    results.push(res);
  }

  // Compile findings
  const totalTurns = results.reduce((acc, r) => acc + r.turns, 0);
  const maxFloor = Math.max(...results.map(r => r.floor));
  const minFloor = Math.min(...results.map(r => r.floor));
  const avgFloor = (results.reduce((acc, r) => acc + r.floor, 0) / count).toFixed(1);
  const avgTurns = (totalTurns / count).toFixed(1);

  const statuses = {};
  results.forEach(r => statuses[r.status] = (statuses[r.status] || 0) + 1);
  const byClass = {};
  results.forEach(r => {
    byClass[r.class] ||= { runs: 0, maxFloor: 0, totalFloor: 0, outcomes: {} };
    byClass[r.class].runs++;
    byClass[r.class].maxFloor = Math.max(byClass[r.class].maxFloor, r.floor);
    byClass[r.class].totalFloor += r.floor;
    byClass[r.class].outcomes[r.status] = (byClass[r.class].outcomes[r.status] || 0) + 1;
  });
  Object.values(byClass).forEach(c => {
    c.avgFloor = Number((c.totalFloor / c.runs).toFixed(1));
    delete c.totalFloor;
  });

  const allErrors = [];
  results.forEach(r => {
    if (r.errors.length > 0) allErrors.push({ run: r.run, errors: r.errors });
  });

  const report = {
    totalRuns: count,
    totalTurnsPlayed: totalTurns,
    floors: { max: maxFloor, min: minFloor, avg: avgFloor },
    turns: { avg: avgTurns },
    outcomes: statuses,
    byClass,
    bugCount: allErrors.length,
    bugs: allErrors
  };

  if (process.env.KEEP_TEST_ARTIFACTS === '1') {
    fs.writeFileSync('bot_findings.json', JSON.stringify(report, null, 2));
    console.log('\n✅ Completed all runs. Findings compiled to bot_findings.json');
  } else {
    console.log('\n✅ Completed all runs. Set KEEP_TEST_ARTIFACTS=1 to write bot_findings.json.');
  }
  console.log(`Summary: ${JSON.stringify(report)}`);
}

// Only run 3 times for the fast iterative learning loop by default, can be modified by the agent.
if (require.main === module) {
  const runsArg = parseInt(process.argv[2]) || 3;
  const classArg = process.argv[3] || null;
  runMany(runsArg, classArg).catch(console.error);
}

module.exports = {
  isRetryableStartupResult,
  hasActionResolved,
  runAutoBot,
  runAutoBotWithRetries,
  runMany,
};

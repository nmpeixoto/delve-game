const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function waitForGameStable(page) {
  await page.waitForFunction(() => {
    return typeof G === 'undefined' || !G.enemies || !G.enemies.some(e => e.dying);
  }, { timeout: 1200 }).catch(() => {});
}

async function runAutoBot(url, runIndex) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1280, height: 800 });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`[Error]: ${msg.text()}`);
  });
  page.on('pageerror', error => {
    errors.push(`[Exception]: ${error.message}`);
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#title-screen .btn', { visible: true });
    await page.click('#title-screen .btn');
    await page.waitForFunction(() => {
      const el = document.getElementById('game-screen');
      return el && !el.classList.contains('hidden');
    });

    // Inject the brain logic
    await page.addScriptTag({ path: path.join(__dirname, 'bot_brain.js') });

    // Wait for game start and disable debounce
    await page.waitForFunction(() => typeof G !== 'undefined' && G.map && G.player);
    await page.evaluate(() => { window.canAct = () => true; });
    let turns = 0;
    const MAX_TURNS = 5000;
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
          await page.addScriptTag({ path: path.join(__dirname, 'bot_brain.js') });
      }

      const step = await page.evaluate(() => {
        const decision = window.botDecisionLogic();
        if (typeof G === 'undefined' || !G.player) return { decision, trace: { decision } };

        const MAP_W = 28, MAP_H = 18, WALL = 0, STAIRS = 2;
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
            bashCooldown: G.bashCooldown,
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
        finalStatus = 'stuck';
        break;
      }

      decisions.push(step.trace);
      if (decisions.length > 8) decisions.shift();

      if (botDecision.type === 'status') {
        finalStatus = botDecision.val;
        break;
      }

      if (botDecision.type === 'click') {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.click();
        }, botDecision.target);
      } else if (botDecision.type === 'key') {
        await page.keyboard.press(botDecision.val);
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

    return { run: runIndex, turns, floor, status: finalStatus, errors, logs, decisions };
  } catch (err) {
    return { run: runIndex, turns: 0, floor: 0, status: 'fatal_script_error', errors: [err.message], logs: [], decisions: [] };
  } finally {
    await browser.close();
  }
}

async function runMany(count) {
  console.log(`Starting ${count} automated bot runs using bot_brain.js...`);
  const results = [];
  for (let i = 1; i <= count; i++) {
    console.log(`[Run ${i}/${count}] Playing...`);
    const res = await runAutoBot('http://127.0.0.1:8080/src/index.html', i);
    console.log(`   -> Ended with status: ${res.status.toUpperCase()} | Floor: ${res.floor} | Turns: ${res.turns} | Errors: ${res.errors.length}`);
    if (res.decisions.length > 0) {
      console.log(`   -> Last ${res.decisions.length} decisions: ${JSON.stringify(res.decisions)}`);
    }
    if (res.logs.length > 0) {
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
    bugCount: allErrors.length,
    bugs: allErrors
  };

  fs.writeFileSync('bot_findings.json', JSON.stringify(report, null, 2));
  console.log('\n✅ Completed all runs. Findings compiled to bot_findings.json');
}

// Only run 3 times for the fast iterative learning loop by default, can be modified by the agent.
const runsArg = parseInt(process.argv[2]) || 3;
runMany(runsArg).catch(console.error);

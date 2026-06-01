---
name: play-delve-and-learn
description: >-
  Executes an automated gameplay test loop for DELVE, analyzes decision traces and outcomes, updates the lessons ledger, adds focused regression tests, mutates bot logic, verifies results, and cleans up generated artifacts.
---

# DELVE Self-Improving Gameplay Loop

## Overview
This skill instructs the agent to run the DELVE automated test bot (`scripts/autoplay_test.js`), evaluate its performance and causes of death from decision traces, and inject smarter heuristics into `bot_brain.js`. The goal is to maximize honest average floor depth and win rate without exploiting runner artifacts.

## Dependencies
This skill requires Node.js and Puppeteer to be installed in the project root.

## Quick Start
To trigger this skill, the user can say:
*"Run the play-delve-and-learn loop for 3 iterations to improve survivability."*

## Workflow

Follow these steps exactly when invoked:

### 1. Run the Bot
- Ensure a local static server is available for `http://127.0.0.1:8080/src/index.html` before running Puppeteer.
- Execute a small baseline batch first: `node scripts/autoplay_test.js 3` or `node scripts/autoplay_test.js 5`. The runner will print a summary to the console.
- If you need detailed JSON telemetry for your analysis, run with `KEEP_TEST_ARTIFACTS=1 node scripts/autoplay_test.js 3` to write `bot_findings.json`.
- Treat `bot_findings.json` as a temporary artifact. Read it, summarize the useful data, then delete it before finishing unless the user asks to keep it.

### 2. Analyze the Findings
- Read `bot_findings.json`.
- Examine `outcomes`, floor statistics, `totalTurnsPlayed`, console errors, and the printed decision traces from `scripts/autoplay_test.js`.
- Prefer concrete evidence from recent traces: HP, floor, position, visible enemies, adjacent enemies, stairs visibility, potions, and recent logs.
- Distinguish game failures from runner failures. Browser/network errors, stale modal state, or animation timing bugs should not be treated as bot strategy failures.
- Watch for runner artifacts such as acting during enemy death animations, repeated attacks on `dying` enemies, or inflated XP/gold.

### 3. Document Lessons Learned
- Open `lessons_learned.md`.
- Append an iteration entry with the run count, win rate, average floor, notable errors, and the root cause of the observed weakness.
- Propose a specific, programmatic rule to fix the weakness.
- If a batch includes external browser errors, record them separately and avoid overstating the strategic result.

### 4. Mutate the Brain
- Add or update focused regression tests before changing strategy when feasible:
  - Use `tests/bot_brain_test.js` for decision-logic rules.
  - Use `tests/combat_test.js` for engine/combat invariants.
- Implement the new rule in `window.botDecisionLogic`.
- If the root cause is in the game engine or harness, patch the source module in `src/js/` and replicate production changes to `dungeon.html` when finalizing.
- Keep heuristics honest: do not depend on animation timing, repeated corpse attacks, stale DOM state, or other runner-only behavior.

### 5. Verify
- Run `npm test` after bot or combat changes.
- Run `node scripts/autoplay_test.js 5` or a larger requested batch to measure behavior.
- Run `node scripts/browser_smoke.js` when UI/runtime behavior or `dungeon.html` changes.
- Read the full command output and use only fresh verification evidence in the final summary.

### 6. Clean Up
- Delete temporary artifacts before finishing: `bot_findings.json`, `screenshot_*.png`, ad-hoc diagnostic scripts, trace logs, and other one-off generated files.
- Stop or close background browser/server sessions started only for the task when they are no longer needed.
- If an artifact should be retained, state why and make sure it is intentionally tracked or ignored.

### 7. Iterate
- If the user requested multiple macro-iterations, repeat the run/analyze/test/mutate/verify/cleanup loop.
- Stop when the iterations are complete, and summarize the evidence and remaining bottleneck.

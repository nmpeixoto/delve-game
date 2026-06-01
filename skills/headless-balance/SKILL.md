---
name: headless-balance
description: Faithful Node VM balance runs for DELVE. Use this to measure per-class win rate, floor depth, and turn counts with fixed seeds without launching Chromium.
---

# Headless Balance

## Overview

Use this skill when you need reproducible class-balance data from the real DELVE rules without browser overhead. It runs the game logic in a Node VM, drives the existing bot brain, and reports per-class outcomes so you can tune difficulty against measured win rates instead of gut feel.

## When To Use

Use this skill for:

- load-balancing the playable classes
- comparing before/after balance changes with the same seed set
- checking whether a class is underperforming or overperforming
- diagnosing a headless/browser parity bug before changing balance numbers

Do not use it for UI verification or touch interaction checks. For that, use the browser autoplay or smoke tests.

## Workflow

1. Run a fixed-seed batch.
   - Example:
     `node automation/headless-balance/headless_balance.js --classes warrior,rogue,mage,paladin,ranger,barbarian,necromancer,monk --per-class 20 --seed-base 1000 --max-turns 5000 --output bot_findings.json`
   - If you need concurrency, launch one process per class and write each report to its own file.
2. Read the summary.
   - Focus on `winRate`, `floor5Rate`, `avgFloor`, `avgTurns`, `avgSteps`, and `stuck` counts.
3. Compare classes against the target band.
   - The practical target is roughly 25% to 35% wins per class.
   - If a class sits outside that band, inspect its trace and the last few logs before changing balance values.
4. Treat divergence as a bug first.
   - If the headless run disagrees with browser autoplay on the same seed, fix the parity problem before tuning class numbers.
5. Keep the seeds stable.
   - Reuse the same `--seed-base` when comparing branches so the data stays comparable.
6. Keep traces targeted.
   - Use `--trace` for one-off debugging or small batches only. It is not meant for long sweeps.

## CLI

- `--classes` or `--class`: comma-separated class list
- `--per-class`: number of runs per class
- `--seed-base`: starting seed for the batch
- `--max-turns`: runner step cap for a single run
- `--output`: write the JSON report to disk
- `--trace`: include per-step traces in the report
- `--verbose`: print per-run progress lines

## Output

The report includes:

- `status` per run: `won`, `dead`, `stuck`, `max_turns`, or `fatal_script_error`
- `finalFloor` and `gameTurns`
- `winRate` and `floor5Rate` per class
- `avgFloor`, `avgTurns`, and `avgSteps`
- `errors` and `stuck` counts

## Notes

- The runner uses the real `src/js` rules and the real `automation/bot_brain.js` policy.
- It does not use Puppeteer.
- If a batch exposes a new class imbalance, fix the game or bot logic first, then rerun the same seed set.

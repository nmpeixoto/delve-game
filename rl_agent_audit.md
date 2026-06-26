# RL Agent Audit Report - Verified Update

**Original report date**: 2026-06-25
**Updated**: 2026-06-26
**Repository**: `C:\Users\Xavier\Documents\delve-game-main`

## Executive Summary

After reading and tracing the referenced code paths, none of the original CRITICAL findings remain critical. The shop reserve-lockout claim is false, the combat-item scoring claim is false, and most of the remaining items are either low-priority tuning opportunities or unsupported design suggestions.

One behavior was real and worth fixing: the RL/headless environment auto-drank emergency potions instead of exposing the browser's manual drink/decline choice to the policy.

During verification, one additional RL bridge contract issue was confirmed and fixed: the current-shop feature slice was not at the documented tail position in the Python state extractor or the JavaScript inference port.

## Verification Performed

- Read and traced `automation/bot_brain.js`, `automation/headless_rl_runner.js`, `automation/strategy_config.json`, and the RL environment files under `automation/nn_rl/`.
- Read the relevant browser runtime paths in `src/js/state.js`, `src/js/emergency.js`, `src/js/movement.js`, `src/js/items.js`, `src/js/shop.js`, `src/js/combat.js`, and `src/js/constants.js`.
- Ran `node tests\bot_brain_test.js`: passed.
- Ran focused reserve-gold reproductions:
  - 55 gold, 55 reserve, 15-gold critical potion: bot selected the potion.
  - 55 gold, 55 reserve, 15-gold bomb with two adjacent enemies: bot selected the bomb.

## Fixed Finding

### FIXED - Emergency potion auto-drink was an RL simplification

**Original item**: BUG #3

**Fix status**: Fixed on 2026-06-26.

**Code paths**:

- `automation/headless_rl_runner.js`: exposes `pendingHit` snapshots and resolves only explicit emergency decisions.
- `automation/nn_rl/game_engine.py`: stores pending emergency hits and resolves them through `resolve_emergency(...)`.
- `src/js/emergency.js`: the browser runtime exposes the reference manual emergency potion drink/decline overlay.
- `automation/nn_rl/action_mask.py`: pending emergency prompts now mask normal gameplay and expose only drink/decline actions.
- `automation/nn_rl/vector_env.py`: pending emergency prompts now map `USE_POTION` to drink and `ESCAPE` to decline.

**Reasoning**:

The `canAct` override in the headless runner is not itself a bug; it is a synchronous test-throughput choice that bypasses browser debounce and overlay gating. The real issue was that emergency-potion decisions were automated in both the Node headless runner and the pure-Python RL environment.

The pure-Python engine now stores a pending emergency hit, exposes serializable `pendingHit` metadata in snapshots, and waits for the RL policy to choose drink or decline. The action mask treats that pending hit as a blocking overlay. The legacy Node runner also exposes `pendingHit` in snapshots, accepts explicit `{ type: 'emergency', drink: boolean }` decisions, and no longer auto-drinks after every step.

**Impact**:

The policy can now learn emergency potion resource tradeoffs instead of inheriting an automatic survival rule.

**Confidence**: High.

**Verification**:

- Added Python tests for emergency action masking, drink/decline decision mapping, and Python-engine pending-hit behavior.
- Added a Node runner regression test for explicit emergency resolution.
- Ran `npm test`: passed.
- Ran focused Python emergency tests: passed.

### FIXED - Shop state features were not encoded at the vector tail

**Original item**: Found during fix verification, not part of the original critical list.

**Fix status**: Fixed on 2026-06-26.

**Code paths**:

- `automation/nn_rl/config.py`: defines `STATE_DIM = 69 + MAX_SHOP_SLOTS * SHOP_ITEM_FEATURES`.
- `automation/nn_rl/state_extractor.py`: now emits all 69 non-shop scalar features before appending shop slots.
- `automation/nn_rl/inference.js`: mirrors the same ordering for browser-side inference.

**Reasoning**:

`tests/nn_rl_bridge_test.py` calculates the shop feature start as `STATE_DIM - MAX_SHOP_SLOTS * SHOP_ITEM_FEATURES`, which is index `69`. The extractor previously appended the shop slice after 64 non-shop features and then appended five tactical-context features, so current-shop stock appeared at index `64` instead of the documented tail slice. Moving those five tactical features before shop encoding preserves the 411-feature length and restores the expected tail layout.

**Impact**:

Python training/evaluation code and JavaScript inference now agree with the documented state-vector contract for shop observations.

**Confidence**: High.

**Verification**:

- Ran `python -m unittest tests.nn_rl_bridge_test.NnRlBridgeTest.test_extract_state_includes_current_shop_stock`: passed.
- Ran a Node extractor smoke check confirming `state.length === 411` and `state[69] === 1` for an open shop with stock.
- Ran `python tests\nn_rl_bridge_test.py`: passed.

## Retracted Findings

### NOT A BUG - BUG #1: Shop gold reserve lockout blocks potions/bombs

**Code path**: `automation/bot_brain.js` `usefulShopItem(...)`, `shouldSpendGoldOn(...)`, `reserveGold(...)`.

**Claim audited**:

The original report claimed the reserve-gold check prevents buying emergency potions or bombs when gold equals the configured reserve.

**Actual logic**:

```js
if (p.gold - item.price < reserveGold() && !shouldSpendGoldOn(item)) return false;
```

When a purchase would cross the reserve, JavaScript evaluates `shouldSpendGoldOn(item)`. Survival and pressure purchases are allowed through:

- Potion: `criticalRecovery || carriedPotions().length < strategy.potionTarget`
- Teleport: `criticalRecovery || carriedTeleports().length < strategy.teleportTarget`
- Bomb: `carriedBombs().length < strategy.bombTarget || (visEnemies.length > 0 && adjEnemies.length >= 2)`

**Contradicting evidence**:

Focused reproductions selected a critical potion and a pressure bomb even though both purchases crossed the reserve threshold.

**Confidence**: High.

### NOT A BUG - BUG #2: Shop scoring prefers upgrades at critical HP

**Code path**: `automation/bot_brain.js` `usefulShopItem(...)`, `shopItemScore(...)`, `chooseShopPurchase(...)`.

**Claim audited**:

The original report claimed combat items receive no survival bonus, so equipment upgrades can be purchased over potions while critically injured.

**Actual logic**:

Useful items are filtered before scoring. At critical HP, potions and teleports pass `shouldSpendGoldOn(...)` even if reserve gold would be crossed. Equipment purchases still must pass `canEquip(...)`, affordability, usefulness, and reserve checks. For consumables, `shopItemScore(...)` also adds class-specific potion bonuses, target-stock bonuses, bomb-pressure bonuses, and teleport bonuses.

**Contradicting evidence**:

The targeted potion reproduction selected the potion at critical HP with the reserve guard active.

**Confidence**: High.

### NOT A BUG - BUG #4: Bombs are reactive only, never proactively stocked

**Code path**: `automation/bot_brain.js` `wantsMoreBombs(...)`, `shouldSpendGoldOn(...)`, `shopItemScore(...)`.

**Reasoning**:

Bombs are proactively stocked up to `strategy.bombTarget`, and that target is read from `automation/strategy_config.json`. The adjacent-enemy branch is an additional pressure override, not the only path that permits buying bombs.

**Confidence**: High.

### TUNING ONLY - BUG #5: Teleports are hidden-secret gated

**Code path**: `automation/bot_brain.js` `wantsMoreTeleports(...)`, `hiddenSecretsRemain(...)`, `shouldSpendGoldOn(...)`.

**Reasoning**:

Teleports are proactively stocked up to `strategy.teleportTarget`, independent of known hidden secrets. The hidden-secret check affects extra valuation, not the base ability to buy a teleport. The possible tuning concern is narrower: the heuristic does not appear to value teleports for speculative secret discovery once all currently known secret signals are gone.

**Confidence**: Medium.

### NOT A BUG - BUG #6: Panic-mode threshold math is inverted

**Code path**: `automation/bot_brain.js` panic-mode calculation around `combatPotionFloor`, `panicFloor`, and `Math.min(...)`.

**Claim audited**:

The original report claimed `Math.min(combatPotionFloor, panicFloor)` makes panic mode trigger at the wrong threshold.

**Actual calculation**:

With the report's own example values, `Math.min(0.52, 0.30) === 0.30`. Therefore `hp <= maxHp * 0.30` means "only when below both thresholds," not "use the higher threshold accidentally."

**Confidence**: High.

### NOT A BUG - BUG #7: Class item preferences cause duplicate wasted buys

**Code path**: `automation/bot_brain.js` `canEquip(...)`; `src/js/items.js` auto-equip logic.

**Reasoning**:

Shop equipment must pass `canEquip(item)`, which compares the candidate value against currently equipped gear of the same type. The game also auto-equips better gear on pickup. The original report did not provide a path where same-slot, equal-or-worse duplicate equipment remains purchaseable and preferred.

**Confidence**: Medium-high.

### LOW - BUG #8: Full-map hidden-secret scan may be inefficient

**Code path**: `automation/bot_brain.js` `hiddenSecretsRemain(...)`.

**Reasoning**:

The full-map scan is real, but the map is small. Based on `MAP_W = 56` and `MAP_H = 36`, the scan touches at most `56 * 36 = 2016` cells. That is unlikely to be a meaningful bottleneck unless profiling shows it in hot loops across very large training batches.

**Confidence**: High.

### LOW / TUNING - BUG #9: Trap-disarm risk assessment is incomplete

**Code paths**:

- `automation/bot_brain.js` `isDangerousTrap(...)`, `trapDamage(...)`.
- `src/js/movement.js` trap stepping/disarm logic.

**Reasoning**:

The original claim was overstated. The bot avoids known trap coordinates when HP is low enough relative to trap damage, and the game rewards revealed-trap disarms. The remaining issue is tuning: the heuristic does not appear to explicitly path toward revealed traps for the disarm reward, so it may under-use safe disarm opportunities.

**Confidence**: Medium.

### UNKNOWN / NOT ACTIONABLE - BUG #10: Item synergy scoring missing

**Code path**: broad shop scoring and strategy heuristic code in `automation/bot_brain.js`.

**Reasoning**:

This is a broad design suggestion rather than a verified bug. The report did not identify a concrete failing path, target metric, or reproducible scenario where missing synergy scoring causes a regression.

**Confidence**: Unknown until tied to a reproducible gameplay or training outcome.

## Priority Recommendations

1. Do not patch BUG #1, BUG #2, BUG #4, BUG #6, or BUG #7 as reported. They are false positives based on the traced code.
2. Decide whether emergency potion usage should be a policy action or an automatic environment rule. If it should be learned, expose the drink/decline choice in the RL action space and reward model.
3. Treat teleport secret-search behavior, trap-disarm pathing, and item synergy as tuning work. Add metric-backed tests or seeded simulations before changing heuristics.
4. Only optimize `hiddenSecretsRemain(...)` if profiling shows it contributes meaningful runtime cost in training batches.

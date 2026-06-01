# Normal Mode Moderate Balance Pass Design

## Context

The latest normal-mode headless audit after the previous tuning pass is still below the intended challenge curve:

- Overall average floor: 3.5.
- Floor 5 reaches: 8 / 400 runs.
- Wins: 2 / 400 runs.
- Monk remains the weakest outlier, with 3.1 average floor and 0 / 50 floor 5 reaches.

The target is a moderate normal-mode difficulty: challenging, but not so punitive that most runs end before players can use class identity, mid-game gear, and level 5 abilities. Hard mode is intentionally out of scope for this pass and should be tuned separately afterward.

## Goals

- Raise normal-mode average floor from about 3.5 to roughly 4.0-4.3.
- Raise floor 5 reaches from 8 / 400 to roughly 30-60 / 400.
- Raise wins from 2 / 400 to roughly 15-25 / 400.
- Keep the game challenging by preserving early-floor danger and avoiding broad enemy nerfs.
- Reduce class spread, especially improving Monk so it is no longer a wide last-place outlier.
- Improve bot play around the adjusted systems only where the bot is failing to use already-useful tools.

## Non-Goals

- Do not tune Hard mode in this pass.
- Do not make floor 1 or floor 2 broadly easier.
- Do not rewrite the item system or shop system.
- Do not force every item to be class-relevant; roguelike variance should remain.
- Do not balance around a perfect bot. The bot should play plausibly and avoid obvious strategic mistakes, but some imperfection is acceptable.

## Design

### 1. Normal-Only Midgame XP Pacing

Add a small normal-mode XP pacing boost for floors 3 and 4 only:

- Floor 1: 1.00x XP.
- Floor 2: 1.00x XP.
- Floor 3: 1.15x XP.
- Floor 4: 1.25x XP.
- Floor 5: no special boost.

This targets the main failure mode from the audits: too many runs collapse before classes reach enough level-based power to express their identity. The boost should apply to enemy kill rewards, ideally through enemy spawn XP values so existing reward code remains simple.

Implementation should make mode detection explicit. If `G.hardMode` is not currently persisted in game state, add it during game initialization and cover it with tests so the XP boost cannot accidentally leak into Hard mode.

### 2. Better Class-Relevant Gear Access

Improve access to usable gear without removing item randomness:

- Shops should include at least one class-usable weapon or armor option when a valid candidate exists for the current floor.
- Armory rooms should strongly prefer class-usable gear for at least one generated item.
- Treasure and generic item drops may keep their current randomness, with only a small floor 3-4 bias if test results still show gear starvation.

This should help classes whose survival depends on finding compatible upgrades while avoiding a deterministic gear treadmill. The bot should not treat unused gear as useless if it is class-ineligible or situational; analysis should distinguish "not usable by this class" from "bad item".

### 3. Monk Low-Level Scaling

Improve Monk's early and midgame baseline by increasing unarmed scaling:

- Current behavior effectively gives Monk little to no unarmed weapon power at low levels.
- Change unarmed weapon power from `floor(level / 2)` to a slightly stronger curve such as `ceil(level / 2)`.
- Keep weapon auto-equip logic aware of this virtual unarmed power so Monk does not equip a weapon that is worse than fighting unarmed.

This is more targeted than reducing enemy pressure because it addresses the class-specific outlier shown by the audit. If Monk remains weak after this, a second option is to make Flurry reduce incoming retaliation for that exchange, but that is intentionally not included in the first implementation pass.

### 4. Bot Behavior Monitoring

The headless audit should continue capturing behavior evidence that separates balance problems from bot mistakes:

- Floor reached, death cause, final level, final gear, potions/scrolls/bombs used, and unused relevant consumables.
- Class-specific ability usage, especially Monk Push Kick and Flurry.
- Shop visits, purchases, skipped usable upgrades, and unaffordable relevant upgrades.
- Stairs behavior: whether the bot over-explores while low on resources or leaves too early with high resources.

Any new analysis should avoid the false conclusion that unused items are bad. Unused can mean the bot missed the right trigger, the item was class-ineligible, the item was unaffordable, the tactical window did not occur, or the run ended before it mattered.

## Data Flow

- Class, item, and enemy constants remain in `src/js/data.js`.
- XP scaling should live near enemy spawn or reward logic so all normal-mode automation and browser play use the same rule.
- Gear candidate filtering should reuse existing class compatibility helpers where possible.
- Bot heuristics remain in `automation/bot_brain.js`; they should consume the same item/class rules rather than duplicating balance assumptions.
- Production changes must be rebuilt into `dungeon.html` after source changes.

## Testing

Add focused tests before implementation where practical:

- XP tests proving floors 3 and 4 get normal-mode boosts while floors 1, 2, and Hard mode do not.
- Shop or item-generation tests proving at least one class-usable gear option appears when valid candidates exist.
- Monk tests proving unarmed scaling is stronger and auto-equip still rejects inferior weapons.
- Bot behavior tests only for concrete heuristic changes, not for aggregate win-rate expectations.

Verification after implementation:

- Run `npm test`.
- Run `npm run build`.
- Run browser smoke for `src/index.html` and `dungeon.html`.
- Run the same seeded 400-run normal-mode headless audit and compare against the latest baseline.

## Acceptance Criteria

The implementation is successful if the seeded normal-mode audit moves close to the target range without obvious regressions:

- Overall average floor: 4.0-4.3.
- Floor 5 reaches: 30-60 / 400.
- Wins: 15-25 / 400.
- No class below roughly 3.7 average floor.
- Monk improves materially and is not a wide outlier.
- Hard mode behavior is unchanged by construction, except for explicit state plumbing needed to isolate normal-mode changes.

If the first implementation pass undershoots, prefer a second small XP or gear-access adjustment over broad enemy nerfs. If it overshoots, first reduce the floor 4 XP boost or remove any optional treasure/drop bias before touching early floors.

## Risks

- XP boosts can over-level already-strong classes if they survive to floor 4; keep boosts modest and midgame-only.
- Gear guarantees can flatten roguelike variance; limit guarantees to one shop or armory slot rather than all drops.
- Monk buffs can become too strong if combined with excellent armor; monitor Monk win quality, not only win count.
- Hard mode can be accidentally changed if mode state is implicit; tests must lock this down before tuning Hard mode later.

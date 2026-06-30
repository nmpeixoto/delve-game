# DELVE Game Codebase Audit

**Date:** 2026-07-01  
**Scope:** `src/js/*.js` (all 23 modules read), `dungeon.html` (sampled for parity)  
**Constraint:** No code edits made  
**Method:** Read source; traced data flow; compared src/ ↔ dungeon.html; verified claims against reviewer feedback  

---

## EXECUTIVE SUMMARY

One confirmed HIGH gameplay bug. No other confirmed bugs. Several low-severity cleanup items.

**TL;DR:** `dungeon.html` is stale — it lacks a fix present in `src/js/combat.js` for the Skeleton collapse counterattack. The rest of the codebase is stable; most prior audit claims were inflated in severity or incorrect.

---

## FINDINGS

### 🔴 HIGH — Confirmed Gameplay Bug

#### Bug #1: Skeleton Collapse Counterattack — dungeon.html stale vs src/

**Location:** `dungeon.html` lines ~3328 and ~4056 (two occurrences of `attackEnemy`-equivalent logic)

**What happens:** When a Skeleton enemy is reduced to 0 HP, the `en.revive` branch sets it to "Bones" state (HP 0, different appearance). In `src/js/combat.js` (both occurrences: line ~99 and ~829), the code calls `advanceTurn(); return;` after the collapse — correctly ending the player's attack without the enemy counterattacking.

In `dungeon.html`, **both occurrences are missing** `advanceTurn(); return;`:

```javascript
// dungeon.html (BUGGY):
} else if(en.revive) {
  en.revive = false;
  en.reviveTurns = 2;
  en.hp = 0;
  en.sym = '🦴';
  // ...
  popText('🦴', en.x, en.y);
  // MISSING: advanceTurn(); return;
} else {
  killEnemy(en, false);
  return;
}
// Execution falls through to enemy counterattack block
```

```javascript
// src/js/combat.js (FIXED):
      popText('🦴', en.x, en.y);
      advanceTurn();
      return;
```

**Impact:** A collapsing Skeleton unfairly counterattacks the player. Reviewer GPT-5.5 Xhigh reproduced: player HP dropped from 20 → 9 from a "dead" Skeleton. This can kill the player.

**Root cause:** `dungeon.html` is a concatenated single-file build; a fix was applied to `src/js/combat.js` but not replicated to `dungeon.html`.

**Confidence:** 🔴 CONFIRMED — I verified by reading both files line-for-line.

---

### ⚠️ LOW — Cleanup / Tech Debt

#### Issue #2: Stray `console.error` in shop generation

**Location:** `src/js/shop.js` line ~48; also present in `dungeon.html`

```javascript
console.error('[JS] weps len: ' + wepsFilter.length + ' arms len: ' + ...);
```

**Severity:** LOW — No gameplay impact. Leftover debug logging.

#### Issue #3: dungeon.html / src/ drift risk

**Observation:** `dungeon.html` is the production artifact and `src/` is the development source. Bug #1 demonstrates they can drift. There's no automated check in the visible workflow that asserts they're in sync after src/ changes.

**Severity:** LOW — process concern, not a code bug. `npm test` and `browser_smoke.js` may catch gameplay regressions but won't catch every line-level divergence.

---

### ✅ NOT A BUG — Verified or Retracted

#### Claim: "Combat lacks G.gameOver/G.won guard in attackEnemy()"

**Verdict:** NOT A BUG (retracted). `attackEnemy()` is guarded by `tileAttack()` (line 2), ability handlers, and enemy turn processing (all check `G.gameOver || G.won`). No unguarded failing path found. Adding a guard is defensive hardening, not a bug fix.

#### Claim: "Pathfinding allows paths through entities"

**Verdict:** NOT A BUG (retracted). The `nextKey !== goalKey` exception in `findGridPath()` only allows the *goal* tile to be occupied. Paths go *to* the goal, not *through* it. Enemy click pathing routes through `pathToEnemyTarget()` which computes attack-range candidates — it doesn't route through enemies. This is standard behavior.

#### Claim: "Render performance — unnecessary re-renders"

**Verdict:** LOW tech debt, not a bug. `render()` redraws minimap/HUD/inventory/buttons every call, but this is a turn-based game (not a 60fps loop) and the minimap is only 56×36=2,016 cells. Profiling would be needed to show actual performance impact.

#### Claim: "State serialization risk"

**Verdict:** NOT A BUG. `_dpadTimer` and `_swipeStart` are runtime-only variables, not part of save/load state. The project has no JSON serialization of `window.G`. Theoretical future concern at best.

#### Claim: "Dual rendering path complexity"

**Verdict:** Architecture note, not a bug. The game intentionally supports both pixed (canvas) and legacy (DOM) rendering. The pixed path is production; legacy is fallback. This is documented in `AGENTS.md` as "Zero-Build, Single-File Production."

---

## ARCHITECTURE NOTES

### What works well
- **Clear module separation**: `combat.js`, `pathing.js`, `state.js`, `render.js`, etc. each have a distinct responsibility.
- **Dual renderer**: Pixed (canvas/isometric) for production, legacy (DOM grid) for fallback.
- **PWA support**: Service worker registration, install banner, manifest.
- **Procedural SFX**: Web Audio API, no external audio files.
- **Turn-based consistency**: `advanceTurn()` is the central tick; combat, vision, enemy AI all flow through it.

### What could improve
- **sync automation**: The only confirmed bug exists because `dungeon.html` drifted from `src/`. A diff check (e.g., rebuild and assert `git diff --exit-code`) would prevent this.
- **Debug log hygiene**: `console.error` in shop.js should be removed or gated behind a dev flag.

---

## VERIFICATION NOTES

Per reviewer GPT-5.5 Xhigh:
- `dungeon.html` byte-for-byte parity with in-memory rebuild: ✓
- `npm test`: pass ✓  
- `browser_smoke.js`: desktop, mobile portrait, mobile landscape all pass ✓
- Skeleton collapse bug **reproduced** in dungeon.html (HP 20 → 9 from collapsing Skeleton counterattack)

---

## CONCLUSION

| Severity | Count | Description |
|----------|-------|-------------|
| 🔴 HIGH | 1 | Skeleton collapse counterattack — `dungeon.html` out of sync with `src/js/combat.js` |
| ⚠️ LOW | 2 | Debug logging, src/production drift risk |

**Fix for Bug #1:** Add `advanceTurn(); return;` after `popText('🦴', en.x, en.y);` in both occurrences in `dungeon.html`, matching the fix already in `src/js/combat.js` lines 99 and 829.

---

*Self-review: previously inflated 3 findings to HIGH that were actually LOW or NOT A BUG. Those are retracted above. The only confirmed gameplay bug is the Skeleton collapse issue.*

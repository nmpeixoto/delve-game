# Normal Mode Moderate Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise normal-mode midgame survivability and class consistency without making early floors easier or changing Hard mode balance.

**Architecture:** Add small normal-only XP scaling at enemy spawn time, improve class-usable shop and armory gear generation through existing item pools, and update Monk unarmed weapon power consistently across game, bot, and audit helpers. Keep the production monolith synchronized by rebuilding `dungeon.html`.

**Tech Stack:** Vanilla JavaScript, Node `vm`-based tests, headless balance runner, Puppeteer browser smoke.

---

### Task 1: Normal-Mode Midgame XP Pacing

**Files:**
- Modify: `src/js/map.js`
- Test: `tests/map_test.js`

- [ ] **Step 1: Write failing XP tests**

Add tests that call `getNormalXpScale` and assert normal floors 3 and 4 get boosts, floors 1, 2, and 5 do not, and Hard mode never gets the normal boost.

```js
test('normal mode applies a small XP boost only on floors 3 and 4', () => {
  const context = loadMapContext();

  assert.strictEqual(context.getNormalXpScale(1, false), 1);
  assert.strictEqual(context.getNormalXpScale(2, false), 1);
  assert.strictEqual(context.getNormalXpScale(3, false), 1.15);
  assert.strictEqual(context.getNormalXpScale(4, false), 1.25);
  assert.strictEqual(context.getNormalXpScale(5, false), 1);
});

test('hard mode does not receive the normal-mode XP pacing boost', () => {
  const context = loadMapContext();

  assert.strictEqual(context.getNormalXpScale(3, true), 1);
  assert.strictEqual(context.getNormalXpScale(4, true), 1);
});

test('initGame persists hard mode state for balance gates', () => {
  const context = loadMapContext();

  context.initGame('warrior', true);
  assert.strictEqual(context.G.hardMode, true);

  context.initGame('warrior', false);
  assert.strictEqual(context.G.hardMode, false);
});
```

- [ ] **Step 2: Run map tests and verify failure**

Run: `node tests/map_test.js`

Expected: fail because `getNormalXpScale` is not defined and `G.hardMode` is not persisted explicitly.

- [ ] **Step 3: Implement XP helper and state persistence**

Add this helper near `getFloorEnemyProfile` in `src/js/map.js`:

```js
function getNormalXpScale(floor, hardMode = false){
  if(hardMode) return 1;
  if(floor === 3) return 1.15;
  if(floor === 4) return 1.25;
  return 1;
}
```

Persist hard mode in the `G` object created by `initGame`:

```js
hardMode: !!hardMode,
```

Apply it to enemy spawn XP:

```js
let xpMult = getNormalXpScale(G.floor, G.hardMode);
xp:Math.round(t.xp*(isCrypt?1.5:1)*sc*xpMult),
```

- [ ] **Step 4: Run map tests and verify pass**

Run: `node tests/map_test.js`

Expected: all map tests pass.

### Task 2: Class-Relevant Gear Access

**Files:**
- Modify: `src/js/data.js`
- Modify: `src/js/shop.js`
- Test: `tests/map_test.js`
- Test: `tests/shop_test.js`

- [ ] **Step 1: Write failing gear-generation tests**

In `tests/map_test.js`, extend `loadSpawnContext` with deterministic random helpers and add:

```js
test('spawnItem can require class-usable gear for armory slots', () => {
  const context = loadSpawnContext();
  context.G.player.class = 'monk';
  context.G.player.lvl = 5;

  context.spawnItem({ x: 12, y: 13 }, item => item.type === 'weapon' || item.type === 'armor', false, { preferClassGear: true });

  assert.strictEqual(context.G.items.length, 1);
  assert.strictEqual(context.G.items[0].type, 'armor');
  assert.ok(!context.G.items[0].reqClass || context.G.items[0].reqClass.includes('monk'));
});
```

In `tests/shop_test.js`, load `data.js` before `shop.js` for stock tests and add:

```js
test('generateShopStock includes at least one class-usable gear item when candidates exist', () => {
  const context = loadShopContext({
    G: {
      floor: 3,
      player: {
        class: 'monk',
        lvl: 5,
        gold: 0,
        weapon: null,
        armor: { id: 'gi', name: 'Gi', type: 'armor', def: 4 },
      },
      items: [],
    },
    rr: (a) => a,
    ch: () => false,
    uid: () => 'shop-id',
  });

  const stock = context.generateShopStock();
  const usableGear = stock.filter(item =>
    (item.type === 'weapon' || item.type === 'armor') &&
    (!item.reqClass || item.reqClass.includes(context.G.player.class))
  );

  assert.ok(usableGear.length >= 1);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node tests/map_test.js && node tests/shop_test.js`

Expected: fail because `spawnItem` ignores the fourth options argument and `loadShopContext` does not load item data for `generateShopStock` tests.

- [ ] **Step 3: Implement class-usable gear helpers**

In `src/js/data.js`, add:

```js
function isClassUsableGear(item, player = G.player){
  if(!item || (item.type !== 'weapon' && item.type !== 'armor')) return false;
  if(item.reqClass && !item.reqClass.includes(player.class)) return false;
  return true;
}

function gearPoolForPlayer(items, player = G.player, levelSlack = 2){
  return items.filter(item =>
    (!item.reqLvl || player.lvl >= item.reqLvl - levelSlack) &&
    isClassUsableGear(item, player)
  );
}
```

Update `spawnItem` signature to:

```js
function spawnItem(r, itemFilter=null, forceHighTier=false, opts={}){
```

Use `gearPoolForPlayer(WEAPONS)` and `gearPoolForPlayer(ARMORS)` for existing weapon and armor pool generation. When `opts.preferClassGear` is true and the filtered pool has no class-usable gear, add eligible class-usable armor/weapon candidates before potion fallback.

In `src/js/map.js`, for armory rooms, pass `preferClassGear` on the first guaranteed item:

```js
spawnItem(r, itemFilter, (r.type==='treasure'||r.type==='crypt'||r.type==='secret'), { preferClassGear: r.type === 'armory' && g === 0 });
```

- [ ] **Step 4: Update shop stock generation**

In `src/js/shop.js`, choose at least one class-usable gear item before the random weapon and armor rolls:

```js
let classGear = [
  ...WEAPONS.filter(w => w.atk <= 4 + floorScale * 3),
  ...ARMORS.filter(a => a.def <= 2 + floorScale * 2),
].filter(item =>
  (!item.reqLvl || G.player.lvl >= item.reqLvl - 2) &&
  (!item.reqClass || item.reqClass.includes(G.player.class))
);
if(classGear.length) {
  let pick = classGear[rr(0, classGear.length - 1)];
  stock.push({...pick,id:uid(),sold:false});
}
```

Avoid duplicates by filtering picked item names out of the later random weapon and armor pools.

- [ ] **Step 5: Run focused tests and verify pass**

Run: `node tests/map_test.js && node tests/shop_test.js`

Expected: all focused tests pass.

### Task 3: Monk Unarmed Scaling

**Files:**
- Modify: `src/js/items.js`
- Modify: `src/js/render.js`
- Modify: `automation/bot_brain.js`
- Modify: `automation/bot_behavior_audit.js`
- Test: `tests/combat_test.js`
- Test: `tests/bot_brain_test.js`
- Test: `tests/bot_behavior_audit_test.js`

- [ ] **Step 1: Write failing Monk scaling tests**

In `tests/combat_test.js`, add:

```js
test('monk unarmed weapon power rounds up by level', () => {
  const context = loadItems();

  context.G.player.lvl = 1;
  assert.strictEqual(context.weaponPower(null), 1);

  context.G.player.lvl = 2;
  assert.strictEqual(context.weaponPower(null), 1);

  context.G.player.lvl = 3;
  assert.strictEqual(context.weaponPower(null), 2);
});
```

In `tests/bot_behavior_audit_test.js`, add an export assertion for audit helper behavior:

```js
test('audit weaponPower uses rounded-up Monk unarmed scaling', () => {
  assert.strictEqual(weaponPower(null, { class: 'monk', lvl: 3 }), 2);
});
```

In `tests/bot_brain_test.js`, update or add a scenario proving the bot values Monk bare hands at level 3 above a 1 ATK weapon.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node tests/combat_test.js && node tests/bot_behavior_audit_test.js && node tests/bot_brain_test.js`

Expected: fail because Monk unarmed power currently uses `Math.floor(level / 2)`.

- [ ] **Step 3: Implement rounded-up scaling consistently**

Change Monk unarmed power from floor to ceil in all duplicated helpers:

```js
return G.player.class === 'monk' ? Math.ceil(G.player.lvl / 2) : 0;
```

For bot/audit helpers:

```js
if (!item) return p.class === 'monk' ? Math.ceil((p.lvl || 1) / 2) : 0;
```

Change render fallback from `Math.floor(G.player.lvl / 2)` to `Math.ceil(G.player.lvl / 2)`.

- [ ] **Step 4: Run focused tests and verify pass**

Run: `node tests/combat_test.js && node tests/bot_behavior_audit_test.js && node tests/bot_brain_test.js`

Expected: all focused tests pass.

### Task 4: Build and Full Verification

**Files:**
- Modify generated: `dungeon.html`

- [ ] **Step 1: Run full unit/regression suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Rebuild production HTML**

Run: `npm run build`

Expected: build succeeds and updates `dungeon.html`.

- [ ] **Step 3: Run browser smoke**

Run: `npm run smoke`

Expected: browser smoke passes for both `src/index.html` and `dungeon.html`.

### Task 5: Headless Balance Comparison

**Files:**
- Temporary: `balance_reports/*.json`

- [ ] **Step 1: Run same normal-mode comparison sweep**

Run:

```powershell
New-Item -ItemType Directory -Force balance_reports
node automation/bot_behavior_audit.js --classes all --seeds 1000,2000,3000,4000,5000 --per-class 10 --max-turns 5000 --output balance_reports/normal-post-moderate-pass.json
```

Expected: 400 normal-mode runs complete with no fatal script errors.

- [ ] **Step 2: Compare to previous baseline**

Compare against the previous post-pass-2 baseline:

- Overall average floor: 3.5.
- Floor 5 reaches: 8 / 400.
- Wins: 2 / 400.
- Timeouts: 0.
- Monk: 3.1 average floor, 0 / 50 floor 5 reaches, 0 wins.

- [ ] **Step 3: Clean temporary reports**

Delete `balance_reports` after extracting summary results for the final response.

Expected: no temporary balance artifacts remain.

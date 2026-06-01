# Mobile Interface Touch Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent accidental mobile actions while preserving single-tap controls across shop, inventory, and map interactions.

**Architecture:** Add one shared guarded-tap helper in `src/js/ui.js` that distinguishes intentional taps from scroll or swipe gestures. Route touch-driven shop rows, inventory rows, and map tile actions through that helper while keeping desktop `onclick` behavior intact.

**Tech Stack:** Vanilla HTML, CSS, JavaScript, Puppeteer smoke tests, existing `npm run build`, existing `npm test`, existing browser smoke test.

---

## File Structure

- Modify `src/js/ui.js`: owns shared UI helpers, so it will own guarded touch state and validation.
- Modify `src/js/shop.js`: generated buy and sell rows use guarded touch handlers.
- Modify `src/js/render.js`: inventory rows and map tile touch actions use guarded touch handlers; enemy long-press cancellation respects movement.
- Modify `src/css/style.css`: scrollable action rows advertise `touch-action: pan-y`.
- Modify `test.js`: adds a mobile viewport smoke test for shop, inventory, help, class select, emergency overlay, and map touch behavior.
- Regenerate `dungeon.html`: production single-file output from `npm run build`.

## Scope Check

This is one cohesive mobile input pass. It does not redesign every modal. It fixes the risky gesture/action conflicts and adds coverage that all major interfaces open, fit, scroll, and accept intentional taps on mobile viewports.

---

### Task 1: Add Shared Guarded Tap Helpers

**Files:**
- Modify: `src/js/ui.js`

- [ ] **Step 1: Add the helper functions after `hideTip()`**

Add this block immediately after the existing `hideTip()` function:

```javascript
// ===================== GUARDED TOUCH TAPS =====================
const TOUCH_TAP_MAX_MOVE = 10;
const TOUCH_TAP_MAX_SCROLL = 2;

function nearestScrollable(el){
  while(el && el !== document.body){
    let style=getComputedStyle(el);
    let canScroll=(style.overflowY==='auto'||style.overflowY==='scroll') && el.scrollHeight>el.clientHeight;
    if(canScroll)return el;
    el=el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function startGuardedTap(e, el){
  if(!e.changedTouches || e.changedTouches.length!==1 || e.touches.length>1)return;
  let t=e.changedTouches[0];
  let scroller=nearestScrollable(el);
  el._tapGuard={
    x:t.clientX,
    y:t.clientY,
    moved:false,
    scrollEl:scroller,
    scrollTop:scroller ? scroller.scrollTop : 0
  };
}

function moveGuardedTap(e, el){
  let g=el && el._tapGuard;
  if(!g || !e.changedTouches || e.changedTouches.length!==1)return;
  let t=e.changedTouches[0];
  if(Math.hypot(t.clientX-g.x,t.clientY-g.y)>TOUCH_TAP_MAX_MOVE)g.moved=true;
}

function finishGuardedTap(e, el, action){
  if(e.cancelable)e.preventDefault();
  e.stopPropagation();
  let g=el && el._tapGuard;
  if(el)el._tapGuard=null;
  if(!g || !e.changedTouches || e.changedTouches.length!==1)return false;
  let t=e.changedTouches[0];
  let moved=g.moved || Math.hypot(t.clientX-g.x,t.clientY-g.y)>TOUCH_TAP_MAX_MOVE;
  let scrolled=g.scrollEl && Math.abs(g.scrollEl.scrollTop-g.scrollTop)>TOUCH_TAP_MAX_SCROLL;
  if(moved || scrolled)return false;
  action();
  return true;
}
```

- [ ] **Step 2: Run syntax check through the browser smoke command after later tasks**

No standalone command is required yet because the helper is browser-global code. `node test.js` in Task 6 will load both `src/index.html` and `dungeon.html` and fail on syntax errors.

---

### Task 2: Guard Shop Buy And Sell Rows

**Files:**
- Modify: `src/js/shop.js`

- [ ] **Step 1: Replace buy row touch handlers in `renderShop()`**

Change the generated `.shop-item` opening tag from:

```javascript
h+=`<div class="shop-item${item.sold?' sold':''}"
  onclick="buyItem('${item.id}')"
  ontouchend="event.preventDefault();event.stopPropagation();buyItem('${item.id}')">
```

to:

```javascript
h+=`<div class="shop-item${item.sold?' sold':''}"
  onclick="buyItem('${item.id}')"
  ontouchstart="startGuardedTap(event,this)"
  ontouchmove="moveGuardedTap(event,this)"
  ontouchend="finishGuardedTap(event,this,()=>buyItem('${item.id}'))">
```

- [ ] **Step 2: Replace sell row touch handlers in `renderSellPanel()`**

Change the generated `.sell-item` opening tag from:

```javascript
h+=`<div class="sell-item"
  onclick="sellItem('${item.id}','${item._equipped||''}')"
  ontouchend="event.preventDefault();event.stopPropagation();sellItem('${item.id}','${item._equipped||''}')">
```

to:

```javascript
h+=`<div class="sell-item"
  onclick="sellItem('${item.id}','${item._equipped||''}')"
  ontouchstart="startGuardedTap(event,this)"
  ontouchmove="moveGuardedTap(event,this)"
  ontouchend="finishGuardedTap(event,this,()=>sellItem('${item.id}','${item._equipped||''}'))">
```

- [ ] **Step 3: Run focused text check**

Run:

```powershell
rg -n "shop-item|sell-item|startGuardedTap|finishGuardedTap" src\js\shop.js
```

Expected: both shop row generators include `ontouchstart`, `ontouchmove`, and `finishGuardedTap`.

---

### Task 3: Guard Inventory And Map Tile Touch Actions

**Files:**
- Modify: `src/js/ui.js`
- Modify: `src/js/render.js`

- [ ] **Step 1: Update enemy long-press movement tracking in `src/js/ui.js`**

Change `startLongPress`, `endLongPress`, and `cancelLongPress` to this exact implementation:

```javascript
function startLongPress(e, id, name, hp, maxHp, atk){
  e.stopPropagation();
  startGuardedTap(e, e.currentTarget || e.target);
  _lpFired=false; _lpId=id;
  _lpTimer=setTimeout(()=>{
    _lpFired=true;
    showTip(e, name, hp, maxHp, atk);
    // Light vibration to confirm long press on mobile
    if(navigator.vibrate) navigator.vibrate(40);
  }, 480);
}
function endLongPress(e, id){
  clearTimeout(_lpTimer);
  let validTap=finishGuardedTap(e, e.currentTarget || e.target, ()=>{});
  if(_lpFired){ _lpFired=false; return; } // long press - tooltip already shown, don't attack
  if(validTap)tileAttack(id); // short stationary tap - attack
}
function cancelLongPress(e){
  clearTimeout(_lpTimer);
  if(e)moveGuardedTap(e, e.currentTarget || e.target);
  _lpFired=false;
}
```

- [ ] **Step 2: Update enemy tile `ontouchmove` in `src/js/render.js`**

Change:

```javascript
ontouchmove="${en.dying?'':'cancelLongPress()'}">
```

to:

```javascript
ontouchmove="${en.dying?'':'cancelLongPress(event)'}">
```

- [ ] **Step 3: Guard item, stairs, and shop map tile touch actions in `src/js/render.js`**

Change item tile touch attributes from:

```javascript
ontouchend="event.preventDefault();tilePickup('${it.id}')"
ontouchstart="showTip(event,'${safeName}: ${safeDesc}');event.stopPropagation()"
```

to:

```javascript
ontouchstart="startGuardedTap(event,this);showTip(event,'${safeName}: ${safeDesc}');event.stopPropagation()"
ontouchmove="moveGuardedTap(event,this)"
ontouchend="finishGuardedTap(event,this,()=>tilePickup('${it.id}'))"
```

Change stairs tile generation from:

```javascript
h+=`<div class="tile tile-stairs" style="${s}" onclick="descend()" ontouchend="event.preventDefault();descend()">></div>`;continue;
```

to:

```javascript
h+=`<div class="tile tile-stairs" style="${s}" onclick="descend()" ontouchstart="startGuardedTap(event,this)" ontouchmove="moveGuardedTap(event,this)" ontouchend="finishGuardedTap(event,this,()=>descend())">></div>`;continue;
```

Change shop tile generation from:

```javascript
h+=`<div class="tile tile-shop" style="${s}" onclick="openShop()" ontouchend="event.preventDefault();openShop()">$</div>`;continue;
```

to:

```javascript
h+=`<div class="tile tile-shop" style="${s}" onclick="openShop()" ontouchstart="startGuardedTap(event,this)" ontouchmove="moveGuardedTap(event,this)" ontouchend="finishGuardedTap(event,this,()=>openShop())">$</div>`;continue;
```

- [ ] **Step 4: Guard inventory row touch actions in `src/js/render.js`**

Change inventory slot generation from:

```javascript
h+=`<div class="inv-slot"
  onclick="useItem('${it.id}')"
  ontouchend="event.preventDefault();useItem('${it.id}')">
```

to:

```javascript
h+=`<div class="inv-slot"
  onclick="useItem('${it.id}')"
  ontouchstart="startGuardedTap(event,this)"
  ontouchmove="moveGuardedTap(event,this)"
  ontouchend="finishGuardedTap(event,this,()=>useItem('${it.id}'))">
```

- [ ] **Step 5: Run focused text check**

Run:

```powershell
rg -n "cancelLongPress|tilePickup|tile-stairs|tile-shop|inv-slot|finishGuardedTap" src\js\ui.js src\js\render.js
```

Expected: map item, stairs, shop, inventory, and enemy touch paths all route through guarded helpers.

---

### Task 4: Allow Natural Vertical Scrolling On Action Rows

**Files:**
- Modify: `src/css/style.css`

- [ ] **Step 1: Update touch-action declarations**

Change these declarations:

```css
.inv-slot{padding:8px 10px;border:1px solid var(--border);margin-bottom:5px;cursor:pointer;transition:all .12s;display:flex;justify-content:space-between;align-items:center;gap:8px;touch-action:manipulation;user-select:none;-webkit-user-select:none;}
.shop-item{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);margin-bottom:6px;cursor:pointer;transition:all .15s;touch-action:manipulation;user-select:none;-webkit-user-select:none;}
.sell-item{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);margin-bottom:6px;cursor:pointer;transition:all .15s;touch-action:manipulation;user-select:none;-webkit-user-select:none;}
```

to:

```css
.inv-slot{padding:8px 10px;border:1px solid var(--border);margin-bottom:5px;cursor:pointer;transition:all .12s;display:flex;justify-content:space-between;align-items:center;gap:8px;touch-action:pan-y;user-select:none;-webkit-user-select:none;}
.shop-item{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);margin-bottom:6px;cursor:pointer;transition:all .15s;touch-action:pan-y;user-select:none;-webkit-user-select:none;}
.sell-item{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);margin-bottom:6px;cursor:pointer;transition:all .15s;touch-action:pan-y;user-select:none;-webkit-user-select:none;}
```

- [ ] **Step 2: Run focused CSS check**

Run:

```powershell
rg -n "inv-slot|shop-item|sell-item|touch-action" src\css\style.css
```

Expected: `.inv-slot`, `.shop-item`, and `.sell-item` use `touch-action:pan-y`.

---

### Task 5: Add Mobile Interface Smoke Coverage

**Files:**
- Modify: `test.js`

- [ ] **Step 1: Add touch utility functions near the top of `test.js` after the `path` import**

Add:

```javascript
async function getCenter(page, selector) {
  return page.$eval(selector, el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

async function touchDrag(page, selector, dy = -120) {
  const { x, y } = await getCenter(page, selector);
  const client = await page.createCDPSession();
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }]
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y + dy / 2 }]
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y + dy }]
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: []
  });
}

async function touchTap(page, selector) {
  const { x, y } = await getCenter(page, selector);
  await page.touchscreen.tap(x, y);
}
```

- [ ] **Step 2: Add a reusable game start helper below the touch helpers**

Add:

```javascript
async function startWarriorRun(page) {
  await page.waitForSelector('#title-screen .btn', { visible: true });
  await page.click('#title-screen .btn');
  await page.waitForSelector('#class-select-overlay', { visible: true });
  await page.click('#cbtn-warrior');
  await page.click('#class-select-modal .btn-gold');
  await page.waitForFunction(() => {
    const el = document.getElementById('game-screen');
    return el && !el.classList.contains('hidden');
  });
  await page.waitForSelector('#map .tile-player', { timeout: 2000 });
}
```

- [ ] **Step 3: Replace the duplicated start sequence in `runTest()`**

Replace the title/class/start block in `runTest()` with:

```javascript
console.log('Starting warrior run...');
await startWarriorRun(page);
```

- [ ] **Step 4: Add `runMobileInterfaceTest()` before `main()`**

Add:

```javascript
async function runMobileInterfaceTest(url, name) {
  console.log(`\n=== Mobile interface testing ${name} ===`);
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  await page.setViewport({
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`[Console Error]: ${msg.text()}`);
  });
  page.on('pageerror', error => {
    errors.push(`[Page Error]: ${error.message}`);
  });
  page.on('requestfailed', request => {
    errors.push(`[Request Failed]: ${request.url()} - ${request.failure()?.errorText}`);
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 5000 });
    await startWarriorRun(page);

    console.log('Checking inventory scroll guard...');
    await page.evaluate(() => {
      G.items = Array.from({ length: 18 }, (_, i) => ({
        id: `mobile-inv-${i}`,
        name: `Mobile Potion ${i}`,
        type: 'potion',
        rarity: 'common',
        heal: 1,
        price: 10,
        carried: true
      }));
      G.player.hp = Math.max(1, G.player.hp - 5);
      updateInvDrawer();
    });
    await page.click('#bag-btn');
    await page.waitForSelector('#inv-drawer.open', { timeout: 1000 });
    const invBefore = await page.evaluate(() => G.items.filter(i => i.carried).length);
    await touchDrag(page, '.inv-slot', -160);
    const invAfterDrag = await page.evaluate(() => G.items.filter(i => i.carried).length);
    if (invAfterDrag !== invBefore) throw new Error('Inventory drag consumed an item');
    await touchTap(page, '.inv-slot');
    const invAfterTap = await page.evaluate(() => G.items.filter(i => i.carried).length);
    if (invAfterTap !== invBefore - 1) throw new Error('Inventory tap did not use one item');
    await page.click('#drawer-backdrop');
    await page.waitForFunction(() => !document.getElementById('inv-drawer').classList.contains('open'));

    console.log('Checking shop buy and sell scroll guards...');
    await page.evaluate(() => {
      G.player.gold = 500;
      G.currentShop = {
        stock: Array.from({ length: 16 }, (_, i) => ({
          id: `mobile-buy-${i}`,
          name: `Mobile Dagger ${i}`,
          type: 'weapon',
          rarity: 'common',
          sym: '/',
          atk: 1,
          price: 10,
          sold: false
        }))
      };
      G.items = Array.from({ length: 18 }, (_, i) => ({
        id: `mobile-sell-${i}`,
        name: `Mobile Sell ${i}`,
        type: 'weapon',
        rarity: 'common',
        sym: '/',
        atk: 1,
        price: 20,
        carried: true
      }));
      document.getElementById('shop-overlay').classList.add('open');
      switchShopTab('buy');
      renderShop();
    });
    await page.waitForSelector('#shop-overlay.open .shop-item', { timeout: 1000 });
    const goldBeforeBuyDrag = await page.evaluate(() => G.player.gold);
    await touchDrag(page, '.shop-item', -160);
    const goldAfterBuyDrag = await page.evaluate(() => G.player.gold);
    if (goldAfterBuyDrag !== goldBeforeBuyDrag) throw new Error('Shop buy drag purchased an item');
    await touchTap(page, '.shop-item');
    const goldAfterBuyTap = await page.evaluate(() => G.player.gold);
    if (goldAfterBuyTap !== goldBeforeBuyDrag - 10) throw new Error('Shop buy tap did not purchase one item');

    await page.evaluate(() => switchShopTab('sell'));
    await page.waitForSelector('#shop-overlay.open .sell-item', { timeout: 1000 });
    const carriedBeforeSellDrag = await page.evaluate(() => G.items.filter(i => i.carried).length);
    await touchDrag(page, '.sell-item', -160);
    const carriedAfterSellDrag = await page.evaluate(() => G.items.filter(i => i.carried).length);
    if (carriedAfterSellDrag !== carriedBeforeSellDrag) throw new Error('Shop sell drag sold an item');
    await touchTap(page, '.sell-item');
    const carriedAfterSellTap = await page.evaluate(() => G.items.filter(i => i.carried).length);
    if (carriedAfterSellTap !== carriedBeforeSellDrag - 1) throw new Error('Shop sell tap did not sell one item');
    await page.click('#shop-overlay .shop-close-row .btn');
    await page.waitForFunction(() => !document.getElementById('shop-overlay').classList.contains('open'));

    console.log('Checking help and class overlays fit mobile viewport...');
    await page.click('#hud button');
    await page.waitForSelector('#help-overlay', { visible: true });
    const helpFits = await page.$eval('#help-modal', el => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight && r.width <= window.innerWidth;
    });
    if (!helpFits) throw new Error('Help modal does not fit mobile viewport');
    await page.click('#help-overlay .btn');
    await page.waitForFunction(() => document.getElementById('help-overlay').style.display === 'none');

    await page.evaluate(() => openClassSelect());
    await page.waitForSelector('#class-select-overlay', { visible: true });
    const classFits = await page.$eval('#class-select-modal', el => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight && r.width <= window.innerWidth;
    });
    if (!classFits) throw new Error('Class select modal does not fit mobile viewport');
    await page.click('#class-select-overlay .btn');
    await page.waitForFunction(() => document.getElementById('class-select-overlay').style.display === 'none');

    console.log('Checking emergency overlay buttons...');
    await page.evaluate(() => {
      document.getElementById('emergency-overlay').style.display = 'flex';
      document.getElementById('emergency-msg').textContent = 'Mobile smoke test';
      document.getElementById('emergency-potion').innerHTML = '<div class="emergency-potion-row"><div class="emergency-potion-name">Potion</div><div class="emergency-potion-heal">+5</div></div>';
    });
    const emergencyFits = await page.$eval('#emergency-modal', el => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight && r.width <= window.innerWidth;
    });
    if (!emergencyFits) throw new Error('Emergency modal does not fit mobile viewport');
    await page.evaluate(() => document.getElementById('emergency-overlay').style.display = 'none');

    if (errors.length > 0) {
      errors.forEach(e => console.error(e));
      throw new Error(`${name} mobile emitted ${errors.length} browser error(s)`);
    }

    console.log(`\nMobile interface test passed for ${name}.`);
  } catch (err) {
    console.error(`\nError during mobile ${name} test:`);
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 5: Call the mobile smoke test from `main()`**

Change `main()` from:

```javascript
async function main() {
  await runTest('http://127.0.0.1:8080/src/index.html', 'src');
  await runTest('http://127.0.0.1:8080/dungeon.html', 'production');
}
```

to:

```javascript
async function main() {
  await runTest('http://127.0.0.1:8080/src/index.html', 'src');
  await runTest('http://127.0.0.1:8080/dungeon.html', 'production');
  await runMobileInterfaceTest('http://127.0.0.1:8080/src/index.html', 'src');
  await runMobileInterfaceTest('http://127.0.0.1:8080/dungeon.html', 'production');
}
```

---

### Task 6: Build, Verify, And Commit

**Files:**
- Modify: `dungeon.html`

- [ ] **Step 1: Run unit/regression tests**

Run:

```powershell
npm test
```

Expected: all listed tests pass: `bot_brain_test.js`, `autoplay_runner_test.js`, `combat_test.js`, and `map_test.js`.

- [ ] **Step 2: Regenerate production HTML**

Run:

```powershell
npm run build
```

Expected output:

```text
Successfully built dungeon.html
```

- [ ] **Step 3: Start a temporary static server**

Run:

```powershell
$server = Start-Process -FilePath node -ArgumentList @('-e','require("http").createServer((req,res)=>{const fs=require("fs"),path=require("path");let p=path.join(process.cwd(),decodeURIComponent(req.url.split("?")[0]));if(req.url==="/"||fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(process.cwd(),"dungeon.html");fs.readFile(p,(err,data)=>{if(err){res.statusCode=404;res.end("not found");return;}res.end(data);});}).listen(8080,"127.0.0.1")') -WorkingDirectory (Get-Location) -WindowStyle Hidden -PassThru
```

Expected: `$server.Id` is set to a running process id.

- [ ] **Step 4: Run browser smoke tests**

Run:

```powershell
node test.js
```

Expected: desktop and mobile smoke tests pass for `src/index.html` and `dungeon.html`; screenshots are removed automatically unless `KEEP_TEST_ARTIFACTS=1`.

- [ ] **Step 5: Stop the temporary static server**

Run:

```powershell
Stop-Process -Id $server.Id
```

Expected: the server process is stopped and no local server remains running.

- [ ] **Step 6: Check for generated artifacts**

Run:

```powershell
Get-ChildItem -Force | Where-Object { $_.Name -match '^screenshot_.*\.png$|^bot_findings\.json$|trace|diagnostic' }
```

Expected: no files are listed.

- [ ] **Step 7: Review changed files**

Run:

```powershell
git diff -- src\js\ui.js src\js\shop.js src\js\render.js src\css\style.css test.js dungeon.html
```

Expected: diff only contains guarded tap helpers, guarded touch handler wiring, row CSS touch-action updates, mobile smoke coverage, and generated production HTML.

- [ ] **Step 8: Commit implementation changes**

Run:

```powershell
git add src\js\ui.js src\js\shop.js src\js\render.js src\css\style.css test.js dungeon.html
git commit -m "fix: guard mobile tap actions during scroll"
```

Expected: one commit containing only implementation and verification changes. Existing unrelated local changes remain untouched unless they are already in the listed files; if a listed file has unrelated pre-existing changes, inspect the diff and stage only this task's hunks.

---

## Self-Review

- Spec coverage: the plan preserves single-tap shop actions, ignores scroll gestures, keeps desktop clicks, updates source files, rebuilds `dungeon.html`, and verifies mobile behavior. The user-requested broader mobile pass is covered by inventory, map tile, help, class select, emergency, shop, and production smoke checks.
- Placeholder scan: no deferred implementation notes, placeholders, or empty test instructions are present.
- Type consistency: helper names are consistently `startGuardedTap`, `moveGuardedTap`, and `finishGuardedTap`; all generated HTML handlers use those names.

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
}

async function waitForCanvasReady(page) {
  await page.waitForSelector('#game-canvas', { timeout: 2000 });
  await page.waitForFunction(() => {
    const canvas = document.getElementById('game-canvas');
    return canvas && canvas.width > 0 && canvas.height > 0 && window.PixedRenderer && window.PixedRenderer.initialized;
  });
  return page.$eval('#game-canvas', el => ({ width: el.width, height: el.height }));
}

async function expectModalFits(page, selector, label) {
  const result = await page.$eval(selector, el => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      left: r.left,
      bottom: r.bottom,
      right: r.right,
      width: r.width,
      height: r.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });

  if (
    result.top < 0 ||
    result.left < 0 ||
    result.right > result.viewportWidth ||
    result.bottom > result.viewportHeight ||
    result.width > result.viewportWidth ||
    result.height > result.viewportHeight
  ) {
    throw new Error(`${label} does not fit mobile viewport: ${JSON.stringify(result)}`);
  }
}

async function runTest(url, name) {
  console.log(`\n=== Testing ${name} ===`);
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  let screenshotPath = null;

  // Set viewport to a typical desktop size
  await page.setViewport({ width: 1280, height: 800 });

  const logs = [];
  const errors = [];

  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      if (!text.startsWith('[JS]') && !text.startsWith('[JS_ROOMS]')) {
        errors.push(`[Console Error]: ${text}`);
      } else {
        logs.push(`[Console Log]: ${text}`);
      }
    } else if (type === 'warning') {
      logs.push(`[Console Warning]: ${text}`);
    } else {
      logs.push(`[Console Log]: ${text}`);
    }
  });

  page.on('pageerror', error => {
    errors.push(`[Page Error]: ${error.message}`);
  });

  page.on('requestfailed', request => {
    errors.push(`[Request Failed]: ${request.url()} - ${request.failure()?.errorText}`);
  });

  try {
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 5000 });

    // Check title
    const title = await page.title();
    console.log(`Page title: "${title}"`);

    console.log('Starting warrior run...');
    await startWarriorRun(page);

    // Verify map is rendered
    console.log('Checking map render...');
    const canvasSize = await waitForCanvasReady(page);
    console.log(`Canvas rendered at ${canvasSize.width}x${canvasSize.height}.`);

    // Verify HUD
    const hp = await page.$eval('#hp-val', el => el.textContent);
    console.log(`Initial HP: ${hp}`);
    if (hp !== '32/32') throw new Error('Initial HP is incorrect');

    // Take screenshot
    screenshotPath = path.join(__dirname, '..', `screenshot_${name}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved to ${screenshotPath}`);

    // Test Bag button
    console.log('Testing BAG button...');
    await page.evaluate(() => document.getElementById('bag-btn').click());
    await page.waitForSelector('#inv-drawer.open', { timeout: 1000 });
    console.log('Inventory drawer successfully opened.');

    if (errors.length > 0) {
      console.error(`\n❌ ${name} finished with errors:`);
      errors.forEach(e => console.error(e));
      throw new Error(`${name} emitted ${errors.length} browser error(s)`);
    } else {
      console.log(`\n✅ ${name} test passed successfully! No errors detected.`);
    }

  } catch (err) {
    console.error(`\n❌ Error during ${name} test:`);
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (screenshotPath && process.env.KEEP_TEST_ARTIFACTS !== '1') {
      fs.rmSync(screenshotPath, { force: true });
      console.log(`Removed temporary screenshot ${screenshotPath}`);
    }
  }
}

async function runMobileInterfaceTest(url, name) {
  console.log(`\n=== Testing ${name} mobile interface ===`);
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  await page.setViewport({
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  });

  const logs = [];
  const errors = [];

  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error') {
      if (!text.startsWith('[JS]') && !text.startsWith('[JS_ROOMS]')) {
        errors.push(`[Console Error]: ${text}`);
      } else {
        logs.push(`[Console Log]: ${text}`);
      }
    } else if (type === 'warning') {
      logs.push(`[Console Warning]: ${text}`);
    } else {
      logs.push(`[Console Log]: ${text}`);
    }
  });

  page.on('pageerror', error => {
    errors.push(`[Page Error]: ${error.message}`);
  });

  page.on('requestfailed', request => {
    errors.push(`[Request Failed]: ${request.url()} - ${request.failure()?.errorText}`);
  });

  try {
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 5000 });

    console.log('Starting warrior run...');
    await startWarriorRun(page);
    await waitForCanvasReady(page);

    console.log('Testing mobile inventory drag and tap...');
    await page.evaluate(() => {
      G.player.hp = Math.max(1, G.player.maxHp - 10);
      G.items.push({
        id: 'mobile-inv-potion-1',
        name: 'Mobile Test Potion',
        type: 'potion',
        heal: 15,
        sym: '!',
        rarity: 'common',
        price: 15,
        carried: true
      });
      render();
    });
    await page.evaluate(() => document.getElementById('bag-btn').click());
    await page.waitForSelector('#inv-drawer.open .inv-slot', { timeout: 1000 });

    const invBeforeDrag = await page.evaluate(() => G.items.filter(i => i.carried && i.type === 'potion').length);
    await touchDrag(page, '#inv-drawer.open .inv-slot:not(.equipped)');
    await delay(100);
    const invAfterDrag = await page.evaluate(() => G.items.filter(i => i.carried && i.type === 'potion').length);
    if (invAfterDrag !== invBeforeDrag) {
      throw new Error(`Inventory drag consumed an item: before ${invBeforeDrag}, after ${invAfterDrag}`);
    }

    await touchTap(page, '#inv-drawer.open .inv-slot:not(.equipped)');
    await page.waitForFunction(before => G.items.filter(i => i.carried && i.type === 'potion').length === before - 1, {}, invBeforeDrag);
    const invAfterTap = await page.evaluate(() => G.items.filter(i => i.carried && i.type === 'potion').length);
    if (invAfterTap !== invBeforeDrag - 1) {
      throw new Error(`Inventory tap did not consume exactly one item: before ${invBeforeDrag}, after ${invAfterTap}`);
    }

    console.log('Testing mobile shop buy drag and tap...');
    await page.evaluate(() => {
      closeInv();
      G.player.gold = 100;
      G.currentShop = {
        x: G.player.x,
        y: G.player.y,
        stock: [{
          id: 'mobile-shop-potion-1',
          name: 'Shop Test Potion',
          type: 'potion',
          heal: 15,
          sym: '!',
          rarity: 'common',
          price: 15,
          sold: false
        }]
      };
      renderShop();
      switchShopTab('buy');
      document.getElementById('shop-overlay').classList.add('open');
    });
    await page.waitForSelector('#shop-overlay.open .shop-item', { timeout: 1000 });
    const shopBeforeDrag = await page.evaluate(() => ({
      gold: G.player.gold,
      carried: G.items.filter(i => i.carried).length,
      sold: G.currentShop.stock[0].sold
    }));
    await touchDrag(page, '#shop-overlay.open .shop-item');
    await delay(100);
    const shopAfterDrag = await page.evaluate(() => ({
      gold: G.player.gold,
      carried: G.items.filter(i => i.carried).length,
      sold: G.currentShop.stock[0].sold
    }));
    if (
      shopAfterDrag.gold !== shopBeforeDrag.gold ||
      shopAfterDrag.carried !== shopBeforeDrag.carried ||
      shopAfterDrag.sold !== shopBeforeDrag.sold
    ) {
      throw new Error(`Shop drag bought an item: before ${JSON.stringify(shopBeforeDrag)}, after ${JSON.stringify(shopAfterDrag)}`);
    }

    await touchTap(page, '#shop-overlay.open .shop-item');
    await page.waitForFunction(before => G.player.gold === before.gold - 15 && G.items.filter(i => i.carried).length === before.carried + 1, {}, shopBeforeDrag);
    const shopAfterTap = await page.evaluate(() => ({
      gold: G.player.gold,
      carried: G.items.filter(i => i.carried).length,
      sold: G.currentShop.stock[0].sold
    }));
    if (
      shopAfterTap.gold !== shopBeforeDrag.gold - 15 ||
      shopAfterTap.carried !== shopBeforeDrag.carried + 1 ||
      shopAfterTap.sold !== true
    ) {
      throw new Error(`Shop tap did not buy exactly one item: before ${JSON.stringify(shopBeforeDrag)}, after ${JSON.stringify(shopAfterTap)}`);
    }

    console.log('Testing mobile shop sell drag and tap...');
    await page.evaluate(() => {
      G.items.push({
        id: 'mobile-sell-potion-1',
        name: 'Sell Test Potion',
        type: 'potion',
        heal: 15,
        sym: '!',
        rarity: 'common',
        price: 20,
        carried: true
      });
      switchShopTab('sell');
    });
    await page.waitForSelector('#shop-overlay.open .sell-item', { timeout: 1000 });
    const sellBeforeDrag = await page.evaluate(() => ({
      gold: G.player.gold,
      carried: G.items.filter(i => i.carried).length
    }));
    await touchDrag(page, '#shop-overlay.open .sell-item');
    await delay(100);
    const sellAfterDrag = await page.evaluate(() => ({
      gold: G.player.gold,
      carried: G.items.filter(i => i.carried).length
    }));
    if (sellAfterDrag.gold !== sellBeforeDrag.gold || sellAfterDrag.carried !== sellBeforeDrag.carried) {
      throw new Error(`Sell drag sold an item: before ${JSON.stringify(sellBeforeDrag)}, after ${JSON.stringify(sellAfterDrag)}`);
    }

    await touchTap(page, '#shop-overlay.open .sell-item');
    await page.waitForFunction(before => G.player.gold > before.gold && G.items.filter(i => i.carried).length === before.carried - 1, {}, sellBeforeDrag);
    const sellAfterTap = await page.evaluate(() => ({
      gold: G.player.gold,
      carried: G.items.filter(i => i.carried).length
    }));
    if (sellAfterTap.carried !== sellBeforeDrag.carried - 1) {
      throw new Error(`Sell tap did not sell exactly one item: before ${JSON.stringify(sellBeforeDrag)}, after ${JSON.stringify(sellAfterTap)}`);
    }

    console.log('Testing mobile modal fit...');
    await page.evaluate(() => {
      closeShop();
      openHelp();
    });
    await page.waitForSelector('#help-overlay[style*="flex"] #help-modal', { timeout: 1000 });
    await expectModalFits(page, '#help-modal', 'Help modal');

    await page.evaluate(() => {
      closeHelp();
      openClassSelect();
    });
    await page.waitForSelector('#class-select-overlay[style*="flex"] #class-select-modal', { timeout: 1000 });
    await expectModalFits(page, '#class-select-modal', 'Class select modal');

    await page.evaluate(() => {
      closeClassSelect();
      G.items.push({
        id: 'mobile-emergency-potion-1',
        name: 'Emergency Test Potion',
        type: 'potion',
        heal: 15,
        sym: '!',
        rarity: 'common',
        price: 15,
        carried: true
      });
      G.player.hp = 4;
      offerEmergencyPotion(8, () => {});
    });
    await page.waitForSelector('#emergency-overlay[style*="flex"] #emergency-modal', { timeout: 1000 });
    await expectModalFits(page, '#emergency-modal', 'Emergency modal');

    if (errors.length > 0) {
      console.error(`\n${name} mobile interface finished with errors:`);
      errors.forEach(e => console.error(e));
      throw new Error(`${name} mobile interface emitted ${errors.length} browser error(s)`);
    } else {
      console.log(`\n${name} mobile interface test passed successfully! No errors detected.`);
    }
  } catch (err) {
    console.error(`\nError during ${name} mobile interface test:`);
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function runMobileLandscapeInterfaceTest(url, name) {
  console.log(`\n=== Testing ${name} mobile landscape interface ===`);
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  await page.setViewport({
    width: 844,
    height: 390,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  });

  const errors = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' && !text.startsWith('[JS]') && !text.startsWith('[JS_ROOMS]')) {
      errors.push(`[Console Error]: ${text}`);
    }
  });
  page.on('pageerror', error => {
    errors.push(`[Page Error]: ${error.message}`);
  });
  page.on('requestfailed', request => {
    errors.push(`[Request Failed]: ${request.url()} - ${request.failure()?.errorText}`);
  });

  try {
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 5000 });
    await startWarriorRun(page);
    await waitForCanvasReady(page);

    const layout = await page.evaluate(() => {
      const map = document.getElementById('map-area').getBoundingClientRect();
      const dpad = document.getElementById('dpad-area').getBoundingClientRect();
      const logDisplay = getComputedStyle(document.getElementById('bottom-bar')).display;
      return {
        viewportWidth: window.innerWidth,
        mapRight: map.right,
        dpadLeft: dpad.left,
        logDisplay
      };
    });

    if (layout.logDisplay !== 'none') {
      throw new Error(`Landscape log strip should be hidden, got display=${layout.logDisplay}`);
    }
    if (Math.abs(layout.mapRight - layout.dpadLeft) > 1) {
      throw new Error(`Landscape map should meet controls without a dead column: ${JSON.stringify(layout)}`);
    }

    if (errors.length > 0) {
      errors.forEach(e => console.error(e));
      throw new Error(`${name} mobile landscape emitted ${errors.length} browser error(s)`);
    }
    console.log(`${name} mobile landscape interface test passed successfully.`);
  } catch (err) {
    console.error(`\nError during ${name} mobile landscape interface test:`);
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function main() {
  await runTest('http://127.0.0.1:8080/src/index.html', 'src');
  await runTest('http://127.0.0.1:8080/dungeon.html', 'production');
  await runMobileInterfaceTest('http://127.0.0.1:8080/src/index.html', 'src');
  await runMobileInterfaceTest('http://127.0.0.1:8080/dungeon.html', 'production');
  await runMobileLandscapeInterfaceTest('http://127.0.0.1:8080/src/index.html', 'src');
  await runMobileLandscapeInterfaceTest('http://127.0.0.1:8080/dungeon.html', 'production');
}

main().catch(console.error);

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

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
    if (type === 'error') {
      errors.push(`[Console Error]: ${msg.text()}`);
    } else if (type === 'warning') {
      logs.push(`[Console Warning]: ${msg.text()}`);
    } else {
      logs.push(`[Console Log]: ${msg.text()}`);
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

    // Click "DESCEND" button on title screen
    console.log('Clicking "DESCEND" on title screen...');
    await page.waitForSelector('#title-screen .btn', { visible: true });
    await page.click('#title-screen .btn');

    // Wait for game screen to become visible
    console.log('Waiting for game screen...');
    await page.waitForFunction(() => {
      const el = document.getElementById('game-screen');
      return el && !el.classList.contains('hidden');
    });

    // Verify map is rendered
    console.log('Checking map render...');
    await page.waitForSelector('#map .tile-player', { timeout: 2000 });
    const tiles = await page.$$eval('#map .tile', els => els.length);
    console.log(`Map rendered with ${tiles} tiles.`);

    // Verify HUD
    const hp = await page.$eval('#hp-val', el => el.textContent);
    console.log(`Initial HP: ${hp}`);
    if (hp !== '20/20') throw new Error('Initial HP is incorrect');

    // Take screenshot
    screenshotPath = path.join(__dirname, `screenshot_${name}.png`);
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
    } else {
      console.log(`\n✅ ${name} test passed successfully! No errors detected.`);
    }

  } catch (err) {
    console.error(`\n❌ Error during ${name} test:`);
    console.error(err.message);
  } finally {
    await browser.close();
    if (screenshotPath && process.env.KEEP_TEST_ARTIFACTS !== '1') {
      fs.rmSync(screenshotPath, { force: true });
      console.log(`Removed temporary screenshot ${screenshotPath}`);
    }
  }
}

async function main() {
  await runTest('http://127.0.0.1:8080/src/index.html', 'src');
  await runTest('http://127.0.0.1:8080/dungeon.html', 'production');
}

main().catch(console.error);

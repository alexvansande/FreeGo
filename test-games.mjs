#!/usr/bin/env node
/**
 * E2E test: Load each saved game and step through to the last move.
 * Run with: npx -y playwright test --config=- test-games.mjs
 * Or: npm init -y && npm i playwright && node test-games.mjs
 * Requires: server at localhost:8000
 */
import { firefox } from 'playwright';

const BASE_URL = 'http://localhost:8000';
const EXPECTED_MOVES = {
  'alphago-lee-sedol.sgf': 277,
  'an-jungki-chen-yaoye.sgf': 271,
  'cho-chikun-cho-hunhyun.sgf': 256,
  'fan-hui-alphago.sgf': 236,
  'gu-li-zhou-ruiyang.sgf': 302,
  'lee-sedol-chen-yaoye.sgf': 400,
  'mi-yuting-gu-li.sgf': 318,
  'takemiya-cho-chikun.sgf': 302,
  'tang-weixing-lee-sedol.sgf': 257,
  'yamashita-iyama.sgf': 267,
};

async function testGame(page, filename, expectedMoves) {
  await page.evaluate((f) => {
    const sel = document.getElementById('saved-game-select');
    if (sel) sel.value = f;
  }, filename);
  await page.click('#saved-load-btn');
  await page.waitForTimeout(2000);

  const info = await page.textContent('#saved-game-info');
  if (info.includes('Failed') || info.includes('Select a game')) {
    throw new Error(`Load failed: ${info}`);
  }

  const endBtn = page.locator('#saved-end-btn');
  await endBtn.waitFor({ state: 'visible', timeout: 5000 });
  if (await endBtn.isEnabled()) {
    await endBtn.click({ timeout: 60000 });
    await page.waitForTimeout(2000);
  }

  const finalInfo = await page.textContent('#saved-game-info');
  const match = finalInfo.match(/Move (\d+) \/ (\d+)/);
  const actualTotal = match ? parseInt(match[2], 10) : 0;
  const currentMove = match ? parseInt(match[1], 10) : 0;
  if (actualTotal !== expectedMoves) {
    throw new Error(`Wrong move count: got ${actualTotal}, expected ${expectedMoves}`);
  }
  if (currentMove !== expectedMoves) {
    throw new Error(`Not at last move: at ${currentMove}, expected ${expectedMoves}`);
  }
  return actualTotal;
}

async function main() {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on('dialog', d => d.dismiss());

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (e) {
    console.error('Cannot reach', BASE_URL, '- is the server running?');
    process.exit(1);
  }

  await page.click('#mode-saved');
  await page.waitForSelector('#saved-game-panel.visible');
  await page.waitForTimeout(500);

  const options = await page.$$eval('#saved-game-select option', opts =>
    opts.filter(o => o.value).map(o => o.value)
  );
  if (options.length === 0) {
    console.error('No games in dropdown - manifest may have failed to load');
    process.exit(1);
  }

  let failed = 0;
  for (const filename of options) {
    const expected = EXPECTED_MOVES[filename];
    if (!expected) {
      console.log('SKIP', filename, '(no expected count)');
      continue;
    }
    try {
      await page.evaluate((f) => {
        const sel = document.getElementById('saved-game-select');
        if (sel) sel.value = f;
      }, filename);
      await page.click('#saved-load-btn');
      await page.waitForTimeout(2000);
      const steps = await testGame(page, filename, expected);
      console.log('OK', filename, ':', steps, 'moves');
    } catch (e) {
      console.log('FAIL', filename, ':', e.message);
      failed++;
    }
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

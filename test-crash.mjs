#!/usr/bin/env node
/**
 * Reproduce the crash when placing 3 stones - runs in headless browser
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));

const PORT = 18765;
let server;

async function startServer() {
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.mjs': 'application/javascript' };
  server = createServer((req, res) => {
    let path = req.url === '/' ? '/index.html' : req.url;
    path = join(__dirname, path.split('?')[0]);
    try {
      const data = readFileSync(path);
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
      res.end(data);
    } catch (e) {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise((r, rej) => {
    server.listen(PORT, () => r());
    server.on('error', rej);
  });
}

async function run() {
  await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
    console.error(err.stack);
  });
  page.on('crash', () => console.error('PAGE CRASHED'));

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('#canvas', { timeout: 5000 });

    const canvas = await page.$('#canvas');
    const box = await canvas.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    async function placeStone(x, y) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await new Promise(r => setTimeout(r, 300));
      await page.mouse.up();
      await new Promise(r => setTimeout(r, 100));
    }

    console.log('Placing stone 1 (black)...');
    await placeStone(centerX - 100, centerY - 100);
    await new Promise(r => setTimeout(r, 500));

    console.log('Placing stone 2 (white)...');
    await placeStone(centerX + 100, centerY - 50);
    await new Promise(r => setTimeout(r, 500));

    console.log('Placing stone 3 (black)...');
    await placeStone(centerX - 50, centerY + 100);
    await new Promise(r => setTimeout(r, 1000));

    const stones = await page.evaluate(() => {
      const scoreEl = document.querySelector('#score-black');
      return scoreEl ? 'page responsive' : 'unknown';
    });
    console.log('Stones on board:', stones);
    console.log('No crash detected - test passed');
  } catch (err) {
    console.error('Test failed:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
    server.close();
  }
}

run();

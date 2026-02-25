#!/usr/bin/env node
/**
 * Download SGF games from a list of URLs.
 * Usage: node scripts/download-games.mjs [urls.txt]
 * If no file given, reads from GAME_URLS env or games/game-urls.txt
 * Saves to games/corpus/ and updates manifest.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

const GAMES_DIR = join(process.cwd(), 'games');
const CORPUS_DIR = join(GAMES_DIR, 'corpus');
const MANIFEST_PATH = join(GAMES_DIR, 'manifest.json');
const DEFAULT_URLS_FILE = join(GAMES_DIR, 'game-urls.txt');

const SAMPLE_URLS = [
  'https://raw.githubusercontent.com/nickshanks/Go-Game-Data/master/AlphaGo-Lee-Sedol/Game1.sgf',
  'https://raw.githubusercontent.com/nickshanks/Go-Game-Data/master/AlphaGo-Lee-Sedol/Game2.sgf',
  'https://raw.githubusercontent.com/nickshanks/Go-Game-Data/master/AlphaGo-Lee-Sedol/Game3.sgf',
  'https://raw.githubusercontent.com/nickshanks/Go-Game-Data/master/AlphaGo-Lee-Sedol/Game4.sgf',
  'https://raw.githubusercontent.com/nickshanks/Go-Game-Data/master/AlphaGo-Lee-Sedol/Game5.sgf'
];

function loadUrls(filePath) {
  if (existsSync(filePath)) {
    const data = readFileSync(filePath, 'utf8');
    return data.split('\n').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

async function downloadUrl(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'FreeGo/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    throw new Error(e.message);
  }
}

function safeFilename(url) {
  const name = basename(url).replace(/[^a-zA-Z0-9._-]/g, '_');
  return name.endsWith('.sgf') ? name : name + '.sgf';
}

async function main() {
  const args = process.argv.slice(2);
  const urlsFile = args[0] || process.env.GAME_URLS || DEFAULT_URLS_FILE;
  let urls = loadUrls(urlsFile);

  if (urls.length === 0) {
    console.log('No URLs in', urlsFile);
    console.log('Creating sample game-urls.txt with placeholder URLs');
    writeFileSync(
      DEFAULT_URLS_FILE,
      SAMPLE_URLS.join('\n') + '\n# Add more SGF URLs, one per line\n',
      'utf8'
    );
    urls = SAMPLE_URLS;
  }

  if (!existsSync(CORPUS_DIR)) {
    mkdirSync(CORPUS_DIR, { recursive: true });
  }

  let downloaded = 0;
  for (const url of urls) {
    if (!url || url.startsWith('#')) continue;
    const filename = safeFilename(url);
    const outPath = join(CORPUS_DIR, filename);
    try {
      const content = await downloadUrl(url);
      if (content.includes('(') && content.includes(';')) {
        writeFileSync(outPath, content, 'utf8');
        console.log('OK', filename);
        downloaded++;
      } else {
        console.log('SKIP', filename, '(not valid SGF)');
      }
    } catch (e) {
      console.log('FAIL', filename, e.message);
    }
  }

  const existing = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    : [];
  const corpusFiles = readdirSync(CORPUS_DIR).filter(f => f.endsWith('.sgf'));
  const rootFiles = readdirSync(GAMES_DIR).filter(f => f.endsWith('.sgf') && f !== 'manifest.json');
  const allFiles = [...new Set([...rootFiles, ...corpusFiles.map(f => 'corpus/' + f)])].sort();
  writeFileSync(MANIFEST_PATH, JSON.stringify(allFiles, null, 2) + '\n', 'utf8');
  console.log('\nManifest updated:', allFiles.length, 'games');
  console.log('Downloaded:', downloaded);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Config grid search: replay SGF games with different configs, report winner match and metrics.
 */

import { replaySGF } from './replay.mjs';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const GAMES_DIR = join(process.cwd(), 'games');
const MANIFEST = join(GAMES_DIR, 'manifest.json');

function loadManifest() {
  try {
    const data = readFileSync(MANIFEST, 'utf8');
    return JSON.parse(data);
  } catch {
    return readdirSync(GAMES_DIR).filter(f => f.endsWith('.sgf'));
  }
}

function loadGame(filename) {
  const path = join(GAMES_DIR, filename);
  return readFileSync(path, 'utf8');
}

const CONFIG_GRID = {
  lineDistanceExponent: [1, 2, 3],
  triangleAreaExponent: [0.25, 0.333, 0.5],
  simulation_steps_per_turn: [30, 60, 120]
};

function* configVariants(baseConfig = {}) {
  const keys = Object.keys(CONFIG_GRID);
  const values = keys.map(k => CONFIG_GRID[k]);
  const n = values.reduce((a, v) => a * v.length, 1);
  for (let i = 0; i < n; i++) {
    let idx = i;
    const config = { ...baseConfig };
    for (let j = 0; j < keys.length; j++) {
      const arr = values[j];
      config[keys[j]] = arr[idx % arr.length];
      idx = Math.floor(idx / arr.length);
    }
    yield config;
  }
}

function runOne(gameFile, config, seed = 12345, moveLimit = null, onProgress = null) {
  const sgfText = loadGame(gameFile);
  return replaySGF(sgfText, config, seed, moveLimit, onProgress);
}

function runOneWithSeeds(gameFile, config, seeds, moveLimit = null, onProgress = null) {
  const results = [];
  for (let si = 0; si < seeds.length; si++) {
    const wrapProgress = onProgress ? (cur, tot, elapsed) => onProgress(cur, tot, elapsed, si, seeds.length) : null;
    results.push(runOne(gameFile, config, seeds[si], moveLimit, wrapProgress));
  }
  const winnerMatches = results.filter(r => !r.error && r.winnerFromResult && r.winnerFromResult === r.energyLeader).length;
  const valid = results.filter(r => !r.error && r.winnerFromResult).length;
  return { winnerMatches, total: valid, results };
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function main() {
  const args = process.argv.slice(2);
  const moveLimit = args[0] ? parseInt(args[0], 10) : 10;
  const maxConfigs = args[1] ? parseInt(args[1], 10) : 2;
  const numSeeds = args[2] ? parseInt(args[2], 10) : 1;
  const seeds = Array.from({ length: numSeeds }, (_, i) => 12345 + i);

  const files = loadManifest();
  if (files.length === 0) {
    console.error('No games found in', GAMES_DIR);
    process.exit(1);
  }

  console.log('Games:', files.length);
  console.log('Move limit:', moveLimit ?? 'full');
  console.log('Config variants:', maxConfigs);
  console.log('Seeds per game:', numSeeds);
  console.log('');

  const results = [];
  let configIdx = 0;
  const isTty = process.stdout.isTTY;
  const totalTasks = maxConfigs * files.length * numSeeds;
  const startTime = Date.now();

  for (const config of configVariants()) {
    if (configIdx >= maxConfigs) break;
    configIdx++;

    let winnerMatch = 0;
    let total = 0;
    const gameResults = [];

    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
      const file = files[fileIdx];
      try {
        const baseTask = (configIdx - 1) * files.length * numSeeds + fileIdx * numSeeds;
        const onProgress = isTty
          ? (cur, tot, elapsed, seedIdx = 0, numS = 1) => {
              const taskProgress = baseTask + (numS > 1 ? seedIdx + cur / tot : cur / tot);
              const pct = totalTasks > 0 ? Math.min(1, taskProgress / totalTasks) : 0;
              const barLen = 20;
              const filled = Math.round(pct * barLen);
              const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
              const cfgStr = `Config ${configIdx}/${maxConfigs}`;
              const gameStr = `Game ${fileIdx + 1}/${files.length}`;
              const innerStr = numS > 1 ? `Seed ${seedIdx + 1}/${numS} Move ${cur}/${tot}` : `Move ${cur}/${tot}`;
              const etaSec = taskProgress > 0 ? Math.round((Date.now() - startTime) / taskProgress * (totalTasks - taskProgress) / 1000) : null;
              const etaStr = etaSec != null && etaSec > 0 ? `ETA ~${etaSec}s` : '';
              process.stdout.write(`\r  ${bar} ${cfgStr} | ${gameStr} | ${innerStr} | ${formatElapsed(Date.now() - startTime)} ${etaStr}   `);
            }
          : null;

        if (numSeeds > 1) {
          const multi = runOneWithSeeds(file, config, seeds, moveLimit, onProgress);
          total += multi.total;
          winnerMatch += multi.winnerMatches;
          const consistent = multi.results.every(r => r.energyLeader === multi.results[0].energyLeader);
          gameResults.push({
            file,
            match: multi.total > 0 ? multi.winnerMatches === multi.total : false,
            consistent,
            seeds: numSeeds
          });
        } else {
          const out = runOne(file, config, seeds[0], moveLimit, onProgress);
          if (out.error) continue;
          if (!out.winnerFromResult) continue;
          total++;
          const match = out.winnerFromResult === out.energyLeader;
          if (match) winnerMatch++;
          gameResults.push({
            file,
            match,
            result: out.result,
            energyLeader: out.energyLeader
          });
        }
      } catch (e) {
        console.error('\nError', file, e.message);
      }
    }

    if (isTty) process.stdout.write('\r' + ' '.repeat(100) + '\r');

    const rate = total > 0 ? (winnerMatch / total * 100).toFixed(1) : 0;
    results.push({
      config,
      winnerMatchRate: parseFloat(rate),
      winnerMatch,
      total,
      gameResults
    });
    console.log(`Config ${configIdx}: winner match ${winnerMatch}/${total} (${rate}%)`);
  }

  results.sort((a, b) => b.winnerMatchRate - a.winnerMatchRate);
  console.log('\n--- Best configs ---');
  results.slice(0, 3).forEach((r, i) => {
    console.log(`${i + 1}. ${r.winnerMatch}/${r.total} (${r.winnerMatchRate}%)`, JSON.stringify(r.config));
  });
}

main();

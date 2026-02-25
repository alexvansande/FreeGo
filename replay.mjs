#!/usr/bin/env node
/**
 * Headless SGF replay: load a game, replay moves with FreeGo simulation, report results.
 */

import { createSimulation, parseSGF, sgfToBoard } from './simulation.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

function loadConfig() {
  try {
    const p = join(process.cwd(), 'config.json');
    const data = readFileSync(p, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function replaySGF(sgfText, userConfig = {}, seed = 12345, moveLimit = null, onProgress = null) {
  const config = { ...loadConfig(), ...userConfig };
  const parsed = parseSGF(sgfText);
  if (parsed.error || !parsed.moves?.length) {
    return { error: parsed.error || 'No moves', result: parsed.result };
  }

  const sim = createSimulation(config, seed);
  const baseTicksPerMove = config.simulation_steps_per_turn ?? config.simTicksPerMove ?? 60;
  const adaptiveTicks = config.adaptiveTicks !== false;
  const adaptiveThreshold = config.adaptiveTicksThreshold ?? 60;
  const movesToReplay = moveLimit != null ? Math.min(moveLimit, parsed.moves.length) : parsed.moves.length;
  const startTime = Date.now();

  for (let i = 0; i < movesToReplay; i++) {
    const m = parsed.moves[i];
    sim.placeStone(m.pos.x, m.pos.y, m.color);
    const stoneCount = sim.getBoardState().stones.length;
    const ticksPerMove = adaptiveTicks && stoneCount > adaptiveThreshold
      ? Math.max(5, Math.floor(baseTicksPerMove * (adaptiveThreshold * adaptiveThreshold) / (stoneCount * stoneCount)))
      : baseTicksPerMove;
    sim.runSimulationTicks(ticksPerMove);
    if (onProgress) {
      onProgress(i + 1, movesToReplay, Date.now() - startTime);
    }
  }

  const areaScore = sim.computeAreaScore();
  const energyLeader = sim.getEnergyLeader();

  return {
    moves: parsed.moves.length,
    movesReplayed: movesToReplay,
    result: parsed.result,
    black: parsed.black,
    white: parsed.white,
    areaScore,
    energyLeader,
    winnerFromResult: parseResultWinner(parsed.result)
  };
}

function parseResultWinner(re) {
  if (!re) return null;
  if (re.startsWith('B+') || re === 'B+Resign') return 'black';
  if (re.startsWith('W+') || re === 'W+Resign') return 'white';
  return null;
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function main() {
  const args = process.argv.slice(2);
  const file = args[0] || 'games/alphago-lee-sedol.sgf';
  const seed = parseInt(args[1], 10) || 12345;
  const limit = args[2] ? parseInt(args[2], 10) : null;

  let sgfText;
  try {
    sgfText = readFileSync(file, 'utf8');
  } catch (e) {
    console.error('Failed to read:', file, e.message);
    process.exit(1);
  }

  const parsed = parseSGF(sgfText);
  const movesToReplay = limit != null ? Math.min(limit, parsed.moves?.length ?? 0) : (parsed.moves?.length ?? 0);
  const isTty = process.stdout.isTTY;

  const onProgress = movesToReplay > 0
    ? (current, total, elapsedMs) => {
        const pct = Math.round((current / total) * 100);
        if (isTty) {
          const barLen = 20;
          const filled = Math.round((current / total) * barLen);
          const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
          const etaSec = current > 0 ? Math.round((elapsedMs / current) * (total - current) / 1000) : null;
          const etaStr = etaSec != null ? `ETA ~${etaSec}s` : 'ETA ...';
          process.stdout.write(`\r  ${bar} ${current}/${total} (${pct}%) | ${formatElapsed(elapsedMs)} | ${etaStr}   `);
        } else if (current === total || current % 10 === 0) {
          process.stderr.write(`Replay: ${current}/${total} (${formatElapsed(elapsedMs)})\n`);
        }
      }
    : null;

  const out = replaySGF(sgfText, {}, seed, limit, onProgress);

  if (onProgress) {
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
  }

  if (out.error) {
    console.error('Replay error:', out.error);
    process.exit(1);
  }

  console.log(JSON.stringify(out, null, 2));
  console.log('\nWinner match:', out.winnerFromResult === out.energyLeader ? 'YES' : 'NO');
}

if (process.argv[1]?.endsWith('replay.mjs')) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

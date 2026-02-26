#!/usr/bin/env node
/**
 * Voronoi-based Go engine prototype v2.
 * 
 * Grid mode: uses orthogonal adjacency (standard Go).
 * Free mode: will use Delaunay for adjacency, Voronoi for territory.
 * 
 * Capture = group with 0 liberties → removed from board.
 */

const BOARD_SIZE = 600;
const GRID_SIZE = 19;
const GRID_SPACING = BOARD_SIZE / (GRID_SIZE - 1);

// ============ Grid-based Groups and Liberties ============

function makePositionMap(stones) {
  const posMap = new Map();
  for (const s of stones) {
    if (s.captured) continue;
    const c = Math.round(s.x / GRID_SPACING);
    const r = Math.round(s.y / GRID_SPACING);
    posMap.set(`${c},${r}`, s);
  }
  return posMap;
}

function findGroupOf(stone, stones) {
  const posMap = makePositionMap(stones);
  const visited = new Set();
  const group = [];
  const stack = [stone];
  
  while (stack.length > 0) {
    const curr = stack.pop();
    if (visited.has(curr)) continue;
    visited.add(curr);
    group.push(curr);
    
    const c = Math.round(curr.x / GRID_SPACING);
    const r = Math.round(curr.y / GRID_SPACING);
    for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const neighbor = posMap.get(`${c+dc},${r+dr}`);
      if (neighbor && !visited.has(neighbor) && neighbor.color === curr.color) {
        stack.push(neighbor);
      }
    }
  }
  return group;
}

function findAllGroups(stones) {
  const active = stones.filter(s => !s.captured);
  const posMap = makePositionMap(stones);
  const visited = new Set();
  const groups = [];
  
  for (const s of active) {
    if (visited.has(s)) continue;
    const group = [];
    const stack = [s];
    while (stack.length > 0) {
      const curr = stack.pop();
      if (visited.has(curr)) continue;
      visited.add(curr);
      group.push(curr);
      
      const c = Math.round(curr.x / GRID_SPACING);
      const r = Math.round(curr.y / GRID_SPACING);
      for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const neighbor = posMap.get(`${c+dc},${r+dr}`);
        if (neighbor && !visited.has(neighbor) && neighbor.color === curr.color) {
          stack.push(neighbor);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

function getGroupLiberties(group, stones) {
  const posMap = makePositionMap(stones);
  const liberties = new Set();
  
  for (const stone of group) {
    const col = Math.round(stone.x / GRID_SPACING);
    const row = Math.round(stone.y / GRID_SPACING);
    
    for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= GRID_SIZE || nr < 0 || nr >= GRID_SIZE) continue;
      const key = `${nc},${nr}`;
      if (!posMap.has(key)) {
        liberties.add(key);
      }
    }
  }
  
  return liberties;
}

// ============ Capture Logic ============

function resolveCaptures(stones, lastPlacedStone) {
  const lastPlacedColor = lastPlacedStone.color;
  const opponentColor = lastPlacedColor === 'black' ? 'white' : 'black';
  const posMap = makePositionMap(stones);
  let totalCaptured = [];
  
  // Check opponent neighbors of the placed stone first
  const col = Math.round(lastPlacedStone.x / GRID_SPACING);
  const row = Math.round(lastPlacedStone.y / GRID_SPACING);
  const checkedGroups = new Set();
  
  for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
    const neighbor = posMap.get(`${col+dc},${row+dr}`);
    if (!neighbor || neighbor.color !== opponentColor || checkedGroups.has(neighbor)) continue;
    
    const group = findGroupOf(neighbor, stones);
    for (const s of group) checkedGroups.add(s);
    
    const libs = getGroupLiberties(group, stones);
    if (libs.size === 0) {
      for (const s of group) {
        s.captured = true;
        totalCaptured.push(s);
      }
    }
  }
  
  // If no opponent captures, check self-capture (suicide)
  if (totalCaptured.length === 0) {
    const ownGroup = findGroupOf(lastPlacedStone, stones);
    const libs = getGroupLiberties(ownGroup, stones);
    if (libs.size === 0) {
      for (const s of ownGroup) {
        s.captured = true;
        totalCaptured.push(s);
      }
    }
  }
  
  return totalCaptured;
}

// ============ Scoring (area scoring) ============

function computeScore(stones) {
  const posMap = makePositionMap(stones);
  const idx = (c, r) => r * GRID_SIZE + c;
  const visited = new Set();
  let blackTerritory = 0, whiteTerritory = 0, neutral = 0;
  let blackStones = 0, whiteStones = 0;
  
  for (const s of stones) {
    if (s.captured) continue;
    if (s.color === 'black') blackStones++;
    else whiteStones++;
  }
  
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const key = `${c},${r}`;
      if (posMap.has(key) || visited.has(key)) continue;
      
      const region = [];
      let touchesBlack = false, touchesWhite = false;
      const stack = [[c, r]];
      
      while (stack.length > 0) {
        const [cc, cr] = stack.pop();
        const k = `${cc},${cr}`;
        if (visited.has(k)) continue;
        
        const stone = posMap.get(k);
        if (stone) {
          if (stone.color === 'black') touchesBlack = true;
          else touchesWhite = true;
          continue;
        }
        
        visited.add(k);
        region.push(k);
        
        for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
          const nc = cc + dc, nr = cr + dr;
          if (nc >= 0 && nc < GRID_SIZE && nr >= 0 && nr < GRID_SIZE) {
            stack.push([nc, nr]);
          }
        }
      }
      
      if (touchesBlack && !touchesWhite) blackTerritory += region.length;
      else if (touchesWhite && !touchesBlack) whiteTerritory += region.length;
      else neutral += region.length;
    }
  }
  
  return {
    blackTerritory, whiteTerritory, neutral,
    blackStones, whiteStones,
    blackTotal: blackTerritory + blackStones,
    whiteTotal: whiteTerritory + whiteStones,
    winner: (blackTerritory + blackStones) > (whiteTerritory + whiteStones) ? 'black' : 'white'
  };
}

// ============ SGF Parser ============

function sgfToBoard(sgfCoord) {
  if (!sgfCoord || sgfCoord.length < 2) return null;
  const col = sgfCoord.charCodeAt(0) - 97;
  const row = sgfCoord.charCodeAt(1) - 97;
  if (col < 0 || col > 18 || row < 0 || row > 18) return null;
  return { x: col * GRID_SPACING, y: row * GRID_SPACING };
}

function parseSGF(sgfText) {
  const moves = [];
  let black = '', white = '', result = '';
  let i = 0;
  const inMainLine = [];
  let justClosed = false;

  function readPropertyValue() {
    if (sgfText[i] !== '[') return '';
    i++; let val = '';
    while (i < sgfText.length) {
      if (sgfText[i] === '\\' && i + 1 < sgfText.length) { i++; val += sgfText[i++]; continue; }
      if (sgfText[i] === ']') { i++; break; }
      val += sgfText[i++];
    }
    return val;
  }

  while (i < sgfText.length) {
    const c = sgfText[i];
    if (c === '(') { inMainLine.push(!justClosed); justClosed = false; i++; continue; }
    if (c === ')') { inMainLine.pop(); justClosed = true; i++; continue; }
    if (c === ';') {
      justClosed = false; i++;
      while (i < sgfText.length) {
        while (i < sgfText.length && /\s/.test(sgfText[i])) i++;
        if (i >= sgfText.length || !/[A-Za-z]/.test(sgfText[i])) break;
        const collect = inMainLine.length > 0 && inMainLine[inMainLine.length - 1];
        if (collect && sgfText[i] === 'B' && sgfText[i+1] === '[') {
          i++; const val = readPropertyValue();
          if (val.length >= 2) { const pos = sgfToBoard(val); if (pos) moves.push({ color: 'black', coord: val, pos }); }
          else if (val === '') moves.push({ color: 'black', pass: true }); // pass
          continue;
        }
        if (collect && sgfText[i] === 'W' && sgfText[i+1] === '[') {
          i++; const val = readPropertyValue();
          if (val.length >= 2) { const pos = sgfToBoard(val); if (pos) moves.push({ color: 'white', coord: val, pos }); }
          else if (val === '') moves.push({ color: 'white', pass: true }); // pass
          continue;
        }
        if (sgfText[i] === 'R' && sgfText[i+1] === 'E' && sgfText[i+2] === '[') {
          i += 2; result = readPropertyValue(); continue;
        }
        if ((sgfText[i] === 'P' && (sgfText[i+1] === 'B' || sgfText[i+1] === 'W'))) {
          const prop = sgfText[i+1] === 'B' ? 'PB' : 'PW';
          i += 2;
          if (sgfText[i] === '[') { const val = readPropertyValue(); if (prop === 'PB') black = val; else white = val; }
          continue;
        }
        i++;
        while (i < sgfText.length && sgfText[i] !== '[' && sgfText[i] !== ';' && sgfText[i] !== '(' && sgfText[i] !== ')') i++;
        if (sgfText[i] === '[') { while (sgfText[i] === '[') readPropertyValue(); }
      }
      continue;
    }
    i++;
  }
  return { moves, black, white, result };
}

// ============ Game ============

function createGame() {
  const stones = [];
  let captures = { black: 0, white: 0 };
  
  function placeStone(x, y, color) {
    const posMap = makePositionMap(stones);
    const c = Math.round(x / GRID_SPACING);
    const r = Math.round(y / GRID_SPACING);
    const key = `${c},${r}`;
    
    if (posMap.has(key)) return { success: false, reason: 'occupied' };
    
    const stone = { x: c * GRID_SPACING, y: r * GRID_SPACING, color, captured: false };
    stones.push(stone);
    
    const capturedStones = resolveCaptures(stones, stone);
    const capturedByMe = capturedStones.filter(s => s.color !== color).length;
    
    if (color === 'black') captures.black += capturedByMe;
    else captures.white += capturedByMe;
    
    return { success: true, captured: capturedStones.length };
  }
  
  return { placeStone, stones, captures, computeScore: () => computeScore(stones) };
}

// ============ Test SGF ============

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function testSGFGame(filename) {
  const sgfText = readFileSync(filename, 'utf-8');
  const parsed = parseSGF(sgfText);
  
  if (parsed.moves.length === 0) { console.log('  SKIP'); return null; }
  
  const game = createGame();
  let errors = 0, totalCaptures = 0;
  
  for (let i = 0; i < parsed.moves.length; i++) {
    const m = parsed.moves[i];
    if (m.pass) continue;
    const result = game.placeStone(m.pos.x, m.pos.y, m.color);
    if (!result.success) {
      errors++;
    } else {
      totalCaptures += result.captured;
    }
  }
  
  const score = game.computeScore();
  let expectedWinner = null;
  if (parsed.result) {
    if (parsed.result.startsWith('B+')) expectedWinner = 'black';
    else if (parsed.result.startsWith('W+')) expectedWinner = 'white';
  }
  
  const match = expectedWinner ? (score.winner === expectedWinner ? '✅' : '❌') : '❓';
  console.log(`  ${match} ${parsed.moves.length} moves, ${totalCaptures} captures, ${errors} placement errors`);
  console.log(`     B ${score.blackTotal} (terr ${score.blackTerritory} + stones ${score.blackStones}) vs W ${score.whiteTotal} (terr ${score.whiteTerritory} + stones ${score.whiteStones}) | neutral: ${score.neutral}`);
  console.log(`     Expected: ${parsed.result || '?'} | Got: ${score.winner}`);
  console.log(`     Captured: B took ${game.captures.black}, W took ${game.captures.white}`);
  
  return { expectedWinner, actualWinner: score.winner, match: score.winner === expectedWinner };
}

console.log('=== Voronoi Go Engine v2 - SGF Tests ===\n');
const gamesDir = join(import.meta.dirname || '.', 'games');
const files = readdirSync(gamesDir).filter(f => f.endsWith('.sgf') && !f.includes('.min.'));
let correct = 0, total = 0;

for (const file of files) {
  console.log(file + ':');
  const result = testSGFGame(join(gamesDir, file));
  if (result && result.expectedWinner) {
    total++;
    if (result.match) correct++;
  }
}

console.log(`\n=== Results: ${correct}/${total} correct winners ===`);

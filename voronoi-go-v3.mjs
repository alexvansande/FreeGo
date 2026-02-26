#!/usr/bin/env node
/**
 * Voronoi Go Engine v3 - Fixed capture resolution.
 * Now checks ALL opponent groups (not just neighbors) after placement.
 */

const BOARD_SIZE = 600;
const GRID_SIZE = 19;
const GRID_SPACING = BOARD_SIZE / (GRID_SIZE - 1);

function makePositionMap(stones) {
  const m = new Map();
  for (const s of stones) {
    if (s.captured) continue;
    m.set(`${Math.round(s.x / GRID_SPACING)},${Math.round(s.y / GRID_SPACING)}`, s);
  }
  return m;
}

function findAllGroups(stones) {
  const posMap = makePositionMap(stones);
  const visited = new Set();
  const groups = [];
  for (const [key, s] of posMap) {
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
        const n = posMap.get(`${c+dc},${r+dr}`);
        if (n && !visited.has(n) && n.color === curr.color) stack.push(n);
      }
    }
    groups.push({ color: s.color, stones: group });
  }
  return groups;
}

function getGroupLiberties(group, posMap) {
  const liberties = new Set();
  for (const stone of group) {
    const c = Math.round(stone.x / GRID_SPACING);
    const r = Math.round(stone.y / GRID_SPACING);
    for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= GRID_SIZE || nr < 0 || nr >= GRID_SIZE) continue;
      if (!posMap.has(`${nc},${nr}`)) liberties.add(`${nc},${nr}`);
    }
  }
  return liberties;
}

function resolveCaptures(stones, lastColor) {
  const opponentColor = lastColor === 'black' ? 'white' : 'black';
  const posMap = makePositionMap(stones);
  let captured = [];
  
  // Find all opponent groups and check liberties
  const groups = findAllGroups(stones);
  for (const g of groups) {
    if (g.color !== opponentColor) continue;
    const libs = getGroupLiberties(g.stones, posMap);
    if (libs.size === 0) {
      for (const s of g.stones) { s.captured = true; captured.push(s); }
    }
  }
  
  // If no opponent captured, check own suicide
  if (captured.length === 0) {
    const posMap2 = makePositionMap(stones);
    const groups2 = findAllGroups(stones);
    for (const g of groups2) {
      if (g.color !== lastColor) continue;
      const libs = getGroupLiberties(g.stones, posMap2);
      if (libs.size === 0) {
        for (const s of g.stones) { s.captured = true; captured.push(s); }
      }
    }
  }
  
  return captured;
}

function computeScore(stones) {
  const posMap = makePositionMap(stones);
  const visited = new Set();
  let bT = 0, wT = 0, neutral = 0, bS = 0, wS = 0;
  
  for (const [_, s] of posMap) { if (s.color === 'black') bS++; else wS++; }
  
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const k = `${c},${r}`;
      if (posMap.has(k) || visited.has(k)) continue;
      const region = [];
      let tb = false, tw = false;
      const stack = [[c, r]];
      while (stack.length > 0) {
        const [cc, cr] = stack.pop();
        const kk = `${cc},${cr}`;
        if (visited.has(kk)) continue;
        const stone = posMap.get(kk);
        if (stone) { if (stone.color === 'black') tb = true; else tw = true; continue; }
        visited.add(kk);
        region.push(kk);
        for (const [dc, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
          const nc = cc+dc, nr = cr+dr;
          if (nc >= 0 && nc < GRID_SIZE && nr >= 0 && nr < GRID_SIZE) stack.push([nc, nr]);
        }
      }
      if (tb && !tw) bT += region.length;
      else if (tw && !tb) wT += region.length;
      else neutral += region.length;
    }
  }
  return { bT, wT, neutral, bS, wS, bTotal: bT + bS, wTotal: wT + wS, winner: (bT + bS) > (wT + wS) ? 'black' : 'white' };
}

function sgfToBoard(c) {
  const col = c.charCodeAt(0) - 97, row = c.charCodeAt(1) - 97;
  if (col < 0 || col > 18 || row < 0 || row > 18) return null;
  return { x: col * GRID_SPACING, y: row * GRID_SPACING };
}

function parseSGF(t) {
  const moves = []; let black='', white='', result='';
  let i = 0; const inML = []; let jc = false;
  function rpv() { if(t[i]!=='[')return''; i++; let v=''; while(i<t.length){if(t[i]==='\\'&&i+1<t.length){i++;v+=t[i++];continue;} if(t[i]===']'){i++;break;} v+=t[i++];} return v; }
  while(i<t.length){
    const c=t[i];
    if(c==='('){inML.push(!jc);jc=false;i++;continue;}
    if(c===')'){inML.pop();jc=true;i++;continue;}
    if(c===';'){jc=false;i++;
      while(i<t.length){
        while(i<t.length&&/\s/.test(t[i]))i++;
        if(i>=t.length||!/[A-Za-z]/.test(t[i]))break;
        const col=inML.length>0&&inML[inML.length-1];
        if(col&&t[i]==='B'&&t[i+1]==='['){i++;const v=rpv();if(v.length>=2){const p=sgfToBoard(v);if(p)moves.push({color:'black',coord:v,pos:p});}else if(v==='')moves.push({color:'black',pass:true});continue;}
        if(col&&t[i]==='W'&&t[i+1]==='['){i++;const v=rpv();if(v.length>=2){const p=sgfToBoard(v);if(p)moves.push({color:'white',coord:v,pos:p});}else if(v==='')moves.push({color:'white',pass:true});continue;}
        if(t[i]==='R'&&t[i+1]==='E'&&t[i+2]==='['){i+=2;result=rpv();continue;}
        if(t[i]==='P'&&(t[i+1]==='B'||t[i+1]==='W')){const p=t[i+1]==='B'?'PB':'PW';i+=2;if(t[i]==='['){const v=rpv();if(p==='PB')black=v;else white=v;}continue;}
        i++;while(i<t.length&&t[i]!=='['&&t[i]!==';'&&t[i]!=='('&&t[i]!==')')i++;
        if(t[i]==='['){while(t[i]==='[')rpv();}
      }continue;}
    i++;}
  return {moves,black,white,result};
}

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

function testSGF(filename) {
  const parsed = parseSGF(readFileSync(filename, 'utf-8'));
  if (!parsed.moves.length) { console.log('  SKIP'); return null; }
  
  const stones = [];
  let capB = 0, capW = 0, errors = 0;
  
  for (const m of parsed.moves) {
    if (m.pass) continue;
    const pm = makePositionMap(stones);
    const c = Math.round(m.pos.x / GRID_SPACING);
    const r = Math.round(m.pos.y / GRID_SPACING);
    if (pm.has(`${c},${r}`)) { errors++; continue; }
    
    stones.push({ x: c * GRID_SPACING, y: r * GRID_SPACING, color: m.color, captured: false });
    const caps = resolveCaptures(stones, m.color);
    const byMe = caps.filter(s => s.color !== m.color).length;
    if (m.color === 'black') capB += byMe; else capW += byMe;
  }
  
  const score = computeScore(stones);
  let exp = null;
  if (parsed.result?.startsWith('B+')) exp = 'black';
  else if (parsed.result?.startsWith('W+')) exp = 'white';
  
  const ok = exp ? (score.winner === exp ? '✅' : '❌') : '❓';
  console.log(`  ${ok} ${parsed.moves.length} moves | ${errors} errors | captures: B took ${capB}, W took ${capW}`);
  console.log(`     B ${score.bTotal} (${score.bT}+${score.bS}) vs W ${score.wTotal} (${score.wT}+${score.wS}) | neutral ${score.neutral}`);
  console.log(`     Expected: ${parsed.result || '?'} | Got: ${score.winner}`);
  
  return exp ? { match: score.winner === exp } : null;
}

console.log('=== Voronoi Go Engine v3 ===\n');
const dir = join(import.meta.dirname || '.', 'games');
const files = readdirSync(dir).filter(f => f.endsWith('.sgf') && !f.includes('.min.'));
let ok = 0, tot = 0;
for (const f of files) {
  console.log(f + ':');
  const r = testSGF(join(dir, f));
  if (r) { tot++; if (r.match) ok++; }
}
console.log(`\n=== ${ok}/${tot} correct ===`);

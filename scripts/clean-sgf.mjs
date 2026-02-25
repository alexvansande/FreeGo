#!/usr/bin/env node
/**
 * Clean/normalize SGF files for easier parsing.
 * - Normalizes line endings (CRLF → LF)
 * - Strips BOM
 * - Optionally outputs main-line-only SGF (smaller, trivial to parse)
 *
 * Usage:
 *   node scripts/clean-sgf.mjs games/foo.sgf           # normalize in place
 *   node scripts/clean-sgf.mjs games/foo.sgf -o out.sgf # write to file
 *   node scripts/clean-sgf.mjs games/*.sgf             # all games
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

function normalize(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\uFEFF/, '');
}

function parseMainLine(sgfText) {
  const moves = [];
  let black = '', white = '', gameName = '', boardSize = 19;
  let i = 0;
  const inMainLine = [];
  let justClosed = false;

  function readValue() {
    if (sgfText[i] !== '[') return '';
    i++;
    let val = '';
    while (i < sgfText.length) {
      if (sgfText[i] === '\\' && i + 1 < sgfText.length) {
        i++;
        val += sgfText[i++];
        continue;
      }
      if (sgfText[i] === ']') { i++; break; }
      val += sgfText[i++];
    }
    return val;
  }

  while (i < sgfText.length) {
    const c = sgfText[i];
    if (c === '(') {
      inMainLine.push(!justClosed);
      justClosed = false;
      i++;
      continue;
    }
    if (c === ')') {
      inMainLine.pop();
      justClosed = true;
      i++;
      continue;
    }
    if (c === ';') {
      justClosed = false;
      i++;
      while (i < sgfText.length) {
        while (i < sgfText.length && /\s/.test(sgfText[i])) i++;
        if (i >= sgfText.length || !/[A-Za-z]/.test(sgfText[i])) break;
        const collect = inMainLine.length > 0 && inMainLine[inMainLine.length - 1];
        if (collect && sgfText[i] === 'B' && sgfText[i + 1] === '[') {
          i += 1;
          const val = readValue();
          if (val.length >= 2) moves.push({ color: 'B', coord: val });
          continue;
        }
        if (collect && sgfText[i] === 'W' && sgfText[i + 1] === '[') {
          i += 1;
          const val = readValue();
          if (val.length >= 2) moves.push({ color: 'W', coord: val });
          continue;
        }
        if ((sgfText[i] === 'P' && sgfText[i + 1] === 'B') || (sgfText[i] === 'P' && sgfText[i + 1] === 'W') ||
            (sgfText[i] === 'G' && sgfText[i + 1] === 'N') || (sgfText[i] === 'S' && sgfText[i + 1] === 'Z')) {
          const prop = sgfText[i] === 'P' ? (sgfText[i + 1] === 'B' ? 'PB' : 'PW') : (sgfText[i + 1] === 'N' ? 'GN' : 'SZ');
          i += 2;
          if (sgfText[i] === '[') {
            const val = readValue();
            if (prop === 'PB') black = val;
            else if (prop === 'PW') white = val;
            else if (prop === 'GN') gameName = val;
            else if (prop === 'SZ') boardSize = parseInt(val, 10) || 19;
          }
          continue;
        }
        i++;
        while (i < sgfText.length && sgfText[i] !== '[' && sgfText[i] !== ';' && sgfText[i] !== '(' && sgfText[i] !== ')') i++;
        if (sgfText[i] === '[') {
          while (sgfText[i] === '[') readValue();
        }
      }
      continue;
    }
    i++;
  }
  return { moves, black, white, gameName, boardSize };
}

function toMinimalSGF(parsed) {
  const parts = ['(;GM[1]FF[4]SZ[' + parsed.boardSize + ']'];
  if (parsed.black) parts.push('PB[' + escapeSGF(parsed.black) + ']');
  if (parsed.white) parts.push('PW[' + escapeSGF(parsed.white) + ']');
  if (parsed.gameName) parts.push('GN[' + escapeSGF(parsed.gameName) + ']');
  for (const m of parsed.moves) {
    parts.push(';' + m.color + '[' + m.coord + ']');
  }
  return parts.join('') + ')';
}

function escapeSGF(s) {
  return s.replace(/\\/g, '\\\\').replace(/]/g, '\\]');
}

function cleanFile(path, outPath, minimal = false) {
  const text = readFileSync(path, 'utf8');
  const normalized = normalize(text);
  if (!minimal) {
    const out = outPath || path;
    if (normalized !== text) {
      writeFileSync(out, normalized);
      console.log('Normalized:', path);
    }
    return;
  }
  const parsed = parseMainLine(normalized);
  const out = outPath || path.replace(/\.sgf$/, '.min.sgf');
  writeFileSync(out, toMinimalSGF(parsed));
  console.log('Minimal SGF:', path, '→', parsed.moves.length, 'moves');
}

const args = process.argv.slice(2);
const outIdx = args.indexOf('-o');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
const minimal = args.includes('-m') || args.includes('--minimal');
const files = args.filter((a, i) => a !== '-o' && (i === 0 || args[i - 1] !== '-o') && !a.startsWith('-') && a.endsWith('.sgf'));

if (files.length === 0) {
  console.log('Usage: node clean-sgf.mjs <file.sgf> [file2.sgf ...] [-o out.sgf] [-m]');
  console.log('  -o out.sgf   Write to file (default: overwrite)');
  console.log('  -m           Output minimal main-line-only SGF');
  process.exit(1);
}

for (const f of files) {
  try {
    cleanFile(resolve(f), outPath ? resolve(outPath) : null, minimal);
  } catch (e) {
    console.error('Error:', f, e.message);
    process.exit(1);
  }
}

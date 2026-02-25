#!/usr/bin/env node
/**
 * Headless FreeGo simulation for SGF replay and config tuning.
 * No DOM/canvas; uses seeded RNG for deterministic replay.
 */

const BOARD_SIZE = 600;
const GRID_SIZE = 19;
const GRID_SPACING = BOARD_SIZE / (GRID_SIZE - 1);
const BASE_STONE_ENERGY = 1;
const BASE_STONE_RADIUS = 4;
const MIN_STONE_RADIUS = 2;
const MAX_STONE_RADIUS = 8;
const STOCHASTIC_PAIRS_PER_TICK = 12;
const STALE_DRAIN_RATE = 0.05;
const MAX_LINE_LENGTH = 120;

const DEFAULT_CONFIG = {
  lineDistanceExponent: 2,
  triangleAreaExponent: 0.333,
  deathMode: 'flip',
  zero_energy_behavior: 'flip',
  staleFlipThreshold: -5,
  flipCooldownMs: 2000,
  stoneDrainRate: 0.01,
  supportFlowRate: 30,
  energy_transfer_speed: 30,
  conflictDrainRate: 0.3,
  simulation_steps_per_turn: 60,
  simTicksPerMove: 60,
  simDt: 1 / 60,
  stone_max_energy: 5,
  placement_energy_multiplier: 3,
  zero_area_death_speed_multiplier: 10,
  edge_energy_strength: 0.15,
  edge_point_spacing: 20,
  board_size: 'free',
  allow_dynamic_grid_resize: false
};

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function segmentsIntersect(a1, a2, b1, b2) {
  const [x1, y1] = [a1.x, a1.y];
  const [x2, y2] = [a2.x, a2.y];
  const [x3, y3] = [b1.x, b1.y];
  const [x4, y4] = [b2.x, b2.y];
  if ((x1 === x2 && y1 === y2) || (x3 === x4 && y3 === y4)) return false;
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < 1e-10) return false;
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return false;
  return { x: x1 + ua * (x2 - x1), y: y1 + ua * (y2 - y1) };
}

function segmentsProperlyCross(a1, a2, b1, b2) {
  const inter = segmentsIntersect(a1, a2, b1, b2);
  if (!inter) return false;
  const eps = 1e-6;
  const atEndpoint = (p, s, e) =>
    (Math.abs(p.x - s.x) < eps && Math.abs(p.y - s.y) < eps) ||
    (Math.abs(p.x - e.x) < eps && Math.abs(p.y - e.y) < eps);
  return !atEndpoint(inter, a1, a2) && !atEndpoint(inter, b1, b2);
}

function pointStrictlyInsideTriangle(p, t1, t2, t3) {
  const eps = 1e-6;
  if (dist(p, t1) < eps || dist(p, t2) < eps || dist(p, t3) < eps) return false;
  const sign = (p1, p2, p3) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(p, t1, t2), d2 = sign(p, t2, t3), d3 = sign(p, t3, t1);
  if (Math.abs(d1) < eps || Math.abs(d2) < eps || Math.abs(d3) < eps) return false;
  return (d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0);
}

function segmentCrossesTriangleInterior(s1, s2, t1, t2, t3) {
  const edges = [[t1, t2], [t2, t3], [t3, t1]];
  for (const [e1, e2] of edges) {
    const inter = segmentsIntersect(s1, s2, e1, e2);
    if (inter) {
      const onEndpoint = (p, a, b) =>
        (Math.abs(p.x - a.x) < 1e-6 && Math.abs(p.y - a.y) < 1e-6) ||
        (Math.abs(p.x - b.x) < 1e-6 && Math.abs(p.y - b.y) < 1e-6);
      if (!onEndpoint(inter, s1, s2) && !onEndpoint(inter, e1, e2)) return true;
    }
  }
  return pointStrictlyInsideTriangle(s1, t1, t2, t3) || pointStrictlyInsideTriangle(s2, t1, t2, t3);
}

function triangleArea(a, b, c) {
  return 0.5 * Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
}

function energyToRadius(energy) {
  const e = Math.max(0, energy);
  return MIN_STONE_RADIUS + (e / (e + BASE_STONE_ENERGY)) * (MAX_STONE_RADIUS - MIN_STONE_RADIUS);
}

export function sgfToBoard(sgfCoord) {
  if (!sgfCoord || sgfCoord.length < 2) return null;
  const col = sgfCoord.charCodeAt(0) - 97;
  const row = sgfCoord.charCodeAt(1) - 97;
  if (col < 0 || col > 18 || row < 0 || row > 18) return null;
  return { x: col * GRID_SPACING, y: row * GRID_SPACING };
}

export function parseSGF(sgfText) {
  const moves = [];
  let black = '', white = '', gameName = '', result = '', boardSize = 19;
  let i = 0;
  const inMainLine = [];
  let justClosed = false;

  function readPropertyValue() {
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
          const val = readPropertyValue();
          if (val.length >= 2) {
            const pos = sgfToBoard(val);
            if (pos) moves.push({ color: 'black', coord: val, pos, comment: '' });
          }
          continue;
        }
        if (collect && sgfText[i] === 'W' && sgfText[i + 1] === '[') {
          i += 1;
          const val = readPropertyValue();
          if (val.length >= 2) {
            const pos = sgfToBoard(val);
            if (pos) moves.push({ color: 'white', coord: val, pos, comment: '' });
          }
          continue;
        }
        if (sgfText[i] === 'R' && sgfText[i + 1] === 'E' && sgfText[i + 2] === '[') {
          i += 2;
          result = readPropertyValue();
          continue;
        }
        if (sgfText[i] === 'C' && sgfText[i + 1] === '[') {
          i += 1;
          readPropertyValue();
          continue;
        }
        if ((sgfText[i] === 'P' && sgfText[i + 1] === 'B') || (sgfText[i] === 'P' && sgfText[i + 1] === 'W') ||
            (sgfText[i] === 'G' && sgfText[i + 1] === 'N') || (sgfText[i] === 'S' && sgfText[i + 1] === 'Z')) {
          const prop = sgfText[i] === 'P' ? (sgfText[i + 1] === 'B' ? 'PB' : 'PW') : (sgfText[i + 1] === 'N' ? 'GN' : 'SZ');
          i += 2;
          if (sgfText[i] === '[') {
            const val = readPropertyValue();
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
          while (sgfText[i] === '[') readPropertyValue();
        }
      }
      continue;
    }
    i++;
  }
  if (boardSize !== 19) return { moves: [], black, white, gameName, result, error: 'Only 19x19 boards supported' };
  return { moves, black, white, gameName, result };
}

export function createSimulation(userConfig = {}, seed = 12345) {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const random = mulberry32(seed);

  const state = {
    stones: [],
    lines: [],
    triangles: [],
    retestQueue: [],
    simTime: 0
  };

  function hasLine(a, b) {
    return state.lines.some(l => (l.stoneA === a && l.stoneB === b) || (l.stoneA === b && l.stoneB === a));
  }

  function getLineCount(stone) {
    return state.lines.filter(l => l.stoneA === stone || l.stoneB === stone).length;
  }

  function getSupportLineCount(stone) {
    return state.lines.filter(l => !l.isConflict && (l.stoneA === stone || l.stoneB === stone)).length;
  }

  function computeLinePower(line, lineExistsInState = true) {
    const countA = getLineCount(line.stoneA);
    const countB = getLineCount(line.stoneB);
    const nA = Math.max(1, lineExistsInState ? countA - 1 : countA);
    const nB = Math.max(1, lineExistsInState ? countB - 1 : countB);
    const len = dist(line.stoneA, line.stoneB);
    if (len < 1e-6) return 0;
    const eA = Math.max(0, line.stoneA.energy);
    const eB = Math.max(0, line.stoneB.energy);
    const exp = config.lineDistanceExponent ?? 2;
    return (eA / nA + eB / nB) / Math.pow(len, exp);
  }

  function findTriangles() {
    const tri = [];
    const sameColorLines = state.lines.filter(l => !l.isConflict);
    for (let i = 0; i < state.stones.length; i++) {
      for (let j = i + 1; j < state.stones.length; j++) {
        for (let k = j + 1; k < state.stones.length; k++) {
          const a = state.stones[i], b = state.stones[j], c = state.stones[k];
          if (a.disabled || b.disabled || c.disabled) continue;
          if (a.color !== b.color || b.color !== c.color) continue;
          const hasAB = sameColorLines.some(l => (l.stoneA === a && l.stoneB === b) || (l.stoneA === b && l.stoneB === a));
          const hasBC = sameColorLines.some(l => (l.stoneA === b && l.stoneB === c) || (l.stoneA === c && l.stoneB === b));
          const hasCA = sameColorLines.some(l => (l.stoneA === c && l.stoneB === a) || (l.stoneA === a && l.stoneB === c));
          if (!hasAB || !hasBC || !hasCA) continue;
          const area = triangleArea(a, b, c);
          if (area < 1e-6) continue;
          let hasLineInside = false;
          for (const line of state.lines) {
            const s1 = line.stoneA, s2 = line.stoneB;
            const isEdge = (s1 === a && s2 === b) || (s1 === b && s2 === a) ||
              (s1 === b && s2 === c) || (s1 === c && s2 === b) ||
              (s1 === c && s2 === a) || (s1 === a && s2 === c);
            if (isEdge) continue;
            if (segmentCrossesTriangleInterior(s1, s2, a, b, c)) {
              hasLineInside = true;
              break;
            }
          }
          let hasSameColorStoneInside = false;
          const triColor = a.color;
          for (const stone of state.stones) {
            if (stone === a || stone === b || stone === c) continue;
            if (stone.color !== triColor) continue;
            if (pointStrictlyInsideTriangle(stone, a, b, c)) {
              hasSameColorStoneInside = true;
              break;
            }
          }
          if (!hasLineInside && !hasSameColorStoneInside) {
            const exp = config.triangleAreaExponent ?? 0.333;
            tri.push({ vertices: [a, b, c], area, energy: Math.pow(area, exp) });
          }
        }
      }
    }
    return tri;
  }

  function resolveIntersections() {
    const toRemove = new Set();
    for (let i = 0; i < state.lines.length; i++) {
      const lineA = state.lines[i];
      const a1 = lineA.stoneA, a2 = lineA.stoneB;
      const powerA = computeLinePower(lineA);
      for (let j = i + 1; j < state.lines.length; j++) {
        const lineB = state.lines[j];
        const b1 = lineB.stoneA, b2 = lineB.stoneB;
        if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
        if (!segmentsProperlyCross(a1, a2, b1, b2)) continue;
        const powerB = computeLinePower(lineB);
        if (powerA >= powerB) {
          toRemove.add(j);
          state.retestQueue.push([b1, b2]);
        } else {
          toRemove.add(i);
          state.retestQueue.push([a1, a2]);
        }
      }
    }
    state.lines = state.lines.filter((_, idx) => !toRemove.has(idx));
  }

  function getEdgePointsAndAssignments() {
    const activeStones = state.stones.filter(s => !s.disabled && !s.stale);
    if (activeStones.length < 3) return { points: [], virtualLines: [] };
    const hasBlack = activeStones.some(s => s.color === 'black');
    const hasWhite = activeStones.some(s => s.color === 'white');
    if (!hasBlack || !hasWhite) return { points: [], virtualLines: [] };

    const baseSpacing = config.edge_point_spacing ?? 20;
    const spacing = Math.max(10, (baseSpacing * BOARD_SIZE) / 600);
    const edgeStrength = config.edge_energy_strength ?? 0.15;
    const segments = [];
    for (let x = 0; x <= BOARD_SIZE; x += spacing) segments.push({ x, y: 0 });
    for (let y = spacing; y < BOARD_SIZE; y += spacing) segments.push({ x: BOARD_SIZE, y });
    for (let x = BOARD_SIZE; x >= 0; x -= spacing) segments.push({ x, y: BOARD_SIZE });
    for (let y = BOARD_SIZE - spacing; y > 0; y -= spacing) segments.push({ x: 0, y });
    let assignments = segments.map((pt, i) => {
      let nearest = null, nearestD = Infinity;
      for (const s of activeStones) {
        const d = dist(pt, s);
        if (d < nearestD) { nearestD = d; nearest = s; }
      }
      return { pt: { ...pt, i }, stone: nearest };
    });

    const eps = spacing * 0.6;
    const isCorner = (pt) =>
      (Math.abs(pt.x) < eps && Math.abs(pt.y) < eps) ||
      (Math.abs(pt.x - BOARD_SIZE) < eps && Math.abs(pt.y) < eps) ||
      (Math.abs(pt.x - BOARD_SIZE) < eps && Math.abs(pt.y - BOARD_SIZE) < eps) ||
      (Math.abs(pt.x) < eps && Math.abs(pt.y - BOARD_SIZE) < eps);
    assignments = assignments.filter((a, i) => {
      if (isCorner(a.pt)) return true;
      const prev = assignments[(i - 1 + assignments.length) % assignments.length];
      const next = assignments[(i + 1) % assignments.length];
      if (!a.stone || !prev.stone || !next.stone) return true;
      const sameAsPrev = prev.stone === a.stone;
      const sameAsNext = next.stone === a.stone;
      return !(sameAsPrev && sameAsNext);
    });
    assignments.forEach((a, i) => { a.pt.i = i; });

    const virtualLines = assignments.filter(a => a.stone).map(a => ({
      stoneA: { x: a.pt.x, y: a.pt.y, energy: edgeStrength, isEdge: true },
      stoneB: a.stone,
      isVirtual: true
    }));
    return { points: assignments, virtualLines };
  }

  function findEdgeTriangles() {
    const { points } = getEdgePointsAndAssignments();
    const tri = [];
    const n = points.length;
    for (let j = 0; j < n; j++) {
      const a1 = points[j], a2 = points[(j + 1) % n];
      if (!a1.stone || !a2.stone) continue;
      const e1 = a1.pt, e2 = a2.pt;
      const stone = a1.stone === a2.stone ? a1.stone : (
        dist({ x: (e1.x + e2.x) / 2, y: (e1.y + e2.y) / 2 }, a1.stone) < dist({ x: (e1.x + e2.x) / 2, y: (e1.y + e2.y) / 2 }, a2.stone) ? a1.stone : a2.stone
      );
      const area = triangleArea(e1, e2, stone);
      if (area > 1e-6) {
        const exp = config.triangleAreaExponent ?? 0.333;
        tri.push({ vertices: [e1, e2, stone], area, energy: Math.pow(area, exp), isEdge: true });
      }
    }
    return tri;
  }

  function simulationTick(dt) {
    state.simTime += dt;
    state.triangles = findTriangles();
    state.triangles = state.triangles.concat(findEdgeTriangles());
    state.stones.forEach(s => { s.stale = s.energy <= 0; });

    const activeTriangles = state.triangles.filter(t => t.vertices.every(v => !v.stale));
    const stoneDeltas = new Map();
    state.stones.forEach(s => { stoneDeltas.set(s, 0); });

    state.stones.forEach(s => {
      if (s.stale || s.disabled) return;
      const triFeed = activeTriangles
        .filter(t => t.vertices.includes(s))
        .reduce((sum, t) => sum + t.energy / 3, 0);
      stoneDeltas.set(s, stoneDeltas.get(s) + triFeed);
    });

    state.stones.forEach(s => {
      if (s.disabled) return;
      if (s.stale) {
        stoneDeltas.set(s, stoneDeltas.get(s) - STALE_DRAIN_RATE * dt);
      } else {
        const radius = energyToRadius(s.energy);
        let drain = config.stoneDrainRate * dt * s.energy * (radius / BASE_STONE_RADIUS);
        const hasArea = activeTriangles.some(t => t.vertices.includes(s));
        if (!hasArea) drain *= (config.zero_area_death_speed_multiplier ?? 1);
        stoneDeltas.set(s, stoneDeltas.get(s) - drain);
      }
    });

    const supportLines = state.lines.filter(l => !l.isConflict && !l.stoneA.disabled && !l.stoneB.disabled);
    supportLines.forEach(line => {
      const a = line.stoneA, b = line.stoneB;
      if (a.stale && b.stale) return;
      const nA = Math.max(1, getSupportLineCount(a));
      const nB = Math.max(1, getSupportLineCount(b));
      const len = dist(a, b);
      if (len < 1e-6) return;
      const rate = (config.energy_transfer_speed ?? config.supportFlowRate ?? 30) * dt / (len * len);
      const outflowA = a.stale ? 0 : (a.energy / nA) * rate;
      const outflowB = b.stale ? 0 : (b.energy / nB) * rate;
      if (!a.stale) stoneDeltas.set(a, stoneDeltas.get(a) - (a.energy / nA) * rate + outflowB);
      if (!b.stale) stoneDeltas.set(b, stoneDeltas.get(b) - (b.energy / nB) * rate + outflowA);
    });

    const conflictLines = state.lines.filter(l => l.isConflict && !l.stoneA.disabled && !l.stoneB.disabled);
    conflictLines.forEach(line => {
      const a = line.stoneA, b = line.stoneB;
      const len = dist(a, b);
      if (len < 1e-6) return;
      const drain = config.conflictDrainRate * dt / (len * len);
      stoneDeltas.set(a, stoneDeltas.get(a) - drain);
      stoneDeltas.set(b, stoneDeltas.get(b) - drain);
    });

    const { virtualLines } = getEdgePointsAndAssignments();
    const transferSpeed = config.energy_transfer_speed ?? config.supportFlowRate ?? 30;
    virtualLines.forEach(vl => {
      const edgePt = vl.stoneA;
      const s = vl.stoneB;
      const len = dist(edgePt, s);
      if (len < 1e-6) return;
      const rate = transferSpeed * dt / (len * len);
      const nS = Math.max(1, getSupportLineCount(s));
      const inflow = edgePt.energy * rate;
      const outflow = (s.energy / nS) * rate;
      stoneDeltas.set(s, stoneDeltas.get(s) + inflow - outflow);
    });

    const maxE = config.stone_max_energy ?? 5;
    stoneDeltas.forEach((delta, s) => {
      s.energy = s.energy + delta;
      if (!s.placedThisTurn && !s.disabled) s.energy = Math.min(maxE, s.energy);
    });

    const hasBlackTriangles = state.triangles.some(t => t.vertices[0].color === 'black' && t.vertices.every(v => !v.stale));
    const hasWhiteTriangles = state.triangles.some(t => t.vertices[0].color === 'white' && t.vertices.every(v => !v.stale));
    const neitherHasTriangles = !hasBlackTriangles && !hasWhiteTriangles;

    const flipCooldownSec = config.flipCooldownMs / 1000;
    const toRemove = [];
    const zeroBehavior = config.zero_energy_behavior ?? config.deathMode ?? 'flip';
    if (!neitherHasTriangles) {
      state.stones.forEach(s => {
        if (s.disabled) return;
        if (s.energy <= config.staleFlipThreshold) {
          const lastFlip = s.lastFlipTime ?? 0;
          if (state.simTime - lastFlip >= flipCooldownSec) {
            if (zeroBehavior === 'remove') {
              toRemove.push(s);
            } else if (zeroBehavior === 'dormant') {
              s.disabled = true;
              s.energy = 0;
              s.stale = true;
            } else {
              s.color = s.color === 'black' ? 'white' : 'black';
              s.energy = BASE_STONE_ENERGY;
              s.stale = false;
              s.lastFlipTime = state.simTime;
              state.lines.filter(l => l.stoneA === s || l.stoneB === s).forEach(l => {
                l.isConflict = l.stoneA.color !== l.stoneB.color;
              });
            }
          }
        }
      });
    }
    if (toRemove.length > 0) {
      const removedSet = new Set(toRemove);
      toRemove.forEach(s => {
        state.lines = state.lines.filter(l => l.stoneA !== s && l.stoneB !== s);
        state.stones = state.stones.filter(x => x !== s);
      });
      state.retestQueue = state.retestQueue.filter(([a, b]) => !removedSet.has(a) && !removedSet.has(b));
    }

    state.lines.forEach(l => { l.power = computeLinePower(l); });
    resolveIntersections();
  }

  function tryAddLine(stoneA, stoneB) {
    if (hasLine(stoneA, stoneB)) return false;
    if (stoneA === stoneB) return false;
    const isConflict = stoneA.color !== stoneB.color;
    const tempLine = { stoneA, stoneB, power: 0, isConflict };
    const power = computeLinePower(tempLine, false);
    for (const line of state.lines) {
      const otherA = line.stoneA, otherB = line.stoneB;
      if (otherA === stoneA || otherA === stoneB || otherB === stoneA || otherB === stoneB) continue;
      if (!segmentsProperlyCross(stoneA, stoneB, otherA, otherB)) continue;
      const otherPower = computeLinePower(line);
      if (power <= otherPower) return false;
      state.lines = state.lines.filter(l => l !== line);
      state.retestQueue.push([otherA, otherB]);
    }
    state.lines.push({ stoneA, stoneB, power, isConflict });
    return true;
  }

  function stochasticTick() {
    if (state.stones.length < 2) return;
    const pairs = [];
    for (let i = 0; i < state.stones.length; i++) {
      for (let j = i + 1; j < state.stones.length; j++) {
        if (!hasLine(state.stones[i], state.stones[j])) {
          pairs.push([state.stones[i], state.stones[j]]);
        }
      }
    }
    let tries = 0;
    while (state.retestQueue.length > 0 && tries < STOCHASTIC_PAIRS_PER_TICK) {
      const [a, b] = state.retestQueue.shift();
      tryAddLine(a, b);
      tries++;
    }
    while (pairs.length > 0 && tries < STOCHASTIC_PAIRS_PER_TICK) {
      const idx = Math.floor(random() * pairs.length);
      const [a, b] = pairs.splice(idx, 1)[0];
      tryAddLine(a, b);
      tries++;
    }
  }

  function populateInitialLines() {
    for (let i = 0; i < state.stones.length; i++) {
      for (let j = i + 1; j < state.stones.length; j++) {
        if (dist(state.stones[i], state.stones[j]) > MAX_LINE_LENGTH) continue;
        tryAddLine(state.stones[i], state.stones[j]);
      }
    }
  }

  function placeStone(x, y, color) {
    const mult = config.placement_energy_multiplier ?? 3;
    const stone = { x, y, color, energy: BASE_STONE_ENERGY * mult, placedThisTurn: true };
    state.stones.push(stone);
    populateInitialLines();
  }

  function runSimulationTicks(n) {
    const dt = config.simDt;
    for (let i = 0; i < n; i++) {
      simulationTick(dt);
      stochasticTick();
    }
    state.stones.forEach(s => { s.placedThisTurn = false; });
  }

  function buildGridFromStones() {
    const grid = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cx = c * GRID_SPACING, cy = r * GRID_SPACING;
        const pt = { x: cx, y: cy };
        let nearest = null, nearestD = GRID_SPACING / 2;
        for (const s of state.stones) {
          if (s.stale) continue;
          const d = dist(pt, s);
          if (d < nearestD) {
            nearestD = d;
            nearest = s;
          }
        }
        grid.push(nearest ? nearest.color : 'empty');
      }
    }
    return grid;
  }

  function computeAreaScore() {
    const grid = buildGridFromStones();
    const idx = (c, r) => r * GRID_SIZE + c;
    const visited = new Set();
    let blackTerritory = 0, whiteTerritory = 0, neutral = 0;
    const adj = [[0, 1], [1, 0], [0, -1], [-1, 0]];

    function floodFill(sc, sr) {
      const stack = [[sc, sr]];
      const region = [];
      const touchesBlack = new Set();
      const touchesWhite = new Set();
      while (stack.length > 0) {
        const [c, r] = stack.pop();
        const i = idx(c, r);
        if (visited.has(i)) continue;
        const cell = grid[i];
        if (cell !== 'empty') {
          if (cell === 'black') touchesBlack.add(i);
          if (cell === 'white') touchesWhite.add(i);
          continue;
        }
        visited.add(i);
        region.push([c, r]);
        for (const [dc, dr] of adj) {
          const nc = c + dc, nr = r + dr;
          if (nc >= 0 && nc < GRID_SIZE && nr >= 0 && nr < GRID_SIZE) {
            const ni = idx(nc, nr);
            const ncell = grid[ni];
            if (ncell === 'empty' && !visited.has(ni)) stack.push([nc, nr]);
            else if (ncell === 'black') touchesBlack.add(ni);
            else if (ncell === 'white') touchesWhite.add(ni);
          }
        }
      }
      const b = touchesBlack.size > 0, w = touchesWhite.size > 0;
      if (b && !w) blackTerritory += region.length;
      else if (w && !b) whiteTerritory += region.length;
      else neutral += region.length;
    }

    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (grid[idx(c, r)] === 'empty' && !visited.has(idx(c, r))) {
          floodFill(c, r);
        }
      }
    }

    const blackStones = grid.filter(g => g === 'black').length;
    const whiteStones = grid.filter(g => g === 'white').length;
    return {
      blackTerritory, whiteTerritory, neutral,
      blackStones, whiteStones,
      blackScore: blackTerritory + blackStones,
      whiteScore: whiteTerritory + whiteStones
    };
  }

  function getEnergyLeader() {
    const activeTriangles = state.triangles.filter(t => t.vertices.every(v => !v.stale));
    const blackEnergy = activeTriangles.filter(t => t.vertices[0].color === 'black').reduce((s, t) => s + t.energy, 0);
    const whiteEnergy = activeTriangles.filter(t => t.vertices[0].color === 'white').reduce((s, t) => s + t.energy, 0);
    if (blackEnergy > whiteEnergy) return 'black';
    if (whiteEnergy > blackEnergy) return 'white';
    return null;
  }

  return {
    placeStone,
    runSimulationTicks,
    getBoardState: () => ({ stones: [...state.stones], lines: [...state.lines], triangles: [...state.triangles] }),
    computeAreaScore,
    getEnergyLeader,
    config: () => ({ ...config })
  };
}

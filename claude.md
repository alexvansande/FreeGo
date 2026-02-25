# FreeGo – Implementation Notes

## Architecture

Single-file HTML game: `index.html` contains all HTML, CSS, and JavaScript. No build step. Open in a browser or serve with any static server (e.g. `python -m http.server 8000`).

## Key Data Structures

- **state.stones**: Array of `{ x, y, color, energy, stale?, lastFlipTime? }`. Stones are mutable objects; lines and triangles reference them.
- **state.lines**: Array of `{ stoneA, stoneB, power, isConflict }`. Lines connect stones. `isConflict` true when colors differ.
- **state.triangles**: Computed each frame by `findTriangles()`. `{ vertices, area, energy }` where `energy = cbrt(area)`.

## Simulation Loop

1. **simulationTick(dt)**: Updates triangles, stone energy (triFeed, drains, support flow, conflict drain), flips stale stones, resolves line intersections.
2. **stochasticTick()**: Tries up to `STOCHASTIC_PAIRS_PER_TICK` line connections (retest queue first, then random unconnected pairs).
3. **render()**: Draws board, ripples, grid, triangles (cache + fade), lines (cache + fade), stones, placement preview.
4. **updateUI()**: Score bar from energy production; turn info.

## Rendering Caches

- **triangleRenderCache**: Keyed by vertex indices. Tracks fade in/out so triangles don't flicker when they appear/disappear.
- **lineRenderCache**: Same pattern for lines.
- **ripples**: Array of `{ startTime, origin, type: 'placement'|'flip' }`. Filtered each frame; removed when animation completes.

## Coordinate System

- Board: 0–600 in both axes. `screenToBoard` / `boardToScreen` handle viewport transform (pan, zoom).
- Stones can be placed anywhere; `populateInitialLines` runs after each placement to add new connections.

## Constants to Tune

- `STOCHASTIC_PAIRS_PER_TICK`: More = faster line formation.
- `PERIMETER_ANCHOR_TURNS`, `PERIMETER_ANCHOR_ENERGY`: Opening behavior.
- `STALE_FLIP_THRESHOLD`, `FLIP_COOLDOWN_MS`: Flip sensitivity.
- `SUPPORT_FLOW_RATE`, `CONFLICT_DRAIN_RATE`: Energy dynamics.
- `RIPPLE_DURATION_MS`, `HOVER_PREVIEW_DELAY_MS`: Animation timing.

## Edge Cases

- Triangles with same-color stone inside are rejected (must subdivide).
- Line intersection resolution: stronger line wins; weaker is removed and queued for retest.
- Placement cost can draw from bank and empire; empire drain is proportional across same-color stones.

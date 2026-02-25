# FreeGo

A territorial strategy game where Black and White compete to control the board through stones, lines, and triangles.

## Intent

FreeGo is a Go-inspired game that replaces fixed grid placement with free-form positioning. Players place stones anywhere on the board, and the game dynamically forms connections (lines) between stones and territories (triangles) based on geometric and energy rules. The goal is to create stable triangles that feed your stones energy while undermining your opponent's positions.

## Design Philosophy

### Territory Through Geometry

- **Triangles are territory.** Three same-color stones connected by lines form a triangle. Triangles produce energy for their vertices. The score bar shows each side's energy production (sum of cube roots of triangle areas).
- **Smaller is denser.** Triangle productivity uses the cube root of area: small, tight triangles are more efficient per unit area than sprawling ones. This rewards precise, compact play.
- **No overlapping territories.** A triangle is invalid if it contains another stone of the same color—it must be subdivided into smaller triangles. This keeps territories well-defined.

### Lines as Force

- **Lines connect stones.** Lines form stochastically between stones. When two lines cross, the stronger one survives. Line strength is inversely proportional to the square of length and divided by how many other lines each endpoint has.
- **Short lines dominate.** The inverse-square law makes short connections much stronger than long ones. Dense clusters of stones form robust networks; isolated stones are vulnerable.
- **Conflict lines drain.** Lines between opposite colors (red) drain energy from both stones. They represent contested boundaries.

### Energy and Flux

- **Stones have energy.** Stones gain energy from triangles they belong to and from support lines (same-color connections). They lose energy to base drain, conflict lines, and placement cost.
- **Stale stones can flip.** When a stone's energy drops below a threshold and one side has triangles while the other doesn't, the stone may flip color. This creates dynamic border shifts.
- **Placement costs energy.** Placing a stone draws from your bank and empire. Hold longer to place a larger stone (more energy) at higher cost.

### Fair Opening

- **Perimeter anchors.** The first four placements each add two free stones at the nearest unoccupied corners or side-midpoints. This populates the perimeter quickly, creates early triangles, and removes the advantage of placing near the edge.

### Visual Feedback

- **Opacity reflects size.** Triangle opacity = 1 - √(area)/√(boardArea). Small triangles appear more opaque; large ones more transparent.
- **Fade in/out.** Triangles and lines fade in when they appear and fade out when they disappear, avoiding flicker during disputes.
- **Ripples.** Placement triggers a cream ripple; stone flips trigger a red ripple.

## How to Play

1. **Place stones:** Click and hold on the board. Release to place. Longer hold = larger stone (more energy, higher cost).
2. **Skip turn:** Pass if you have no good move.
3. **Zoom/pan:** Scroll to zoom; drag to pan.
4. **Win:** Outproduce your opponent. The score bar shows relative energy production.

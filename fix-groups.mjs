// Test: use grid adjacency for groups instead of Delaunay
const GRID_SPACING = 600/18;
const GRID_SIZE = 19;

function findGroupsGrid(stones) {
  const active = stones.filter(s => !s.captured);
  const posMap = new Map(); // "col,row" -> stone
  for (const s of active) {
    const c = Math.round(s.x / GRID_SPACING);
    const r = Math.round(s.y / GRID_SPACING);
    posMap.set(`${c},${r}`, s);
  }
  
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

// Test: 3 connected black stones
const stones = [
  { x: 3*GRID_SPACING, y: 3*GRID_SPACING, color: 'black', captured: false },
  { x: 4*GRID_SPACING, y: 3*GRID_SPACING, color: 'black', captured: false },
  { x: 5*GRID_SPACING, y: 3*GRID_SPACING, color: 'black', captured: false },
  { x: 3*GRID_SPACING, y: 4*GRID_SPACING, color: 'white', captured: false },
];

const groups = findGroupsGrid(stones);
console.log('Groups:', groups.length);
for (const g of groups) {
  console.log(`  ${g[0].color}: ${g.length} stones`);
}

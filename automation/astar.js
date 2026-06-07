// automation/astar.js
// A* pathfinding module for roguelike dungeon crawler bot
// Replaces BFS with weighted pathfinding that considers enemy positions, traps, and explored tiles

/**
 * Priority queue for A* algorithm
 */
class PriorityQueue {
  constructor() {
    this.items = [];
  }

  enqueue(item, priority) {
    this.items.push({ item, priority });
    this.items.sort((a, b) => a.priority - b.priority);
  }

  dequeue() {
    return this.items.shift()?.item || null;
  }

  isEmpty() {
    return this.items.length === 0;
  }
}

/**
 * Manhattan distance heuristic for A*
 * @param {Object} a - Position {x, y}
 * @param {Object} b - Position {x, y}
 * @returns {number} Estimated distance
 */
function heuristic(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Get movement cost for a tile
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} state - Game state
 * @returns {number} Cost to move to this tile
 */
function getMoveCost(x, y, state) {
  const { map, enemies, traps, seen, MAP_W } = state;
  const WALL = 0;
  const LOCKED_DOOR = 4;

  // Base cost: 1 for floor tiles, walls are impassable
  const tile = map[y]?.[x];
  if (tile === undefined || tile === WALL) return Infinity;
  if (tile === LOCKED_DOOR && !state.hasKey) return Infinity;

  let cost = 1;

  // +50 for enemy-adjacent tiles (strongly avoid)
  if (enemies && enemies.length > 0) {
    const isEnemyAdjacent = enemies.some(e =>
      !e.dying && !e.isPet && Math.abs(e.x - x) + Math.abs(e.y - y) === 1
    );
    if (isEnemyAdjacent) cost += 50;
  }

  // +10 for unseen tiles (strongly prefer explored areas)
  if (!seen.has(y * MAP_W + x)) {
    cost += 10;
  }

  // +100 for trap tiles (heavily penalize but allow passage if desperate)
  if (traps && traps.length > 0) {
    const hasTrap = traps.some(t => t.x === x && t.y === y && !t.triggered);
    if (hasTrap) cost += 100;
  }

  return cost;
}

/**
 * Reconstruct path from cameFrom map
 * @param {Map} cameFrom - Map of node -> parent node
 * @param {Object} current - End node
 * @returns {string[]} Array of direction keys
 */
function reconstructPath(cameFrom, current) {
  const path = [];
  let node = `${current.x},${current.y}`;
  
  while (cameFrom.has(node)) {
    const parent = cameFrom.get(node);
    const [px, py] = parent.split(',').map(Number);
    const dx = current.x - px;
    const dy = current.y - py;
    
    if (dx === 0 && dy === -1) path.unshift('ArrowUp');
    else if (dx === 0 && dy === 1) path.unshift('ArrowDown');
    else if (dx === -1 && dy === 0) path.unshift('ArrowLeft');
    else if (dx === 1 && dy === 0) path.unshift('ArrowRight');
    
    current = { x: px, y: py };
    node = parent;
  }
  
  return path;
}

/**
 * A* pathfinding from start to target position
 * @param {Object} start - {x, y}
 * @param {Object} target - {x, y}
 * @param {Object} state - {map, enemies, traps, seen, MAP_W, MAP_H, hasKey}
 * @returns {string[]|null} - Array of direction keys or null
 */
function aStarPath(start, target, state) {
  const { MAP_W, MAP_H } = state;

  // Validate inputs
  if (!start || !target || !state.map) return null;
  if (start.x < 0 || start.x >= MAP_W || start.y < 0 || start.y >= MAP_H) return null;
  if (target.x < 0 || target.x >= MAP_W || target.y < 0 || target.y >= MAP_H) return null;

  const openSet = new PriorityQueue();
  const closedSet = new Set();
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  const startKey = `${start.x},${start.y}`;
  const targetKey = `${target.x},${target.y}`;

  gScore.set(startKey, 0);
  fScore.set(startKey, heuristic(start, target));
  openSet.enqueue(start, fScore.get(startKey));

  while (!openSet.isEmpty()) {
    const current = openSet.dequeue();
    const currentKey = `${current.x},${current.y}`;

    // Reached target
    if (currentKey === targetKey) {
      return reconstructPath(cameFrom, current);
    }

    closedSet.add(currentKey);

    // Check all 4 directions
    const dirs = [
      { dx: 0, dy: -1 }, // Up
      { dx: 0, dy: 1 },  // Down
      { dx: -1, dy: 0 }, // Left
      { dx: 1, dy: 0 },  // Right
    ];

    for (const { dx, dy } of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const neighborKey = `${nx},${ny}`;

      // Skip if out of bounds or already evaluated
      if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
      if (closedSet.has(neighborKey)) continue;

      // Calculate movement cost
      const moveCost = getMoveCost(nx, ny, state);
      if (moveCost === Infinity) continue;

      const tentativeGScore = (gScore.get(currentKey) || 0) + moveCost;

      if (tentativeGScore < (gScore.get(neighborKey) || Infinity)) {
        // This path is better
        cameFrom.set(neighborKey, currentKey);
        gScore.set(neighborKey, tentativeGScore);
        fScore.set(neighborKey, tentativeGScore + heuristic({ x: nx, y: ny }, target));
        openSet.enqueue({ x: nx, y: ny }, fScore.get(neighborKey));
      }
    }
  }

  // No path found
  return null;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { aStarPath, heuristic, getMoveCost };
} else if (typeof window !== 'undefined') {
  window.aStarPath = aStarPath;
}

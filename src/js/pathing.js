// ===================== PATHING =====================
function gridKey(x, y) {
  return `${x},${y}`;
}

function parseGridKey(key) {
  const [x, y] = key.split(',').map(Number);
  const point = new Math.constructor();
  point.x = x;
  point.y = y;
  return point;
}

function isTileWalkableForPath(map, x, y, opts = {}) {
  if (x < 0 || y < 0 || y >= map.length || x >= map[y].length) return false;
  const tile = map[y][x];
  if (tile === TILE.WALL) return false;
  if (tile === TILE.LOCKED_DOOR && !opts.hasKey) return false;
  return true;
}

function findGridPath({ map, start, goal, hasKey = false, blocked = [] }) {
  if (!map || !start || !goal) return [];
  const blockedKeys = new Set(blocked.map(p => gridKey(p.x, p.y)));
  const startKey = gridKey(start.x, start.y);
  const goalKey = gridKey(goal.x, goal.y);
  const queue = [start];
  const cameFrom = new Map([[startKey, null]]);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (queue.length) {
    const cur = queue.shift();
    const curKey = gridKey(cur.x, cur.y);
    if (curKey === goalKey) break;

    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const nextKey = gridKey(nx, ny);
      if (cameFrom.has(nextKey)) continue;
      if (blockedKeys.has(nextKey) && nextKey !== goalKey) continue;
      if (!isTileWalkableForPath(map, nx, ny, { hasKey })) continue;
      cameFrom.set(nextKey, curKey);
      queue.push({ x: nx, y: ny });
    }
  }

  if (!cameFrom.has(goalKey)) return [];
  const reversed = [];
  let cursor = goalKey;
  while (cursor && cursor !== startKey) {
    reversed.push(parseGridKey(cursor));
    cursor = cameFrom.get(cursor);
  }
  return reversed.reverse();
}

function getPlayerAttackRange(player) {
  return player.class === 'ranger' && player.weapon && player.weapon.sym === '\uD83C\uDFF9' ? 3 : 1;
}

function pathToBestCandidate({ map, start, candidates, hasKey = false, blocked = [] }) {
  if (candidates.some(p => p.x === start.x && p.y === start.y)) return [];
  return candidates
    .map(goal => findGridPath({ map, start, goal, hasKey, blocked }))
    .filter(path => path.length)
    .sort((a, b) => a.length - b.length)[0] || [];
}

function pathToAdjacentTarget({ map, player, target, hasKey = false, blocked = [] }) {
  const candidates = [
    { x: target.x - 1, y: target.y },
    { x: target.x + 1, y: target.y },
    { x: target.x, y: target.y - 1 },
    { x: target.x, y: target.y + 1 },
  ].filter(p => isTileWalkableForPath(map, p.x, p.y, { hasKey }));

  return pathToBestCandidate({ map, start: player, candidates, hasKey, blocked });
}

function pathToEnemyTarget({ map, player, enemy, hasKey = false, blocked = [] }) {
  const range = getPlayerAttackRange(player);
  const candidates = [];
  for (let y = enemy.y - range; y <= enemy.y + range; y++) {
    for (let x = enemy.x - range; x <= enemy.x + range; x++) {
      const dist = Math.max(Math.abs(enemy.x - x), Math.abs(enemy.y - y));
      if (dist === 0 || dist > range) continue;
      if (!isTileWalkableForPath(map, x, y, { hasKey })) continue;
      candidates.push({ x, y });
    }
  }

  return pathToBestCandidate({ map, start: player, candidates, hasKey, blocked });
}

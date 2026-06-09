"""
Shared pathfinding utilities for DELVE RL.
BFS distance computation used by both action masking and state extraction.
"""

from collections import deque

MAP_W = 56
WALL = 0
FLOOR = 1
STAIRS = 2
SHOP = 3
LOCKED_DOOR = 4
DIRS = [(0, -1), (0, 1), (-1, 0), (1, 0)]


def shortest_stairs_distance(G, map_data, start_x, start_y):
    """BFS distance from (start_x, start_y) to nearest known/seen stairs."""
    if len(map_data) == 0 or start_y < 0 or start_y >= len(map_data):
        return None
    if start_x < 0 or start_x >= len(map_data[start_y]):
        return None
    if not _tile_passable(G, map_data[start_y][start_x]):
        return None

    targets = known_stair_targets(G, map_data)
    if not targets:
        return None

    blocked = {
        (e.get('x'), e.get('y'))
        for e in G.get('enemies', [])
        if not e.get('dying') and not e.get('isPet')
    }
    queue = deque([(start_x, start_y, 0)])
    visited = {(start_x, start_y)}
    while queue:
        x, y, dist = queue.popleft()
        if (x, y) in targets:
            return dist
        for dx, dy in DIRS:
            nx, ny = x + dx, y + dy
            if (nx, ny) in visited or (nx, ny) in blocked:
                continue
            if ny < 0 or ny >= len(map_data) or nx < 0 or nx >= len(map_data[ny]):
                continue
            if not _tile_passable(G, map_data[ny][nx]):
                continue
            visited.add((nx, ny))
            queue.append((nx, ny, dist + 1))
    return None


def known_stair_targets(G, map_data):
    """Set of (x, y) positions of stairs that have been seen or are globally known."""
    seen = _seen_set(G)
    stair_coords = G.get('_stair_coords', [])
    targets = set()
    for x, y in stair_coords:
        if (y * MAP_W + x) in seen:
            targets.add((x, y))
    return targets


def nearest_entity_direction(G, entity_list):
    """Compute normalized direction from player to nearest entity in list.
    Returns (dx, dy) normalized to [-1, 1] with scale=10.
    Returns (0, 0) if no entities found."""
    p = G.get('player', {})
    px, py = p.get('x', 0), p.get('y', 0)
    best_dist = float('inf')
    best_dx, best_dy = 0, 0
    for e in entity_list:
        dx, dy = e.get('x', 0) - px, e.get('y', 0) - py
        dist = abs(dx) + abs(dy)
        if dist < best_dist:
            best_dist = dist
            best_dx, best_dy = dx, dy
    if best_dist == 0:
        return 0.0, 0.0
    scale = 10.0
    return max(-1.0, min(1.0, best_dx / scale)), max(-1.0, min(1.0, best_dy / scale))


def nearest_locked_door_direction(G):
    """Direction to nearest locked door on the map."""
    map_data = G.get('map', [])
    doors = []
    for y, row in enumerate(map_data):
        for x, tile in enumerate(row):
            if tile == LOCKED_DOOR:
                doors.append({'x': x, 'y': y})
    return nearest_entity_direction(G, doors)


def nearest_key_on_ground_direction(G):
    """Direction to nearest uncarried key on the ground."""
    items = [i for i in G.get('items', []) if i.get('type') == 'key' and not i.get('carried')]
    return nearest_entity_direction(G, items)


def nearest_shop_direction(G):
    """Direction to nearest shop."""
    return nearest_entity_direction(G, G.get('shops', []))


def floor_exploration_ratio(G, map_data):
    """Fraction of explorable tiles that have been seen."""
    walkable_total = G.get('_walkable_total', 0)
    if walkable_total == 0:
        return 0.0
    seen_count = len(G.get('seen', []))
    # It's possible seen count exceeds walkable if player sees walls,
    # but the rough ratio is fine for reward scaling.
    return min(seen_count / walkable_total, 1.0)


def _tile_passable(G, tile):
    if tile == WALL:
        return False
    if tile == LOCKED_DOOR and not _has_key(G):
        return False
    return True


def _has_key(G):
    return any(i.get('type') == 'key' for i in G.get('items', []) if i.get('carried'))


def _seen_set(G):
    seen = G.get('seen', set())
    if isinstance(seen, set):
        return seen
    return set(seen or [])

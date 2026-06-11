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
SECRET_DOOR = 5
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
    targets = set()
    for y, row in enumerate(map_data):
        for x, tile in enumerate(row):
            if tile == STAIRS and (y * MAP_W + x) in seen:
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
    if tile == WALL or tile == SECRET_DOOR:
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


def nearest_unseen_direction(G, map_data):
    """Returns (dx, dy) direction toward the nearest UNSEEN FLOOR tile using BFS."""
    p = G.get('player', {})
    start_x, start_y = p.get('x', 0), p.get('y', 0)
    
    seen = _seen_set(G)
    
    blocked = {
        (e.get('x'), e.get('y'))
        for e in G.get('enemies', [])
        if not e.get('dying') and not e.get('isPet')
    }
    
    queue = deque([(start_x, start_y, 0, 0)])  # x, y, initial_dx, initial_dy
    visited = {(start_x, start_y)}
    
    while queue:
        x, y, i_dx, i_dy = queue.popleft()
        
        # Target: any unseen non-wall tile
        if (y * MAP_W + x) not in seen and map_data[y][x] != WALL:
            return i_dx, i_dy
            
        for dx, dy in DIRS:
            nx, ny = x + dx, y + dy
            if (nx, ny) in visited or (nx, ny) in blocked:
                continue
            if ny < 0 or ny >= len(map_data) or nx < 0 or nx >= len(map_data[ny]):
                continue
            if not _tile_passable(G, map_data[ny][nx]):
                continue
                
            visited.add((nx, ny))
            next_idx = dx if i_dx == 0 and i_dy == 0 else i_dx
            next_idy = dy if i_dx == 0 and i_dy == 0 else i_dy
            queue.append((nx, ny, next_idx, next_idy))
            
    return 0, 0


def nearest_poi_direction(G, map_data, poi_type):
    """
    Returns (dx, dy) direction toward the nearest SEEN POI.
    poi_type can be: 'shop' (tile), 'shrine' (item), 'locked_door' (tile).
    """
    p = G.get('player', {})
    start_x, start_y = p.get('x', 0), p.get('y', 0)
    
    seen = _seen_set(G)
    
    targets = set()
    if poi_type == 'shop':
        shop_items = {(i.get('x'), i.get('y')) for i in G.get('items', []) if not i.get('carried') and i.get('price', 0) > 0}
        for y, row in enumerate(map_data):
            for x, tile in enumerate(row):
                if tile == SHOP and (y * MAP_W + x) in seen:
                    if (x, y) in shop_items:
                        targets.add((x, y))
    elif poi_type == 'locked_door':
        for y, row in enumerate(map_data):
            for x, tile in enumerate(row):
                if tile == LOCKED_DOOR and (y * MAP_W + x) in seen:
                    targets.add((x, y))
    elif poi_type == 'shrine':
        for item in G.get('items', []):
            if item.get('type') == 'shrine' and not item.get('carried'):
                x, y = item.get('x'), item.get('y')
                if x is not None and y is not None and (y * MAP_W + x) in seen:
                    targets.add((x, y))
                    
    if not targets:
        return 0, 0
        
    if (start_x, start_y) in targets:
        return 0, 0

    blocked = {
        (e.get('x'), e.get('y'))
        for e in G.get('enemies', [])
        if not e.get('dying') and not e.get('isPet')
    }
    
    queue = deque([(start_x, start_y, 0, 0)])
    visited = {(start_x, start_y)}
    
    while queue:
        x, y, i_dx, i_dy = queue.popleft()
        
        if (x, y) in targets:
            return i_dx, i_dy
            
        for dx, dy in DIRS:
            nx, ny = x + dx, y + dy
            if (nx, ny) in visited or (nx, ny) in blocked:
                continue
            if ny < 0 or ny >= len(map_data) or nx < 0 or nx >= len(map_data[ny]):
                continue
            if not _tile_passable(G, map_data[ny][nx]):
                # If the target is a locked door and we don't have a key, it's not passable.
                # But if it IS the target, we should still allow reaching it!
                if not (poi_type == 'locked_door' and (nx, ny) in targets):
                    continue
                
            visited.add((nx, ny))
            next_idx = dx if i_dx == 0 and i_dy == 0 else i_dx
            next_idy = dy if i_dx == 0 and i_dy == 0 else i_dy
            queue.append((nx, ny, next_idx, next_idy))
            
    return 0, 0

"""
Action masking for DELVE RL bot.
Computes which trainable actions are valid for the current game state.
"""

import numpy as np

from config import ACTION_DIM, ACTIONS
from pathfinding import (
    shortest_stairs_distance as _bfs_stairs_distance,
    known_stair_targets as _known_stair_targets,
    MAP_W, WALL, FLOOR, STAIRS, SHOP, LOCKED_DOOR, DIRS,
)

MAP_H = 36
FLOORS = 5
STAIR_BEELINE_EXPLORED_RATIO = 0.30
STAIR_BEELINE_MAX_PATH_DISTANCE = 3


def manhattan(a, b):
    return abs(a['x'] - b['x']) + abs(a['y'] - b['y'])


def get_action_mask(G):
    """
    Compute a boolean mask of valid trainable actions.

    WAIT and raw inventory toggling are intentionally not in the action space.
    Item actions are represented as direct high-level use actions.
    """
    mask = np.zeros(ACTION_DIM, dtype=bool)
    p = G.get('player', {})
    map_data = G.get('map', [])
    enemies = G.get('enemies', [])
    items = G.get('items', [])
    shops = G.get('shops', [])
    seen = G.get('seen', set())

    px, py = p.get('x', 0), p.get('y', 0)

    if G.get('gameOver') or G.get('won'):
        return mask

    # Movement is still a real input while rooted: the game consumes root when
    # an arrow key is pressed.
    for i, (dx, dy) in enumerate(DIRS):
        nx, ny = px + dx, py + dy
        if 0 <= ny < len(map_data) and 0 <= nx < len(map_data[0]):
            tile = map_data[ny][nx]
            if tile == WALL:
                continue
            if tile == LOCKED_DOOR and not _has_key(G):
                continue
            blocking = any(e.get('x') == nx and e.get('y') == ny and not e.get('dying') for e in enemies)
            if not blocking:
                mask[i] = True

    vis_enemies = _visible_enemies(G, seen)
    adj_enemies = [e for e in vis_enemies if manhattan(e, p) == 1]
    _apply_stair_beeline_mask(G, mask, p, vis_enemies)

    for i, _enemy in enumerate(adj_enemies[:2]):
        mask[ACTIONS['ATTACK_1'] + i] = True

    if G.get('ability1Cooldown', 0) == 0 and _ability1_valid(G, p, vis_enemies, adj_enemies):
        mask[ACTIONS['ABILITY1']] = True
    if (p.get('lvl', 0) >= 5
            and G.get('ability2Cooldown', 0) == 0
            and _ability2_valid(G, p, vis_enemies, adj_enemies)):
        mask[ACTIONS['ABILITY2']] = True

    carried = [i for i in items if i.get('carried')]
    if any(i.get('type') == 'potion' for i in carried):
        mask[ACTIONS['USE_POTION']] = True
    if any(i.get('type') == 'potion_buff' for i in carried):
        mask[ACTIONS['USE_BUFF']] = True
    if any(i.get('type') == 'bomb' for i in carried):
        if any(manhattan(e, p) <= 2 for e in vis_enemies):
            mask[ACTIONS['USE_BOMB']] = True
    if any(i.get('type') == 'scroll_teleport' for i in carried):
        mask[ACTIONS['USE_TELEPORT']] = True
    if any(i.get('type') == 'scroll' and 'detection' in i.get('name', '').lower() for i in carried):
        mask[ACTIONS['USE_DETECTION']] = True

    if 0 <= py < len(map_data) and 0 <= px < len(map_data[0]):
        if map_data[py][px] == STAIRS and G.get('floor', 1) < FLOORS:
            mask[ACTIONS['DESCEND']] = True

    near_shop = any(manhattan(s, p) <= 1 for s in shops)
    if near_shop:
        mask[ACTIONS['SHOP_OPEN']] = True
    if G.get('shopOpen'):
        mask[ACTIONS['SHOP_BUY']] = True
        mask[ACTIONS['SHOP_SELL']] = True
        mask[ACTIONS['ESCAPE']] = True

    if not mask.any():
        mask[ACTIONS['ESCAPE']] = True

    return mask


def _visible_enemies(G, seen):
    visible = G.get('visible', seen)
    if isinstance(visible, list):
        visible = set(visible)
    return [
        e for e in G.get('enemies', [])
        if not e.get('dying')
        and not e.get('isPet')
        and (e.get('y', 0) * MAP_W + e.get('x', 0)) in visible
    ]


def _has_key(G):
    return any(i.get('type') == 'key' for i in G.get('items', []) if i.get('carried'))


def _apply_stair_beeline_mask(G, mask, p, vis_enemies):
    if vis_enemies or G.get('shopOpen') or not G.get('known_stairs'):
        return

    map_data = G.get('map', [])
    if not _floor_mostly_seen(G, map_data):
        return

    px, py = p.get('x', 0), p.get('y', 0)
    current_dist = _bfs_stairs_distance(G, map_data, px, py)
    if (
        current_dist is None
        or current_dist == 0
        or current_dist > STAIR_BEELINE_MAX_PATH_DISTANCE
    ):
        return

    improving_moves = []
    for action_index, (dx, dy) in enumerate(DIRS):
        if not mask[action_index]:
            continue
        next_dist = _bfs_stairs_distance(G, map_data, px + dx, py + dy)
        if next_dist is not None and next_dist < current_dist:
            improving_moves.append(action_index)

    if not improving_moves:
        return

    for action_index in range(len(DIRS)):
        mask[action_index] = action_index in improving_moves


def _floor_mostly_seen(G, map_data):
    explorable = 0
    seen_explorable = 0
    seen = _seen_set(G)
    for y, row in enumerate(map_data):
        for x, tile in enumerate(row):
            if tile not in (FLOOR, STAIRS, SHOP, LOCKED_DOOR):
                continue
            explorable += 1
            if (y * MAP_W + x) in seen:
                seen_explorable += 1
    if explorable == 0:
        return False
    return (seen_explorable / explorable) >= STAIR_BEELINE_EXPLORED_RATIO


def _has_key(G):
    return any(i.get('type') == 'key' for i in G.get('items', []) if i.get('carried'))


def _seen_set(G):
    seen = G.get('seen', set())
    if isinstance(seen, set):
        return seen
    return set(seen or [])


def _ability1_valid(G, p, vis_enemies, adj_enemies):
    cls = p.get('class', '')
    if cls == 'rogue':
        return p.get('freeMoves', 0) <= 0 and _has_useful_move(G, p)
    if cls == 'mage':
        return len(vis_enemies) > 0
    if cls == 'ranger':
        return any(_is_line_clear(G, p, e) for e in vis_enemies)
    if cls in ('warrior', 'paladin', 'necromancer'):
        return any(manhattan(e, p) <= 2 for e in vis_enemies)
    if cls in ('barbarian', 'monk'):
        return len(adj_enemies) > 0
    return False


def _ability2_valid(_G, p, vis_enemies, adj_enemies):
    cls = p.get('class', '')
    hp_ratio = p.get('hp', 0) / max(p.get('maxHp', 1), 1)
    if cls in ('warrior', 'rogue', 'mage'):
        return len(vis_enemies) > 0 or hp_ratio <= 0.5
    if cls == 'paladin':
        return hp_ratio <= 0.8
    if cls == 'ranger':
        return len(vis_enemies) > 0
    if cls in ('barbarian', 'necromancer'):
        return len(vis_enemies) > 0
    if cls == 'monk':
        return len(adj_enemies) > 0
    return False


def _is_line_clear(G, p, e):
    dx = e.get('x', 0) - p.get('x', 0)
    dy = e.get('y', 0) - p.get('y', 0)
    if not (dx == 0 or dy == 0 or abs(dx) == abs(dy)):
        return False

    sx = 0 if dx == 0 else (1 if dx > 0 else -1)
    sy = 0 if dy == 0 else (1 if dy > 0 else -1)
    map_data = G.get('map', [])
    cx, cy = p.get('x', 0) + sx, p.get('y', 0) + sy

    while cx != e.get('x', 0) or cy != e.get('y', 0):
        if cy < 0 or cy >= len(map_data) or cx < 0 or cx >= len(map_data[0]):
            return False
        if map_data[cy][cx] == WALL:
            return False
        cx += sx
        cy += sy

    return True


def _has_useful_move(G, p):
    map_data = G.get('map', [])
    enemies = G.get('enemies', [])
    px, py = p.get('x', 0), p.get('y', 0)

    for dx, dy in DIRS:
        nx, ny = px + dx, py + dy
        if 0 <= ny < len(map_data) and 0 <= nx < len(map_data[0]):
            if map_data[ny][nx] == WALL:
                continue
            if any(e.get('x') == nx and e.get('y') == ny and not e.get('dying') for e in enemies):
                continue
            return True

    return False

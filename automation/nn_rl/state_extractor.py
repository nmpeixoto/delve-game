"""
State extractor for DELVE RL bot.
Extracts a 28-dimensional feature vector from game state G.

Minimal feature set focused on navigation and survival:
  - Player core (7): hp, atk, def, lvl, has_key, floor, on_stairs
  - Navigation (4): stair_dx, stair_dy, bfs_stair_dist, exploration_ratio
  - Context (6): enemy_count, nearest_enemy_dist, has_weapon, ability1/2_ready, any_buff
  - Resources (1): has_potion
  - Temporal (5): prev_action (dx, dy, combat, item), steps_since_floor_change
  - Event tracking (5): steps_since_key_pickup, steps_since_kill, steps_since_door, doors_opened, turns_norm
"""

import numpy as np

from pathfinding import (
    shortest_stairs_distance,
    floor_exploration_ratio,
    MAP_W,
)

FLOORS = 5
STATE_DIM = 28
NUM_CLASSES = 8
CLASS_NAMES = ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk']


def extract_state(G, prev_action=None):
    p = G.get('player', {})
    map_data = G.get('map', [])

    if isinstance(G.get('seen'), list):
        G['seen'] = set(G['seen'])
    if isinstance(G.get('visible'), list):
        G['visible'] = set(G['visible'])

    features = []

    # ── PLAYER CORE (7) ──────────────────────────────────────────────────────
    features.append(p.get('hp', 0) / max(p.get('maxHp', 1), 1))       # 0: hp_ratio
    features.append(p.get('atk', 0) / 30)                              # 1: atk
    features.append(p.get('def', 0) / 20)                              # 2: def
    features.append(p.get('lvl', 1) / 15)                              # 3: level
    features.append(1.0 if any(i.get('type') == 'key' and i.get('carried')
                               for i in G.get('items', [])) else 0.0)   # 4: has_key
    features.append(G.get('floor', 1) / FLOORS)                        # 5: floor
    features.append(1.0 if _is_on_stairs(G) else 0.0)                  # 6: on_stairs

    # ── NAVIGATION (4) ───────────────────────────────────────────────────────
    px, py = p.get('x', 0), p.get('y', 0)

    # Stair direction (the critical features)
    stair_dx, stair_dy = _stair_direction(G)
    features.append(stair_dx)                                           # 7: stair_dx
    features.append(stair_dy)                                           # 8: stair_dy

    # BFS distance to stairs
    bfs_dist = shortest_stairs_distance(G, map_data, px, py)
    features.append(min(bfs_dist / 30, 1.0) if bfs_dist is not None else 1.0)  # 9: bfs_dist

    # Floor exploration
    features.append(floor_exploration_ratio(G, map_data))              # 10: exploration

    # ── CONTEXT (6) ──────────────────────────────────────────────────────────
    vis_enemies = _visible_enemies(G)
    features.append(min(len(vis_enemies) / 6, 1.0))                    # 11: enemy_count
    features.append(_min_enemy_distance(G) / 10)                       # 12: enemy_dist
    features.append(1.0 if p.get('weapon') else 0.0)                   # 13: has_weapon
    features.append(1.0 if G.get('ability1Cooldown', 0) == 0 else 0.0) # 14: ability1
    features.append(1.0 if (G.get('ability2Cooldown', 0) == 0 and p.get('lvl', 0) >= 5) else 0.0)  # 15: ability2
    features.append(1.0 if _has_buff(p) else 0.0)                      # 16: any_buff

    # ── RESOURCES (1) ────────────────────────────────────────────────────────
    features.append(1.0 if any(i.get('type') == 'potion' and i.get('carried')
                               for i in G.get('items', [])) else 0.0)   # 17: has_potion

    # ── PREV ACTION (4) ──────────────────────────────────────────────────────
    if prev_action is not None:
        features.extend(_encode_prev_action(prev_action))
    else:
        features.extend([0.0, 0.0, 0.0, 0.0])                         # 18-21: prev_action

    # ── TEMPORAL / EVENT TRACKING (7) ────────────────────────────────────────
    features.append(min(G.get('_steps_since_floor_change', 0) / 500, 1.0))   # 22
    features.append(min(G.get('_steps_since_key_pickup', 0) / 200, 1.0))     # 23
    features.append(min(G.get('_steps_since_enemy_kill', 0) / 200, 1.0))     # 24
    features.append(min(G.get('_steps_since_door_unlock', 0) / 200, 1.0))    # 25
    features.append(min(G.get('_doors_opened_this_floor', 0) / 4, 1.0))      # 26
    features.append(min(G.get('turn', 0) / 2000, 1.0))                       # 27

    assert len(features) == STATE_DIM, f"Expected {STATE_DIM} features, got {len(features)}"
    return np.array(features, dtype=np.float32)


def _is_on_stairs(G):
    p = G.get('player', {})
    map_data = G.get('map', [])
    y, x = p.get('y', 0), p.get('x', 0)
    if 0 <= y < len(map_data) and 0 <= x < len(map_data[0]):
        return map_data[y][x] == 2
    return False


def _stair_direction(G):
    p = G.get('player', {})
    px, py = p.get('x', 0), p.get('y', 0)
    map_data = G.get('map', [])
    seen = G.get('seen', set())

    best_dist = float('inf')
    best_dx, best_dy = 0, 0

    for y in range(len(map_data)):
        for x in range(len(map_data[0])):
            if map_data[y][x] == 2 and (y * MAP_W + x) in seen:
                dx, dy = x - px, y - py
                dist = abs(dx) + abs(dy)
                if dist < best_dist:
                    best_dist = dist
                    best_dx, best_dy = dx, dy

    if best_dist == 0:
        return 0.0, 0.0
    scale = 3.0
    return max(-1.0, min(1.0, best_dx / scale)), max(-1.0, min(1.0, best_dy / scale))


def _visible_enemies(G):
    p = G.get('player', {})
    enemies = G.get('enemies', [])
    visible = G.get('visible', set())
    return [e for e in enemies if not e.get('dying') and not e.get('isPet') and
            (e.get('y', 0) * MAP_W + e.get('x', 0)) in visible]


def _min_enemy_distance(G):
    p = G.get('player', {})
    vis = _visible_enemies(G)
    if not vis:
        return 10.0
    return min(abs(p.get('x', 0) - e.get('x', 0)) + abs(p.get('y', 0) - e.get('y', 0)) for e in vis)


def _has_buff(p):
    return any(p.get(k, 0) > 0 for k in ['shieldWallTurns', 'vanishTurns', 'strengthTurns', 'bloodlustTurns'])


def _encode_prev_action(action):
    from config import ACTIONS
    MOVEMENT = {
        ACTIONS['MOVE_UP']: (0, -1),
        ACTIONS['MOVE_DOWN']: (0, 1),
        ACTIONS['MOVE_LEFT']: (-1, 0),
        ACTIONS['MOVE_RIGHT']: (1, 0),
    }
    COMBAT = {ACTIONS['ATTACK_1'], ACTIONS['ATTACK_2'], ACTIONS['ABILITY1'], ACTIONS['ABILITY2']}
    ITEMS = {ACTIONS['USE_POTION'], ACTIONS['USE_BUFF'], ACTIONS['USE_BOMB'],
             ACTIONS['USE_TELEPORT'], ACTIONS['USE_DETECTION']}

    if action in MOVEMENT:
        dx, dy = MOVEMENT[action]
        return [dx, dy, 0.0, 0.0]
    elif action in COMBAT:
        return [0.0, 0.0, 1.0, 0.0]
    elif action in ITEMS:
        return [0.0, 0.0, 0.0, 1.0]
    else:
        return [0.0, 0.0, 0.0, 0.0]

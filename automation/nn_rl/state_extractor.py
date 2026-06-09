"""
State extractor for DELVE RL bot.
Extracts a STATE_DIM-dimensional feature vector from game state G.

Feature breakdown (total = 28 non-shop + MAX_SHOP_SLOTS * SHOP_ITEM_FEATURES shop):
  - Player core (7): hp_ratio, atk, def, lvl, has_key, floor, on_stairs
  - Navigation (4): stair_dx, stair_dy, bfs_stair_dist, exploration_ratio
  - Context (6): enemy_count, nearest_enemy_dist, has_weapon, ability1_ready, ability2_ready, any_buff
  - Resources (1): has_potion
  - Prev action (4): dx, dy, is_combat, is_item
  - Temporal / event (6): steps_since_floor_change, steps_since_key_pickup,
                           steps_since_enemy_kill, steps_since_door_unlock,
                           doors_opened_this_floor, turns_norm
  - Shop tail (MAX_SHOP_SLOTS x SHOP_ITEM_FEATURES): current shop stock encoding
      Per slot (19 features): present, type_flags(8), price, heal, atk, def,
                               amount, rarity, stat_atk, stat_def, stat_hp, stat_other
"""

import numpy as np

from config import MAX_SHOP_SLOTS, SHOP_ITEM_FEATURES, STATE_DIM, MAP_W
from pathfinding import (
    shortest_stairs_distance,
    floor_exploration_ratio,
    _seen_set,
)

FLOORS = 5
NUM_CLASSES = 8
CLASS_NAMES = ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk']
SHOP_TYPE_ORDER = ['potion', 'potion_buff', 'bomb', 'scroll_teleport', 'scroll', 'weapon', 'armor', 'upgrade']
RARITY_SCALE = {
    'common': 0.0,
    'rare': 0.5,
    'legendary': 1.0,
}


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

    features.extend(_encode_current_shop(G))

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
    seen = _seen_set(G)

    best_dist = float('inf')
    best_dx, best_dy = 0, 0

    stair_coords = G.get('_stair_coords', [])
    for x, y in stair_coords:
        if (y * MAP_W + x) in seen:
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


def _encode_current_shop(G):
    shop = G.get('currentShop') if G.get('shopOpen') else None
    stock = list((shop or {}).get('stock', []) or [])
    features = []
    for slot in range(MAX_SHOP_SLOTS):
        item = stock[slot] if slot < len(stock) else None
        features.extend(_encode_shop_item(item))
    return features


def _encode_shop_item(item):
    if not item or item.get('sold'):
        return [0.0] * SHOP_ITEM_FEATURES

    item_type = item.get('type', '')
    type_flags = [1.0 if item_type == kind else 0.0 for kind in SHOP_TYPE_ORDER]
    rarity = RARITY_SCALE.get(str(item.get('rarity', '')).lower(), 0.0)

    # Upgrade-stat one-hots: lets the network distinguish ATK/DEF/HP upgrades.
    # 'all'/'all5' give all three stats so all three bits are set.
    stat = item.get('stat', '') or ''
    _all = stat in ('all', 'all5')
    stat_atk   = 1.0 if (_all or stat == 'atk') else 0.0
    stat_def   = 1.0 if (_all or stat == 'def') else 0.0
    stat_hp    = 1.0 if (_all or stat == 'hp')  else 0.0
    stat_other = 1.0 if (stat and not _all and stat not in ('atk', 'def', 'hp')) else 0.0

    return [
        1.0,                                                    # present
        *type_flags,                                            # type one-hot (8)
        min(max(item.get('price',  0) / 1000.0, 0.0), 1.0),
        min(max(item.get('heal',   0) /   60.0, 0.0), 1.0),
        min(max(item.get('atk',    0) /   20.0, 0.0), 1.0),
        min(max(item.get('def',    0) /   15.0, 0.0), 1.0),
        min(max(item.get('amount', 0) /   30.0, 0.0), 1.0),
        rarity,
        stat_atk,
        stat_def,
        stat_hp,
        stat_other,
    ]

def extract_local_map(G):
    p = G.get('player', {})
    px, py = p.get('x', 0), p.get('y', 0)
    map_data = G.get('map', [])
    seen = _seen_set(G)
    enemy_coords = {(e.get('x'), e.get('y')) for e in G.get('enemies', []) if not e.get('dying')}
    item_coords = {(i.get('x'), i.get('y')) for i in G.get('items', []) if not i.get('carried')}
    channels = np.zeros((6, 8, 8), dtype=np.float32)
    if len(map_data) == 0:
        return channels
    for dy in range(-4, 4):
        for dx in range(-4, 4):
            x, y = px + dx, py + dy
            if 0 <= y < len(map_data) and 0 <= x < len(map_data[0]):
                tile = map_data[y][x]
                channels[0, dy + 4, dx + 4] = 1.0 if tile in (1, 2, 3) else 0.0
                channels[1, dy + 4, dx + 4] = 1.0 if (y * MAP_W + x) in seen else 0.0
                channels[2, dy + 4, dx + 4] = 1.0 if (x, y) in enemy_coords else 0.0
                channels[3, dy + 4, dx + 4] = 1.0 if (x, y) in item_coords else 0.0
                channels[4, dy + 4, dx + 4] = 1.0 if tile == 2 else 0.0
                channels[5, dy + 4, dx + 4] = 1.0 if tile == 4 else 0.0
    return channels

def numpyize_states(states, prev_actions=None):
    return np.stack([extract_state(s, pa) for s, pa in zip(states, prev_actions or [None] * len(states))]).astype(np.float32, copy=False)

def numpyize_maps(states):
    return np.stack([extract_local_map(s) for s in states]).astype(np.float32, copy=False)

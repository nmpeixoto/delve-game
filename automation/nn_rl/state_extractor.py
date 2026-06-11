"""
State extractor for DELVE RL bot.
Extracts a STATE_DIM-dimensional feature vector from game state G.

Feature breakdown (total = 46 non-shop + MAX_SHOP_SLOTS * SHOP_ITEM_FEATURES shop):
  - Player core (7):      hp_ratio, atk, def, lvl, has_key, floor, on_stairs
  - Navigation (4):       stair_dx, stair_dy, bfs_stair_dist, exploration_ratio
  - Context (6):          enemy_count, nearest_enemy_dist, has_weapon, ability1_ready,
                          ability2_ready, any_buff
  - Resources (1):        has_potion
  - Prev action (4):      dx, dy, is_combat, is_item
  - Temporal / event (6): steps_since_floor_change, steps_since_key_pickup,
                           steps_since_enemy_kill, steps_since_door_unlock,
                           doors_opened_this_floor, turns_norm
  - Class context (8):    cluster_density, adj_enemies, enemies_in_line,
                          closest_enemy_near_wall, enemies_within_2, is_wand,
                          is_bow, is_melee
  - Secondary stats (10): vampirism, regen, swiftness, critChance, dodgeBonus,
                          freeMoves, rootedTurns, xp_ratio, gold, max_hp
  - Shop tail (MAX_SHOP_SLOTS x SHOP_ITEM_FEATURES): current shop stock encoding
      Per slot (19 features): present, type_flags(8), price, heal, atk, def,
                               amount, rarity, stat_atk, stat_def, stat_hp, stat_other
"""

import numpy as np

from config import MAX_SHOP_SLOTS, SHOP_ITEM_FEATURES, STATE_DIM, MAP_W
from pathfinding import (
    shortest_stairs_distance,
    floor_exploration_ratio,
    nearest_unseen_direction,
    nearest_poi_direction,
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
    features.append(1.0 if p.get('shieldWallTurns', 0) > 0 else 0.0)   # 16: shieldWall
    features.append(1.0 if p.get('vanishTurns', 0) > 0 else 0.0)       # 17: vanish
    features.append(1.0 if p.get('strengthTurns', 0) > 0 else 0.0)     # 18: strength
    features.append(1.0 if p.get('bloodlustTurns', 0) > 0 else 0.0)    # 19: bloodlust
    features.append(1.0 if p.get('poisonedTurns', 0) > 0 else 0.0)     # 20: poisoned

    # ── RESOURCES (3) ────────────────────────────────────────────────────────
    potions = sum(1.0 for i in G.get('items', []) if i.get('type') in ('potion', 'potion_buff') and i.get('carried'))
    features.append(min(potions / 5.0, 1.0))   # 21: potion_ratio
    
    bombs = sum(1.0 for i in G.get('items', []) if i.get('type') == 'bomb' and i.get('carried'))
    features.append(min(bombs / 3.0, 1.0))     # 22: bomb_ratio
    
    scrolls = sum(1.0 for i in G.get('items', []) if 'scroll' in str(i.get('type')) and i.get('carried'))
    features.append(min(scrolls / 3.0, 1.0))   # 23: scroll_ratio

    # ── PREV ACTION (4) ──────────────────────────────────────────────────────
    if prev_action is not None:
        features.extend(_encode_prev_action(prev_action))
    else:
        features.extend([0.0, 0.0, 0.0, 0.0])                         # 24-27: prev_action

    # ── TEMPORAL / EVENT TRACKING (6) ────────────────────────────────────────
    features.append(min(G.get('_steps_since_floor_change', 0) / 500, 1.0))   # 28
    features.append(min(G.get('_steps_since_key_pickup', 0) / 200, 1.0))     # 29
    features.append(min(G.get('_steps_since_enemy_kill', 0) / 200, 1.0))     # 30
    
    exp_dx, exp_dy = nearest_unseen_direction(G, map_data)
    features.append(float(exp_dx))                                           # 31: explore_dx
    features.append(float(exp_dy))                                           # 32: explore_dy
    
    shop_dx, shop_dy = nearest_poi_direction(G, map_data, 'shop')
    features.append(float(shop_dx))                                          # 33: shop_dx
    features.append(float(shop_dy))                                          # 34: shop_dy
    
    shrine_dx, shrine_dy = nearest_poi_direction(G, map_data, 'shrine')
    features.append(float(shrine_dx))                                        # 35: shrine_dx
    features.append(float(shrine_dy))                                        # 36: shrine_dy
    
    has_key = any(i.get('type') == 'key' and i.get('carried') for i in G.get('items', []))
    if has_key:
        ldoor_dx, ldoor_dy = nearest_poi_direction(G, map_data, 'locked_door')
    else:
        ldoor_dx, ldoor_dy = 0.0, 0.0
    features.append(float(ldoor_dx))                                         # 37: locked_door_dx
    features.append(float(ldoor_dy))                                         # 38: locked_door_dy

    # ── ENEMY CONTEXT (11 features) ───────────────────────────────────────
    
    edx, edy = _closest_enemy_direction(G)
    features.append(edx)                                                 # 39
    features.append(edy)                                                 # 40
    features.append(_closest_enemy_hp_ratio(G))                          # 41

    weapon_dict = p.get('weapon') or {}
    weapon_name = weapon_dict.get('name', '').lower()
    is_wand = 1.0 if 'wand' in weapon_name or 'staff' in weapon_name or 'rod' in weapon_name else 0.0
    is_bow = 1.0 if 'bow' in weapon_name else 0.0
    is_melee = 1.0 if p.get('weapon') and not is_wand and not is_bow else 0.0
    features.extend([is_wand, is_bow, is_melee])                         # 42-44

    # ── SECONDARY STATS (10 features) ────────────────────────────────────
    features.append(p.get('vampirism', 0) / 10.0)                        # 45
    features.append(p.get('regen', 0) / 5.0)                             # 46
    features.append(p.get('swiftness', 0) / 5.0)                         # 47
    features.append(min(p.get('critChance', 0), 1.0))                    # 48
    features.append(min(p.get('dodgeBonus', 0), 1.0))                    # 49
    features.append(1.0 if p.get('freeMoves', 0) > 0 else 0.0)           # 50
    features.append(1.0 if p.get('rootedTurns', 0) > 0 else 0.0)         # 51
    features.append(p.get('xp', 0) / max(p.get('xpNext', 1), 1))         # 52
    features.append(min(p.get('gold', 0) / 1000.0, 1.0))                 # 53
    features.append(p.get('maxHp', 1) / 200.0)                           # 54

    # ── CLASS ID (8 features) ────────────────────────────────────────────
    cls_name = str(p.get('class', '')).lower()
    features.extend([1.0 if cls_name == c else 0.0 for c in CLASS_NAMES]) # 55-62

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
    map_data = G.get('map', [])

    best_dist = float('inf')
    best_dx, best_dy = 0, 0

    for y, row in enumerate(map_data):
        for x, tile in enumerate(row):
            if tile == 2 and (y * MAP_W + x) in seen:
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
    cached = G.get('_visible_enemies')
    if cached is not None:
        return cached
    enemies = G.get('enemies', [])
    visible = G.get('visible', set())
    result = [e for e in enemies if not e.get('dying') and not e.get('isPet') and
              (e.get('y', 0) * MAP_W + e.get('x', 0)) in visible]
    G['_visible_enemies'] = result
    return result


def _closest_enemy_direction(G):
    p = G.get('player', {})
    px, py = p.get('x', 0), p.get('y', 0)
    vis = _visible_enemies(G)
    if not vis:
        return 0.0, 0.0
    
    closest = min(vis, key=lambda e: abs(p.get('x',0)-e.get('x',0)) + abs(p.get('y',0)-e.get('y',0)))
    dx, dy = closest.get('x', 0) - px, closest.get('y', 0) - py
    scale = 3.0
    return max(-1.0, min(1.0, dx / scale)), max(-1.0, min(1.0, dy / scale))


def _closest_enemy_hp_ratio(G):
    p = G.get('player', {})
    px, py = p.get('x', 0), p.get('y', 0)
    vis = _visible_enemies(G)
    if not vis:
        return 1.0  # Safe default if no enemies
    
    closest = min(vis, key=lambda e: max(abs(p.get('x',0)-e.get('x',0)), abs(p.get('y',0)-e.get('y',0))))
    hp = closest.get('hp', 0)
    maxHp = closest.get('maxHp', 1)
    if maxHp <= 0: maxHp = 1
    return min(max(hp / maxHp, 0.0), 1.0)


def _min_enemy_distance(G):
    p = G.get('player', {})
    px, py = p.get('x', 0), p.get('y', 0)
    vis = _visible_enemies(G)
    if not vis:
        return 10.0
    return min(max(abs(p.get('x', 0) - e.get('x', 0)), abs(p.get('y', 0) - e.get('y', 0))) for e in vis)


def _has_buff(p):
    return any(p.get(k, 0) > 0 for k in ['shieldWallTurns', 'vanishTurns', 'strengthTurns', 'bloodlustTurns'])


def _max_enemy_cluster_density(G):
    vis = _visible_enemies(G)
    if not vis:
        return 0.0
    coords = {(e.get('x', 0), e.get('y', 0)) for e in vis}
    max_adj = 0
    for e in vis:
        ex, ey = e.get('x', 0), e.get('y', 0)
        adj_count = sum(1 for dx, dy in [(-1,0),(1,0),(0,-1),(0,1)] if (ex+dx, ey+dy) in coords)
        if adj_count > max_adj:
            max_adj = adj_count
    return max_adj


def _enemies_adjacent_to_player(G):
    p = G.get('player', {})
    px, py = p.get('x', 0), p.get('y', 0)
    vis = _visible_enemies(G)
    coords = {(e.get('x', 0), e.get('y', 0)) for e in vis}
    return sum(1 for dx in [-1,0,1] for dy in [-1,0,1] if (dx != 0 or dy != 0) and (px+dx, py+dy) in coords)


def _max_enemies_in_line(G):
    p = G.get('player', {})
    px, py = p.get('x', 0), p.get('y', 0)
    vis = _visible_enemies(G)
    if not vis:
        return 0.0
    max_line = 0
    map_data = G.get('map', [])
    for dx, dy in [(-1,0),(1,0),(0,-1),(0,1)]:
        count = 0
        cx, cy = px + dx, py + dy
        while 0 <= cy < len(map_data) and 0 <= cx < len(map_data[0]):
            if map_data[cy][cx] == 0:  # wall
                break
            if any(e.get('x') == cx and e.get('y') == cy for e in vis):
                count += 1
            cx += dx
            cy += dy
        if count > max_line:
            max_line = count
    return max_line


def _is_closest_enemy_near_wall(G):
    p = G.get('player', {})
    vis = _visible_enemies(G)
    if not vis:
        return False
    closest = min(vis, key=lambda e: abs(p.get('x',0)-e.get('x',0)) + abs(p.get('y',0)-e.get('y',0)))
    ex, ey = closest.get('x',0), closest.get('y',0)
    map_data = G.get('map', [])
    for dx, dy in [(-1,0),(1,0),(0,-1),(0,1)]:
        nx, ny = ex+dx, ey+dy
        if 0 <= ny < len(map_data) and 0 <= nx < len(map_data[0]):
            if map_data[ny][nx] == 0:
                return True
    return False


def _enemies_within_dist(G, max_dist):
    p = G.get('player', {})
    px, py = p.get('x', 0), p.get('y', 0)
    vis = _visible_enemies(G)
    return sum(1 for e in vis if max(abs(e.get('x',0)-px), abs(e.get('y',0)-py)) <= max_dist)


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
    
    enemies_by_coord = {(e.get('x'), e.get('y')): e for e in G.get('enemies', []) if not e.get('dying')}
    items_by_coord = {(i.get('x'), i.get('y')): i for i in G.get('items', []) if not i.get('carried')}
    
    channels = np.zeros((9, 8, 8), dtype=np.float32)
    if len(map_data) == 0:
        return channels
        
    for dy in range(-4, 4):
        for dx in range(-4, 4):
            x, y = px + dx, py + dy
            if 0 <= y < len(map_data) and 0 <= x < len(map_data[0]):
                tile = map_data[y][x]
                channels[0, dy + 4, dx + 4] = 1.0 if tile in (1, 2, 3) else 0.0
                channels[1, dy + 4, dx + 4] = 1.0 if (y * MAP_W + x) in seen else 0.0
                channels[2, dy + 4, dx + 4] = 1.0 if tile == 2 else 0.0
                channels[3, dy + 4, dx + 4] = 1.0 if tile == 4 else 0.0
                
                coord = (x, y)
                if coord in enemies_by_coord:
                    e = enemies_by_coord[coord]
                    if e.get('isBoss'):
                        channels[6, dy + 4, dx + 4] = 1.0
                    elif e.get('isElite'):
                        channels[5, dy + 4, dx + 4] = 1.0
                    else:
                        channels[4, dy + 4, dx + 4] = 1.0
                        
                if coord in items_by_coord:
                    # Gate items on seen set: only show items the player has discovered.
                    # Without this gate the CNN would have "X-ray vision" for unseen items.
                    if (y * MAP_W + x) in seen:
                        i = items_by_coord[coord]
                        typ = i.get('type')
                        if typ in ('potion', 'potion_buff', 'bomb', 'scroll_teleport', 'scroll'):
                            channels[7, dy + 4, dx + 4] = 1.0
                        elif typ in ('weapon', 'armor', 'upgrade'):
                            channels[8, dy + 4, dx + 4] = 1.0
                        
    return channels

def numpyize_states(states, prev_actions=None):
    return np.stack([extract_state(s, pa) for s, pa in zip(states, prev_actions or [None] * len(states))]).astype(np.float32, copy=False)

def numpyize_maps(states):
    return np.stack([extract_local_map(s) for s in states]).astype(np.float32, copy=False)

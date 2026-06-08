"""
State extractor for DELVE RL bot.
Extracts a 155-dimensional feature vector from the game state G.
"""

import numpy as np

MAP_W = 56
MAP_H = 36
FLOORS = 5
NUM_CLASSES = 8
CLASS_NAMES = ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk']

def manhattan(a, b):
    """Manhattan distance between two dicts with x,y keys."""
    return abs(a['x'] - b['x']) + abs(a['y'] - b['y'])

def extract_state(G):
    """
    Extract a 155-dimensional feature vector from game state G.
    
    Args:
        G: Game state dict with keys: player, map, enemies, items, shops, 
           seen, visible, floor, turn, ability1Cooldown, ability2Cooldown, etc.
    
    Returns:
        np.ndarray of shape (155,) with float32 features
    """
    p = G.get('player', {})
    features = []
    
    # Convert seen/visible from JSON lists to sets for O(1) lookup
    if isinstance(G.get('seen'), list):
        G['seen'] = set(G['seen'])
    if isinstance(G.get('visible'), list):
        G['visible'] = set(G['visible'])
    
    # ── PLAYER CORE (15 floats: 7 scalars + 8 one-hot class) ─────────────────
    features.append(p.get('hp', 0) / max(p.get('maxHp', 1), 1))  # hp_ratio
    features.append(p.get('maxHp', 0) / 100)                      # max_hp_norm
    features.append(p.get('atk', 0) / 30)                         # atk_norm
    features.append(p.get('def', 0) / 20)                         # def_norm
    features.append(p.get('lvl', 1) / 15)                         # level_norm
    xp_next = p.get('xpNext', 10)
    xp = p.get('xp', 0)
    features.append(min((xp_next - xp) / 100, 1.0))              # xp_to_level_norm
    features.append(p.get('gold', 0) / 300)                       # gold_norm
    # One-hot class encoding (8 dims)
    class_id = CLASS_NAMES.index(p.get('class', 'warrior')) if p.get('class') in CLASS_NAMES else 0
    for i in range(NUM_CLASSES):
        features.append(1.0 if i == class_id else 0.0)
    # Total: 15 (7 scalars + 8 one-hot)
    
    # ── PLAYER BUFFS (9 floats) ──────────────────────────────────────────────
    features.append(1.0 if p.get('shieldWallTurns', 0) > 0 else 0.0)
    features.append(1.0 if p.get('vanishTurns', 0) > 0 else 0.0)
    features.append(1.0 if p.get('strengthTurns', 0) > 0 else 0.0)
    features.append(1.0 if p.get('bloodlustTurns', 0) > 0 else 0.0)
    features.append(1.0 if p.get('rootedTurns', 0) > 0 else 0.0)
    features.append(1.0 if p.get('poisonedTurns', 0) > 0 else 0.0)
    features.append(min(p.get('freeMoves', 0) / 5, 1.0))
    features.append(1.0 if G.get('ability1Cooldown', 0) == 0 else 0.0)
    features.append(1.0 if (G.get('ability2Cooldown', 0) == 0 and p.get('lvl', 0) >= 5) else 0.0)
    # Total: 9
    
    # ── PLAYER GEAR (8 floats) ───────────────────────────────────────────────
    weapon = p.get('weapon')
    armor = p.get('armor')
    features.append(1.0 if weapon else 0.0)
    features.append((weapon.get('atk', 0) if weapon else 0) / 20)
    features.append(1.0 if weapon and weapon.get('sym') == '♦' else 0.0)  # magic weapon
    features.append(1.0 if weapon and weapon.get('sym') == '🏹' else 0.0)  # ranged weapon
    features.append(1.0 if armor else 0.0)
    features.append((armor.get('def', 0) if armor else 0) / 15)
    features.append(p.get('vampirism', 0) / 3)
    features.append(p.get('regen', 0) / 3)
    # Total: 8
    
    # ── PASSIVE COMBAT STATS (6 floats) ──────────────────────────────────────
    features.append(p.get('dodgeBonus', 0) / 0.5)
    features.append(p.get('critChance', 0) / 0.3)
    features.append(p.get('swiftness', 0) / 3)
    features.append(p.get('perception', 0) / 3)
    features.append(p.get('goldBonus', 0) / 10)
    features.append(p.get('xpMult', 0) / 0.5)
    # Total: 6
    
    # ── DUNGEON CONTEXT (13 floats) ──────────────────────────────────────────
    features.append(G.get('floor', 1) / FLOORS)
    features.append(1.0 if G.get('floor', 1) >= FLOORS else 0.0)
    features.append(min(G.get('turn', 0) / 2000, 1.0))
    features.append(G.get('seen_count', 0) / (MAP_W * MAP_H))
    features.append(1.0 if _has_key(G) else 0.0)
    features.append(1.0 if _is_on_stairs(G) else 0.0)
    features.append(1.0 if _is_on_shop(G) else 0.0)
    features.append(1.0 if _is_map_cleared(G) else 0.0)
    features.append(min(_turns_on_floor(G) / 300, 1.0))
    features.append(1.0 if _has_stairs(G) else 0.0)
    features.append(min(_shop_distance(G) / 30, 1.0))
    features.append(min(_locked_door_count(G) / 4, 1.0))
    features.append(G.get('floor', 1) * _get_pressure_scale(G) / 5)
    # Total: 13 (was 8, now 13)
    
    # ── STAIR DIRECTION (2 floats) ────────────────────────────────────────────
    stair_dx, stair_dy = _stair_direction(G)
    features.append(stair_dx)   # normalized dx to nearest seen stairs (-1 to 1)
    features.append(stair_dy)   # normalized dy to nearest seen stairs (-1 to 1)
    # Total: 2
    
    # ── CARRIED ITEMS (8 floats) ─────────────────────────────────────────────
    carried = _carried_items(G)
    features.append(min(sum(1 for i in carried if i.get('type') == 'potion') / 6, 1.0))
    features.append(min(sum(1 for i in carried if i.get('type') == 'potion_buff') / 3, 1.0))
    features.append(min(sum(1 for i in carried if i.get('type') == 'bomb') / 3, 1.0))
    features.append(min(sum(1 for i in carried if i.get('type') == 'scroll_teleport') / 3, 1.0))
    features.append(min(sum(1 for i in carried if i.get('type') == 'scroll' and 'detection' in i.get('name', '')) / 2, 1.0))
    features.append(min(sum(1 for i in carried if i.get('type') == 'key') / 2, 1.0))
    features.append(min(len(carried) / 12, 1.0))
    features.append(1.0 if _has_floor_upgrade(G) else 0.0)
    # Total: 8
    
    # ── ENEMY SUMMARY (6 floats) ────────────────────────────────────────────
    vis_enemies = _visible_enemies(G)
    adj_enemies = [e for e in vis_enemies if manhattan(e, p) == 1]
    features.append(min(len(vis_enemies) / 6, 1.0))
    features.append(min(len(adj_enemies) / 4, 1.0))
    features.append(_min_enemy_distance(G) / 10)
    features.append(_max_enemy_hp_ratio(G))
    features.append(_total_enemy_threat(G) / 100)
    features.append(1.0 if _has_boss(G) else 0.0)
    # Total: 6
    
    # ── NEAREST ENEMY DETAIL (6 floats) ─────────────────────────────────────
    if vis_enemies:
        nearest = min(vis_enemies, key=lambda e: manhattan(e, p))
        features.append(min(manhattan(nearest, p) / 10, 1.0))
        features.append(nearest.get('hp', 0) / max(nearest.get('maxHp', 1), 1))
        features.append(nearest.get('atk', 0) / 30)
        features.append(nearest.get('def', 0) / 10)
        features.append(1.0 if nearest.get('boss') else 0.0)
        features.append(1.0 if nearest.get('isElite') else 0.0)
    else:
        features.extend([0.0] * 6)
    # Total: 6
    
    # ── LOCAL MAP ENCODING (48 floats) ──────────────────────────────────────
    # 12x4 local map around player (each tile = 4 features: is_floor, is_seen, has_enemy, has_item)
    local_features = _local_map_encoding(G, radius_x=6, radius_y=2)
    features.extend(local_features)
    # Total: 48
    
    # ── PAD TO 155 ───────────────────────────────────────────────────────────
    current_len = len(features)
    if current_len < 155:
        features.extend([0.0] * (155 - current_len))
    elif current_len > 155:
        features = features[:155]
    
    return np.array(features, dtype=np.float32)


# ─── HELPER FUNCTIONS ────────────────────────────────────────────────────────

def _carried_items(G):
    """Get list of carried items."""
    return [i for i in G.get('items', []) if i.get('carried')]

def _has_key(G):
    """Check if player has a key."""
    return any(i.get('type') == 'key' for i in _carried_items(G))

def _is_on_stairs(G):
    """Check if player is on stairs."""
    p = G.get('player', {})
    map_data = G.get('map', [])
    y, x = p.get('y', 0), p.get('x', 0)
    if 0 <= y < len(map_data) and 0 <= x < len(map_data[0]):
        return map_data[y][x] == 2  # STAIRS
    return False

def _is_on_shop(G):
    """Check if player is on a shop."""
    p = G.get('player', {})
    map_data = G.get('map', [])
    y, x = p.get('y', 0), p.get('x', 0)
    if 0 <= y < len(map_data) and 0 <= x < len(map_data[0]):
        return map_data[y][x] == 3  # SHOP
    return False

def _is_map_cleared(G):
    """Check if map is fully cleared (simplified version)."""
    # This is expensive to compute exactly; use a heuristic
    enemies = G.get('enemies', [])
    alive = [e for e in enemies if not e.get('dying') and not e.get('isPet')]
    return len(alive) == 0

def _turns_on_floor(G):
    """Estimate turns on current floor (simplified)."""
    # We don't track this directly; use turn/5 as approximation
    return G.get('turn', 0) // 5

def _has_stairs(G):
    """Check if stairs have been found (seen)."""
    p = G.get('player', {})
    map_data = G.get('map', [])
    seen = G.get('seen', set())
    MAP_W = 56
    for y in range(len(map_data)):
        for x in range(len(map_data[0])):
            if map_data[y][x] == 2 and (y * MAP_W + x) in seen:
                return True
    return False

def _stair_direction(G):
    """Compute normalized direction from player to nearest seen stairs.
    Returns (dx, dy) in range [-1, 1]. Returns (0, 0) if stairs not known."""
    p = G.get('player', {})
    px, py = p.get('x', 0), p.get('y', 0)
    map_data = G.get('map', [])
    seen = G.get('seen', set())
    MAP_W = 56
    
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
    # Normalize to [-1, 1] using tanh-like scaling
    scale = 10.0  # 10 tiles = full direction
    return max(-1.0, min(1.0, best_dx / scale)), max(-1.0, min(1.0, best_dy / scale))

def _shop_distance(G):
    """Distance to nearest shop."""
    p = G.get('player', {})
    shops = G.get('shops', [])
    if not shops:
        return 30.0
    return min(manhattan(p, s) for s in shops)

def _locked_door_count(G):
    """Count locked doors on the map."""
    map_data = G.get('map', [])
    count = 0
    for row in map_data:
        for tile in row:
            if tile == 4:  # LOCKED_DOOR
                count += 1
    return count

def _get_pressure_scale(G):
    """Get enemy pressure scale for current floor."""
    floor = G.get('floor', 1)
    scales = {1: 1.0, 2: 1.0, 3: 1.0, 4: 0.9, 5: 1.0}
    return scales.get(floor, 1.0)

def _has_floor_upgrade(G):
    """Check if there's an upgrade available on the floor."""
    # Simplified: check if any upgrade items exist
    items = G.get('items', [])
    return any(i.get('type') == 'upgrade' for i in items if not i.get('carried'))

def _visible_enemies(G):
    """Get list of visible enemies."""
    p = G.get('player', {})
    enemies = G.get('enemies', [])
    visible = G.get('visible', set())
    MAP_W = 56
    return [e for e in enemies if not e.get('dying') and not e.get('isPet') and 
            (e.get('y', 0) * MAP_W + e.get('x', 0)) in visible]

def _min_enemy_distance(G):
    """Minimum distance to any visible enemy."""
    p = G.get('player', {})
    vis = _visible_enemies(G)
    if not vis:
        return 10.0
    return min(manhattan(p, e) for e in vis)

def _max_enemy_hp_ratio(G):
    """Maximum HP ratio of visible enemies."""
    vis = _visible_enemies(G)
    if not vis:
        return 0.0
    return max(e.get('hp', 0) / max(e.get('maxHp', 1), 1) for e in vis)

def _total_enemy_threat(G):
    """Total threat from visible enemies (sum of ATK)."""
    vis = _visible_enemies(G)
    return sum(e.get('atk', 0) for e in vis)

def _has_boss(G):
    """Check if boss is visible."""
    return any(e.get('boss') for e in _visible_enemies(G))

def _local_map_encoding(G, radius_x=6, radius_y=2):
    """
    Encode a 12x4 local map around the player.
    Each tile has 4 features: is_floor, is_seen, has_enemy, has_item.
    Total: 12 * 4 = 48 features.
    """
    p = G.get('player', {})
    px, py = p.get('x', 0), p.get('y', 0)
    map_data = G.get('map', [])
    seen = G.get('seen', set())
    enemies = G.get('enemies', [])
    items = G.get('items', [])
    MAP_W = 56
    
    features = []
    # 3x4 grid: dy in {-1, 0, 1}, dx in {-3, -1, 1, 3} = 12 tiles, 4 features each = 48
    for dy in range(-1, 2, 1):  # -1, 0, 1
        for dx in [-3, -1, 1, 3]:  # 4 columns
            x, y = px + dx, py + dy
            if 0 <= y < len(map_data) and 0 <= x < len(map_data[0]):
                tile = map_data[y][x]
                is_floor = 1.0 if tile in (1, 2, 3) else 0.0  # FLOOR, STAIRS, SHOP
                is_seen = 1.0 if (y * MAP_W + x) in seen else 0.0
                has_enemy = 1.0 if any(e.get('x') == x and e.get('y') == y and not e.get('dying') for e in enemies) else 0.0
                has_item = 1.0 if any(i.get('x') == x and i.get('y') == y and not i.get('carried') for i in items) else 0.0
                features.extend([is_floor, is_seen, has_enemy, has_item])
            else:
                features.extend([0.0, 0.0, 0.0, 0.0])
    
    return features

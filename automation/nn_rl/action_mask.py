"""
Action masking for DELVE RL bot.
Computes which actions are valid given the current game state.
"""

import numpy as np

MAP_W = 56
MAP_H = 36
FLOORS = 5
WALL = 0
FLOOR = 1
STAIRS = 2
SHOP = 3
LOCKED_DOOR = 4
SECRET_DOOR = 5

DIRS = [(0, -1), (0, 1), (-1, 0), (1, 0)]  # Up, Down, Left, Right

def manhattan(a, b):
    return abs(a['x'] - b['x']) + abs(a['y'] - b['y'])

def get_action_mask(G):
    """
    Compute a boolean mask of valid actions for the current game state.
    
    Args:
        G: Game state dict
    
    Returns:
        np.ndarray of shape (20,) with True for valid actions
    """
    mask = np.zeros(20, dtype=bool)
    p = G.get('player', {})
    map_data = G.get('map', [])
    enemies = G.get('enemies', [])
    items = G.get('items', [])
    shops = G.get('shops', [])
    seen = G.get('seen', set())
    
    px, py = p.get('x', 0), p.get('y', 0)
    
    # Check if game is over
    if G.get('gameOver') or G.get('won'):
        return mask  # No valid actions
    
    # Check if stunned (can't do anything)
    if p.get('stunnedTurns', 0) > 0:
        mask[19] = True  # Only wait is valid
        return mask
    
    # ── MOVEMENT (0-3) ──────────────────────────────────────────────────────
    rooted = p.get('rootedTurns', 0) > 0
    if not rooted:
        for i, (dx, dy) in enumerate(DIRS):
            nx, ny = px + dx, py + dy
            if 0 <= ny < len(map_data) and 0 <= nx < len(map_data[0]):
                tile = map_data[ny][nx]
                if tile != WALL:
                    # Check for locked doors
                    if tile == LOCKED_DOOR and not _has_key(G):
                        continue
                    # Check for enemy blocking
                    blocking = any(e.get('x') == nx and e.get('y') == ny and not e.get('dying') for e in enemies)
                    if not blocking:
                        mask[i] = True
    
    # ── ATTACK (4-5) ────────────────────────────────────────────────────────
    vis_enemies = _visible_enemies(G, seen, MAP_W)
    adj_enemies = [e for e in vis_enemies if manhattan(e, p) == 1]
    for i, e in enumerate(adj_enemies[:2]):
        mask[4 + i] = True
    
    # ── ABILITIES (6-7) ─────────────────────────────────────────────────────
    if G.get('ability1Cooldown', 0) == 0:
        mask[6] = True
    if p.get('lvl', 0) >= 5 and G.get('ability2Cooldown', 0) == 0:
        mask[7] = True
    
    # ── ITEMS (8-12) ────────────────────────────────────────────────────────
    carried = [i for i in items if i.get('carried')]
    if any(i.get('type') == 'potion' for i in carried):
        mask[8] = True  # USE_POTION
    if any(i.get('type') == 'potion_buff' for i in carried):
        mask[9] = True  # USE_BUFF
    # Bomb: valid if we have one AND there are enemies within 2 tiles
    if any(i.get('type') == 'bomb' for i in carried):
        nearby = [e for e in vis_enemies if manhattan(e, p) <= 2]
        if len(nearby) > 0:
            mask[10] = True  # USE_BOMB
    if any(i.get('type') == 'scroll_teleport' for i in carried):
        mask[11] = True  # USE_TELEPORT
    if any(i.get('type') == 'scroll' and 'detection' in i.get('name', '') for i in carried):
        mask[12] = True  # USE_DETECTION
    
    # ── DESCEND (13) ────────────────────────────────────────────────────────
    if 0 <= py < len(map_data) and 0 <= px < len(map_data[0]):
        if map_data[py][px] == STAIRS and G.get('floor', 1) < FLOORS:
            mask[13] = True
    
    # ── SHOP (14-17) ────────────────────────────────────────────────────────
    near_shop = any(manhattan(s, p) <= 1 for s in shops)
    if near_shop:
        mask[14] = True  # SHOP_OPEN
    if G.get('shopOpen'):
        mask[15] = True  # SHOP_BUY
        mask[16] = True  # SHOP_SELL
        mask[17] = True  # SHOP_CLOSE
    
    # ── INVENTORY (18) ──────────────────────────────────────────────────────
    if not G.get('shopOpen') and not G.get('emergencyOpen'):
        mask[18] = True
    
    # ── WAIT (19) - always valid ────────────────────────────────────────────
    mask[19] = True
    
    return mask


def _visible_enemies(G, seen, MAP_W):
    """Get list of visible enemies."""
    p = G.get('player', {})
    enemies = G.get('enemies', [])
    return [e for e in enemies if not e.get('dying') and not e.get('isPet') and 
            (e.get('y', 0) * MAP_W + e.get('x', 0)) in seen]


def _has_key(G):
    """Check if player has a key."""
    items = G.get('items', [])
    return any(i.get('type') == 'key' for i in items if i.get('carried'))

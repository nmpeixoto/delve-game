"""
Action masking for DELVE RL bot.
Computes which trainable actions are valid for the current game state.
"""

import numpy as np

from config import ACTION_DIM, ACTIONS, MAX_SHOP_SLOTS
from tactical_actions import choose_line_clear_enemy, safest_adjacent_move
from pathfinding import (
    shortest_stairs_distance as _bfs_stairs_distance,
    known_stair_targets as _known_stair_targets,
    MAP_W,
    WALL,
    FLOOR,
    STAIRS,
    SHOP,
    LOCKED_DOOR,
    DIRS,
)

MAP_H = 36


def manhattan(a, b):
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


def chebyshev(a, b):
    return max(abs(a["x"] - b["x"]), abs(a["y"] - b["y"]))


def get_action_mask(G):
    """
    Compute a boolean mask of valid trainable actions.

    WAIT and raw inventory toggling are intentionally not in the action space.
    Item actions are represented as direct high-level use actions.
    """
    mask = np.zeros(ACTION_DIM, dtype=bool)
    p = G.get("player", {})
    map_data = G.get("map", [])
    enemies = G.get("enemies", [])
    items = G.get("items", [])
    shops = G.get("shops", [])
    seen = G.get("seen", set())

    px, py = p.get("x", 0), p.get("y", 0)

    if G.get("gameOver") or G.get("won"):
        return mask

    if G.get("shrineOpen"):
        mask[ACTIONS["USE_BUFF"]] = True
        mask[ACTIONS["ESCAPE"]] = True
        return mask

    if G.get("shopOpen"):
        current_shop = G.get("currentShop") or {}
        stock = list((current_shop.get("stock") or []))
        gold = p.get("gold", 0)
        for idx in range(min(MAX_SHOP_SLOTS, len(stock))):
            item = stock[idx]
            if not item or item.get("sold"):
                continue
            if item.get("price", 0) <= gold:
                action_key = f"SHOP_BUY_{idx}"
                if action_key in ACTIONS:
                    mask[ACTIONS[action_key]] = True
        if _has_sellable_gear(G):
            mask[ACTIONS["SHOP_SELL"]] = True
        mask[ACTIONS["ESCAPE"]] = True
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
            mask[i] = True

    vis_enemies = _visible_enemies(G, seen)
    adj_enemies = [e for e in vis_enemies if chebyshev(e, p) <= 1]

    # ATTACK_1 and ATTACK_2 are permanently disabled.
    # The agent must learn to bump-attack using the directional MOVE actions.
    # This prevents the agent from being trapped when surrounded, while preserving ACTION_DIM shape.

    if G.get("ability1Cooldown", 0) == 0 and _ability1_valid(
        G, p, vis_enemies, adj_enemies
    ):
        mask[ACTIONS["ABILITY1"]] = True
    if (
        p.get("lvl", 0) >= 5
        and G.get("ability2Cooldown", 0) == 0
        and _ability2_valid(G, p, vis_enemies, adj_enemies)
    ):
        mask[ACTIONS["ABILITY2"]] = True

    if _tactical_actions_allowed(p):
        if choose_line_clear_enemy(G) is not None:
            mask[ACTIONS["RANGED_ATTACK_WEAK"]] = True
            mask[ACTIONS["RANGED_ATTACK_NEAREST"]] = True
        
        kite_enemies = _kite_pressure_enemies(p, vis_enemies)
        if kite_enemies and safest_adjacent_move(
            G, threat_enemies=kite_enemies, require_increase=True
        ) is not None:
            mask[ACTIONS["KITE_SAFE_MOVE"]] = True

    carried = [i for i in items if i.get("carried")]
    if any(i.get("type") == "potion" for i in carried):
        if p.get("hp", 0) < p.get("maxHp", 1):
            mask[ACTIONS["USE_POTION"]] = True
    if any(i.get("type") == "potion_buff" for i in carried):
        mask[ACTIONS["USE_BUFF"]] = True
    if any(i.get("type") == "bomb" for i in carried):
        if any(chebyshev(e, p) <= 2 for e in vis_enemies):
            mask[ACTIONS["USE_BOMB"]] = True
    if any(i.get("type") == "scroll_teleport" for i in carried):
        mask[ACTIONS["USE_TELEPORT"]] = True
    if any(
        i.get("type") == "scroll" and "detection" in i.get("name", "").lower()
        for i in carried
    ):
        mask[ACTIONS["USE_DETECTION"]] = True

    if 0 <= py < len(map_data) and 0 <= px < len(map_data[0]):
        if map_data[py][px] == STAIRS:
            mask[ACTIONS["DESCEND"]] = True

    near_shop = any(chebyshev(s, p) <= 1 for s in shops)
    if near_shop:
        mask[ACTIONS["SHOP_OPEN"]] = True

    if not mask.any():
        mask[ACTIONS["ESCAPE"]] = True

    return mask


def _visible_enemies(G, seen):
    cached = G.get("_visible_enemies")
    if cached is not None:
        return cached
    visible = G.get("visible")
    if visible is None:
        visible = set()
    elif isinstance(visible, list):
        visible = set(visible)
    result = [
        e
        for e in G.get("enemies", [])
        if not e.get("dying")
        and not e.get("isPet")
        and (e.get("y", 0) * MAP_W + e.get("x", 0)) in visible
    ]
    G["_visible_enemies"] = result
    return result


def _has_key(G):
    return any(i.get("type") == "key" for i in G.get("items", []) if i.get("carried"))


def _tactical_actions_allowed(player):
    return str(player.get("class", "")).lower() in {"rogue", "mage", "ranger"}


def _kite_pressure_enemies(player, visible_enemies):
    px, py = player.get("x", 0), player.get("y", 0)
    return [
        enemy
        for enemy in visible_enemies
        if abs(enemy.get("x", 0) - px) + abs(enemy.get("y", 0) - py) <= 4
    ]


def _has_sellable_gear(G):
    p = G.get("player", {})
    equipped_weapon = p.get("weapon") or {}
    equipped_armor = p.get("armor") or {}
    for item in G.get("items", []):
        if not item.get("carried") or item.get("type") not in ("weapon", "armor"):
            continue
        if equipped_weapon and equipped_weapon.get("id") == item.get("id"):
            continue
        if equipped_armor and equipped_armor.get("id") == item.get("id"):
            continue
        req = item.get("reqClass")
        if req and p.get("class") not in req:
            return True
        if item.get("type") == "weapon":
            if not equipped_weapon or _weapon_power(item) <= _weapon_power(
                equipped_weapon
            ):
                return True
        elif item.get("type") == "armor":
            if not equipped_armor or _armor_power(item) <= _armor_power(equipped_armor):
                return True
    return False


def _weapon_power(item):
    if not item:
        return 0
    return item.get("atk", item.get("pow", item.get("amount", 0))) or 0


def _armor_power(item):
    if not item:
        return 0
    return item.get("def", item.get("armor", item.get("amount", 0))) or 0


def _seen_set(G):
    seen = G.get("seen", set())
    if isinstance(seen, set):
        return seen
    return set(seen or [])


def _ability1_valid(G, p, vis_enemies, adj_enemies):
    cls = p.get("class", "")
    if cls == "rogue":
        return p.get("freeMoves", 0) <= 0 and _has_useful_move(G, p)
    if cls == "mage":
        return len(vis_enemies) > 0
    if cls == "ranger":
        return any(_is_line_clear(G, p, e) for e in vis_enemies)
    if cls in ("warrior", "paladin", "necromancer"):
        return any(chebyshev(e, p) <= 2 for e in vis_enemies)
    if cls in ("barbarian", "monk"):
        return len(adj_enemies) > 0
    return False


def _ability2_valid(_G, p, vis_enemies, adj_enemies):
    cls = p.get("class", "")
    hp_ratio = p.get("hp", 0) / max(p.get("maxHp", 1), 1)
    if cls in ("warrior", "mage"):
        return len(vis_enemies) > 0 or hp_ratio <= 0.5
    if cls == "rogue":
        return len(vis_enemies) > 0
    if cls == "paladin":
        return hp_ratio <= 0.8
    if cls == "ranger":
        return len(vis_enemies) > 0
    if cls in ("barbarian", "necromancer"):
        return len(vis_enemies) > 0
    if cls == "monk":
        return len(adj_enemies) > 0
    return False


def _is_line_clear(G, p, e):
    dx = e.get("x", 0) - p.get("x", 0)
    dy = e.get("y", 0) - p.get("y", 0)
    if not (dx == 0 or dy == 0 or abs(dx) == abs(dy)):
        return False

    sx = 0 if dx == 0 else (1 if dx > 0 else -1)
    sy = 0 if dy == 0 else (1 if dy > 0 else -1)
    map_data = G.get("map", [])
    cx, cy = p.get("x", 0) + sx, p.get("y", 0) + sy

    while cx != e.get("x", 0) or cy != e.get("y", 0):
        if cy < 0 or cy >= len(map_data) or cx < 0 or cx >= len(map_data[0]):
            return False
        if map_data[cy][cx] == WALL:
            return False
        cx += sx
        cy += sy

    return True


def _has_useful_move(G, p):
    map_data = G.get("map", [])
    enemies = G.get("enemies", [])
    px, py = p.get("x", 0), p.get("y", 0)

    for dx, dy in DIRS:
        nx, ny = px + dx, py + dy
        if 0 <= ny < len(map_data) and 0 <= nx < len(map_data[0]):
            if map_data[ny][nx] == WALL:
                continue
            if any(
                e.get("x") == nx and e.get("y") == ny and not e.get("dying")
                for e in enemies
            ):
                continue
            return True

    return False

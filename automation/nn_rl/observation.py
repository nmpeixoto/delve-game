"""Array-oriented observation helpers for DELVE PPO training."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from action_mask import get_action_mask
from config import ACTION_DIM, STATE_DIM
from state_extractor import extract_local_map, extract_state


@dataclass
class ObservationArrays:
    states: np.ndarray
    maps: np.ndarray
    masks: np.ndarray


def allocate_observation_arrays(num_envs: int) -> ObservationArrays:
    return ObservationArrays(
        states=np.zeros((num_envs, STATE_DIM), dtype=np.float32),
        maps=np.zeros((num_envs, 21, 16, 16), dtype=np.float32),
        masks=np.zeros((num_envs, ACTION_DIM), dtype=bool),
    )


def observe_game_into(game, arrays: ObservationArrays, index: int, prev_action=None, metadata=None):
    state = state_view_from_game(game)
    if metadata:
        state.update(metadata)
    arrays.states[index] = extract_state(state, prev_action)
    arrays.maps[index] = extract_local_map(state)
    arrays.masks[index] = get_action_mask(state)
    return state


def state_view_from_game(game) -> dict:
    """Build a shallow RL state view without copying the full game snapshot."""
    return {
        "ready": True,
        "floor": game.floor,
        "hardMode": bool(game.hard_mode),
        "rCount": game.rng.r_count,
        "turn": game.turn,
        "rooms": [room.get("type") for room in game.rooms],
        "player": game.player,
        "ability1Cooldown": game.ability1_cooldown,
        "ability2Cooldown": game.ability2_cooldown,
        "enemies": _enemy_views(game.enemies),
        "items": _item_views(game.items),
        "traps": _trap_views(game.traps),
        "shops": _shop_views(game.shops),
        "currentShop": _current_shop_view(game.current_shop),
        "map": game.map,
        "seen": game.seen,
        "visible": game.visible,
        "seen_count": len(game.seen),
        "known_stairs": game._known_stairs(),
        "_door_count": game._door_count,
        "_secret_count": game._secret_count,
        "_walkable_total": game._walkable_total,
        "shopOpen": game.current_shop is not None,
        "shrineOpen": getattr(game, "current_shrine", None) is not None,
        "_stair_coords": game._stair_coords,
        "gameOver": game.game_over,
        "won": game.won,
    }


def _enemy_views(enemies):
    return [
        {
            "id": enemy["id"],
            "x": enemy["x"],
            "y": enemy["y"],
            "hp": enemy["hp"],
            "maxHp": enemy["maxHp"],
            "atk": enemy["atk"],
            "def": enemy["def"],
            "xp": enemy.get("xp", 0),
            "gold": enemy.get("gold", 0),
            "boss": bool(enemy.get("boss")),
            "isElite": bool(enemy.get("isElite")),
            "dying": bool(enemy.get("dying")),
            "isPet": bool(enemy.get("isPet")),
        }
        for enemy in enemies
    ]


def _item_views(items):
    return [
        {
            "id": item["id"],
            "name": item.get("name", ""),
            "type": item.get("type", ""),
            "carried": bool(item.get("carried")),
            "x": item.get("x"),
            "y": item.get("y"),
            "heal": item.get("heal", 0),
            "price": item.get("price", 0),
            "atk": item.get("atk", 0),
            "def": item.get("def", 0),
            "sold": bool(item.get("sold", False)),
        }
        for item in items
    ]


def _trap_views(traps):
    return [
        {
            "x": trap["x"],
            "y": trap["y"],
            "type": trap["type"],
            "revealed": bool(trap.get("revealed")),
            "triggered": bool(trap.get("triggered")),
        }
        for trap in traps
    ]


def _shop_item_view(item):
    return {
        "id": item["id"],
        "type": item.get("type", ""),
        "price": item.get("price", 0),
        "heal": item.get("heal", 0),
        "atk": item.get("atk", 0),
        "def": item.get("def", 0),
        "amount": item.get("amount", 0),
        "stat": item.get("stat", ""),
        "rarity": item.get("rarity", ""),
        "sold": bool(item.get("sold", False)),
        "name": item.get("name", ""),
    }


def _shop_views(shops):
    return [
        {
            "x": shop["x"],
            "y": shop["y"],
            "stock": [_shop_item_view(item) for item in shop.get("stock", [])],
        }
        for shop in shops
    ]


def _current_shop_view(shop):
    if not shop:
        return None
    return {
        "x": shop["x"],
        "y": shop["y"],
        "stock": [_shop_item_view(item) for item in shop.get("stock", [])],
    }

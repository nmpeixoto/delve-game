"""
Reward function for DELVE RL bot.
Computes rewards after each action to guide learning.
Designed to prevent reward hacking and encourage winning.
"""

import numpy as np

from config import (
    ACTIONS,
    REWARD_DESCEND_DEPTH_MULT,
    REWARD_DESCEND_PREP_BONUS,
    REWARD_FLOOR_PROGRESS,
    REWARD_KEY_DOOR_CHAIN,
    REWARD_STAIR_APPROACH,
    REWARD_STAIR_RETREAT,
    REWARD_TRAP_PENALTY,
    REWARD_UNPREPARED_DESCEND_PENALTY,
    REWARD_KILL_BOSS,
    REWARD_KILL_ELITE,
    REWARD_KILL_BASE,
    REWARD_KILL_XP_MULT,
    REWARD_HEAL_MULT,
    REWARD_POTION_WASTE,
    REWARD_STAIR_DISCOVERY,
    REWARD_GOLD_MULT,
    REWARD_LEVEL_UP,
    REWARD_TURN_PENALTY,
    REWARD_WIN,
    REWARD_DIE,
    DEFAULT_TIMEOUT_PENALTY,
    REWARD_KEY_PICKUP,
    REWARD_DOOR_UNLOCK,
    REWARD_SECRET_REVEAL,
    REWARD_EXPLORE_MILESTONE,
    REWARD_STAT_ATK_DEF,
    REWARD_STAT_MAX_HP,
    REWARD_DAMAGE_PENALTY_MULT,
)

from pathfinding import (
    floor_exploration_ratio as _floor_exploration_ratio,
    shortest_stairs_distance as _shortest_stairs_distance,
)

MAP_W = 56
FLOORS = 5
STAIRS = 2
ACTION_DESCEND = 13
READY_DESCEND_THRESHOLD = 0.85


def get_class_mults(cls):
    """Return reward multipliers based on class archetype."""
    if cls in ("warrior", "barbarian"):
        return {"kill": 1.5, "explore": 1.0, "dmg_penalty": 0.5}
    elif cls in ("rogue", "mage", "ranger"):
        return {"kill": 0.5, "explore": 1.5, "dmg_penalty": 1.5}
    else:
        return {"kill": 1.0, "explore": 1.0, "dmg_penalty": 1.0}


KEY_DOOR_CHAIN_WINDOW = (
    20  # Steps within which key pickup → door unlock counts as chain
)


def floor_readiness_score(G):
    """Estimate how prepared the player is to leave the current floor."""
    p = G.get("player", {})
    floor = max(int(G.get("floor", 1) or 1), 1)
    map_data = G.get("map", [])

    exploration = _floor_exploration_ratio(G, map_data)
    target_level = 1 + (floor - 1) * 2
    level_score = _clamp01(p.get("lvl", 1) / max(target_level, 1))

    atk_target = 4 + floor * 3
    def_target = 1 + floor * 2
    hp_target = 24 + floor * 12
    combat_score = (
        _clamp01(p.get("atk", 0) / max(atk_target, 1))
        + _clamp01(p.get("def", 0) / max(def_target, 1))
        + _clamp01(p.get("maxHp", 1) / max(hp_target, 1))
    ) / 3

    hp_score = _clamp01(p.get("hp", 0) / max(p.get("maxHp", 1), 1))
    resource_count = sum(
        1
        for item in G.get("items", [])
        if item.get("carried")
        and item.get("type")
        in ("potion", "potion_buff", "bomb", "scroll_teleport", "scroll")
    )
    resource_score = _clamp01(resource_count / 2)

    return _clamp01(
        exploration * 0.45
        + combat_score * 0.20
        + level_score * 0.15
        + hp_score * 0.15
        + resource_score * 0.05
    )


def manhattan(a, b):
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


def chebyshev(a, b):
    return max(abs(a["x"] - b["x"]), abs(a["y"] - b["y"]))


def compute_reward(prev_G, action, curr_G):
    """
    Compute reward after each action.

    Args:
        prev_G: Game state before action
        action: Action index (int)
        curr_G: Game state after action

    Returns:
        float: Reward value
    """
    reward = 0.0
    p = curr_G.get("player", {})
    pp = prev_G.get("player", {})
    mults = get_class_mults(p.get("class", ""))
    floor = max(int(curr_G.get("floor", 1) or 1), 1)

    # ── TERMINAL STATES ──────────────────────────────────────────────────────
    if curr_G.get("won"):
        return REWARD_WIN
    if curr_G.get("gameOver"):
        return REWARD_DIE

    # ── FLOOR PROGRESS ──────────────────────────────────────────────────────
    floor_progress = curr_G.get("floor", 1) > prev_G.get("floor", 1)
    if floor_progress:
        prev_floor = max(int(prev_G.get("floor", 1) or 1), 1)
        readiness = floor_readiness_score(prev_G)
        reward += (
            REWARD_FLOOR_PROGRESS
            + REWARD_DESCEND_DEPTH_MULT * prev_floor
            + REWARD_DESCEND_PREP_BONUS * prev_floor * readiness
        )
        if readiness < READY_DESCEND_THRESHOLD:
            gap = (READY_DESCEND_THRESHOLD - readiness) / READY_DESCEND_THRESHOLD
            reward += REWARD_UNPREPARED_DESCEND_PENALTY * prev_floor * gap
        # reset minimum distance on new floor
        curr_G["_min_stair_dist"] = 9999 * curr_G.get("floor", 1)

    prev_key_count = _carried_count(prev_G, "key")
    curr_key_count = _carried_count(curr_G, "key")
    key_delta = max(0, curr_key_count - prev_key_count)
    if key_delta > 0:
        reward += (
            REWARD_KEY_PICKUP * key_delta * floor * mults["explore"]
        )  # Scaled: explorers benefit more from keys

    unlocked_doors = curr_G.get("_doors_unlocked_this_step", 0)
    if unlocked_doors > 0:
        reward += (
            REWARD_DOOR_UNLOCK * unlocked_doors * floor * mults["explore"]
        )  # Scaled: progress reward per archetype

        # Key→door chain bonus: reward completing the key-use sequence quickly
        last_key_step = curr_G.get("_last_key_pickup_step", -999)
        curr_step = curr_G.get("_current_step", 0)
        if last_key_step >= 0 and (curr_step - last_key_step) <= KEY_DOOR_CHAIN_WINDOW:
            reward += (
                REWARD_KEY_DOOR_CHAIN * floor
            )  # Chain bonus (not scaled — pure skill reward)

    revealed_secrets = curr_G.get("_secrets_revealed_this_step", 0)
    if revealed_secrets > 0:
        reward += REWARD_SECRET_REVEAL * revealed_secrets * floor * mults["explore"]

    revealed_traps = max(0, _revealed_trap_count(curr_G) - _revealed_trap_count(prev_G))

    triggered_traps = max(
        0, _triggered_trap_count(curr_G) - _triggered_trap_count(prev_G)
    )
    if triggered_traps > 0:
        reward += (
            REWARD_TRAP_PENALTY * floor * triggered_traps
        )  # REWARD_TRAP_PENALTY is negative

    # ── COMBAT (kill rewards) ───────────────────────────────────────────────
    prev_alive = {e["id"] for e in prev_G.get("enemies", []) if not e.get("dying")}
    curr_alive = {e["id"] for e in curr_G.get("enemies", []) if not e.get("dying")}
    killed = prev_alive - curr_alive

    for eid in killed:
        prev_en = next((e for e in prev_G.get("enemies", []) if e["id"] == eid), None)
        if prev_en is None:
            continue
        xp = prev_en.get("xp", 0)
        if prev_en.get("boss"):
            reward += REWARD_KILL_BOSS * floor * mults["kill"]
        elif prev_en.get("isElite"):
            reward += REWARD_KILL_ELITE * floor * mults["kill"]
        else:
            reward += (
                (REWARD_KILL_BASE + xp * REWARD_KILL_XP_MULT) * floor * mults["kill"]
            )

    # ── HEALTH MANAGEMENT ────────────────────────────────────────────────────
    hp_delta = (p.get("hp", 0) - pp.get("hp", 0)) / max(p.get("maxHp", 1), 1)

    if hp_delta > 0 and pp.get("hp", 0) < pp.get("maxHp", 1) * 0.6:
        reward += hp_delta * REWARD_HEAL_MULT

    if hp_delta < 0:
        reward += hp_delta * REWARD_DAMAGE_PENALTY_MULT * floor * mults["dmg_penalty"]

    # ── STAT GAINS ───────────────────────────────────────────────────────────
    atk_delta = p.get("atk", 0) - pp.get("atk", 0)
    if atk_delta > 0:
        reward += atk_delta * REWARD_STAT_ATK_DEF

    def_delta = p.get("def", 0) - pp.get("def", 0)
    if def_delta > 0:
        reward += def_delta * REWARD_STAT_ATK_DEF

    maxHp_delta = p.get("maxHp", 1) - pp.get("maxHp", 1)
    if maxHp_delta > 0:
        reward += maxHp_delta * REWARD_STAT_MAX_HP

    resource_gain_reward = _consumable_resource_gain_reward(prev_G, curr_G)
    if resource_gain_reward > 0:
        reward += resource_gain_reward

    # ── EXPLORATION ──────────────────────────────────────────────────────────
    explored_delta = curr_G.get("seen_count", 0) - prev_G.get("seen_count", 0)
    if explored_delta > 0:
        reward += (
            0.1 * explored_delta * floor * mults["explore"]
        )  # Strong incentive to explore fast

    # ── FLOOR COVERAGE BONUS ───────────────────────────────────────────────────────────
    # Reward reaching exploration milestones on the CURRENT floor only.
    # floor_exploration_ratio uses the current map to count explorable tiles,
    # so it never exceeds 1.0 even on floor 2+ (unlike cumulative seen_count).
    curr_floor = curr_G.get("floor", 1)
    prev_floor = prev_G.get("floor", 1)
    if curr_floor == prev_floor:
        curr_map = curr_G.get("map", [])
        prev_map = prev_G.get("map", [])
        curr_ratio = _floor_exploration_ratio(curr_G, curr_map)
        prev_ratio = _floor_exploration_ratio(prev_G, prev_map)
        for threshold in [0.25, 0.50, 0.75]:
            if prev_ratio < threshold <= curr_ratio:
                reward += REWARD_EXPLORE_MILESTONE * floor * mults["explore"]  # Milestone bonus

    # ── RESOURCE MANAGEMENT ──────────────────────────────────────────────────
    # NOTE: USE_POTION is hard-masked when hp >= maxHp, so full-HP drinking
    # cannot occur. This penalty catches suboptimal (but legal) potion use
    # when HP is between 50–100% and a battle is not in progress.
    if action == 8:  # USE_POTION
        if (
            p.get("hp", 0) > p.get("maxHp", 1) * 0.5
            and len(_visible_enemies(curr_G)) == 0
        ):
            reward += (
                REWARD_POTION_WASTE * floor
            )  # Penalty for drinking out of combat above 50% HP

    # ── STAIR DISCOVERY ──────────────────────────────────────────────────────
    stair_discovered = not prev_G.get("known_stairs") and curr_G.get("known_stairs")
    if stair_discovered:
        reward += REWARD_STAIR_DISCOVERY * floor

    stair_distance_improved = False
    if curr_G.get("floor", 1) == prev_G.get("floor", 1):
        prev_stair_dist = _nearest_seen_stairs_distance(prev_G)
        curr_stair_dist = _nearest_seen_stairs_distance(curr_G)

        min_dist_so_far = prev_G.get("_min_stair_dist", 9999)

        if curr_stair_dist is not None:
            curr_G["_min_stair_dist"] = min(min_dist_so_far, curr_stair_dist)

            if prev_stair_dist is not None:
                stair_delta = prev_stair_dist - curr_stair_dist

                # Exploit fix: Only reward if we reached a NEW minimum distance
                if stair_delta > 0 and curr_stair_dist < min_dist_so_far:
                    reward += (
                        min(1.0 * (min_dist_so_far - curr_stair_dist), 5.0) * floor
                    )
                    stair_distance_improved = True
                # Still penalize walking away from the *current* stairs
                elif stair_delta < 0:
                    reward -= min(0.3 * abs(stair_delta), 1.5) * floor

        # DIRECT DIRECTIONAL BONUS: brute-force gradient for movement actions
        # If the action was a movement that brought us closer to stairs, big bonus.
        # This bypasses feature dilution — the network learns "move toward stairs = good".
        if (
            prev_stair_dist is not None
            and prev_stair_dist > 0
            and curr_stair_dist is not None
            and action in (0, 1, 2, 3)  # MOVE_UP, DOWN, LEFT, RIGHT
        ):
            if curr_stair_dist < prev_stair_dist:
                reward += REWARD_STAIR_APPROACH * floor * mults["explore"]
            elif curr_stair_dist > prev_stair_dist:
                reward += REWARD_STAIR_RETREAT * floor * mults["explore"]

        if (
            prev_stair_dist == 0
            and action != ACTION_DESCEND
            and prev_G.get('floor', 1) < FLOORS
        ):
            reward -= 0.5 * floor

    # ── GOLD ─────────────────────────────────────────────────────────────────
    gold_delta = p.get("gold", 0) - pp.get("gold", 0)
    if gold_delta > 0:
        reward += gold_delta * REWARD_GOLD_MULT

    xp_delta = p.get("xp", 0) - pp.get("xp", 0)
    if xp_delta > 0:
        reward += min(xp_delta * 0.25, 10.0)

    # ── LEVEL UP ─────────────────────────────────────────────────────────────
    level_up = p.get("lvl", 0) > pp.get("lvl", 0)
    if level_up:
        reward += REWARD_LEVEL_UP

    # ── STAGNATION PENALTY ─────────────────────────────────────────────────
    damage_dealt = 0
    for e in curr_G.get("enemies", []):
        prev_en = next(
            (pe for pe in prev_G.get("enemies", []) if pe["id"] == e["id"]), None
        )
        if prev_en and e["hp"] < prev_en["hp"]:
            damage_dealt += prev_en["hp"] - e["hp"]

    made_progress = (
        floor_progress
        or len(killed) > 0
        or damage_dealt > 0
        or key_delta > 0
        or unlocked_doors > 0
        or revealed_secrets > 0
        or revealed_traps > 0
        or explored_delta > 0
        or stair_discovered
        or stair_distance_improved
        or gold_delta > 0
        or xp_delta > 0
        or level_up
        or resource_gain_reward > 0
        or atk_delta > 0
        or def_delta > 0
        or maxHp_delta > 0
        or action
        in (
            6,
            7,
            8,
            9,
            10,
            11,
            12,
        )  # ABILITY1, ABILITY2, USE_POTION, USE_BUFF, USE_BOMB, USE_TELEPORT, USE_DETECTION
        or (hp_delta > 0 and pp.get("hp", 0) < pp.get("maxHp", 1))
    )
    if not made_progress and len(_visible_enemies(curr_G)) == 0:
        # Extra penalty to force exploration when completely stagnant out of combat
        reward += REWARD_TURN_PENALTY * floor * 0.5

    # ── TURN PENALTY ────────────────────────────────────────────────────────
    reward += REWARD_TURN_PENALTY * floor

    return reward


def compute_reward_with_components(prev_G, action, curr_G):
    """Return the existing reward plus coarse component attribution for logging."""
    total = compute_reward(prev_G, action, curr_G)
    components = _estimate_reward_components(prev_G, action, curr_G)
    attributed = sum(components.values())
    remainder = total - attributed
    if abs(remainder) > 1e-9:
        components["unattributed"] = remainder
    return total, components


def _add_component(components, name, value):
    if value:
        components[name] = components.get(name, 0.0) + float(value)


def _estimate_reward_components(prev_G, action, curr_G):
    components = {}
    p = curr_G.get("player", {})
    pp = prev_G.get("player", {})
    mults = get_class_mults(p.get("class", ""))
    floor = max(int(curr_G.get("floor", 1) or 1), 1)

    if curr_G.get("won"):
        _add_component(components, "terminal_win", REWARD_WIN)
        return components
    if curr_G.get("gameOver"):
        _add_component(components, "terminal_death", REWARD_DIE)
        return components

    floor_progress = curr_G.get("floor", 1) > prev_G.get("floor", 1)
    if floor_progress:
        prev_floor = max(int(prev_G.get("floor", 1) or 1), 1)
        readiness = floor_readiness_score(prev_G)
        value = (
            REWARD_FLOOR_PROGRESS
            + REWARD_DESCEND_DEPTH_MULT * prev_floor
            + REWARD_DESCEND_PREP_BONUS * prev_floor * readiness
        )
        if readiness < READY_DESCEND_THRESHOLD:
            gap = (READY_DESCEND_THRESHOLD - readiness) / READY_DESCEND_THRESHOLD
            value += REWARD_UNPREPARED_DESCEND_PENALTY * prev_floor * gap
        _add_component(components, "floor_progress", value)

    prev_key_count = _carried_count(prev_G, "key")
    curr_key_count = _carried_count(curr_G, "key")
    key_delta = max(0, curr_key_count - prev_key_count)
    if key_delta > 0:
        _add_component(
            components, "key_door_secret", REWARD_KEY_PICKUP * key_delta * floor * mults["explore"]
        )

    unlocked_doors = curr_G.get("_doors_unlocked_this_step", 0)
    if unlocked_doors > 0:
        value = REWARD_DOOR_UNLOCK * unlocked_doors * floor * mults["explore"]
        last_key_step = curr_G.get("_last_key_pickup_step", -999)
        curr_step = curr_G.get("_current_step", 0)
        if last_key_step >= 0 and (curr_step - last_key_step) <= KEY_DOOR_CHAIN_WINDOW:
            value += REWARD_KEY_DOOR_CHAIN * floor
        _add_component(components, "key_door_secret", value)

    revealed_secrets = curr_G.get("_secrets_revealed_this_step", 0)
    if revealed_secrets > 0:
        _add_component(
            components,
            "key_door_secret",
            REWARD_SECRET_REVEAL * revealed_secrets * floor * mults["explore"],
        )

    triggered_traps = max(
        0, _triggered_trap_count(curr_G) - _triggered_trap_count(prev_G)
    )
    if triggered_traps > 0:
        _add_component(
            components, "trap", REWARD_TRAP_PENALTY * floor * triggered_traps
        )

    prev_alive = {e["id"] for e in prev_G.get("enemies", []) if not e.get("dying")}
    curr_alive = {e["id"] for e in curr_G.get("enemies", []) if not e.get("dying")}
    kill_reward = 0.0
    for eid in prev_alive - curr_alive:
        prev_en = next((e for e in prev_G.get("enemies", []) if e["id"] == eid), None)
        if prev_en is None:
            continue
        xp = prev_en.get("xp", 0)
        if prev_en.get("boss"):
            kill_reward += REWARD_KILL_BOSS * floor * mults["kill"]
        elif prev_en.get("isElite"):
            kill_reward += REWARD_KILL_ELITE * floor * mults["kill"]
        else:
            kill_reward += (
                (REWARD_KILL_BASE + xp * REWARD_KILL_XP_MULT) * floor * mults["kill"]
            )
    _add_component(components, "kill", kill_reward)

    hp_delta = (p.get("hp", 0) - pp.get("hp", 0)) / max(p.get("maxHp", 1), 1)
    if hp_delta > 0 and pp.get("hp", 0) < pp.get("maxHp", 1) * 0.6:
        _add_component(components, "health", hp_delta * REWARD_HEAL_MULT)
    if hp_delta < 0:
        _add_component(components, "health", hp_delta * REWARD_DAMAGE_PENALTY_MULT * floor * mults["dmg_penalty"])

    atk_delta = p.get("atk", 0) - pp.get("atk", 0)
    def_delta = p.get("def", 0) - pp.get("def", 0)
    maxHp_delta = p.get("maxHp", 1) - pp.get("maxHp", 1)
    if atk_delta > 0:
        _add_component(components, "stats", atk_delta * REWARD_STAT_ATK_DEF)
    if def_delta > 0:
        _add_component(components, "stats", def_delta * REWARD_STAT_ATK_DEF)
    if maxHp_delta > 0:
        _add_component(components, "stats", maxHp_delta * REWARD_STAT_MAX_HP)

    resource_gain_reward = _consumable_resource_gain_reward(prev_G, curr_G)
    if resource_gain_reward > 0:
        _add_component(components, "resources", resource_gain_reward)

    explored_delta = curr_G.get("seen_count", 0) - prev_G.get("seen_count", 0)
    if explored_delta > 0:
        _add_component(
            components, "explore", 0.1 * explored_delta * floor * mults["explore"]
        )

    if curr_G.get("floor", 1) == prev_G.get("floor", 1):
        curr_ratio = _floor_exploration_ratio(curr_G, curr_G.get("map", []))
        prev_ratio = _floor_exploration_ratio(prev_G, prev_G.get("map", []))
        for threshold in [0.25, 0.50, 0.75]:
            if prev_ratio < threshold <= curr_ratio:
                _add_component(components, "explore", REWARD_EXPLORE_MILESTONE * floor * mults["explore"])

    if (
        action == 8
        and p.get("hp", 0) > p.get("maxHp", 1) * 0.5
        and len(_visible_enemies(curr_G)) == 0
    ):
        _add_component(components, "item_waste", REWARD_POTION_WASTE * floor)

    stair_discovered = not prev_G.get("known_stairs") and curr_G.get("known_stairs")
    if stair_discovered:
        _add_component(components, "stairs", REWARD_STAIR_DISCOVERY * floor)

    stair_distance_improved = False
    if curr_G.get("floor", 1) == prev_G.get("floor", 1):
        prev_stair_dist = _nearest_seen_stairs_distance(prev_G)
        curr_stair_dist = _nearest_seen_stairs_distance(curr_G)
        min_dist_so_far = prev_G.get("_min_stair_dist", 9999)
        if curr_stair_dist is not None and prev_stair_dist is not None:
            stair_delta = prev_stair_dist - curr_stair_dist
            if stair_delta > 0 and curr_stair_dist < min_dist_so_far:
                _add_component(
                    components,
                    "stairs",
                    min(1.0 * (min_dist_so_far - curr_stair_dist), 5.0) * floor,
                )
                stair_distance_improved = True
            elif stair_delta < 0:
                _add_component(
                    components, "stairs", -min(0.3 * abs(stair_delta), 1.5) * floor
                )

            if prev_stair_dist > 0 and action in (0, 1, 2, 3):
                if curr_stair_dist < prev_stair_dist:
                    _add_component(
                        components,
                        "stairs",
                        REWARD_STAIR_APPROACH * floor * mults["explore"],
                    )
                elif curr_stair_dist > prev_stair_dist:
                    _add_component(
                        components,
                        "stairs",
                        REWARD_STAIR_RETREAT * floor * mults["explore"],
                    )

        if (
            prev_stair_dist == 0
            and action != ACTION_DESCEND
            and prev_G.get("floor", 1) < FLOORS
        ):
            _add_component(components, "stairs", -0.5 * floor)

    gold_delta = p.get("gold", 0) - pp.get("gold", 0)
    if gold_delta > 0:
        _add_component(components, "gold_xp_level", gold_delta * REWARD_GOLD_MULT)
    xp_delta = p.get("xp", 0) - pp.get("xp", 0)
    if xp_delta > 0:
        _add_component(components, "gold_xp_level", min(xp_delta * 0.25, 10.0))
    level_up = p.get("lvl", 0) > pp.get("lvl", 0)
    if level_up:
        _add_component(components, "gold_xp_level", REWARD_LEVEL_UP)

    damage_dealt = 0
    for enemy in curr_G.get("enemies", []):
        prev_enemy = next(
            (prev for prev in prev_G.get("enemies", []) if prev["id"] == enemy["id"]),
            None,
        )
        if prev_enemy and enemy["hp"] < prev_enemy["hp"]:
            damage_dealt += prev_enemy["hp"] - enemy["hp"]

    revealed_traps = max(0, _revealed_trap_count(curr_G) - _revealed_trap_count(prev_G))
    made_progress = (
        floor_progress
        or len(prev_alive - curr_alive) > 0
        or damage_dealt > 0
        or key_delta > 0
        or unlocked_doors > 0
        or revealed_secrets > 0
        or revealed_traps > 0
        or explored_delta > 0
        or stair_discovered
        or stair_distance_improved
        or gold_delta > 0
        or xp_delta > 0
        or level_up
        or resource_gain_reward > 0
        or atk_delta > 0
        or def_delta > 0
        or maxHp_delta > 0
        or action in (6, 7, 8, 9, 10, 11, 12)
        or (hp_delta > 0 and pp.get("hp", 0) < pp.get("maxHp", 1))
    )
    if not made_progress and len(_visible_enemies(curr_G)) == 0:
        _add_component(components, "turn_stagnation", REWARD_TURN_PENALTY * floor * 0.5)
    _add_component(components, "turn", REWARD_TURN_PENALTY * floor)
    return components


def _visible_enemies(G):
    cached = G.get("_visible_enemies")
    if cached is not None:
        return cached
    enemies = G.get("enemies", [])
    visible = G.get("visible", G.get("seen", set()))
    if isinstance(visible, list):
        visible = set(visible)
    result = [
        e
        for e in enemies
        if not e.get("dying")
        and not e.get("isPet")
        and (e.get("y", 0) * MAP_W + e.get("x", 0)) in visible
    ]
    G["_visible_enemies"] = result
    return result


def _nearest_seen_stairs_distance(G):
    p = G.get("player", {})
    map_data = G.get("map", [])
    if len(map_data) == 0 or not p:
        return None

    return _shortest_stairs_distance(G, map_data, p.get("x", 0), p.get("y", 0))


def _seen_set(G):
    seen = G.get("seen", set())
    if isinstance(seen, set):
        return seen
    return set(seen or [])


def _clamp01(value):
    return max(0.0, min(1.0, float(value)))


def _carried_count(G, item_type):
    return sum(
        1
        for item in G.get("items", [])
        if item.get("type") == item_type and item.get("carried")
    )


def _consumable_resource_gain_reward(prev_G, curr_G):
    weights = {
        "potion": 2.5,
        "potion_buff": 3.5,
        "bomb": 4.0,
        "scroll": 4.0,
        "scroll_teleport": 5.0,
    }
    total = 0.0
    for item_type, reward in weights.items():
        gained = _carried_count(curr_G, item_type) - _carried_count(prev_G, item_type)
        if gained > 0:
            total += gained * reward
    return total


def _revealed_trap_count(G):
    return sum(
        1 for t in G.get("traps", []) if t.get("revealed") and not t.get("triggered")
    )


def _triggered_trap_count(G):
    return sum(1 for t in G.get("traps", []) if t.get("triggered"))

"""
Reward function for DELVE RL bot.
Computes rewards after each action to guide learning.
Designed to prevent reward hacking and encourage winning.
"""

import numpy as np

from config import (
    REWARD_FLOOR_PROGRESS, REWARD_KEY_DOOR_CHAIN, REWARD_TRAP_PENALTY,
    REWARD_KILL_BOSS, REWARD_KILL_ELITE, REWARD_KILL_BASE, REWARD_KILL_XP_MULT,
    REWARD_HEAL_MULT, REWARD_POTION_WASTE, REWARD_STAIR_DISCOVERY,
    REWARD_GOLD_MULT, REWARD_LEVEL_UP, REWARD_TURN_PENALTY,
    REWARD_WIN, REWARD_DIE,
)

from pathfinding import (
    floor_exploration_ratio as _floor_exploration_ratio,
    shortest_stairs_distance as _shortest_stairs_distance,
)
MAP_W = 56
FLOORS = 5
STAIRS = 2
ACTION_DESCEND = 13
KEY_DOOR_CHAIN_WINDOW = 20  # Steps within which key pickup → door unlock counts as chain


def manhattan(a, b):
    return abs(a['x'] - b['x']) + abs(a['y'] - b['y'])


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
    p = curr_G.get('player', {})
    pp = prev_G.get('player', {})

    # ── TERMINAL STATES ──────────────────────────────────────────────────────
    if curr_G.get('won'):
        return REWARD_WIN
    if curr_G.get('gameOver'):
        return REWARD_DIE

    # ── FLOOR PROGRESS ──────────────────────────────────────────────────────
    floor_progress = curr_G.get('floor', 1) > prev_G.get('floor', 1)
    if floor_progress:
        reward += REWARD_FLOOR_PROGRESS
        # reset minimum distance on new floor
        curr_G['_min_stair_dist'] = 9999 * curr_G.get('floor', 1)  # Reduced from 75 to avoid dominating

    prev_key_count = _carried_count(prev_G, 'key')
    curr_key_count = _carried_count(curr_G, 'key')
    key_delta = max(0, curr_key_count - prev_key_count)
    if key_delta > 0:
        reward += 30.0 * key_delta  # Increased from 20

    unlocked_doors = curr_G.get('_doors_unlocked_this_step', 0)
    if unlocked_doors > 0:
        reward += 50.0 * unlocked_doors  # Increased from 35

        # Key→door chain bonus: reward completing the key-use sequence quickly
        last_key_step = curr_G.get('_last_key_pickup_step', -999)
        curr_step = curr_G.get('_current_step', 0)
        if last_key_step >= 0 and (curr_step - last_key_step) <= KEY_DOOR_CHAIN_WINDOW:
            reward += REWARD_KEY_DOOR_CHAIN  # Chain bonus

    revealed_secrets = curr_G.get('_secrets_revealed_this_step', 0)
    if revealed_secrets > 0:
        reward += 25.0 * revealed_secrets

    revealed_traps = max(0, _revealed_trap_count(curr_G) - _revealed_trap_count(prev_G))
    if revealed_traps > 0:
        reward += REWARD_TRAP_PENALTY * revealed_traps  # REWARD_TRAP_PENALTY is negative

    # ── COMBAT (kill rewards) ───────────────────────────────────────────────
    prev_alive = {e['id'] for e in prev_G.get('enemies', []) if not e.get('dying')}
    curr_alive = {e['id'] for e in curr_G.get('enemies', []) if not e.get('dying')}
    killed = prev_alive - curr_alive

    for eid in killed:
        prev_en = next((e for e in prev_G.get('enemies', []) if e['id'] == eid), None)
        if prev_en is None:
            continue
        xp = prev_en.get('xp', 0)
        if prev_en.get('boss'):
            reward += REWARD_KILL_BOSS
        elif prev_en.get('isElite'):
            reward += REWARD_KILL_ELITE
        else:
            reward += REWARD_KILL_BASE + xp * REWARD_KILL_XP_MULT

    # ── HEALTH MANAGEMENT ────────────────────────────────────────────────────
    hp_delta = (p.get('hp', 0) - pp.get('hp', 0)) / max(p.get('maxHp', 1), 1)

    if hp_delta > 0 and pp.get('hp', 0) < pp.get('maxHp', 1) * 0.6:
        reward += hp_delta * REWARD_HEAL_MULT

    vis_enemies = _visible_enemies(curr_G)
    adj_count = sum(1 for e in vis_enemies if manhattan(e, p) == 1)
    if hp_delta < -0.05 and adj_count == 0:
        reward -= 3.0

    # ── EXPLORATION ──────────────────────────────────────────────────────────
    explored_delta = curr_G.get('seen_count', 0) - prev_G.get('seen_count', 0)
    if explored_delta > 0:
        reward += 0.1 * explored_delta  # Strong incentive to explore fast

    # ── FLOOR COVERAGE BONUS ───────────────────────────────────────────────────────────
    # Reward reaching exploration milestones on the CURRENT floor only.
    # floor_exploration_ratio uses the current map to count explorable tiles,
    # so it never exceeds 1.0 even on floor 2+ (unlike cumulative seen_count).
    curr_floor = curr_G.get('floor', 1)
    prev_floor = prev_G.get('floor', 1)
    if curr_floor == prev_floor:
        curr_map = curr_G.get('map', [])
        prev_map = prev_G.get('map', [])
        curr_ratio = _floor_exploration_ratio(curr_G, curr_map)
        prev_ratio = _floor_exploration_ratio(prev_G, prev_map)
        for threshold in [0.25, 0.50, 0.75]:
            if prev_ratio < threshold <= curr_ratio:
                reward += 15.0  # Milestone bonus

    # ── RESOURCE MANAGEMENT ──────────────────────────────────────────────────
    if action == 8:  # USE_POTION
        if p.get('hp', 0) > p.get('maxHp', 1) * 0.8:
            reward += REWARD_POTION_WASTE  # REWARD_POTION_WASTE is negative

    # ── STAIR DISCOVERY ──────────────────────────────────────────────────────
    stair_discovered = not prev_G.get('known_stairs') and curr_G.get('known_stairs')
    if stair_discovered:
        reward += REWARD_STAIR_DISCOVERY

    stair_distance_improved = False
    if curr_G.get('floor', 1) == prev_G.get('floor', 1):
        prev_stair_dist = _nearest_seen_stairs_distance(prev_G)
        curr_stair_dist = _nearest_seen_stairs_distance(curr_G)
        
        min_dist_so_far = prev_G.get('_min_stair_dist', 9999)
        
        if curr_stair_dist is not None:
            curr_G['_min_stair_dist'] = min(min_dist_so_far, curr_stair_dist)
            
            if prev_stair_dist is not None:
                stair_delta = prev_stair_dist - curr_stair_dist
                
                # Exploit fix: Only reward if we reached a NEW minimum distance
                if stair_delta > 0 and curr_stair_dist < min_dist_so_far:
                    reward += min(1.0 * (min_dist_so_far - curr_stair_dist), 5.0)
                    stair_distance_improved = True
                # Still penalize walking away from the *current* stairs
                elif stair_delta < 0:
                    reward -= min(0.3 * abs(stair_delta), 1.5)

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
                reward += 2.0   # Direct reward for correct direction
            elif curr_stair_dist > prev_stair_dist:
                reward -= 1.0   # Penalty for wrong direction

        if (
            prev_stair_dist == 0
            and action != ACTION_DESCEND
            and prev_G.get('floor', 1) < FLOORS
        ):
            reward -= 0.5

    # ── GOLD ─────────────────────────────────────────────────────────────────
    gold_delta = p.get('gold', 0) - pp.get('gold', 0)
    if gold_delta > 0:
        reward += gold_delta * REWARD_GOLD_MULT

    xp_delta = p.get('xp', 0) - pp.get('xp', 0)
    if xp_delta > 0:
        reward += min(xp_delta * 0.25, 10.0)

    # ── LEVEL UP ─────────────────────────────────────────────────────────────
    level_up = p.get('lvl', 0) > pp.get('lvl', 0)
    if level_up:
        reward += REWARD_LEVEL_UP

    # ── STAGNATION PENALTY ─────────────────────────────────────────────────
    made_progress = (
        floor_progress
        or len(killed) > 0
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
        or (hp_delta > 0 and pp.get('hp', 0) < pp.get('maxHp', 1))
    )
    if not made_progress:
        # Extra penalty to force exploration when completely stagnant
        reward += REWARD_TURN_PENALTY * 0.5

    # ── TURN PENALTY ────────────────────────────────────────────────────────
    reward += REWARD_TURN_PENALTY

    return reward


def _visible_enemies(G):
    p = G.get('player', {})
    enemies = G.get('enemies', [])
    visible = G.get('visible', G.get('seen', set()))
    if isinstance(visible, list):
        visible = set(visible)
    return [e for e in enemies if not e.get('dying') and not e.get('isPet') and
            (e.get('y', 0) * MAP_W + e.get('x', 0)) in visible]


def _nearest_seen_stairs_distance(G):
    p = G.get('player', {})
    map_data = G.get('map', [])
    if len(map_data) == 0 or not p:
        return None

    return _shortest_stairs_distance(G, map_data, p.get('x', 0), p.get('y', 0))


def _seen_set(G):
    seen = G.get('seen', set())
    if isinstance(seen, set):
        return seen
    return set(seen or [])


def _carried_count(G, item_type):
    return sum(1 for item in G.get('items', []) if item.get('type') == item_type and item.get('carried'))


def _revealed_trap_count(G):
    return sum(
        1
        for trap in G.get('traps', [])
        if trap.get('revealed') and not trap.get('triggered')
    )

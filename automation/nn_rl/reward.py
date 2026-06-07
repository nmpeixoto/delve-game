"""
Reward function for DELVE RL bot.
Computes rewards after each action to guide learning.
Designed to prevent reward hacking and encourage winning.
"""

import numpy as np

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
    
    # ── SURVIVAL (terminal rewards) ──────────────────────────────────────────
    if curr_G.get('won'):
        return 100.0
    if curr_G.get('gameOver'):
        return -50.0
    
    # ── FLOOR PROGRESS ──────────────────────────────────────────────────────
    if curr_G.get('floor', 1) > prev_G.get('floor', 1):
        reward += 20.0 * curr_G.get('floor', 1)
    
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
            reward += 40.0
        elif prev_en.get('isElite'):
            reward += 15.0
        else:
            reward += 5.0 + xp * 0.4
    
    # ── HEALTH MANAGEMENT ────────────────────────────────────────────────────
    hp_delta = (p.get('hp', 0) - pp.get('hp', 0)) / max(p.get('maxHp', 1), 1)
    
    # Reward healing when hurt
    if hp_delta > 0 and pp.get('hp', 0) < pp.get('maxHp', 1) * 0.6:
        reward += hp_delta * 8.0
    
    # Penalty for trap damage (no adjacent enemy)
    vis_enemies = _visible_enemies(curr_G)
    adj_count = sum(1 for e in vis_enemies if manhattan(e, p) == 1)
    if hp_delta < -0.05 and adj_count == 0:
        reward -= 3.0
    
    # ── EXPLORATION ──────────────────────────────────────────────────────────
    explored_delta = curr_G.get('seen_count', 0) - prev_G.get('seen_count', 0)
    if explored_delta > 0:
        reward += 0.1 * explored_delta
    
    # ── RESOURCE MANAGEMENT ──────────────────────────────────────────────────
    # Penalty for wasting potion at high HP
    if action == 8:  # USE_POTION
        if p.get('hp', 0) > p.get('maxHp', 1) * 0.8:
            reward -= 3.0
    
    # ── STAIR DISCOVERY ──────────────────────────────────────────────────────
    if not prev_G.get('known_stairs') and curr_G.get('known_stairs'):
        reward += 8.0
    
    # ── GOLD ─────────────────────────────────────────────────────────────────
    gold_delta = p.get('gold', 0) - pp.get('gold', 0)
    if gold_delta > 0:
        reward += gold_delta * 0.01
    
    # ── LEVEL UP ─────────────────────────────────────────────────────────────
    if p.get('lvl', 0) > pp.get('lvl', 0):
        reward += 8.0
    
    # ── TURN PENALTY ────────────────────────────────────────────────────────
    reward -= 0.005
    
    return reward


def _visible_enemies(G):
    """Get list of visible enemies."""
    p = G.get('player', {})
    enemies = G.get('enemies', [])
    seen = G.get('seen', set())
    MAP_W = 56
    return [e for e in enemies if not e.get('dying') and not e.get('isPet') and 
            (e.get('y', 0) * MAP_W + e.get('x', 0)) in seen]

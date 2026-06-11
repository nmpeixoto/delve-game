import sys
import os
sys.path.insert(0, os.path.abspath('automation/nn_rl'))
from headless_bridge import HeadlessWorker
from game_engine import DelveGame
import random
import copy

CLASSES = ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk']

ACTIONS = [
    {'type': 'key', 'val': 'ArrowUp'},
    {'type': 'key', 'val': 'ArrowDown'},
    {'type': 'key', 'val': 'ArrowLeft'},
    {'type': 'key', 'val': 'ArrowRight'},
    {'type': 'wait'},
    {'type': 'key', 'val': 'b'},
    {'type': 'key', 'val': 'v'},
    {'type': 'key', 'val': '>'},
]

def deep_diff(d1, d2, path=""):
    """Recursive deep dict comparison."""
    if isinstance(d1, dict) and isinstance(d2, dict):
        keys = set(d1.keys()).union(set(d2.keys()))
        for k in keys:
            # Skip fields that we know are not synced or irrelevant for pure gameplay state
            if k in ('map', 'seen', 'visible', 'seen_delta', 'ready', 'rooms', 'seen_count', 'known_stairs', 'shopOpen', 'id', '_door_count', '_secret_count', '_secrets_revealed_this_step', '_walkable_total', '_doors_unlocked_this_step', '_stair_coords'):
                continue

            if k not in d1:
                if not d2[k]: continue
                return f"{path}[{k}] missing in dict 1 (val: {d2[k]})"
            if k not in d2:
                if not d1[k]: continue
                return f"{path}[{k}] missing in dict 2 (val: {d1[k]})"
                
            res = deep_diff(d1[k], d2[k], f"{path}[{k}]")
            if res:
                return res
    elif isinstance(d1, list) and isinstance(d2, list):
        if len(d1) != len(d2):
            return f"{path} length mismatch: {len(d1)} != {len(d2)}"
        for i, (v1, v2) in enumerate(zip(d1, d2)):
            res = deep_diff(v1, v2, f"{path}[{i}]")
            if res:
                return res
    else:
        # For floats, use a small epsilon
        if isinstance(d1, float) or isinstance(d2, float):
            if abs(float(d1) - float(d2)) > 1e-5:
                return f"{path} mismatch: {d1} != {d2}"
        elif d1 != d2:
            return f"{path} mismatch: {d1} != {d2}"
    return None

def test_seed(seed, p_class):
    js_env = HeadlessWorker(num_envs=1)
    js_state = js_env.init_envs(seeds=[seed], classes=[p_class], hard_modes=[False])[0]
    py_env = DelveGame(seed=seed, player_class=p_class, hard_mode=False)
    py_state = py_env.snapshot()
    
    random.seed(seed) 
    
    for step in range(500):
        # We heavily weight basic movement, but occasionally trigger abilities/descend
        weights = [10, 10, 10, 10, 2, 1, 1, 1] 
        act_dict = random.choices(ACTIONS, weights=weights, k=1)[0]
        
        py_env.step(act_dict)
        py_state = py_env.snapshot()
        
        js_res = js_env.step_batch([(0, act_dict)])[0]
        js_state = js_res[1]
        
        diff_result = deep_diff(py_state, js_state)
        if diff_result:
            print(f"Diff: {diff_result}")
            if '[items]' in diff_result:
                print("PY ITEMS:", [(i.get('name'), i.get('price')) for i in py_state.get('items', [])])
                print("JS ITEMS:", [(i.get('name'), i.get('price')) for i in js_state.get('items', [])])
            js_env.shutdown()
            return False, f"Step {step} mismatched state:\nAction: {act_dict}\nDiff: {diff_result}"
            
        if py_state.get('gameOver') or py_state.get('won'):
            break
            
    js_env.shutdown()
    return True, 'Success'

if __name__ == '__main__':
    passed = 0
    total = 0
    
    for p_class in CLASSES:
        print(f"Testing class: {p_class}")
        class_passed = 0
        # Test 5 seeds per class
        for i in range(1, 6):
            total += 1
            ok, msg = test_seed(i, p_class)
            if ok:
                class_passed += 1
                passed += 1
            else:
                print(f'  Seed {i} failed: {msg}')
        print(f"  Passed: {class_passed}/5")
        
    print(f'\nTotal Passed: {passed}/{total}')

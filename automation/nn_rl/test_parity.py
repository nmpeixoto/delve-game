"""
Tests the parity between the JS Node bridge and the pure Python engine.
Generates an identical sequence of seeds and actions, applying them to both.
"""

import sys
import os
import json
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from headless_bridge import HeadlessWorker
from game_engine import DelveGame
from state_extractor import extract_state

def deep_compare(js, py, path=""):
    diffs = []
    if isinstance(js, dict) and isinstance(py, dict):
        for k in js:
            if k not in py:
                diffs.append(f"{path}.{k} in JS but not PY")
            else:
                diffs.extend(deep_compare(js[k], py[k], f"{path}.{k}"))
        for k in py:
            if k not in js:
                diffs.append(f"{path}.{k} in PY but not JS")
    elif isinstance(js, list) and isinstance(py, list):
        if len(js) != len(py):
            diffs.append(f"{path}: JS len {len(js)} != PY len {len(py)}")
        else:
            for i, (j_v, p_v) in enumerate(zip(js, py)):
                diffs.extend(deep_compare(j_v, p_v, f"{path}[{i}]"))
    elif isinstance(js, float) and isinstance(py, float):
        if abs(js - py) > 1e-5:
            diffs.append(f"{path}: JS {js} != PY {py}")
    else:
        if js != py:
            diffs.append(f"{path}: JS {js} != PY {py}")
    return diffs

def run_parity_test():
    seed = 42
    
    print(f"Starting parity test for Seed={seed}...")
    
    # 1. Initialize JS Engine
    js_env = HeadlessWorker(num_envs=1)
    js_state = js_env.init_envs(seeds=[seed], classes=['warrior'], hard_modes=[False])[0]
    
    # 2. Initialize Python Engine
    py_env = DelveGame(seed=seed, player_class='warrior', hard_mode=False)
    py_state = py_env.snapshot()
    
    # Compare initial states
    print("Comparing initial states...")
    diffs = deep_compare(js_state['player'], py_state['player'], "player")
    if diffs:
        print("INITIAL PLAYER DIFFS:")
        for d in diffs:
            print("  ", d)
    else:
        print("INITIAL PLAYER DIFFS: NONE")
    print(f"INITIAL POS: JS={js_state['player']['x']},{js_state['player']['y']} PY={py_state['player']['x']},{py_state['player']['y']}")
    
    map_diffs = deep_compare(js_state['map'], py_state['map'])
    if map_diffs:
        print("MAP DIFFS FOUND! First 10 diffs:")
        for d in map_diffs[:10]:
            print("  ", d)
    else:
        print("Initial maps match perfectly.")
        
    print(f"INITIAL rCount: JS={js_state.get('rCount')} PY={py_state.get('rCount')}")
    print(f"INITIAL ENEMY COUNT: JS={len(js_state['enemies'])} PY={len(py_state['enemies'])}")
    print(f"JS ROOMS: {js_state.get('rooms', [])}")
    print(f"PY ROOMS: {[r.get('type') for r in py_env.rooms]}")
    js_epos = sorted([(e['x'], e['y']) for e in js_state['enemies']])
    py_epos = sorted([(e['x'], e['y']) for e in py_state['enemies']])
    if js_epos != py_epos:
        print("INITIAL ENEMY POSITIONS MISMATCH!")
        print("JS missing:", set(py_epos) - set(js_epos))
        print("PY missing:", set(js_epos) - set(py_epos))
    else:
        print("Initial enemy positions match perfectly.")
    
    # 3. Play 1000 random steps and verify parity
    print("Running 1000 random steps parity check...")
    actions = [
        {'type': 'key', 'val': 'ArrowUp'},
        {'type': 'key', 'val': 'ArrowDown'},
        {'type': 'key', 'val': 'ArrowLeft'},
        {'type': 'key', 'val': 'ArrowRight'},
        {'type': 'wait'}
    ]
    for step in range(1000):
        act_idx = random.choice([0,1,2,3,4])
        act_dict = actions[act_idx]
        
        prev_py_hp = py_state['player']['hp']
        prev_js_hp = js_state['player']['hp']
        
        # Step PY
        py_env.step(act_dict)
        py_state = py_env.snapshot()
        
        # Step JS
        js_res = js_env.step_batch([(0, act_dict)])[0]
        js_state = js_res[1]
        
        if py_state['player']['hp'] != js_state['player']['hp']:
            print(f"Step {step} Action: {act_dict}")
            print(f"JS was {prev_js_hp}, now {js_state['player']['hp']}")
            print(f"PY was {prev_py_hp}, now {py_state['player']['hp']}")
            print(f"Step {step} HP mismatch! JS: {js_state['player']['hp']} PY: {py_state['player']['hp']}")
            break
        if js_state['player']['x'] != py_state['player']['x'] or js_state['player']['y'] != py_state['player']['y']:
            print(f"Step {step} Action: {act_idx} ({act_dict})")
            print(f"Step {step} Pos mismatch! JS: {js_state['player']['x']},{js_state['player']['y']} PY: {py_state['player']['x']},{py_state['player']['y']}")
            break
        if js_state.get('rCount') != py_state.get('rCount'):
            print(f"Step {step} Action: {act_idx} ({act_dict})")
            print(f"Step {step} RNG mismatch! JS: {js_state.get('rCount')} PY: {py_state.get('rCount')}")
            break
        if len(js_state['enemies']) != len(py_state['enemies']):
            print(f"INITIAL ENEMY COUNT: JS={len(js_state['enemies'])} PY={len(py_state['enemies'])}")
            print(f"JS ROOMS: {len(js_state.get('rooms', []))} {js_state.get('rooms', [])}")
            print(f"PY ROOMS: {len(py_env.rooms)} {[r.get('type') for r in py_env.rooms]}")
            sys.exit(1)
            break
            
    else:
        print("1000 steps completed with PERFECT PARITY!")
        
    js_env.shutdown()
    
if __name__ == '__main__':
    run_parity_test()

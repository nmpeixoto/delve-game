import json
import subprocess
import numpy as np
import sys
from state_extractor import extract_state, extract_local_map
from action_mask import get_action_mask

# Create a rich dummy state
G = {
    'player': { 'x': 5, 'y': 5, 'hp': 10, 'maxHp': 20, 'atk': 5, 'def': 5, 'lvl': 2, 'class': 'warrior', 'gold': 50 },
    'map': [[1]*56 for _ in range(36)],
    'seen': list(range(56*36)),
    'visible': list(range(56*36)),
    'enemies': [
        {'x': 6, 'y': 6, 'hp': 5, 'maxHp': 10, 'atk': 3, 'isElite': True}
    ],
    'items': [
        {'x': 4, 'y': 4, 'type': 'potion', 'carried': True},
        {'x': 7, 'y': 7, 'type': 'weapon', 'atk': 10, 'price': 100}
    ],
    'shops': [],
    'floor': 1,
}
G['map'][8][8] = 2 # STAIRS

# 1. Run Python
state_py = extract_state(G, prev_action=None)
map_py = extract_local_map(G).flatten()
mask_py = get_action_mask(G)

G['seen'] = list(G['seen'])
G['visible'] = list(G['visible'])
with open('dummy_G.json', 'w') as f:
    json.dump(G, f)

# 2. Run JS
js_code = """
const fs = require('fs');
const { extractStateJS, extractLocalMapJS, getActionMaskJS } = require('./inference.js');
const G = JSON.parse(fs.readFileSync('dummy_G.json', 'utf8'));
// convert lists to Sets
G.seen = new Set(G.seen);
G.visible = new Set(G.visible);
const s = extractStateJS(G);
const m = extractLocalMapJS(G);
const a = getActionMaskJS(G);
console.log(JSON.stringify({
    state: Array.from(s),
    map: Array.from(m),
    mask: Array.from(a)
}));
"""
with open('test_js.js', 'w') as f:
    f.write(js_code)

res = subprocess.check_output(['node', 'test_js.js'])
js_out = json.loads(res.decode('utf-8'))

state_js = np.array(js_out['state'], dtype=np.float32)
map_js = np.array(js_out['map'], dtype=np.float32)
mask_js = np.array(js_out['mask'], dtype=bool)

state_diff = np.abs(np.array(state_py) - state_js).max()
map_diff = np.abs(np.array(map_py) - map_js).max()
mask_diff = np.sum(mask_py != mask_js)

print(f"State max diff: {state_diff:.6f}")
print(f"Map max diff:   {map_diff:.6f}")
print(f"Mask diffs:     {mask_diff}")
if state_diff < 1e-5 and map_diff < 1e-5 and mask_diff == 0:
    print("SUCCESS: Python and JS logic exactly match.")
else:
    print("FAIL: Mismatch detected!")
    for i, (p, j) in enumerate(zip(state_py, state_js)):
        if abs(p - j) > 1e-5:
            print(f"  State index {i}: Py={p:.5f}, JS={j:.5f}")

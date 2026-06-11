import json
from automation.nn_rl.game_engine import WEAPONS, ARMORS, POTIONS

def _is_class_usable_gear(item, player_class):
    if not item or item.get('type') not in ('weapon', 'armor'):
        return False
    req = item.get('reqClass')
    if req and player_class not in req:
        return False
    return True

lvl = 1
player_class = 'monk'

weapon_pool = [w['name'] for w in WEAPONS if _is_class_usable_gear(w, player_class) and (not w.get('reqLvl') or lvl >= w['reqLvl'] - 2)]
armor_pool = [a['name'] for a in ARMORS if _is_class_usable_gear(a, player_class) and (not a.get('reqLvl') or lvl >= a['reqLvl'] - 2)]
potion_names = [p['name'] for p in POTIONS]
healing_names = [p['name'] for p in POTIONS if p['type'] == 'potion']

pool = []
pool.extend(weapon_pool)
pool.extend(armor_pool)
pool.extend(potion_names)
pool.extend(healing_names)

print("PYTHON POOL FOR MONK (forceHigh=True or rng.ch(0.3)):")
print(pool)
print("Length:", len(pool))

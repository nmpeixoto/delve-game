"""
Synthetic policy probes for DELVE RL checkpoints.
Tests stair navigation in controlled synthetic scenarios.
"""

import os
import sys
from typing import Dict, List

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from action_mask import get_action_mask
from config import ACTIONS
from state_extractor import CLASS_NAMES, extract_state

MAP_W = 56
PROBE_WIDTH = 12
PROBE_HEIGHT = 10

ACTION_LABELS = {
    ACTIONS["MOVE_UP"]: "Up",
    ACTIONS["MOVE_DOWN"]: "Down",
    ACTIONS["MOVE_LEFT"]: "Left",
    ACTIONS["MOVE_RIGHT"]: "Right",
    ACTIONS["DESCEND"]: "Desc",
}


def build_probe_scenarios(class_name="warrior") -> List[Dict]:
    return [
        {
            "name": "on_stairs",
            "target_action": ACTIONS["DESCEND"],
            "state": _probe_state(player_x=5, player_y=5, stairs_x=5, stairs_y=5, class_name=class_name),
        },
        {
            "name": "stairs_right",
            "target_action": ACTIONS["MOVE_RIGHT"],
            "state": _probe_state(player_x=5, player_y=5, stairs_x=6, stairs_y=5, class_name=class_name),
        },
        {
            "name": "stairs_down",
            "target_action": ACTIONS["MOVE_DOWN"],
            "state": _probe_state(player_x=5, player_y=5, stairs_x=5, stairs_y=6, class_name=class_name),
        },
        {
            "name": "stairs_left",
            "target_action": ACTIONS["MOVE_LEFT"],
            "state": _probe_state(player_x=5, player_y=5, stairs_x=4, stairs_y=5, class_name=class_name),
        },
        {
            "name": "stairs_up",
            "target_action": ACTIONS["MOVE_UP"],
            "state": _probe_state(player_x=5, player_y=5, stairs_x=5, stairs_y=4, class_name=class_name),
        },
    ]


from state_extractor import extract_local_map

def evaluate_policy_probe(model, device, class_names=None) -> Dict:
    class_names = list(class_names or CLASS_NAMES)
    scenarios = []
    for class_name in class_names:
        for scenario in build_probe_scenarios(class_name):
            scenarios.append({**scenario, "class_name": class_name})

    states = np.stack([extract_state(scenario["state"]) for scenario in scenarios])
    maps = np.stack([extract_local_map(scenario["state"]) for scenario in scenarios])
    masks = np.stack([get_action_mask(scenario["state"]) for scenario in scenarios])

    state_tensor = torch.from_numpy(states.astype(np.float32, copy=False)).to(device)
    map_tensor = torch.from_numpy(maps.astype(np.float32, copy=False)).to(device)
    mask_tensor = torch.from_numpy(masks).to(device=device, dtype=torch.bool)

    with torch.inference_mode():
        logits, _values, _hidden = model(state_tensor, map_tensor, action_mask=mask_tensor)
        probs = torch.softmax(logits, dim=-1).cpu().numpy()

    scenario_order = [scenario["name"] for scenario in build_probe_scenarios(class_names[0] if class_names else "warrior")]
    target_actions = {scenario["name"]: scenario["target_action"] for scenario in build_probe_scenarios(class_names[0] if class_names else "warrior")}
    grouped = {name: [] for name in scenario_order}
    for scenario, scenario_probs in zip(scenarios, probs):
        grouped[scenario["name"]].append(scenario_probs)

    results = []
    directional_target_probs = []
    directional_exact = 0
    for scenario_name in scenario_order:
        averaged_probs = np.mean(grouped[scenario_name], axis=0)
        target_action = target_actions[scenario_name]
        target_prob = float(averaged_probs[target_action])
        best_action = int(np.argmax(averaged_probs))
        exact = best_action == target_action
        if scenario_name != "on_stairs":
            directional_target_probs.append(target_prob)
            directional_exact += int(exact)
        results.append({
            "name": scenario_name,
            "target_action": target_action,
            "target_label": ACTION_LABELS.get(target_action, str(target_action)),
            "target_prob": target_prob,
            "best_action": best_action,
            "best_label": ACTION_LABELS.get(best_action, str(best_action)),
            "correct": exact,
        })

    metrics = {
        "class_count": len(class_names),
        "descend_prob_on_stairs": results[0]["target_prob"],
        "directional_target_prob_mean": float(np.mean(directional_target_probs)) if directional_target_probs else 0.0,
        "directional_exact_rate": directional_exact / max(len(directional_target_probs), 1),
    }
    return {
        "results": results,
        "metrics": metrics,
        "summary": format_probe_summary(results, metrics),
    }


def format_probe_summary(results: List[Dict], metrics: Dict) -> str:
    parts = []
    for result in results:
        parts.append(f"{result['target_label']} {result['target_prob']:.1%}")
    return (
        f"Probe: class-avg ({metrics.get('class_count', 1)} classes) "
        + " | ".join(parts)
        + f" | MoveMean {metrics['directional_target_prob_mean']:.1%}"
        + f" | MoveTop1 {metrics['directional_exact_rate']:.0%}"
    )


def _probe_state(player_x, player_y, stairs_x, stairs_y, class_name="warrior"):
    map_data = [[1 for _ in range(PROBE_WIDTH)] for _ in range(PROBE_HEIGHT)]
    map_data[stairs_y][stairs_x] = 2

    seen = {
        player_y * MAP_W + player_x,
        stairs_y * MAP_W + stairs_x,
        player_y * MAP_W + max(player_x - 1, 0),
        player_y * MAP_W + min(player_x + 1, PROBE_WIDTH - 1),
        max(player_y - 1, 0) * MAP_W + player_x,
        min(player_y + 1, PROBE_HEIGHT - 1) * MAP_W + player_x,
    }

    return {
        "floor": 1,
        "turn": 20,
        "player": {
            "hp": 20, "maxHp": 20, "atk": 4, "def": 2,
            "lvl": 1, "xp": 0, "xpNext": 10, "gold": 0,
            "x": player_x, "y": player_y, "class": class_name,
        },
        "enemies": [], "items": [], "shops": [], "traps": [],
        "map": map_data, "seen": seen, "visible": set(seen),
        "seen_count": len(seen), "known_stairs": True,
        "shopOpen": False, "ability1Cooldown": 0, "ability2Cooldown": 0,
        "gameOver": False, "won": False,
        "_current_step": 20,
        "_last_key_pickup_step": -999, "_last_door_unlock_step": -999,
        "_last_enemy_kill_step": -999,
        "_doors_opened_this_floor": 0, "_keys_used_this_floor": 0,
        "_steps_since_floor_change": 20, "_steps_since_key_pickup": 999,
        "_steps_since_enemy_kill": 999, "_steps_since_door_unlock": 999,
    }

"""
Small fixed policy probes for detecting obvious navigation collapse.

These scenarios are not gameplay evaluation. They are cheap canaries that answer:
does the policy put high probability on descending when standing on stairs, and
does it prefer the intended direction when stairs are visible nearby?
"""

import numpy as np
import torch

from action_mask import get_action_mask
from config import ACTIONS, MAP_W
from state_extractor import CLASS_NAMES, numpyize_maps, numpyize_states


def build_probe_scenarios():
    return [
        _scenario("on_stairs", player=(5, 5), stairs=(5, 5), target=ACTIONS["DESCEND"], label="Desc"),
        _scenario("stairs_right", player=(5, 5), stairs=(8, 5), target=ACTIONS["MOVE_RIGHT"], label="Right"),
        _scenario("stairs_down", player=(5, 5), stairs=(5, 8), target=ACTIONS["MOVE_DOWN"], label="Down"),
        _scenario("stairs_left", player=(5, 5), stairs=(2, 5), target=ACTIONS["MOVE_LEFT"], label="Left"),
        _scenario("stairs_up", player=(5, 5), stairs=(5, 2), target=ACTIONS["MOVE_UP"], label="Up"),
    ]


def evaluate_policy_probe(model, device):
    scenarios = build_probe_scenarios()
    rows = []
    directional_hits = []
    directional_probs = []

    for scenario in scenarios:
        class_probs = []
        class_hits = []
        for class_name in CLASS_NAMES:
            state = _with_class(scenario["state"], class_name)
            states = [state]
            state_tensor = torch.from_numpy(numpyize_states(states)).to(device)
            map_tensor = torch.from_numpy(numpyize_maps(states)).to(device)
            mask_tensor = torch.from_numpy(np.stack([get_action_mask(state)])).to(device=device, dtype=torch.bool)
            with torch.no_grad():
                logits, _value, _hidden = model(state_tensor, map_tensor, action_mask=mask_tensor)
                probs = torch.softmax(logits, dim=-1)[0].detach().cpu().numpy()

            target_prob = float(probs[scenario["target_action"]])
            class_probs.append(target_prob)
            class_hits.append(int(np.argmax(probs) == scenario["target_action"]))

        target_prob = sum(class_probs) / max(len(class_probs), 1)
        target_hit = sum(class_hits) / max(len(class_hits), 1)
        rows.append({
            "name": scenario["name"],
            "target_label": scenario["target_label"],
            "target_prob": target_prob,
            "target_top1_rate": target_hit,
        })
        if scenario["name"] != "on_stairs":
            directional_probs.append(target_prob)
            directional_hits.append(target_hit)

    metrics = {
        "descend_prob_on_stairs": rows[0]["target_prob"] if rows else 0.0,
        "directional_target_prob_mean": sum(directional_probs) / max(len(directional_probs), 1),
        "directional_exact_rate": sum(directional_hits) / max(len(directional_hits), 1),
        "class_count": len(CLASS_NAMES),
    }
    return rows, metrics


def format_probe_summary(rows, metrics):
    desc = next((row for row in rows if row.get("target_label") == "Desc"), None)
    desc_text = f"Desc {_pct(desc.get('target_prob', 0.0))}" if desc else "Desc n/a"
    return (
        f"Probe: {desc_text} | "
        f"MoveMean {_pct(metrics.get('directional_target_prob_mean', 0.0))} "
        f"class-avg ({int(metrics.get('class_count', 0))} classes) | "
        f"MoveTop1 {_pct(metrics.get('directional_exact_rate', 0.0), digits=0)}"
    )


def _scenario(name, player, stairs, target, label):
    width = 12
    height = 10
    map_data = [[1 for _ in range(width)] for _ in range(height)]
    sx, sy = stairs
    map_data[sy][sx] = 2
    seen = {y * MAP_W + x for y in range(height) for x in range(width)}
    px, py = player
    return {
        "name": name,
        "target_action": target,
        "target_label": label,
        "state": {
            "floor": 1,
            "turn": 0,
            "player": {
                "hp": 20,
                "maxHp": 20,
                "atk": 5,
                "def": 3,
                "lvl": 1,
                "xp": 0,
                "xpNext": 10,
                "gold": 0,
                "x": px,
                "y": py,
                "class": "warrior",
            },
            "map": map_data,
            "seen": set(seen),
            "visible": set(seen),
            "seen_count": len(seen),
            "_walkable_total": width * height,
            "_stair_coords": [(sx, sy)],
            "known_stairs": True,
            "enemies": [],
            "items": [],
            "traps": [],
            "shops": [],
            "ability1Cooldown": 0,
            "ability2Cooldown": 0,
        },
    }


def _with_class(state, class_name):
    clone = {
        **state,
        "player": {**state.get("player", {}), "class": class_name},
        "seen": set(state.get("seen", set())),
        "visible": set(state.get("visible", set())),
    }
    return clone


def _pct(value, digits=1):
    return f"{float(value) * 100:.{digits}f}%"

#!/usr/bin/env python3
"""
DELVE RL Training Script — PPO with vectorized environments.
Uses the existing headless_balance.js VM infrastructure directly.
"""

import argparse
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import glob
import os, sys, time, json
import re
import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import *
from network import DelveNet

from ppo import PPO, RolloutBuffer
from state_extractor import CLASS_NAMES, extract_state
from vector_env import DelveVectorEnv

try:
    from torch.utils.tensorboard import SummaryWriter

    HAS_TB = True
except ImportError:
    HAS_TB = False


def run_games_via_headless(config):
    """
    Run games using the headless_balance.js runner via subprocess.
    Returns list of {className, seed, status, finalFloor, hp, decisionSteps} dicts.
    """
    import subprocess

    args = [
        "node",
        os.path.join(
            os.path.dirname(__file__), "..", "headless-balance", "headless_balance.js"
        ),
        "--classes",
        ",".join(config["classList"]),
        "--per-class",
        str(config["perClass"]),
        "--seed-base",
        str(config["seedBase"]),
        "--max-turns",
        str(config["maxTurns"]),
        "--output",
        config["outputPath"],
    ]
    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=os.path.join(os.path.dirname(__file__), "..", ".."),
    )
    # Load results from output file
    with open(config["outputPath"]) as f:
        report = json.load(f)
    return report


def evaluate_headless(agent, num_games=100, device="cuda"):
    """Evaluate using headless_balance.js runner."""
    import subprocess, json, tempfile

    config_path = os.path.join(os.path.dirname(__file__), "..", "strategy_config.json")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
        tmp_path = tmp.name

    args = [
        "node",
        os.path.join(
            os.path.dirname(__file__), "..", "headless-balance", "headless_balance.js"
        ),
        "--classes",
        ",".join(CLASSES),
        "--per-class",
        str(num_games // 8),
        "--seed-base",
        "1",
        "--max-turns",
        str(DEFAULT_MAX_EPISODE_STEPS),
        "--output",
        tmp_path,
    ]

    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            cwd=os.path.join(os.path.dirname(__file__), "..", ".."),
            timeout=300,
        )

        with open(tmp_path) as f:
            report = json.load(f)

        overall = report.get("overall", {})
        by_class = report.get("byClass", {})

        return {
            "win_rate": overall.get("winRate", 0),
            "avg_floor": overall.get("avgFloor", 0),
            "games": overall.get("runs", 0),
            "by_class": {k: v.get("winRate", 0) for k, v in by_class.items()},
        }
    finally:
        try:
            os.unlink(tmp_path)
        except:
            pass


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Train the DELVE PPO bot against the real headless game runner."
    )
    parser.add_argument(
        "--total-timesteps",
        "--steps",
        dest="total_timesteps",
        type=int,
        default=TOTAL_TIMESTEPS,
    )
    parser.add_argument(
        "--num-envs", "--envs", dest="num_envs", type=int, default=NUM_ENVS
    )
    parser.add_argument("--envs-per-worker", type=int, default=ENVS_PER_WORKER)
    parser.add_argument("--rollout-steps", type=int, default=ROLLOUT_STEPS)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--hidden-dim", type=int, default=None)
    parser.add_argument(
        "--learning-rate",
        "--lr",
        dest="learning_rate",
        type=float,
        default=None,
        help="Override PPO Adam learning rate; useful for conservative resumed training.",
    )
    parser.add_argument(
        "--entropy-coeff",
        type=float,
        default=None,
        help="Override PPO entropy bonus coefficient.",
    )
    parser.add_argument(
        "--model-variant",
        choices=sorted(MODEL_VARIANTS),
        default="base",
    )
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--checkpoint-dir", default="checkpoints")
    parser.add_argument("--save-every", type=int, default=SAVE_EVERY)
    parser.add_argument(
        "--resume",
        nargs="?",
        const="latest",
        default=None,
        help="Resume from a checkpoint path, or use latest checkpoint when passed without a value.",
    )
    parser.add_argument(
        "--reset-optimizer",
        action="store_true",
        help="Load model weights from --resume but start optimizer and LR schedule fresh.",
    )
    parser.add_argument(
        "--max-episode-steps",
        type=int,
        default=DEFAULT_MAX_EPISODE_STEPS,
        help="Max actions per episode; 0 disables the timeout for deliberate unlimited experiments.",
    )
    parser.add_argument(
        "--timeout-penalty", type=float, default=DEFAULT_TIMEOUT_PENALTY
    )
    parser.add_argument("--no-tensorboard", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument(
        "--metrics-log",
        default=os.path.join("runs", "delve_ppo", "metrics.jsonl"),
        help="JSONL file for durable scalar/event logging. Pass an empty string to disable.",
    )
    parser.add_argument(
        "--tensorboard-logdir",
        default=os.path.join("runs", "delve_ppo"),
        help="TensorBoard event directory.",
    )
    parser.add_argument(
        "--observation-mode",
        choices=["legacy", "direct"],
        default="legacy",
        help="Observation builder used by rollout workers.",
    )
    parser.add_argument(
        "--transport-mode",
        choices=["pipe", "shared", "shared-contiguous"],
        default="pipe",
        help="Rollout transport used by worker processes.",
    )
    parser.add_argument(
        "--trainer-mode",
        choices=["sync", "async-double-buffer", "async-one-stale"],
        default="sync",
        help="Synchronous PPO or one-rollout-stale actor/learner overlap.",
    )
    parser.add_argument(
        "--curriculum-max-floor",
        type=int,
        default=None,
        help="Maximum floor the bot is allowed to reach. If it reaches stairs on this floor, it wins early.",
    )
    return parser.parse_args(argv)


def build_ppo_config(args):
    lr_start = float(args.learning_rate) if args.learning_rate is not None else LR_START
    lr_end = min(LR_END, lr_start)
    entropy_coeff = (
        float(args.entropy_coeff)
        if args.entropy_coeff is not None
        else ENTROPY_COEFF
    )
    return {
        "lr": lr_start,
        "gamma": GAMMA,
        "lam": LAM,
        "clip_eps": CLIP_EPS,
        "entropy_coeff": entropy_coeff,
        "value_coeff": VALUE_COEFF,
        "max_grad_norm": MAX_GRAD_NORM,
        "epochs_per_update": EPOCHS_PER_UPDATE,
        "batch_size": args.batch_size,
        "num_envs": args.num_envs,
        "rollout_steps": args.rollout_steps,
        "lr_start": lr_start,
        "lr_end": lr_end,
        "lr_decay_steps": LR_DECAY_STEPS,
        "clip_v_loss": CLIP_V_LOSS,
    }


def should_use_tensorboard(args):
    return bool(HAS_TB and not getattr(args, "no_tensorboard", False))


def format_episode_cap(max_episode_steps):
    if int(max_episode_steps) <= 0:
        return "unlimited"
    return f"{int(max_episode_steps):,} steps"


CHECKPOINT_RE = re.compile(r"delve_ppo_(\d+)\.pt$")
LOG_WINDOW_EPISODES = 100
DEFAULT_METRICS_LOG = os.path.join("runs", "delve_ppo", "metrics.jsonl")


def checkpoint_step_from_path(path):
    match = CHECKPOINT_RE.search(os.path.basename(path))
    return int(match.group(1)) if match else 0


def resolve_resume_checkpoint(resume, checkpoint_dir):
    if not resume:
        return None, 0

    if resume == "latest":
        candidates = []
        for path in glob.glob(os.path.join(checkpoint_dir, "delve_ppo_*.pt")):
            step = checkpoint_step_from_path(path)
            if step > 0:
                candidates.append((step, path))
        if not candidates:
            raise FileNotFoundError(
                f"No numbered DELVE PPO checkpoints found in {checkpoint_dir}"
            )
        step, path = max(candidates, key=lambda item: item[0])
        return path, step

    path = resume if os.path.isabs(resume) else os.path.abspath(resume)
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return path, checkpoint_step_from_path(path)


def curriculum_phase_for_step(total_steps, curriculum):
    steps_remaining = total_steps
    for index, phase in enumerate(curriculum):
        phase_steps = int(phase.get("steps", 0))
        if steps_remaining < phase_steps or index == len(curriculum) - 1:
            return index, max(steps_remaining, 0)
        steps_remaining -= phase_steps
    return max(len(curriculum) - 1, 0), 0


def curriculum_metric_label(phase):
    max_floor = phase.get("max_floor") if phase else None
    if max_floor is None:
        return "Full Win"
    return f"Floor {int(max_floor) + 1}"


def curriculum_phase_target(phase):
    if not phase:
        return "full dungeon clear"
    label = curriculum_metric_label(phase)
    threshold = phase.get("success_threshold")
    window = int(phase.get("success_window", LOG_WINDOW_EPISODES))
    if phase.get("max_floor") is None:
        if threshold is None:
            return "full dungeon clear"
        return f"clear full dungeon at {float(threshold):.0%} over {window} episodes"
    if threshold is None:
        return "full dungeon clear"
    return f"reach {label} at {float(threshold):.0%} over {window} episodes"


def curriculum_should_advance(phase, curriculum_results, steps_in_phase):
    if not phase:
        return False

    min_steps = int(phase.get("min_steps", 0))
    window = int(phase.get("success_window", LOG_WINDOW_EPISODES))
    threshold = phase.get("success_threshold")
    if threshold is None or steps_in_phase < min_steps:
        return False

    progress_key = "wins" if phase.get("max_floor") is None else "curriculum"
    if isinstance(curriculum_results, dict):
        recent = curriculum_results.get(progress_key, [])
        if len(recent) < window:
            return False
            
        class_values = defaultdict(list)
        for class_name, value in zip(curriculum_results.get("classes", []), recent):
            if not class_name or class_name == "unknown":
                continue
            class_values[class_name].append(bool(value))
            
        if len(class_values) < len(CLASS_NAMES):
            return False
            
        class_rates = [sum(vals) / len(vals) for vals in class_values.values()]
        return all(rate >= float(threshold) for rate in class_rates)
    else:
        recent = list(curriculum_results)[-window:]
        if len(recent) < window:
            return False
        success_rate = sum(1 for success in recent if success) / len(recent)
        return success_rate >= float(threshold)


def new_episode_window(window=LOG_WINDOW_EPISODES):
    return {
        "rewards": deque(maxlen=window),
        "lengths": deque(maxlen=window),
        "wins": deque(maxlen=window),
        "floors": deque(maxlen=window),
        "outcomes": deque(maxlen=window),
        "curriculum": deque(maxlen=window),
        "classes": deque(maxlen=window),
        "reward_components": deque(maxlen=window),
    }


def record_episode(window, info):
    window["rewards"].append(info.get("total_reward", 0.0))
    window["lengths"].append(info.get("total_steps", 0))
    window["wins"].append(bool(info.get("won", False)))
    window["floors"].append(info.get("final_floor", 0))
    window["outcomes"].append(info.get("outcome", "done"))
    window["curriculum"].append(bool(info.get("curriculum_success", False)))
    class_name = info.get("class_name")
    if not class_name:
        terminal_state = info.get("terminal_state") or {}
        class_name = terminal_state.get("player", {}).get("class")
    window["classes"].append(class_name or "unknown")
    window["reward_components"].append(dict(info.get("reward_components") or {}))


def episode_rate_stats(window, key):
    values = list(window.get(key, []))
    if not values:
        return 0.0, 0.0

    raw_rate = sum(1 for value in values if value) / len(values)
    class_values = defaultdict(list)
    for class_name, value in zip(window.get("classes", []), values):
        if not class_name or class_name == "unknown":
            continue


def episode_rate_stats(window, key):
    values = list(window.get(key, []))
    if not values:
        return 0.0, 0.0

    raw_rate = sum(1 for value in values if value) / len(values)
    class_values = defaultdict(list)
    for class_name, value in zip(window.get("classes", []), values):
        if not class_name or class_name == "unknown":
            continue
        class_values[class_name].append(bool(value))

    if not class_values:
        return raw_rate, raw_rate

    class_rates = [
        sum(values_for_class) / len(values_for_class)
        for values_for_class in class_values.values()
    ]
    return raw_rate, sum(class_rates) / len(class_rates)


def calculate_dynamic_weights(window, key):
    values = list(window.get(key, []))
    if not values:
        return {c: 1.0 for c in CLASSES}

    class_values = defaultdict(list)
    for class_name, value in zip(window.get("classes", []), values):
        if not class_name or class_name == "unknown":
            continue
        class_values[class_name].append(bool(value))

    new_weights = {}
    for c in CLASSES:
        if c in class_values and class_values[c]:
            rate = sum(class_values[c]) / len(class_values[c])
            new_weights[c] = max(1.0, min(2.0, 1.0 + (1.0 - rate)))
        else:
            new_weights[c] = 2.0
    return new_weights


def episode_class_summary(window, key):
    values = list(window.get(key, []))
    floors = list(window.get("floors", []))
    if not values:
        return "Class counts: none"

    class_values = defaultdict(list)
    class_floors = defaultdict(list)
    for class_name, value, floor in zip(window.get("classes", []), values, floors):
        if not class_name or class_name == "unknown":
            continue
        class_values[class_name].append(bool(value))
        class_floors[class_name].append(float(floor))

    if not class_values:
        return "Class counts: none"

    parts = []
    ordered_names = [name for name in CLASS_NAMES if name in class_values]
    ordered_names.extend(
        sorted(name for name in class_values if name not in CLASS_NAMES)
    )
    for class_name in ordered_names:
        class_results = class_values[class_name]
        c_floors = class_floors[class_name]
        total = len(class_results)
        if total == 0:
            continue
        successes = sum(1 for value in class_results if value)
        avg_floor = sum(c_floors) / len(c_floors) if c_floors else 0
        parts.append(
            f"{class_name} {successes}/{total} ({successes / total:.0%}, F{avg_floor:.1f})"
        )

    return "Class counts: " + ", ".join(parts) if parts else "Class counts: none"


def action_names():
    return [
        "Up",
        "Down",
        "Left",
        "Right",
        "Atk1",
        "Atk2",
        "Ab1",
        "Ab2",
        "Pot",
        "Buff",
        "Bomb",
        "Tele",
        "Detect",
        "Desc",
        "Shop",
        "Buy",
        "Sell",
        "Esc",
    ] + [f"Buy{slot + 1}" for slot in range(MAX_SHOP_SLOTS)] + [
        "RngWeak",
        "RngNear",
        "Kite",
    ]


def action_distribution(action_counts):
    total = int(action_counts.sum())
    names = action_names()
    if total == 0:
        return {}
    return {
        names[i] if i < len(names) else f"Action{i}": float(count) / total
        for i, count in enumerate(action_counts)
        if int(count) > 0
    }


def copy_numpy_observation_into_tensors(
    np_states,
    np_maps,
    np_masks,
    state_tensor,
    map_tensor,
    mask_tensor,
):
    """Copy observation arrays into reusable tensors without replacing targets."""
    state_tensor.copy_(torch.from_numpy(np_states), non_blocking=True)
    map_tensor.copy_(torch.from_numpy(np_maps), non_blocking=True)
    mask_tensor.copy_(
        torch.from_numpy(np_masks.astype(np.bool_, copy=False)),
        non_blocking=True,
    )
    return state_tensor, map_tensor, mask_tensor


@dataclass
class RolloutTransferTensors:
    state: torch.Tensor
    map: torch.Tensor
    mask: torch.Tensor
    bootstrap_state: torch.Tensor
    bootstrap_map: torch.Tensor
    bootstrap_mask: torch.Tensor


@dataclass
class RolloutResult:
    buffer: RolloutBuffer
    transfer: RolloutTransferTensors
    np_states: np.ndarray
    np_maps: np.ndarray
    np_masks: np.ndarray
    hidden: torch.Tensor | None
    action_counts: np.ndarray
    probe_accumulator: dict
    episode_infos: list
    steps_collected: int
    policy_version: int


def allocate_rollout_transfer_tensors(np_states, np_maps, np_masks, device):
    state_tensor = torch.empty(np_states.shape, device=device, dtype=torch.float32)
    map_tensor = torch.empty(np_maps.shape, device=device, dtype=torch.float32)
    mask_tensor = torch.empty(np_masks.shape, device=device, dtype=torch.bool)
    return RolloutTransferTensors(
        state=state_tensor,
        map=map_tensor,
        mask=mask_tensor,
        bootstrap_state=torch.empty_like(state_tensor),
        bootstrap_map=torch.empty_like(map_tensor),
        bootstrap_mask=torch.empty_like(mask_tensor),
    )


def prepare_bootstrap_tensors(result):
    return copy_numpy_observation_into_tensors(
        result.np_states,
        result.np_maps,
        result.np_masks,
        result.transfer.bootstrap_state,
        result.transfer.bootstrap_map,
        result.transfer.bootstrap_mask,
    )


def collect_rollout_batch(
    *,
    env,
    model,
    buffer,
    transfer,
    np_states,
    np_maps,
    np_masks,
    hidden,
    args,
    device,
    policy_version=0,
):
    action_counts = np.zeros(ACTION_DIM, dtype=np.int64)
    probe_accumulator = new_probe_accumulator()
    episode_infos = []

    for step in range(args.rollout_steps):
        state_tensor, map_tensor, mask_tensor = copy_numpy_observation_into_tensors(
            np_states,
            np_maps,
            np_masks,
            transfer.state,
            transfer.map,
            transfer.mask,
        )

        hidden_in = hidden
        with torch.inference_mode():
            logits, values_raw, hidden = model(
                state_tensor,
                map_tensor,
                action_mask=mask_tensor,
                hidden=hidden_in,
            )
            dist = torch.distributions.Categorical(logits=logits)
            actions = dist.sample()
            log_probs = dist.log_prob(actions)
            values = values_raw.squeeze(-1)
            descend_logits = logits[:, ACTIONS["DESCEND"]]
            descend_probs = torch.exp(descend_logits - torch.logsumexp(logits, dim=-1))
        action_array = actions.cpu().numpy()
        update_descend_probe(
            probe_accumulator,
            np_states,
            np_masks,
            action_array,
            descend_probs.cpu().numpy(),
        )
        action_counts += np.bincount(action_array, minlength=ACTION_DIM)

        (
            next_np_states,
            next_np_maps,
            next_np_masks,
            rewards_np,
            dones_np,
            infos,
        ) = env.step(action_array)

        buffer.store(
            step=step,
            states=state_tensor,
            maps=map_tensor,
            actions=actions,
            log_probs=log_probs,
            values=values,
            rewards=torch.from_numpy(rewards_np).to(
                device=device,
                dtype=torch.float32,
            ),
            dones=torch.from_numpy(dones_np).to(
                device=device,
                dtype=torch.bool,
            ),
            masks=mask_tensor,
            hidden=hidden_in,
        )

        np_states = next_np_states
        np_maps = next_np_maps
        np_masks = next_np_masks

        if hidden is not None and dones_np.any():
            done_mask = (
                torch.from_numpy(dones_np)
                .to(device=device, dtype=torch.bool)
                .unsqueeze(0)
            )
            hidden = hidden.masked_fill(done_mask.unsqueeze(-1), 0.0)

        for i, done in enumerate(dones_np.tolist()):
            if done:
                episode_infos.append(infos[i])

    return RolloutResult(
        buffer=buffer,
        transfer=transfer,
        np_states=np_states,
        np_maps=np_maps,
        np_masks=np_masks,
        hidden=hidden,
        action_counts=action_counts,
        probe_accumulator=probe_accumulator,
        episode_infos=episode_infos,
        steps_collected=args.num_envs * args.rollout_steps,
        policy_version=int(policy_version),
    )


def summarize_actions(action_counts):
    total = int(action_counts.sum())
    if total == 0:
        return "Actions: none"
    names = action_names()
    top = list(np.argsort(action_counts)[-3:][::-1])
    descend_idx = ACTIONS["DESCEND"]
    if descend_idx not in top:
        top.append(descend_idx)
    return "Actions: " + ", ".join(
        f"{names[i] if i < len(names) else f'Action{i}'} {_format_action_ratio(action_counts[i], total)}"
        for i in top
    )


def outcome_summary(window):
    outcomes = list(window.get("outcomes", []))
    rewards = list(window.get("rewards", []))
    floors = list(window.get("floors", []))
    lengths = list(window.get("lengths", []))
    summary = {}
    for outcome in sorted(set(outcomes)):
        indexes = [i for i, value in enumerate(outcomes) if value == outcome]
        if not indexes:
            continue
        summary[outcome] = {
            "count": len(indexes),
            "avg_reward": float(np.mean([rewards[i] for i in indexes])),
            "avg_floor": float(np.mean([floors[i] for i in indexes])),
            "avg_length": float(np.mean([lengths[i] for i in indexes])),
        }
    return summary


def reward_component_summary(window):
    components = list(window.get("reward_components", []))
    if not components:
        return {}
    totals = defaultdict(float)
    for component_row in components:
        for name, value in component_row.items():
            totals[name] += float(value)
    denom = max(len(components), 1)
    return {name: value / denom for name, value in sorted(totals.items())}


def new_probe_accumulator():
    return defaultdict(float)


def update_descend_probe(accumulator, np_states, np_masks, actions, desc_probs):
    descend_idx = ACTIONS["DESCEND"]
    on_stairs = np_states[:, 6] > 0.5
    legal_desc = np_masks[:, descend_idx].astype(bool)
    selected_desc = actions == descend_idx

    accumulator["legal_desc_steps"] = accumulator.get("legal_desc_steps", 0) + int(
        legal_desc.sum()
    )
    accumulator["legal_desc_actions"] = accumulator.get("legal_desc_actions", 0) + int(
        (selected_desc & legal_desc).sum()
    )
    accumulator["legal_desc_prob_sum"] = accumulator.get(
        "legal_desc_prob_sum", 0.0
    ) + (
        float(desc_probs[legal_desc].sum()) if legal_desc.any() else 0.0
    )
    accumulator["on_stairs_steps"] = accumulator.get("on_stairs_steps", 0) + int(
        on_stairs.sum()
    )
    accumulator["on_stairs_desc_actions"] = accumulator.get(
        "on_stairs_desc_actions", 0
    ) + int((selected_desc & on_stairs).sum())
    accumulator["on_stairs_desc_prob_sum"] = accumulator.get(
        "on_stairs_desc_prob_sum", 0.0
    ) + (
        float(desc_probs[on_stairs].sum()) if on_stairs.any() else 0.0
    )


def finalize_probe_metrics(accumulator):
    legal = max(float(accumulator.get("legal_desc_steps", 0.0)), 1.0)
    on_stairs = max(float(accumulator.get("on_stairs_steps", 0.0)), 1.0)
    return {
        "legal_desc_steps": int(accumulator.get("legal_desc_steps", 0)),
        "legal_desc_action_rate": float(accumulator.get("legal_desc_actions", 0.0))
        / legal,
        "legal_desc_mean_prob": float(accumulator.get("legal_desc_prob_sum", 0.0))
        / legal,
        "on_stairs_steps": int(accumulator.get("on_stairs_steps", 0)),
        "on_stairs_desc_action_rate": float(
            accumulator.get("on_stairs_desc_actions", 0.0)
        )
        / on_stairs,
        "descend_prob_on_stairs": float(accumulator.get("on_stairs_desc_prob_sum", 0.0))
        / on_stairs,
    }


def build_training_metrics_row(
    *,
    total_steps,
    run_start_steps=0,
    elapsed,
    phase_index,
    phase_name,
    progress_label,
    progress_rate,
    progress_raw_rate,
    win_rate,
    avg_reward,
    avg_length,
    avg_floor,
    timeout_rate,
    death_rate,
    policy_loss,
    value_loss,
    entropy,
    progress_delta=None,
    action_counts=None,
    episode_window=None,
    progress_key="wins",
    status_text=None,
    probe_metrics=None,
    stage_seconds=None,
):
    row = {
        "event": "train_report",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_steps": int(total_steps),
        "elapsed_seconds": float(elapsed),
        "phase_index": int(phase_index),
        "phase_name": str(phase_name),
        "progress_label": str(progress_label),
        "progress_rate": float(progress_rate),
        "progress_raw_rate": float(progress_raw_rate),
        "win_rate": float(win_rate),
        "avg_reward": float(avg_reward),
        "avg_length": float(avg_length),
        "avg_floor": float(avg_floor),
        "timeout_rate": float(timeout_rate),
        "death_rate": float(death_rate),
        "policy_loss": float(policy_loss),
        "value_loss": float(value_loss),
        "entropy": float(entropy),
    }
    if progress_delta is not None:
        row["progress_delta"] = float(progress_delta)
    if episode_window is not None:
        row["class_summary"] = episode_class_summary(episode_window, progress_key)
    if action_counts is not None:
        row["actions_summary"] = summarize_actions(action_counts)
        row["action_distribution"] = action_distribution(action_counts)
    if episode_window is not None:
        row["outcome_summary"] = outcome_summary(episode_window)
        row["reward_components"] = reward_component_summary(episode_window)
    if status_text:
        row["status_text"] = str(status_text)
    if probe_metrics:
        row["probe_metrics"] = dict(probe_metrics)
    if stage_seconds is not None:
        steps_this_run = max(int(total_steps) - int(run_start_steps or 0), 0)
        row["perf"] = {
            "steps_per_second": steps_this_run / max(float(elapsed), 1e-9),
            "run_start_steps": int(run_start_steps or 0),
            "steps_this_run": steps_this_run,
            "stage_seconds": {
                str(name): float(seconds)
                for name, seconds in sorted(dict(stage_seconds).items())
            },
        }
    return row


def append_jsonl_record(path, record):
    if not path:
        return
    abs_path = os.path.abspath(path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, separators=(",", ":")) + "\n")


def format_training_status(
    progress_label,
    progress_rate,
    progress_threshold,
    timeout_rate,
    death_rate,
    avg_floor,
    progress_delta=None,
):
    bits = [f"{progress_label} {float(progress_rate):.1%}"]

    if progress_threshold is not None:
        gap = float(progress_threshold) - float(progress_rate)
        if gap <= 0:
            bits.append("on target")
        else:
            bits.append(f"{gap * 100:.1f} pts below target")

    if progress_delta is not None and abs(progress_delta) >= 0.005:
        if progress_delta > 0:
            bits.append(f"improving (+{progress_delta * 100:.1f} pts)")
        else:
            bits.append(f"slipping ({progress_delta * 100:.1f} pts)")

    if timeout_rate >= 0.40:
        bits.append("timeouts high")

    if death_rate >= 0.20:
        bits.append("deaths high")

    return "  Status: " + " | ".join(bits)


def _format_action_ratio(count, total):
    ratio = 100.0 * count / max(total, 1)
    return f"{ratio:.1f}%" if ratio < 1.0 else f"{ratio:.0f}%"


def main():
    args = parse_args()
    from async_trainer import assert_rollout_staleness, normalize_trainer_mode

    trainer_mode = normalize_trainer_mode(args.trainer_mode)
    if args.device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(args.device)

    model_kwargs = dict(MODEL_VARIANTS[args.model_variant])
    if args.hidden_dim is not None:
        model_kwargs["hidden_dim"] = args.hidden_dim
    model = DelveNet(
        state_dim=STATE_DIM, action_dim=ACTION_DIM, **model_kwargs
    ).to(device)
    config = build_ppo_config(args)
    ppo = PPO(model, config, device)
    buffer = RolloutBuffer(
        args.num_envs,
        args.rollout_steps,
        STATE_DIM,
        ACTION_DIM,
        model.hidden_dim,
        device=device,
    )

    resume_path, resume_step = resolve_resume_checkpoint(
        args.resume, args.checkpoint_dir
    )
    total_steps = 0
    checkpoint = None
    if resume_path:
        checkpoint = torch.load(resume_path, map_location=device)
        total_steps = int(checkpoint.get("total_steps") or resume_step or 0)
        
        remaining_steps = max(0, args.total_timesteps - total_steps)
        steps_per_update = args.num_envs * args.rollout_steps
        remaining_updates = max(1, remaining_steps // steps_per_update)
        
        checkpoint = ppo.load(
            checkpoint,
            load_optimizer=not args.reset_optimizer,
            override_lr=config['lr'] if args.learning_rate is not None else None,
            remaining_updates=remaining_updates
        )
    run_start_steps = total_steps

    # TensorBoard
    writer = None
    if should_use_tensorboard(args):
        writer = SummaryWriter(args.tensorboard_logdir)

    os.makedirs(args.checkpoint_dir, exist_ok=True)
    metrics_log_path = (args.metrics_log or "").strip()

    print()
    print("=" * 60)
    print("  DELVE RL Training Monitor")
    print("=" * 60)
    print(f"  Device:       {device}")
    print(f"  Network:      {model.count_parameters():,} params")
    print(f"  Model:        {args.model_variant} (hidden={model.hidden_dim})")
    print(
        f"  Envs:         {args.num_envs} ({args.envs_per_worker}/worker, {(args.num_envs + args.envs_per_worker - 1) // args.envs_per_worker} workers)"
    )
    print(f"  Rollout:      {args.rollout_steps} steps/env")
    print(f"  Batch size:   {args.batch_size}")
    print(f"  LR/Entropy:   {config['lr']:.2g} / {config['entropy_coeff']:.3g}")
    print(f"  Total steps:  {args.total_timesteps:,}")
    print(f"  Episode cap:  {format_episode_cap(args.max_episode_steps)}")
    print(f"  Observations: {args.observation_mode}")
    print(f"  Transport:    {args.transport_mode}")
    trainer_display = (
        trainer_mode
        if trainer_mode == args.trainer_mode
        else f"{trainer_mode} ({args.trainer_mode} alias)"
    )
    print(f"  Trainer:      {trainer_display}")
    print(f"  Resume:       {resume_path or 'No'}")
    print(f"  Optimizer:    {'Reset' if args.reset_optimizer else 'Checkpoint'}")
    tensorboard_hint = (
        f"tensorboard --logdir={args.tensorboard_logdir}" if writer else "disabled"
    )
    print(f"  TensorBoard:  {'Yes' if writer else 'No'} ({tensorboard_hint})")
    print(f"  Checkpoints:  {args.checkpoint_dir}/delve_ppo_<step>.pt")
    print("=" * 60)
    print()

    start_time = time.time()
    stage_seconds = defaultdict(float)

    saved_phase = None if checkpoint is None else checkpoint.get("curriculum_phase")
    saved_steps_in_phase = (
        None if checkpoint is None else checkpoint.get("steps_in_phase")
    )
    if saved_phase is None:
        curriculum_phase, steps_in_phase = curriculum_phase_for_step(
            total_steps, CURRICULUM
        )
    else:
        curriculum_phase = min(max(int(saved_phase), 0), max(len(CURRICULUM) - 1, 0))
        steps_in_phase = max(int(saved_steps_in_phase or 0), 0)
    active_phase = (
        CURRICULUM[curriculum_phase]
        if CURRICULUM
        else {"name": "full", "max_floor": FLOORS}
    )
    curriculum_max_floor = active_phase.get("max_floor")
    curriculum_hard_mode = active_phase.get("hard_mode", False)
    # CLI override: --curriculum-max-floor overrides the CURRICULUM config phase value.
    if getattr(args, "curriculum_max_floor", None) is not None:
        curriculum_max_floor = args.curriculum_max_floor
    next_save = ((total_steps // args.save_every) + 1) * args.save_every
    phase_budget = int(active_phase.get("steps", 0))
    phase_budget_warned = False
    episode_window = new_episode_window()
    last_report_snapshot = None
    from vector_env import SubprocVecEnv

    env = SubprocVecEnv(
        num_envs=args.num_envs,
        envs_per_worker=args.envs_per_worker,
        max_episode_steps=args.max_episode_steps,
        timeout_penalty=args.timeout_penalty,
        curriculum_max_floor=curriculum_max_floor,
        curriculum_hard_mode=curriculum_hard_mode,
        observation_mode=args.observation_mode,
        transport_mode=args.transport_mode,
    )
    np_states, np_maps, np_masks = env.reset()
    rollout_transfer = allocate_rollout_transfer_tensors(
        np_states,
        np_maps,
        np_masks,
        device,
    )
    rollout_buffers = [buffer]
    rollout_transfers = [rollout_transfer]
    actor_model = model
    async_executor = None
    async_future = None
    learner_version = 0
    next_async_buffer_index = 1
    hidden = None
    if trainer_mode == "async-one-stale":
        actor_model = DelveNet(
            state_dim=STATE_DIM,
            action_dim=ACTION_DIM,
            **model_kwargs,
        ).to(device)
        actor_model.load_state_dict(model.state_dict())
        actor_model.eval()
        rollout_buffers.append(
            RolloutBuffer(
                args.num_envs,
                args.rollout_steps,
                STATE_DIM,
                ACTION_DIM,
                model.hidden_dim,
                device=device,
            )
        )
        rollout_transfers.append(
            allocate_rollout_transfer_tensors(
                np_states,
                np_maps,
                np_masks,
                device,
            )
        )
        async_executor = ThreadPoolExecutor(max_workers=1)
    print(
        f"=== Training Goal: {active_phase.get('name')} ({curriculum_phase_target(active_phase)}) ==="
    )
    print("  Read guide: class-avg is the recent per-class success rate.")

    try:
        while total_steps < args.total_timesteps:
            prefetched_result = None
            if async_future is not None:
                stage_t0 = time.perf_counter()
                prefetched_result = async_future.result()
                stage_seconds["collect_wait"] += time.perf_counter() - stage_t0
                assert_rollout_staleness(
                    prefetched_result.policy_version,
                    learner_version,
                    max_staleness=1,
                )
                async_future = None

            if curriculum_phase < len(CURRICULUM) - 1 and curriculum_should_advance(
                active_phase, episode_window, steps_in_phase
            ):
                curriculum_phase += 1
                steps_in_phase = 0
                active_phase = CURRICULUM[curriculum_phase]
                curriculum_max_floor = active_phase.get("max_floor")
                curriculum_hard_mode = active_phase.get("hard_mode", False)
                phase_budget = int(active_phase.get("steps", 0))
                phase_budget_warned = False
                episode_window = new_episode_window()
                env.set_curriculum(curriculum_max_floor, curriculum_hard_mode)
                print(
                    f"\n=== Training Goal: {active_phase.get('name')} ({curriculum_phase_target(active_phase)}) ==="
                )
            elif (
                curriculum_phase < len(CURRICULUM) - 1
                and phase_budget > 0
                and steps_in_phase >= phase_budget
                and not phase_budget_warned
            ):
                progress_label = curriculum_metric_label(active_phase)
                threshold = float(active_phase.get("success_threshold", 0.0))
                rate_raw, rate_class_avg = episode_rate_stats(
                    episode_window, "curriculum"
                )
                print(
                    f"  Phase budget reached for {active_phase.get('name')} without mastery; "
                    f"holding at {progress_label} class-avg {rate_class_avg:.1%} "
                    f"(raw {rate_raw:.1%}) until it reaches {threshold:.0%}."
                )
                phase_budget_warned = True

            # Collect rollout from real game environments.
            if prefetched_result is None:
                stage_t0 = time.perf_counter()
                result = collect_rollout_batch(
                    env=env,
                    model=actor_model,
                    buffer=rollout_buffers[0],
                    transfer=rollout_transfers[0],
                    np_states=np_states,
                    np_maps=np_maps,
                    np_masks=np_masks,
                    hidden=hidden,
                    args=args,
                    device=device,
                    policy_version=learner_version,
                )
                stage_seconds["collect"] += time.perf_counter() - stage_t0
            else:
                result = prefetched_result
            np_states = result.np_states
            np_maps = result.np_maps
            np_masks = result.np_masks
            hidden = result.hidden
            action_counts = result.action_counts
            probe_accumulator = result.probe_accumulator
            total_steps += result.steps_collected
            steps_in_phase += result.steps_collected
            for episode_info in result.episode_infos:
                record_episode(episode_window, episode_info)

            # Update policy.
            last_states, last_maps, last_masks = prepare_bootstrap_tensors(result)
            if trainer_mode == "async-one-stale" and total_steps < args.total_timesteps:
                progress_key_for_weights = (
                    "wins" if active_phase.get("max_floor") is None else "curriculum"
                )
                env.set_class_weights(
                    calculate_dynamic_weights(episode_window, progress_key_for_weights)
                )
                actor_model.load_state_dict(model.state_dict())
                actor_model.eval()
                actor_version = learner_version
                launch_index = next_async_buffer_index
                next_async_buffer_index = 1 - next_async_buffer_index
                async_future = async_executor.submit(
                    collect_rollout_batch,
                    env=env,
                    model=actor_model,
                    buffer=rollout_buffers[launch_index],
                    transfer=rollout_transfers[launch_index],
                    np_states=np_states,
                    np_maps=np_maps,
                    np_masks=np_masks,
                    hidden=hidden,
                    args=args,
                    device=device,
                    policy_version=actor_version,
                )
            stage_t0 = time.perf_counter()
            info = ppo.update(result.buffer, last_states, last_maps, last_masks, hidden)
            stage_seconds["learner"] += time.perf_counter() - stage_t0
            if trainer_mode == "async-one-stale":
                learner_version += 1

            # Logging.
            elapsed = time.time() - start_time
            if len(episode_window["rewards"]) > 0:
                recent_rewards = list(episode_window["rewards"])
                recent_lengths = list(episode_window["lengths"])
                recent_wins = list(episode_window["wins"])
                recent_floors = list(episode_window["floors"])
                recent_outcomes = list(episode_window["outcomes"])
                win_rate = sum(1 for won in recent_wins if won) / len(recent_wins)
                progress_key = (
                    "wins" if active_phase.get("max_floor") is None else "curriculum"
                )
                progress_raw_rate, progress_class_avg_rate = episode_rate_stats(
                    episode_window, progress_key
                )

                # Push dynamic class weights to environments
                dyn_weights = calculate_dynamic_weights(episode_window, progress_key)
                if trainer_mode != "async-one-stale":
                    env.set_class_weights(dyn_weights)

                progress_rate = progress_class_avg_rate
                timeout_rate = sum(
                    1 for outcome in recent_outcomes if outcome == "timeout"
                ) / len(recent_outcomes)
                death_rate = sum(
                    1 for outcome in recent_outcomes if outcome == "dead"
                ) / len(recent_outcomes)
                avg_reward = np.mean(recent_rewards)
                avg_length = np.mean(recent_lengths)
                avg_floor = np.mean(recent_floors)
                progress_label = curriculum_metric_label(active_phase)
                progress_delta = (
                    None
                    if last_report_snapshot is None
                    else progress_rate
                    - last_report_snapshot.get("progress_rate", progress_rate)
                )

                print(
                    f"Step {total_steps:>10,} | "
                    f"{progress_label}: {progress_rate:.1%} | "
                    f"Avg Floor {avg_floor:.2f} | "
                    f"Death {death_rate:.1%} | "
                    f"Timeout {timeout_rate:.1%} | "
                    f"Loss P {info['policy_loss']:.4f} / V {info['value_loss']:.4f} | "
                    f"Time {elapsed:.0f}s"
                )

                report_snapshot = {
                    "progress_rate": progress_rate,
                    "avg_floor": avg_floor,
                    "timeout_rate": timeout_rate,
                    "death_rate": death_rate,
                }
                threshold = active_phase.get("success_threshold")
                readout = format_training_status(
                    progress_label,
                    progress_rate,
                    threshold,
                    timeout_rate,
                    death_rate,
                    avg_floor,
                    progress_delta=progress_delta,
                )
                if readout:
                    print(f"  {readout}")
                append_jsonl_record(
                    metrics_log_path,
                    build_training_metrics_row(
                        total_steps=total_steps,
                        run_start_steps=run_start_steps,
                        elapsed=elapsed,
                        phase_index=curriculum_phase,
                        phase_name=active_phase.get("name", "unknown"),
                        progress_label=progress_label,
                        progress_rate=progress_rate,
                        progress_raw_rate=progress_raw_rate,
                        progress_delta=progress_delta,
                        win_rate=win_rate,
                        avg_reward=avg_reward,
                        avg_length=avg_length,
                        avg_floor=avg_floor,
                        timeout_rate=timeout_rate,
                        death_rate=death_rate,
                        policy_loss=info["policy_loss"],
                        value_loss=info["value_loss"],
                        entropy=info["entropy"],
                        action_counts=action_counts,
                        episode_window=episode_window,
                        progress_key=progress_key,
                        status_text=readout,
                        probe_metrics=finalize_probe_metrics(probe_accumulator),
                        stage_seconds=stage_seconds,
                    ),
                )
                last_report_snapshot = report_snapshot

                if writer:
                    writer.add_scalar("train/win_rate", win_rate, total_steps)
                    if active_phase.get("max_floor") is not None:
                        writer.add_scalar(
                            "train/curriculum_success_rate_raw",
                            progress_raw_rate,
                            total_steps,
                        )
                        writer.add_scalar(
                            "train/curriculum_success_rate_class_avg",
                            progress_class_avg_rate,
                            total_steps,
                        )
                    else:
                        writer.add_scalar(
                            "train/win_rate_raw", progress_raw_rate, total_steps
                        )
                        writer.add_scalar(
                            "train/win_rate_class_avg",
                            progress_class_avg_rate,
                            total_steps,
                        )
                    writer.add_scalar("train/avg_reward", avg_reward, total_steps)
                    writer.add_scalar("train/avg_length", avg_length, total_steps)
                    writer.add_scalar("train/avg_floor", avg_floor, total_steps)
                    writer.add_scalar("train/timeout_rate", timeout_rate, total_steps)
                    writer.add_scalar("train/death_rate", death_rate, total_steps)
                    writer.add_scalar(
                        "train/policy_loss", info["policy_loss"], total_steps
                    )
                    writer.add_scalar(
                        "train/value_loss", info["value_loss"], total_steps
                    )
            else:
                print(
                    f"Step {total_steps:>10,} | "
                    f"Policy Loss: {info['policy_loss']:.4f} | "
                    f"Value Loss: {info['value_loss']:.4f} | "
                    f"Time: {elapsed:.0f}s"
                )

            if total_steps >= next_save:
                path = os.path.join(args.checkpoint_dir, f"delve_ppo_{total_steps}.pt")
                ppo.save(
                    path,
                    total_steps=total_steps,
                    config=config,
                    curriculum_phase=curriculum_phase,
                    steps_in_phase=steps_in_phase,
                )
                print(f"  Saved: {path}")
                append_jsonl_record(
                    metrics_log_path,
                    {
                        "event": "checkpoint",
                        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "total_steps": int(total_steps),
                        "path": path,
                    },
                )
                next_save += args.save_every

        final_path = os.path.join(args.checkpoint_dir, "delve_ppo_final.pt")
        ppo.save(
            final_path,
            total_steps=total_steps,
            config=config,
            curriculum_phase=curriculum_phase,
            steps_in_phase=steps_in_phase,
        )
        print(f"Training complete! Saved: {final_path}")
    except KeyboardInterrupt:
        if total_steps > 0:
            path = os.path.join(args.checkpoint_dir, f"delve_ppo_{total_steps}.pt")
            ppo.save(
                path,
                total_steps=total_steps,
                config=config,
                interrupted=True,
                curriculum_phase=curriculum_phase,
                steps_in_phase=steps_in_phase,
            )
            print(f"\nInterrupted. Saved checkpoint: {path}")
        else:
            print("\nInterrupted before any training steps were collected.")
    finally:
        if async_executor is not None:
            async_executor.shutdown(wait=True, cancel_futures=True)
        env.close()
        if writer:
            writer.close()


if __name__ == "__main__":
    main()

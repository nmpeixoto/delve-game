#!/usr/bin/env python3
"""
DELVE RL Training Script — PPO with vectorized environments.
Uses the existing headless_balance.js VM infrastructure directly.
"""
import argparse
from collections import defaultdict, deque
import glob
import os, sys, time, json
import re
import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import *
from network import DelveNet
from policy_probe import evaluate_policy_probe
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
        'node', os.path.join(os.path.dirname(__file__), '..', 'headless-balance', 'headless_balance.js'),
        '--classes', ','.join(config['classList']),
        '--per-class', str(config['perClass']),
        '--seed-base', str(config['seedBase']),
        '--max-turns', str(config['maxTurns']),
        '--output', config['outputPath'],
    ]
    result = subprocess.run(args, capture_output=True, text=True, cwd=os.path.join(os.path.dirname(__file__), '..', '..'))
    # Load results from output file
    with open(config['outputPath']) as f:
        report = json.load(f)
    return report


def evaluate_headless(agent, num_games=100, device='cuda'):
    """Evaluate using headless_balance.js runner."""
    import subprocess, json, tempfile
    config_path = os.path.join(os.path.dirname(__file__), '..', 'strategy_config.json')
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tmp:
        tmp_path = tmp.name
    
    args = [
        'node', os.path.join(os.path.dirname(__file__), '..', 'headless-balance', 'headless_balance.js'),
        '--classes', ','.join(CLASSES),
        '--per-class', str(num_games // 8),
        '--seed-base', '1',
        '--max-turns', '5000',
        '--output', tmp_path,
    ]
    
    try:
        result = subprocess.run(args, capture_output=True, text=True, 
                              cwd=os.path.join(os.path.dirname(__file__), '..', '..'),
                              timeout=300)
        
        with open(tmp_path) as f:
            report = json.load(f)
        
        overall = report.get('overall', {})
        by_class = report.get('byClass', {})
        
        return {
            'win_rate': overall.get('winRate', 0),
            'avg_floor': overall.get('avgFloor', 0),
            'games': overall.get('runs', 0),
            'by_class': {k: v.get('winRate', 0) for k, v in by_class.items()},
        }
    finally:
        try:
            os.unlink(tmp_path)
        except:
            pass


def parse_args():
    parser = argparse.ArgumentParser(description="Train the DELVE PPO bot against the real headless game runner.")
    parser.add_argument("--total-timesteps", type=int, default=TOTAL_TIMESTEPS)
    parser.add_argument("--num-envs", type=int, default=NUM_ENVS)
    parser.add_argument("--envs-per-worker", type=int, default=ENVS_PER_WORKER)
    parser.add_argument("--rollout-steps", type=int, default=ROLLOUT_STEPS)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--checkpoint-dir", default="checkpoints")
    parser.add_argument("--save-every", type=int, default=SAVE_EVERY)
    parser.add_argument("--probe-every", type=int, default=PROBE_EVERY)
    parser.add_argument("--resume", nargs="?", const="latest", default=None,
                        help="Resume from a checkpoint path, or use latest checkpoint when passed without a value.")
    parser.add_argument("--reset-optimizer", action="store_true",
                        help="Load model weights from --resume but start optimizer and LR schedule fresh.")
    parser.add_argument("--max-episode-steps", type=int, default=20000)
    parser.add_argument("--timeout-penalty", type=float, default=-400.0)
    parser.add_argument("--no-tensorboard", action="store_true")
    return parser.parse_args()


def extract_local_map(G):
    """Extract 8x8 local map around the player as a (6, 8, 8) tensor."""
    p = G.get('player', {})
    px, py = p.get('x', 0), p.get('y', 0)
    map_data = G.get('map', [])
    seen = G.get('seen', set())
    enemies = G.get('enemies', [])
    items = G.get('items', [])
    channels = np.zeros((6, 8, 8), dtype=np.float32)
    
    for dy in range(-4, 4):
        for dx in range(-4, 4):
            x, y = px + dx, py + dy
            if 0 <= y < len(map_data) and 0 <= x < len(map_data[0]):
                tile = map_data[y][x]
                channels[0, dy + 4, dx + 4] = 1.0 if tile in (1, 2, 3) else 0.0  # passable
                channels[1, dy + 4, dx + 4] = 1.0 if (y * MAP_W + x) in seen else 0.0
                channels[2, dy + 4, dx + 4] = 1.0 if any(e.get('x') == x and e.get('y') == y and not e.get('dying') for e in enemies) else 0.0
                channels[3, dy + 4, dx + 4] = 1.0 if any(i.get('x') == x and i.get('y') == y and not i.get('carried') for i in items) else 0.0
                channels[4, dy + 4, dx + 4] = 1.0 if 0 <= y < len(map_data) and 0 <= x < len(map_data[0]) and map_data[y][x] == 2 else 0.0
                channels[5, dy + 4, dx + 4] = 1.0 if 0 <= y < len(map_data) and 0 <= x < len(map_data[0]) and map_data[y][x] == 4 else 0.0
    return channels


def tensorize_states(states, device, prev_actions=None):
    return torch.from_numpy(
        np.stack([extract_state(s, pa) for s, pa in zip(states, prev_actions or [None] * len(states))]).astype(np.float32, copy=False)
    ).to(device)


def tensorize_maps(states, device):
    return torch.from_numpy(
        np.stack([extract_local_map(s) for s in states]).astype(np.float32, copy=False)
    ).to(device)


CHECKPOINT_RE = re.compile(r"delve_ppo_(\d+)\.pt$")
LOG_WINDOW_EPISODES = 100


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
            raise FileNotFoundError(f"No numbered DELVE PPO checkpoints found in {checkpoint_dir}")
        step, path = max(candidates, key=lambda item: item[0])
        return path, step

    path = resume if os.path.isabs(resume) else os.path.abspath(resume)
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return path, checkpoint_step_from_path(path)


def curriculum_phase_for_step(total_steps, curriculum):
    steps_remaining = total_steps
    for index, phase in enumerate(curriculum):
        phase_steps = int(phase.get('steps', 0))
        if steps_remaining < phase_steps or index == len(curriculum) - 1:
            return index, max(steps_remaining, 0)
        steps_remaining -= phase_steps
    return max(len(curriculum) - 1, 0), 0


def curriculum_metric_label(phase):
    max_floor = phase.get('max_floor') if phase else None
    if max_floor is None:
        return "Full Win"
    return f"Floor {int(max_floor) + 1}"


def curriculum_phase_target(phase):
    if not phase:
        return "full dungeon clear"
    label = curriculum_metric_label(phase)
    threshold = phase.get('success_threshold')
    window = int(phase.get('success_window', LOG_WINDOW_EPISODES))
    if phase.get('max_floor') is None or threshold is None:
        return "full dungeon clear"
    return f"reach {label} at {float(threshold):.0%} over {window} episodes"


def curriculum_should_advance(phase, curriculum_results, steps_in_phase):
    if not phase or phase.get('max_floor') is None:
        return False

    min_steps = int(phase.get('min_steps', 0))
    window = int(phase.get('success_window', LOG_WINDOW_EPISODES))
    threshold = phase.get('success_threshold')
    if threshold is None or steps_in_phase < min_steps:
        return False

    if isinstance(curriculum_results, dict):
        recent = curriculum_results.get('curriculum', [])
        if len(recent) < window:
            return False
        _, success_rate = episode_rate_stats(curriculum_results, 'curriculum')
    else:
        recent = list(curriculum_results)[-window:]
        if len(recent) < window:
            return False
        success_rate = sum(1 for success in recent if success) / len(recent)

    return success_rate >= float(threshold)


def new_episode_window(window=LOG_WINDOW_EPISODES):
    return {
        'rewards': deque(maxlen=window),
        'lengths': deque(maxlen=window),
        'wins': deque(maxlen=window),
        'floors': deque(maxlen=window),
        'outcomes': deque(maxlen=window),
        'curriculum': deque(maxlen=window),
        'classes': deque(maxlen=window),
    }


def record_episode(window, info):
    window['rewards'].append(info.get('total_reward', 0.0))
    window['lengths'].append(info.get('total_steps', 0))
    window['wins'].append(bool(info.get('won', False)))
    window['floors'].append(info.get('final_floor', 0))
    window['outcomes'].append(info.get('outcome', 'done'))
    window['curriculum'].append(bool(info.get('curriculum_success', False)))
    class_name = info.get('class_name')
    if not class_name:
        terminal_state = info.get('terminal_state') or {}
        class_name = terminal_state.get('player', {}).get('class')
    window['classes'].append(class_name or 'unknown')


def episode_rate_stats(window, key):
    values = list(window.get(key, []))
    if not values:
        return 0.0, 0.0

    raw_rate = sum(1 for value in values if value) / len(values)
    class_values = defaultdict(list)
    for class_name, value in zip(window.get('classes', []), values):
        if not class_name or class_name == 'unknown':
            continue
        class_values[class_name].append(bool(value))

    if not class_values:
        return raw_rate, raw_rate

    class_rates = [sum(values_for_class) / len(values_for_class) for values_for_class in class_values.values()]
    return raw_rate, sum(class_rates) / len(class_rates)


def episode_class_summary(window, key):
    values = list(window.get(key, []))
    if not values:
        return "Class counts: none"

    class_values = defaultdict(list)
    for class_name, value in zip(window.get('classes', []), values):
        if not class_name or class_name == 'unknown':
            continue
        class_values[class_name].append(bool(value))

    if not class_values:
        return "Class counts: none"

    parts = []
    ordered_names = [name for name in CLASS_NAMES if name in class_values]
    ordered_names.extend(sorted(name for name in class_values if name not in CLASS_NAMES))
    for class_name in ordered_names:
        class_results = class_values[class_name]
        total = len(class_results)
        if total == 0:
            continue
        successes = sum(1 for value in class_results if value)
        parts.append(f"{class_name} {successes}/{total} ({successes / total:.0%})")

    return "Class counts: " + ", ".join(parts) if parts else "Class counts: none"


def summarize_actions(action_counts):
    total = int(action_counts.sum())
    if total == 0:
        return "Actions: none"
    names = [
        "Up", "Down", "Left", "Right", "Atk1", "Atk2", "Ab1", "Ab2", "Pot", "Buff",
        "Bomb", "Tele", "Detect", "Desc", "Shop", "Buy", "Sell", "Esc",
    ]
    top = list(np.argsort(action_counts)[-3:][::-1])
    descend_idx = ACTIONS['DESCEND']
    if descend_idx not in top:
        top.append(descend_idx)
    return "Actions: " + ", ".join(f"{names[i]} {_format_action_ratio(action_counts[i], total)}" for i in top)


def format_training_status(progress_label, progress_rate, progress_threshold,
                           timeout_rate, death_rate, avg_floor,
                           progress_delta=None, probe_metrics=None):
    if progress_threshold is None:
        target_bits = ["full-win phase"]
    else:
        gap = float(progress_threshold) - float(progress_rate)
        target_bits = [
            f"{progress_label} {progress_rate:.1%}",
            "on target" if gap <= 0 else f"{gap * 100:.1f} pts below target",
        ]

    change_bits = []
    if progress_delta is not None:
        if abs(progress_delta) < 0.005:
            change_bits.append("flat")
        elif progress_delta > 0:
            change_bits.append(f"improving (+{progress_delta * 100:.1f} pts)")
        else:
            change_bits.append(f"slipping ({progress_delta * 100:.1f} pts)")

    issue_bits = []
    if timeout_rate >= 0.65:
        issue_bits.append("timeouts high")
    elif timeout_rate >= 0.40:
        issue_bits.append("timeouts common")

    if death_rate >= 0.20:
        issue_bits.append("deaths high")

    if avg_floor < 2.0:
        issue_bits.append("avg floor low")

    if probe_metrics:
        directional_exact_rate = float(probe_metrics.get("directional_exact_rate", 0.0))
        descend_prob = float(probe_metrics.get("descend_prob_on_stairs", 0.0))
        if directional_exact_rate <= 0.30:
            issue_bits.append("stairs still random")
        elif directional_exact_rate >= 0.50:
            issue_bits.append("stairs learning visible")
        if descend_prob >= 0.90:
            issue_bits.append("descend learned")

    bits = target_bits + change_bits + issue_bits
    return "Status: " + "; ".join(bits) + "."


def _format_action_ratio(count, total):
    ratio = 100.0 * count / max(total, 1)
    return f"{ratio:.1f}%" if ratio < 1.0 else f"{ratio:.0f}%"


def run_policy_probe(model, device, writer=None, total_steps=None):
    probe = evaluate_policy_probe(model, device, class_names=CLASS_NAMES)
    if writer and total_steps is not None:
        for name, value in probe['metrics'].items():
            writer.add_scalar(f'probe/{name}', value, total_steps)
    print(f"  {probe['summary']}")
    return probe


def main():
    args = parse_args()
    if args.device == "auto":
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    else:
        device = torch.device(args.device)
    
    model = DelveNet(state_dim=STATE_DIM, action_dim=ACTION_DIM, hidden_dim=HIDDEN_DIM).to(device)
    config = {
        'lr': LR, 'gamma': GAMMA, 'lam': LAM, 'clip_eps': CLIP_EPS,
        'entropy_coeff': ENTROPY_COEFF, 'value_coeff': VALUE_COEFF,
        'max_grad_norm': MAX_GRAD_NORM, 'epochs_per_update': EPOCHS_PER_UPDATE,
        'batch_size': args.batch_size, 'num_envs': args.num_envs,
        'rollout_steps': args.rollout_steps, 'lr_start': LR_START, 'lr_end': LR_END,
        'lr_decay_steps': LR_DECAY_STEPS,
    }
    ppo = PPO(model, config, device)
    buffer = RolloutBuffer(args.num_envs, args.rollout_steps, STATE_DIM, ACTION_DIM, model.GRU_HIDDEN, device=device)

    resume_path, resume_step = resolve_resume_checkpoint(args.resume, args.checkpoint_dir)
    total_steps = 0
    checkpoint = None
    if resume_path:
        checkpoint = ppo.load(resume_path, load_optimizer=not args.reset_optimizer)
        total_steps = int(checkpoint.get('total_steps') or resume_step or 0)
    
    # TensorBoard
    writer = None
    if HAS_TB and not args.no_tensorboard:
        writer = SummaryWriter('runs/delve_ppo')
    
    os.makedirs(args.checkpoint_dir, exist_ok=True)
    
    print()
    print("=" * 60)
    print("  DELVE RL Training Monitor")
    print("=" * 60)
    print(f"  Device:       {device}")
    print(f"  Network:      {model.count_parameters():,} params")
    print(f"  Envs:         {args.num_envs} ({args.envs_per_worker}/worker, {(args.num_envs + args.envs_per_worker - 1) // args.envs_per_worker} workers)")
    print(f"  Rollout:      {args.rollout_steps} steps/env")
    print(f"  Batch size:   {args.batch_size}")
    print(f"  Total steps:  {args.total_timesteps:,}")
    print(f"  Episode cap:  {args.max_episode_steps:,} steps")
    print(f"  Resume:       {resume_path or 'No'}")
    print(f"  Optimizer:    {'Reset' if args.reset_optimizer else 'Checkpoint'}")
    print(f"  Probe every:  {args.probe_every:,} steps" if args.probe_every > 0 else "  Probe every:  Disabled")
    print(f"  TensorBoard:  {'Yes' if writer else 'No'} (tensorboard --logdir=runs)")
    print(f"  Checkpoints:  {args.checkpoint_dir}/delve_ppo_<step>.pt")
    print("=" * 60)
    print()
    
    start_time = time.time()

    saved_phase = None if checkpoint is None else checkpoint.get('curriculum_phase')
    saved_steps_in_phase = None if checkpoint is None else checkpoint.get('steps_in_phase')
    if saved_phase is None:
        curriculum_phase, steps_in_phase = curriculum_phase_for_step(total_steps, CURRICULUM)
    else:
        curriculum_phase = min(max(int(saved_phase), 0), max(len(CURRICULUM) - 1, 0))
        steps_in_phase = max(int(saved_steps_in_phase or 0), 0)
    active_phase = CURRICULUM[curriculum_phase] if CURRICULUM else {'name': 'full', 'max_floor': FLOORS}
    curriculum_max_floor = active_phase.get('max_floor')
    next_save = ((total_steps // args.save_every) + 1) * args.save_every
    next_probe = None if args.probe_every <= 0 else ((total_steps // args.probe_every) + 1) * args.probe_every
    phase_budget = int(active_phase.get('steps', 0))
    phase_budget_warned = False
    episode_window = new_episode_window()
    latest_probe_metrics = None
    last_report_snapshot = None
    env = DelveVectorEnv(
        num_envs=args.num_envs,
        envs_per_worker=args.envs_per_worker,
        max_episode_steps=args.max_episode_steps,
        timeout_penalty=args.timeout_penalty,
        curriculum_max_floor=curriculum_max_floor,
    )
    states = env.get_states()
    print(f"=== Curriculum Phase {curriculum_phase + 1}: {active_phase.get('name')} ({curriculum_phase_target(active_phase)}) ===")
    print("  Read guide: class-avg is the recent per-class success rate.")

    try:
        while total_steps < args.total_timesteps:
            if (
                curriculum_phase < len(CURRICULUM) - 1
                and curriculum_should_advance(active_phase, episode_window, steps_in_phase)
            ):
                curriculum_phase += 1
                steps_in_phase = 0
                active_phase = CURRICULUM[curriculum_phase]
                curriculum_max_floor = active_phase.get('max_floor')
                phase_budget = int(active_phase.get('steps', 0))
                phase_budget_warned = False
                episode_window = new_episode_window()
                env.set_curriculum_max_floor(curriculum_max_floor)
                print(f"\n=== Curriculum Phase {curriculum_phase + 1}: {active_phase.get('name')} ({curriculum_phase_target(active_phase)}) ===")
            elif (
                curriculum_phase < len(CURRICULUM) - 1
                and phase_budget > 0
                and steps_in_phase >= phase_budget
                and not phase_budget_warned
            ):
                progress_label = curriculum_metric_label(active_phase)
                threshold = float(active_phase.get('success_threshold', 0.0))
                rate_raw, rate_class_avg = episode_rate_stats(episode_window, 'curriculum')
                print(
                    f"  Phase budget reached for {active_phase.get('name')} without mastery; "
                    f"holding at {progress_label} class-avg {rate_class_avg:.1%} "
                    f"(raw {rate_raw:.1%}) until it reaches {threshold:.0%}."
                )
                phase_budget_warned = True

            # Collect rollout from real game environments.
            action_counts = np.zeros(ACTION_DIM, dtype=np.int64)
            prev_actions = [None] * args.num_envs
            hidden = None  # GRU hidden state, carried across steps
            for step in range(args.rollout_steps):
                state_tensor = tensorize_states(states, device, prev_actions)
                map_tensor = tensorize_maps(states, device)
                mask_tensor = torch.from_numpy(env.get_action_masks()).to(device=device, dtype=torch.bool)
                actions, log_probs, values, hidden = ppo.get_action(state_tensor, map_tensor, mask_tensor, hidden)
                action_counts += np.bincount(actions.cpu().numpy(), minlength=ACTION_DIM)

                next_states, rewards_np, dones_np, infos = env.step(actions.cpu().numpy())

                buffer.store(
                    step=step,
                    states=state_tensor,
                    maps=map_tensor,
                    actions=actions,
                    log_probs=log_probs,
                    values=values,
                    rewards=torch.from_numpy(rewards_np).to(device=device, dtype=torch.float32),
                    dones=torch.from_numpy(dones_np).to(device=device, dtype=torch.bool),
                    masks=mask_tensor,
                    hidden=hidden,
                )

                total_steps += args.num_envs
                steps_in_phase += args.num_envs
                states = next_states
                prev_actions = actions.cpu().tolist()

                # Reset hidden state for done environments
                if hidden is not None and dones_np.any():
                    done_mask = torch.from_numpy(dones_np).to(device=device, dtype=torch.bool).unsqueeze(0)
                    hidden = hidden.masked_fill(done_mask.unsqueeze(-1), 0.0)

                for i, done in enumerate(dones_np.tolist()):
                    if done:
                        record_episode(episode_window, infos[i])

            # Update policy.
            last_states = tensorize_states(states, device, prev_actions)
            last_maps = tensorize_maps(states, device)
            last_masks = torch.tensor(env.get_action_masks(), dtype=torch.bool, device=device)
            info = ppo.update(buffer, last_states, last_maps, last_masks, hidden)

            # Logging.
            elapsed = time.time() - start_time
            if len(episode_window['rewards']) > 0:
                recent_rewards = list(episode_window['rewards'])
                recent_lengths = list(episode_window['lengths'])
                recent_wins = list(episode_window['wins'])
                recent_floors = list(episode_window['floors'])
                recent_outcomes = list(episode_window['outcomes'])
                win_rate = sum(1 for won in recent_wins if won) / len(recent_wins)
                progress_key = 'wins' if active_phase.get('max_floor') is None else 'curriculum'
                progress_raw_rate, progress_class_avg_rate = episode_rate_stats(episode_window, progress_key)
                progress_rate = progress_class_avg_rate
                timeout_rate = sum(1 for outcome in recent_outcomes if outcome == 'timeout') / len(recent_outcomes)
                death_rate = sum(1 for outcome in recent_outcomes if outcome == 'dead') / len(recent_outcomes)
                avg_reward = np.mean(recent_rewards)
                avg_length = np.mean(recent_lengths)
                avg_floor = np.mean(recent_floors)
                progress_label = curriculum_metric_label(active_phase)
                progress_delta = None if last_report_snapshot is None else progress_rate - last_report_snapshot.get('progress_rate', progress_rate)

                print(f"Step {total_steps:>10,} | "
                      f"{progress_label}: {progress_rate:.1%} (raw {progress_raw_rate:.1%}) | "
                      f"Avg Floor {avg_floor:.2f} | "
                      f"Death {death_rate:.1%} | "
                      f"Timeout {timeout_rate:.1%} | "
                      f"Loss P {info['policy_loss']:.4f} / V {info['value_loss']:.4f} | "
                      f"Time {elapsed:.0f}s")

                report_snapshot = {
                    'progress_rate': progress_rate,
                    'avg_floor': avg_floor,
                    'timeout_rate': timeout_rate,
                    'death_rate': death_rate,
                }
                threshold = active_phase.get('success_threshold')
                readout = format_training_status(
                    progress_label,
                    progress_rate,
                    threshold,
                    timeout_rate,
                    death_rate,
                    avg_floor,
                    progress_delta=progress_delta,
                    probe_metrics=latest_probe_metrics,
                )
                print(f"  {readout}")
                last_report_snapshot = report_snapshot

                if writer:
                    writer.add_scalar('train/win_rate', win_rate, total_steps)
                    if active_phase.get('max_floor') is not None:
                        writer.add_scalar('train/curriculum_success_rate_raw', progress_raw_rate, total_steps)
                        writer.add_scalar('train/curriculum_success_rate_class_avg', progress_class_avg_rate, total_steps)
                    else:
                        writer.add_scalar('train/win_rate_raw', progress_raw_rate, total_steps)
                        writer.add_scalar('train/win_rate_class_avg', progress_class_avg_rate, total_steps)
                    writer.add_scalar('train/avg_reward', avg_reward, total_steps)
                    writer.add_scalar('train/avg_length', avg_length, total_steps)
                    writer.add_scalar('train/avg_floor', avg_floor, total_steps)
                    writer.add_scalar('train/timeout_rate', timeout_rate, total_steps)
                    writer.add_scalar('train/death_rate', death_rate, total_steps)
                    writer.add_scalar('train/policy_loss', info['policy_loss'], total_steps)
                    writer.add_scalar('train/value_loss', info['value_loss'], total_steps)
            else:
                print(f"Step {total_steps:>10,} | "
                      f"Policy Loss: {info['policy_loss']:.4f} | "
                      f"Value Loss: {info['value_loss']:.4f} | "
                      f"Time: {elapsed:.0f}s")

            if next_probe is not None and total_steps >= next_probe:
                probe = run_policy_probe(model, device, writer=writer, total_steps=total_steps)
                latest_probe_metrics = probe['metrics']
                next_probe += args.probe_every

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
                if next_probe is None:
                    probe = run_policy_probe(model, device, writer=writer, total_steps=total_steps)
                    latest_probe_metrics = probe['metrics']
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
        probe = run_policy_probe(model, device, writer=writer, total_steps=total_steps)
        latest_probe_metrics = probe['metrics']
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
            probe = run_policy_probe(model, device, writer=writer, total_steps=total_steps)
            latest_probe_metrics = probe['metrics']
        else:
            print("\nInterrupted before any training steps were collected.")
    finally:
        env.close()
        if writer:
            writer.close()


if __name__ == '__main__':
    main()

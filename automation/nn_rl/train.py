#!/usr/bin/env python3
"""
DELVE RL Training Script — PPO with vectorized environments.
Uses the existing headless_balance.js VM infrastructure directly.
"""
import argparse
import glob
import os, sys, time, json
import re
import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import *
from network import DelveNet
from ppo import PPO, RolloutBuffer
from state_extractor import extract_state
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
    parser.add_argument("--envs-per-worker", type=int, default=NUM_ENVS)
    parser.add_argument("--rollout-steps", type=int, default=ROLLOUT_STEPS)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--checkpoint-dir", default="checkpoints")
    parser.add_argument("--save-every", type=int, default=SAVE_EVERY)
    parser.add_argument("--resume", nargs="?", const="latest", default=None,
                        help="Resume from a checkpoint path, or use latest checkpoint when passed without a value.")
    parser.add_argument("--max-episode-steps", type=int, default=5000)
    parser.add_argument("--timeout-penalty", type=float, default=-250.0)
    parser.add_argument("--no-tensorboard", action="store_true")
    return parser.parse_args()


def tensorize_states(states, device):
    return torch.tensor(
        np.stack([extract_state(s) for s in states]),
        dtype=torch.float32,
        device=device,
    )


CHECKPOINT_RE = re.compile(r"delve_ppo_(\d+)\.pt$")


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


def summarize_actions(action_counts):
    total = int(action_counts.sum())
    if total == 0:
        return "Actions: none"
    names = [
        "Up", "Down", "Left", "Right", "Atk1", "Atk2", "Ab1", "Ab2", "Pot", "Buff",
        "Bomb", "Tele", "Detect", "Desc", "Shop", "Buy", "Sell", "Esc",
    ]
    top = np.argsort(action_counts)[-3:][::-1]
    return "Actions: " + ", ".join(f"{names[i]} {action_counts[i] / total:.0%}" for i in top)


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
    buffer = RolloutBuffer(args.num_envs, args.rollout_steps, STATE_DIM, ACTION_DIM)

    resume_path, resume_step = resolve_resume_checkpoint(args.resume, args.checkpoint_dir)
    total_steps = 0
    if resume_path:
        checkpoint = ppo.load(resume_path)
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
    print(f"  Envs:         {args.num_envs} ({args.envs_per_worker}/worker)")
    print(f"  Rollout:      {args.rollout_steps} steps/env")
    print(f"  Batch size:   {args.batch_size}")
    print(f"  Total steps:  {args.total_timesteps:,}")
    print(f"  Episode cap:  {args.max_episode_steps:,} steps")
    print(f"  Resume:       {resume_path or 'No'}")
    print(f"  TensorBoard:  {'Yes' if writer else 'No'} (tensorboard --logdir=runs)")
    print(f"  Checkpoints:  {args.checkpoint_dir}/delve_ppo_<step>.pt")
    print("=" * 60)
    print()
    
    episode_rewards = []
    episode_lengths = []
    episode_wins = []
    episode_floors = []
    episode_outcomes = []
    episode_curriculum = []
    action_counts = np.zeros(ACTION_DIM, dtype=np.int64)
    start_time = time.time()
    
    curriculum_phase, steps_in_phase = curriculum_phase_for_step(total_steps, CURRICULUM)
    active_phase = CURRICULUM[curriculum_phase] if CURRICULUM else {'name': 'full', 'max_floor': FLOORS}
    curriculum_max_floor = active_phase.get('max_floor')
    next_save = ((total_steps // args.save_every) + 1) * args.save_every
    env = DelveVectorEnv(
        num_envs=args.num_envs,
        envs_per_worker=args.envs_per_worker,
        max_episode_steps=args.max_episode_steps,
        timeout_penalty=args.timeout_penalty,
        curriculum_max_floor=curriculum_max_floor,
    )
    states = env.get_states()
    print(f"=== Curriculum Phase {curriculum_phase + 1}: {active_phase.get('name')} (clear floor {curriculum_max_floor}) ===")

    try:
        while total_steps < args.total_timesteps:
            next_phase, next_steps_in_phase = curriculum_phase_for_step(total_steps, CURRICULUM)
            if next_phase != curriculum_phase:
                curriculum_phase = next_phase
                steps_in_phase = next_steps_in_phase
                active_phase = CURRICULUM[curriculum_phase]
                curriculum_max_floor = active_phase.get('max_floor')
                env.set_curriculum_max_floor(curriculum_max_floor)
                print(f"\n=== Curriculum Phase {curriculum_phase + 1}: {active_phase.get('name')} (clear floor {curriculum_max_floor}) ===")

            # Collect rollout from real game environments.
            for step in range(args.rollout_steps):
                state_tensor = tensorize_states(states, device)
                mask_tensor = torch.tensor(env.get_action_masks(), dtype=torch.bool, device=device)
                actions, log_probs, values = ppo.get_action(state_tensor, mask_tensor)
                action_counts += np.bincount(actions.cpu().numpy(), minlength=ACTION_DIM)

                next_states, rewards_np, dones_np, infos = env.step(actions.cpu().numpy())

                buffer.store(
                    step=step,
                    states=state_tensor.cpu(),
                    actions=actions.cpu(),
                    log_probs=log_probs.cpu(),
                    values=values.cpu(),
                    rewards=torch.tensor(rewards_np, dtype=torch.float32),
                    dones=torch.tensor(dones_np, dtype=torch.bool),
                    masks=mask_tensor.cpu(),
                )

                total_steps += args.num_envs
                steps_in_phase += args.num_envs
                states = next_states

                for i, done in enumerate(dones_np.tolist()):
                    if done:
                        episode_rewards.append(infos[i].get('total_reward', 0.0))
                        episode_lengths.append(infos[i].get('total_steps', 0))
                        episode_wins.append(bool(infos[i].get('won', False)))
                        episode_floors.append(infos[i].get('final_floor', 0))
                        episode_outcomes.append(infos[i].get('outcome', 'done'))
                        episode_curriculum.append(bool(infos[i].get('curriculum_success', False)))

            # Update policy.
            last_states = tensorize_states(states, device)
            last_masks = torch.tensor(env.get_action_masks(), dtype=torch.bool, device=device)
            info = ppo.update(buffer, last_states, last_masks)

            # Logging.
            elapsed = time.time() - start_time
            if len(episode_rewards) > 0:
                recent = episode_rewards[-100:]
                recent_lengths = episode_lengths[-100:]
                recent_wins = episode_wins[-100:]
                recent_floors = episode_floors[-100:]
                recent_outcomes = episode_outcomes[-100:]
                recent_curriculum = episode_curriculum[-100:]
                win_rate = sum(1 for won in recent_wins if won) / len(recent_wins)
                curriculum_rate = sum(1 for success in recent_curriculum if success) / len(recent_curriculum)
                timeout_rate = sum(1 for outcome in recent_outcomes if outcome == 'timeout') / len(recent_outcomes)
                death_rate = sum(1 for outcome in recent_outcomes if outcome == 'dead') / len(recent_outcomes)
                avg_reward = np.mean(recent)
                avg_length = np.mean(recent_lengths)
                avg_floor = np.mean(recent_floors)
                action_summary = summarize_actions(action_counts)

                print(f"Step {total_steps:>10,} | "
                      f"Win Rate: {win_rate:.1%} | "
                      f"Goal: {curriculum_rate:.1%} | "
                      f"Avg Reward: {avg_reward:.1f} | "
                      f"Avg Length: {avg_length:.0f} | "
                      f"Avg Floor: {avg_floor:.2f} | "
                      f"Timeout: {timeout_rate:.1%} | "
                      f"Death: {death_rate:.1%} | "
                      f"Policy Loss: {info['policy_loss']:.4f} | "
                      f"Value Loss: {info['value_loss']:.4f} | "
                      f"Time: {elapsed:.0f}s")
                print(f"  {action_summary}")

                if writer:
                    writer.add_scalar('train/win_rate', win_rate, total_steps)
                    writer.add_scalar('train/curriculum_success_rate', curriculum_rate, total_steps)
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

            if total_steps >= next_save:
                path = os.path.join(args.checkpoint_dir, f"delve_ppo_{total_steps}.pt")
                ppo.save(path, total_steps=total_steps, config=config)
                print(f"  Saved: {path}")
                next_save += args.save_every

        final_path = os.path.join(args.checkpoint_dir, "delve_ppo_final.pt")
        ppo.save(final_path, total_steps=total_steps, config=config)
        print(f"Training complete! Saved: {final_path}")
    except KeyboardInterrupt:
        if total_steps > 0:
            path = os.path.join(args.checkpoint_dir, f"delve_ppo_{total_steps}.pt")
            ppo.save(path, total_steps=total_steps, config=config, interrupted=True)
            print(f"\nInterrupted. Saved checkpoint: {path}")
        else:
            print("\nInterrupted before any training steps were collected.")
    finally:
        env.close()
        if writer:
            writer.close()


if __name__ == '__main__':
    main()

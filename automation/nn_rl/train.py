#!/usr/bin/env python3
"""
DELVE RL Training Script — PPO with vectorized environments.
Uses the existing headless_balance.js VM infrastructure directly.
"""
import os, sys, time, json
import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import *
from network import DelveNet
from ppo import PPO, RolloutBuffer
from state_extractor import extract_state
from action_mask import get_action_mask

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


def main():
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    
    model = DelveNet(state_dim=STATE_DIM, action_dim=ACTION_DIM, hidden_dim=HIDDEN_DIM).to(device)
    config = {
        'lr': LR, 'gamma': GAMMA, 'lam': LAM, 'clip_eps': CLIP_EPS,
        'entropy_coeff': ENTROPY_COEFF, 'value_coeff': VALUE_COEFF,
        'max_grad_norm': MAX_GRAD_NORM, 'epochs_per_update': EPOCHS_PER_UPDATE,
        'batch_size': BATCH_SIZE, 'num_envs': NUM_ENVS,
        'rollout_steps': ROLLOUT_STEPS, 'lr_start': LR_START, 'lr_end': LR_END,
        'lr_decay_steps': LR_DECAY_STEPS,
    }
    ppo = PPO(model, config, device)
    buffer = RolloutBuffer(NUM_ENVS, ROLLOUT_STEPS, STATE_DIM, ACTION_DIM)
    
    # TensorBoard
    writer = None
    if HAS_TB:
        writer = SummaryWriter('runs/delve_ppo')
    
    os.makedirs('checkpoints', exist_ok=True)
    
    print()
    print("=" * 60)
    print("  DELVE RL Training Monitor")
    print("=" * 60)
    print(f"  Device:       {device}")
    print(f"  Network:      {model.count_parameters():,} params")
    print(f"  Batch size:   {BATCH_SIZE}")
    print(f"  Total steps:  {TOTAL_TIMESTEPS:,}")
    print(f"  TensorBoard:  {'Yes' if HAS_TB else 'No'} (tensorboard --logdir=runs)")
    print(f"  Checkpoints:  checkpoints/delve_ppo_<step>.pt")
    print("=" * 60)
    print()
    
    total_steps = 0
    episode_rewards = []
    episode_lengths = []
    start_time = time.time()
    
    curriculum_phase = 0
    steps_in_phase = 0
    
    while total_steps < TOTAL_TIMESTEPS:
        # Check curriculum
        if curriculum_phase < len(CURRICULUM):
            phase = CURRICULUM[curriculum_phase]
            if steps_in_phase >= phase['steps']:
                curriculum_phase += 1
                steps_in_phase = 0
                if curriculum_phase < len(CURRICULUM):
                    print(f"\n=== Curriculum Phase {curriculum_phase + 1}: {CURRICULUM[curriculum_phase]['name']} ===")
        
        # Collect rollout (using fake envs for now - real env integration TBD)
        for step in range(ROLLOUT_STEPS):
            states = torch.randn(NUM_ENVS, STATE_DIM).to(device)
            masks = torch.ones(NUM_ENVS, ACTION_DIM, dtype=torch.bool).to(device)
            actions, log_probs, values = ppo.get_action(states, masks)
            
            # Simulate environment steps (placeholder for real env)
            rewards = torch.randn(NUM_ENVS) * 0.1
            dones = torch.rand(NUM_ENVS) < 0.01
            
            buffer.store(
                step=step, states=states.cpu(), actions=actions.cpu(),
                log_probs=log_probs.cpu(), values=values.cpu(),
                rewards=rewards, dones=dones.to(torch.bool), masks=masks.cpu()
            )
            
            total_steps += NUM_ENVS
            steps_in_phase += NUM_ENVS
            
            for i, d in enumerate(dones.tolist()):
                if d:
                    episode_rewards.append(rewards[i].item())
                    episode_lengths.append(step)
        
        # Update
        last_states = torch.randn(NUM_ENVS, STATE_DIM).to(device)
        last_masks = torch.ones(NUM_ENVS, ACTION_DIM, dtype=torch.bool).to(device)
        info = ppo.update(buffer, last_states, last_masks)
        
        # Logging
        elapsed = time.time() - start_time
        if len(episode_rewards) > 0:
            recent = episode_rewards[-100:]
            recent_lengths = episode_lengths[-100:]
            win_rate = sum(1 for r in recent if r > 50) / len(recent)
            avg_reward = np.mean(recent)
            avg_length = np.mean(recent_lengths)
            
            print(f"Step {total_steps:>10,} | "
                  f"Win Rate: {win_rate:.1%} | "
                  f"Avg Reward: {avg_reward:.1f} | "
                  f"Avg Length: {avg_length:.0f} | "
                  f"Policy Loss: {info['policy_loss']:.4f} | "
                  f"Value Loss: {info['value_loss']:.4f} | "
                  f"Time: {elapsed:.0f}s")
            
            if writer:
                writer.add_scalar('train/win_rate', win_rate, total_steps)
                writer.add_scalar('train/avg_reward', avg_reward, total_steps)
                writer.add_scalar('train/policy_loss', info['policy_loss'], total_steps)
                writer.add_scalar('train/value_loss', info['value_loss'], total_steps)
        
        # Save checkpoint
        if total_steps % SAVE_EVERY == 0:
            path = f"checkpoints/delve_ppo_{total_steps}.pt"
            ppo.save(path)
            print(f"  Saved: {path}")
    
    ppo.save("checkpoints/delve_ppo_final.pt")
    if writer:
        writer.close()
    print("Training complete!")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Evaluation harness for DELVE RL bot.
Tests trained model against the game.
"""

import os
import sys
import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import *
from network import DelveNet
from ppo import PPO
from vector_env import DelveVectorEnv
from state_extractor import extract_state


def evaluate(model_path=None, num_games=200, device='cuda'):
    """Evaluate a trained model."""
    # Load model
    network = DelveNet(state_dim=STATE_DIM, action_dim=ACTION_DIM, hidden_dim=HIDDEN_DIM).to(device)
    agent = PPO(network, {
        'lr': LR, 'gamma': GAMMA, 'lam': LAM, 'clip_eps': CLIP_EPS,
        'entropy_coeff': ENTROPY_COEFF, 'value_coeff': VALUE_COEFF,
        'max_grad_norm': MAX_GRAD_NORM, 'epochs_per_update': EPOCHS_PER_UPDATE,
        'batch_size': BATCH_SIZE, 'num_envs': NUM_ENVS,
        'rollout_steps': ROLLOUT_STEPS, 'lr_start': LR_START, 'lr_end': LR_END,
        'lr_decay_steps': LR_DECAY_STEPS,
    }, device)
    
    if model_path and os.path.exists(model_path):
        agent.load(model_path)
        print(f"Loaded model from {model_path}")
    else:
        print("No model found, using random policy")
    
    # Run evaluation
    env = DelveVectorEnv(num_envs=min(num_games, 32), envs_per_worker=8)
    
    wins = 0
    total_floor = 0
    total_steps = 0
    games_done = 0
    class_wins = {c: 0 for c in CLASSES}
    class_games = {c: 0 for c in CLASSES}
    
    states = env.get_states()
    hidden = None
    
    while games_done < num_games:
        state_tensors = torch.stack([
            torch.tensor(extract_state(s) if s else np.zeros(STATE_DIM, dtype=np.float32))
            for s in states
        ]).to(device)
        
        from train import extract_local_map
        map_tensors = torch.stack([
            torch.tensor(extract_local_map(s) if s else np.zeros((6, 8, 8), dtype=np.float32))
            for s in states
        ]).to(device)
        
        masks = torch.tensor(env.get_action_masks(), dtype=torch.bool).to(device)
        
        with torch.no_grad():
            actions, _, _, hidden = agent.get_action(state_tensors, map_tensors, masks, hidden, deterministic=True)
        
        new_states, rewards, dones, infos = env.step(actions.cpu().numpy())
        
        # Reset hidden for done environments
        if hidden is not None and dones.any():
            done_mask = torch.from_numpy(dones).to(device=device, dtype=torch.bool).unsqueeze(0)
            hidden = hidden.masked_fill(done_mask.unsqueeze(-1), 0.0)
        
        for i, done in enumerate(dones):
            if done:
                games_done += 1
                if infos[i].get('won'):
                    wins += 1
                total_floor += states[i].get('floor', 1) if states[i] else 1
                total_steps += infos[i].get('total_steps', 0)
                # Reset hidden for this environment
                if hidden is not None:
                    hidden[:, i] = 0.0
        
        states = new_states
    
    env.close()
    
    results = {
        'win_rate': wins / max(games_done, 1),
        'avg_floor': total_floor / max(games_done, 1),
        'avg_steps': total_steps / max(games_done, 1),
        'games': games_done,
        'wins': wins,
    }
    
    print(f"\nEvaluation Results ({games_done} games):")
    print(f"  Win Rate: {results['win_rate']:.1%}")
    print(f"  Avg Floor: {results['avg_floor']:.1f}")
    print(f"  Avg Steps: {results['avg_steps']:.0f}")
    
    return results


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', type=str, default='checkpoints/delve_ppo_final.pt')
    parser.add_argument('--games', type=int, default=200)
    args = parser.parse_args()
    
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    evaluate(args.model, args.games, device)

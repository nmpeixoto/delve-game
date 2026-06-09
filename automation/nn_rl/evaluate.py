#!/usr/bin/env python3
"""
Evaluation harness for DELVE RL bot.
Tests trained model against the game.
"""

import os
import sys
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import *
from network import DelveNet
from ppo import PPO
from train import tensorize_maps, tensorize_states
from vector_env import DelveVectorEnv


def parse_args(argv=None):
    import argparse

    parser = argparse.ArgumentParser(description="Evaluate a DELVE PPO checkpoint with the training rollout settings.")
    parser.add_argument('--model', type=str, default='checkpoints/delve_ppo_final.pt')
    parser.add_argument('--games', type=int, default=200)
    parser.add_argument('--device', choices=['auto', 'cpu', 'cuda'], default='auto')
    parser.add_argument('--deterministic', action='store_true',
                        help='Use greedy argmax actions instead of stochastic sampling.')
    parser.add_argument('--max-episode-steps', type=int, default=10000)
    parser.add_argument('--num-envs', type=int, default=32)
    parser.add_argument('--envs-per-worker', type=int, default=8)
    return parser.parse_args(argv)


def advance_prev_actions(prev_actions, action_list, dones):
    updated = list(action_list)
    for index, done in enumerate(dones.tolist() if hasattr(dones, "tolist") else dones):
        if done:
            updated[index] = None
    return updated


def evaluate(model_path=None, num_games=200, device='cuda', deterministic=False,
             max_episode_steps=10000, num_envs=32, envs_per_worker=8):
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
    env_count = min(num_games, num_envs)
    env = DelveVectorEnv(
        num_envs=env_count,
        envs_per_worker=envs_per_worker,
        max_episode_steps=max_episode_steps,
        timeout_penalty=-400.0,
    )
    
    wins = 0
    total_floor = 0
    total_steps = 0
    games_done = 0
    outcomes = {}
    
    states = env.get_states()
    prev_actions = [None] * env_count
    hidden = None
    
    while games_done < num_games:
        state_tensors = tensorize_states(states, device, prev_actions)
        map_tensors = tensorize_maps(states, device)
        masks = torch.tensor(env.get_action_masks(), dtype=torch.bool).to(device)
        
        with torch.no_grad():
            actions, _, _, hidden = agent.get_action(
                state_tensors,
                map_tensors,
                masks,
                hidden,
                deterministic=deterministic,
            )
        
        action_list = actions.cpu().numpy().tolist()
        new_states, _rewards, dones, infos = env.step(action_list)
        
        # Reset hidden for done environments
        if hidden is not None and dones.any():
            done_mask = torch.from_numpy(dones).to(device=device, dtype=torch.bool).unsqueeze(0)
            hidden = hidden.masked_fill(done_mask.unsqueeze(-1), 0.0)
        
        for i, done in enumerate(dones):
            if done:
                games_done += 1
                if infos[i].get('won'):
                    wins += 1
                total_floor += infos[i].get('final_floor', 0)
                total_steps += infos[i].get('total_steps', 0)
                outcome = infos[i].get('outcome', 'unknown')
                outcomes[outcome] = outcomes.get(outcome, 0) + 1
                # Reset hidden for this environment
                if hidden is not None:
                    hidden[:, i] = 0.0
        
        states = new_states
        prev_actions = advance_prev_actions(prev_actions, action_list, dones)
    
    env.close()
    
    results = {
        'win_rate': wins / max(games_done, 1),
        'avg_floor': total_floor / max(games_done, 1),
        'avg_steps': total_steps / max(games_done, 1),
        'games': games_done,
        'wins': wins,
        'outcomes': outcomes,
    }
    
    print(f"\nEvaluation Results ({games_done} games):")
    print(f"  Win Rate: {results['win_rate']:.1%}")
    print(f"  Avg Floor: {results['avg_floor']:.1f}")
    print(f"  Avg Steps: {results['avg_steps']:.0f}")
    if outcomes:
        summary = ", ".join(f"{name} {count}" for name, count in sorted(outcomes.items()))
        print(f"  Outcomes: {summary}")
    
    return results


if __name__ == '__main__':
    args = parse_args()
    if args.device == 'auto':
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    else:
        device = torch.device(args.device)
    evaluate(
        args.model,
        args.games,
        device,
        deterministic=args.deterministic,
        max_episode_steps=args.max_episode_steps,
        num_envs=args.num_envs,
        envs_per_worker=args.envs_per_worker,
    )

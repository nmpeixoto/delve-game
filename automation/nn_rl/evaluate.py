#!/usr/bin/env python3
"""
Evaluation harness for DELVE RL bot.
Tests trained model against the game.
"""

import os
import sys
import json
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import *
from network import DelveNet
from ppo import PPO
from state_extractor import numpyize_states, numpyize_maps
from action_mask import get_action_mask
from vector_env import DelveVectorEnv
from eval_gate import summarize_class_eval


def parse_args(argv=None):
    import argparse

    parser = argparse.ArgumentParser(description="Evaluate a DELVE PPO checkpoint with the training rollout settings.")
    parser.add_argument('--model', '--checkpoint', dest='model', type=str, default='checkpoints/delve_ppo_final.pt')
    parser.add_argument('--games', type=int, default=200)
    parser.add_argument('--seed-base', type=int, default=1)
    parser.add_argument('--per-class', type=int, default=0)
    parser.add_argument('--classes', default=",".join(CLASSES))
    parser.add_argument('--summary-json', default="")
    parser.add_argument('--model-variant', choices=sorted(MODEL_VARIANTS), default='base')
    parser.add_argument('--hidden-dim', type=int, default=None)
    parser.add_argument('--device', choices=['auto', 'cpu', 'cuda'], default='auto')
    parser.add_argument('--deterministic', action='store_true',
                        help='Use greedy argmax actions instead of stochastic sampling.')
    parser.add_argument(
        '--max-episode-steps',
        type=int,
        default=DEFAULT_MAX_EPISODE_STEPS,
        help='Max actions per episode; 0 disables the timeout for deliberate unlimited experiments.',
    )
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
             max_episode_steps=DEFAULT_MAX_EPISODE_STEPS, num_envs=32, envs_per_worker=8,
             classes=None, per_class=0, seed_base=1, summary_json="",
             model_variant="base", hidden_dim=None):
    """Evaluate a trained model."""
    # Load model
    model_kwargs = dict(MODEL_VARIANTS[model_variant])
    if hidden_dim is not None:
        model_kwargs["hidden_dim"] = int(hidden_dim)
    network = DelveNet(state_dim=STATE_DIM, action_dim=ACTION_DIM, **model_kwargs).to(device)
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
    
    class_list = _parse_class_list(classes)
    class_schedule = None
    if per_class and per_class > 0:
        class_schedule = []
        for class_index, class_name in enumerate(class_list):
            for run_index in range(per_class):
                class_schedule.append({
                    "class_name": class_name,
                    "seed": int(seed_base) + class_index * per_class + run_index,
                })
        num_games = len(class_schedule)

    # Run evaluation
    env_count = min(num_games, num_envs)
    env = DelveVectorEnv(
        num_envs=env_count,
        envs_per_worker=envs_per_worker,
        max_episode_steps=max_episode_steps,
        timeout_penalty=DEFAULT_TIMEOUT_PENALTY,
        class_schedule=class_schedule,
        seed_base=seed_base,
    )
    
    wins = 0
    total_floor = 0
    total_steps = 0
    games_done = 0
    outcomes = {}
    eval_rows = []
    
    states = env.get_states()
    prev_actions = [None] * env_count
    hidden = None
    
    while games_done < num_games:
        np_states = numpyize_states(states, prev_actions)
        np_maps = numpyize_maps(states)
        import numpy as np
        np_masks = np.array([get_action_mask(s) for s in states], dtype=np.bool_)

        state_tensors = torch.from_numpy(np_states).to(device)
        map_tensors = torch.from_numpy(np_maps).to(device)
        masks = torch.from_numpy(np_masks).to(device)
        
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
                c_name = infos[i].get('class_name', 'unknown')
                won = infos[i].get('won', False)
                if won:
                    wins += 1
                final_floor = infos[i].get('final_floor', 0)
                total_floor += final_floor
                total_steps += infos[i].get('total_steps', 0)
                outcome = infos[i].get('outcome', 'unknown')
                outcomes[outcome] = outcomes.get(outcome, 0) + 1
                eval_rows.append({
                    "class_name": c_name,
                    "won": bool(won),
                    "final_floor": final_floor,
                    "total_steps": infos[i].get('total_steps', 0),
                    "outcome": outcome,
                })
                
                if 'class_stats' not in locals():
                    class_stats = {}
                if c_name not in class_stats:
                    class_stats[c_name] = {'games': 0, 'wins': 0, 'floors': 0}
                class_stats[c_name]['games'] += 1
                if won: class_stats[c_name]['wins'] += 1
                class_stats[c_name]['floors'] += final_floor
                
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
    
    if 'class_stats' in locals():
        print("\n  Per-Class Performance:")
        for c, stats in sorted(class_stats.items()):
            c_games = stats['games']
            if c_games > 0:
                c_win = stats['wins'] / c_games
                c_floor = stats['floors'] / c_games
                print(f"    {c.capitalize():<12} {c_games:>3} runs | Win: {c_win:>5.1%} | Avg Floor: {c_floor:.2f}")

    if outcomes:
        summary = ", ".join(f"{name} {count}" for name, count in sorted(outcomes.items()))
        print(f"\n  Outcomes: {summary}")

    if summary_json:
        summary = summarize_class_eval(eval_rows)
        summary.update({
            "overall": results,
            "model": model_path,
            "classes": class_list,
            "per_class": per_class,
            "seed_base": seed_base,
        })
        os.makedirs(os.path.dirname(summary_json) or ".", exist_ok=True)
        with open(summary_json, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, indent=2, sort_keys=True)
        print(f"\n  Wrote summary: {summary_json}")
    
    return results


def _parse_class_list(classes):
    if classes is None:
        return list(CLASSES)
    if isinstance(classes, str):
        parsed = [part.strip() for part in classes.split(",") if part.strip()]
        return parsed or list(CLASSES)
    return list(classes)


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
        classes=args.classes,
        per_class=args.per_class,
        seed_base=args.seed_base,
        summary_json=args.summary_json,
        model_variant=args.model_variant,
        hidden_dim=args.hidden_dim,
    )

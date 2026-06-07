#!/usr/bin/env python3
"""
Hyperparameter tuning for DELVE RL training.
Uses grid search or random search over key hyperparameters.
"""

import os
import sys
import json
import itertools
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def generate_param_grid():
    """Generate a grid of hyperparameters to search."""
    return {
        'lr': [1e-4, 3e-4, 5e-4, 1e-3],
        'entropy_coeff': [0.01, 0.02, 0.05],
        'clip_eps': [0.1, 0.2, 0.3],
        'hidden_dim': [128, 256],
        'rollout_steps': [128, 256, 512],
        'batch_size': [64, 128, 256],
    }


def random_search(n_trials=50):
    """Random search over hyperparameter space."""
    grid = generate_param_grid()
    trials = []
    
    for i in range(n_trials):
        params = {}
        for key, values in grid.items():
            params[key] = np.random.choice(values)
        
        # Estimate training time
        steps_per_sec = 5000  # Conservative estimate
        total_steps = 5_000_000  # 5M steps for quick evaluation
        time_estimate = total_steps / steps_per_sec / 60  # minutes
        
        trials.append({
            'params': params,
            'time_estimate_min': time_estimate,
            'win_rate': None,  # To be filled after training
        })
    
    return trials


def save_trials(trials, path='checkpoints/hp_trials.json'):
    """Save trial results to file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(trials, f, indent=2, default=str)


def load_trials(path='checkpoints/hp_trials.json'):
    """Load trial results from file."""
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return []


if __name__ == '__main__':
    print("Generating hyperparameter search space...")
    trials = random_search(n_trials=20)
    print(f"Generated {len(trials)} trials")
    for i, t in enumerate(trials):
        print(f"  Trial {i+1}: {t['params']}")
    save_trials(trials)
    print(f"Saved to checkpoints/hp_trials.json")

#!/usr/bin/env python3
"""
Load a DELVE PPO checkpoint and print synthetic stair-navigation probe results.
"""

import argparse
import os
import sys
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import ACTION_DIM, HIDDEN_DIM, STATE_DIM
from network import DelveNet
from policy_probe import evaluate_policy_probe
from train import resolve_resume_checkpoint


def parse_args():
    parser = argparse.ArgumentParser(description="Probe a DELVE PPO checkpoint on synthetic stair-navigation states.")
    parser.add_argument("--model", default="latest", help="Checkpoint path or 'latest'.")
    parser.add_argument("--checkpoint-dir", default="checkpoints")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    return parser.parse_args()


def main():
    args = parse_args()
    if args.device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(args.device)

    model = DelveNet(state_dim=STATE_DIM, action_dim=ACTION_DIM, hidden_dim=HIDDEN_DIM).to(device)
    path, _step = resolve_resume_checkpoint(args.model, args.checkpoint_dir)
    checkpoint = torch.load(path, map_location=device)
    model.load_state_dict(checkpoint["network"])

    probe = evaluate_policy_probe(model, device)
    print(f"Checkpoint: {path}")
    print(probe["summary"])
    for result in probe["results"]:
        print(
            f"  {result['name']}: target={result['target_label']} "
            f"prob={result['target_prob']:.1%} best={result['best_label']}"
        )


if __name__ == "__main__":
    main()

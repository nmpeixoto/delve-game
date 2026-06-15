#!/usr/bin/env python3
"""Migrate DELVE PPO checkpoints across compatible network expansions."""

from __future__ import annotations

import argparse
import os

import torch

from config import (
    ACTION_DIM,
    ACTION_SPACE_VERSION,
    MODEL_VARIANTS,
    STATE_DIM,
)
from network import DelveNet


def copy_overlapping_tensor(old_tensor, new_tensor):
    result = new_tensor.clone()
    slices = tuple(
        slice(0, min(old_size, new_size))
        for old_size, new_size in zip(old_tensor.shape, new_tensor.shape)
    )
    result[slices] = old_tensor[slices]
    return result


def migrate_state_dict(old_state, new_state):
    migrated = {}
    report = {}
    for name, new_tensor in new_state.items():
        old_tensor = old_state.get(name)
        if old_tensor is None or old_tensor.ndim != new_tensor.ndim:
            migrated[name] = new_tensor
            report[name] = "new"
        elif old_tensor.shape == new_tensor.shape:
            migrated[name] = old_tensor
            report[name] = "exact"
        else:
            migrated[name] = copy_overlapping_tensor(old_tensor, new_tensor)
            report[name] = f"partial {tuple(old_tensor.shape)} -> {tuple(new_tensor.shape)}"
    return migrated, report


def build_target_model(model_variant="base", hidden_dim=None, device="cpu"):
    model_kwargs = dict(MODEL_VARIANTS[model_variant])
    if hidden_dim is not None:
        model_kwargs["hidden_dim"] = int(hidden_dim)
    return DelveNet(state_dim=STATE_DIM, action_dim=ACTION_DIM, **model_kwargs).to(device)


def migrate_checkpoint(source, target, model_variant="base", hidden_dim=None, device="cpu"):
    checkpoint = torch.load(source, map_location=device)
    model = build_target_model(model_variant=model_variant, hidden_dim=hidden_dim, device=device)
    migrated_state, report = migrate_state_dict(checkpoint["network"], model.state_dict())
    output = {
        "network": migrated_state,
        "migrated_from": os.path.abspath(source),
        "migration_report": report,
        "model_variant": model_variant,
        "action_space_version": ACTION_SPACE_VERSION,
        "total_steps": int(checkpoint.get("total_steps", 0)),
        "curriculum_phase": checkpoint.get("curriculum_phase"),
        "steps_in_phase": checkpoint.get("steps_in_phase"),
    }
    torch.save(output, target)
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Migrate a DELVE PPO checkpoint to the current network shape."
    )
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--model-variant", choices=sorted(MODEL_VARIANTS), default="base")
    parser.add_argument("--hidden-dim", type=int, default=None)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    args = parser.parse_args(argv)

    result = migrate_checkpoint(
        source=args.source,
        target=args.target,
        model_variant=args.model_variant,
        hidden_dim=args.hidden_dim,
        device=args.device,
    )
    partial = sum(1 for value in result["migration_report"].values() if value.startswith("partial"))
    exact = sum(1 for value in result["migration_report"].values() if value == "exact")
    print(f"Migrated checkpoint: {args.target}")
    print(f"  exact tensors:   {exact}")
    print(f"  partial tensors: {partial}")
    print("  optimizer:       reset")


if __name__ == "__main__":
    main()

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
    if old_tensor.ndim >= 2:
        existing_outputs = slice(0, min(old_tensor.shape[0], new_tensor.shape[0]))
        for dim in range(1, old_tensor.ndim):
            if new_tensor.shape[dim] > old_tensor.shape[dim]:
                zero_slices = [slice(None)] * old_tensor.ndim
                zero_slices[0] = existing_outputs
                zero_slices[dim] = slice(old_tensor.shape[dim], new_tensor.shape[dim])
                result[tuple(zero_slices)] = 0
    return result


def identity_inserted_conv(new_tensor, preserved_channels):
    result = new_tensor.clone()
    limit = min(int(preserved_channels), new_tensor.shape[0], new_tensor.shape[1])
    center_y = new_tensor.shape[2] // 2
    center_x = new_tensor.shape[3] // 2
    for channel in range(limit):
        result[channel].zero_()
        result[channel, channel, center_y, center_x] = 1.0
    return result


def zero_preserved_bias(new_tensor, preserved_channels):
    result = new_tensor.clone()
    result[: min(int(preserved_channels), new_tensor.shape[0])] = 0
    return result


def _square_pool_size(flat_dim, channels):
    if channels <= 0 or flat_dim % channels != 0:
        return None
    pool = int((flat_dim // channels) ** 0.5)
    return pool if channels * pool * pool == flat_dim else None


def expand_spatial_fc_weight(old_tensor, new_tensor, old_channels, new_channels):
    old_pool = _square_pool_size(old_tensor.shape[1], old_channels)
    new_pool = _square_pool_size(new_tensor.shape[1], new_channels)
    if (
        old_pool is None
        or new_pool is None
        or new_pool % old_pool != 0
        or new_channels < old_channels
    ):
        return copy_overlapping_tensor(old_tensor, new_tensor)

    result = new_tensor.clone()
    output_count = min(old_tensor.shape[0], new_tensor.shape[0])
    scale = new_pool // old_pool
    scale_area = float(scale * scale)
    old_view = old_tensor[:output_count].reshape(
        output_count,
        old_channels,
        old_pool,
        old_pool,
    )
    new_view = result[:output_count].reshape(
        output_count,
        new_channels,
        new_pool,
        new_pool,
    )
    new_view.zero_()
    for y in range(old_pool):
        for x in range(old_pool):
            new_view[
                :,
                :old_channels,
                y * scale:(y + 1) * scale,
                x * scale:(x + 1) * scale,
            ] = old_view[:, :, y, x].unsqueeze(-1).unsqueeze(-1) / scale_area
    return result


def migrate_gru_gate_tensor(old_tensor, new_tensor):
    if old_tensor.shape[0] % 3 != 0 or new_tensor.shape[0] % 3 != 0:
        return copy_overlapping_tensor(old_tensor, new_tensor)

    old_hidden = old_tensor.shape[0] // 3
    new_hidden = new_tensor.shape[0] // 3
    preserved_hidden = min(old_hidden, new_hidden)
    result = new_tensor.clone()
    for gate in range(3):
        old_rows = slice(gate * old_hidden, gate * old_hidden + preserved_hidden)
        new_rows = slice(gate * new_hidden, gate * new_hidden + preserved_hidden)
        if old_tensor.ndim == 1:
            result[new_rows] = old_tensor[old_rows]
        else:
            cols = min(old_tensor.shape[1], new_tensor.shape[1])
            result[new_rows, :] = 0
            result[new_rows, :cols] = old_tensor[old_rows, :cols]
    return result


def migrate_state_dict(old_state, new_state):
    migrated = {}
    report = {}
    old_cnn_channels = None
    if "cnn.conv.2.weight" in old_state:
        old_cnn_channels = int(old_state["cnn.conv.2.weight"].shape[0])
    new_cnn_channels = None
    if "cnn.conv.4.weight" in new_state:
        new_cnn_channels = int(new_state["cnn.conv.4.weight"].shape[0])
    for name, new_tensor in new_state.items():
        old_tensor = old_state.get(name)
        if name == "cnn.conv.4.weight" and old_tensor is None and old_cnn_channels:
            migrated[name] = identity_inserted_conv(new_tensor, old_cnn_channels)
            report[name] = "new identity"
        elif name == "cnn.conv.4.bias" and old_tensor is None and old_cnn_channels:
            migrated[name] = zero_preserved_bias(new_tensor, old_cnn_channels)
            report[name] = "new zero-preserved"
        elif (
            name == "cnn.fc.0.weight"
            and old_tensor is not None
            and old_cnn_channels
            and new_cnn_channels
            and old_tensor.ndim == new_tensor.ndim == 2
        ):
            migrated[name] = expand_spatial_fc_weight(
                old_tensor,
                new_tensor,
                old_channels=old_cnn_channels,
                new_channels=new_cnn_channels,
            )
            report[name] = f"spatial {tuple(old_tensor.shape)} -> {tuple(new_tensor.shape)}"
        elif (
            name.startswith("gru.")
            and old_tensor is not None
            and old_tensor.ndim == new_tensor.ndim
            and old_tensor.shape != new_tensor.shape
        ):
            migrated[name] = migrate_gru_gate_tensor(old_tensor, new_tensor)
            report[name] = f"gru-gated {tuple(old_tensor.shape)} -> {tuple(new_tensor.shape)}"
        elif old_tensor is None or old_tensor.ndim != new_tensor.ndim:
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

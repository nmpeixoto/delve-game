"""Double-buffered actor/learner helpers for DELVE PPO."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RolloutPacket:
    policy_version: int
    total_steps: int
    payload: dict


def collect_rollout(policy_version, collector_fn):
    payload = collector_fn()
    return RolloutPacket(
        policy_version=int(policy_version),
        total_steps=int(payload["total_steps"]),
        payload=payload,
    )

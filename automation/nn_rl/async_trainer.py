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


def normalize_trainer_mode(mode):
    return "async-one-stale" if mode == "async-double-buffer" else mode


def assert_rollout_staleness(actor_version, learner_version, max_staleness=1):
    actor_version = int(actor_version)
    learner_version = int(learner_version)
    max_staleness = int(max_staleness)
    if learner_version - actor_version > max_staleness:
        raise RuntimeError(
            f"rollout policy is too stale: actor_version={actor_version}, "
            f"learner_version={learner_version}, max_staleness={max_staleness}"
        )

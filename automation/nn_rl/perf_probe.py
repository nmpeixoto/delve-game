#!/usr/bin/env python3
"""Benchmark helpers for DELVE PPO training performance."""

from __future__ import annotations

import argparse
import json
import time
from collections.abc import Mapping


def summarize_stage_timings(stage_seconds: Mapping[str, float]) -> dict:
    total = sum(max(float(value), 0.0) for value in stage_seconds.values())
    stages = {}
    for name, seconds in sorted(stage_seconds.items()):
        value = max(float(seconds), 0.0)
        stages[name] = {
            "seconds": value,
            "pct": (100.0 * value / total) if total > 0 else 0.0,
        }
    return {"total_seconds": total, "stages": stages}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Probe DELVE PPO training throughput.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = parser.parse_args(argv)

    start = time.perf_counter()
    result = {
        "wall_seconds": time.perf_counter() - start,
        "stage_summary": summarize_stage_timings({}),
    }
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        print(result)


if __name__ == "__main__":
    main()

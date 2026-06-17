"""Go/no-go checks for DELVE PPO efficiency experiments."""

from __future__ import annotations

import argparse
import json


def summarize_recent_reports(rows, limit=5):
    reports = [row for row in rows if row.get("event") == "train_report"]
    recent = reports[-int(limit):]
    if not recent:
        raise ValueError("No train_report rows found")

    return {
        "progress_rate": _mean_float(recent, "progress_rate"),
        "avg_floor": _mean_float(recent, "avg_floor"),
        "death_rate": _mean_float(recent, "death_rate"),
    }


def training_gate_passes(
    summary,
    min_progress=0.25,
    min_avg_floor=3.7,
    max_death_rate=0.85,
):
    reasons = []
    if float(summary["progress_rate"]) < min_progress:
        reasons.append(
            f"progress_rate {summary['progress_rate']:.1%} < {min_progress:.1%}"
        )
    if float(summary["avg_floor"]) < min_avg_floor:
        reasons.append(
            f"avg_floor {summary['avg_floor']:.2f} < {min_avg_floor:.2f}"
        )
    if float(summary["death_rate"]) > max_death_rate:
        reasons.append(
            f"death_rate {summary['death_rate']:.1%} > {max_death_rate:.1%}"
        )
    return not reasons, reasons


def load_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _mean_float(rows, key):
    return sum(float(row[key]) for row in rows) / len(rows)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Check whether PPO training is stable enough for pipeline changes."
    )
    parser.add_argument("metrics_log")
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args(argv)

    summary = summarize_recent_reports(load_jsonl(args.metrics_log), limit=args.limit)
    passed, reasons = training_gate_passes(summary)
    print(
        json.dumps(
            {"passed": passed, "summary": summary, "reasons": reasons},
            indent=2,
            sort_keys=True,
        )
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())

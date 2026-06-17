"""Fixed-seed per-class evaluation summaries for DELVE PPO."""

from __future__ import annotations

from collections import defaultdict


def summarize_class_eval(rows, weak_threshold=0.70):
    buckets = defaultdict(list)
    for row in rows:
        buckets[row["class_name"]].append(row)

    by_class = {}
    weak_classes = []
    for class_name, values in sorted(buckets.items()):
        wins = sum(1 for row in values if row.get("won"))
        total = len(values)
        avg_floor = sum(float(row.get("final_floor", 0)) for row in values) / max(total, 1)
        win_rate = wins / max(total, 1)
        by_class[class_name] = {
            "wins": wins,
            "total": total,
            "win_rate": win_rate,
            "avg_floor": avg_floor,
        }
        if win_rate < weak_threshold:
            weak_classes.append(class_name)
    return {"by_class": by_class, "weak_classes": weak_classes}

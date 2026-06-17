import json
import os
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "automation", "nn_rl"))

from training_gate import load_jsonl, summarize_recent_reports, training_gate_passes


class TrainingGateTest(unittest.TestCase):
    def test_summarize_recent_reports_uses_last_n_train_reports(self):
        rows = [
            {"event": "ignored"},
            {
                "event": "train_report",
                "progress_rate": 0.20,
                "avg_floor": 3.5,
                "death_rate": 0.90,
            },
            {
                "event": "train_report",
                "progress_rate": 0.30,
                "avg_floor": 3.9,
                "death_rate": 0.80,
            },
            {
                "event": "train_report",
                "progress_rate": 0.40,
                "avg_floor": 4.0,
                "death_rate": 0.70,
            },
        ]

        summary = summarize_recent_reports(rows, limit=2)

        self.assertAlmostEqual(summary["progress_rate"], 0.35)
        self.assertAlmostEqual(summary["avg_floor"], 3.95)
        self.assertAlmostEqual(summary["death_rate"], 0.75)

    def test_training_gate_passes_stable_base_run(self):
        summary = {"progress_rate": 0.30, "avg_floor": 3.8, "death_rate": 0.80}

        passed, reasons = training_gate_passes(summary)

        self.assertTrue(passed)
        self.assertEqual(reasons, [])

    def test_training_gate_rejects_collapsed_policy(self):
        summary = {"progress_rate": 0.0, "avg_floor": 2.7, "death_rate": 1.0}

        passed, reasons = training_gate_passes(summary)

        self.assertFalse(passed)
        self.assertIn("progress_rate 0.0% < 25.0%", reasons)
        self.assertIn("avg_floor 2.70 < 3.70", reasons)
        self.assertIn("death_rate 100.0% > 85.0%", reasons)

    def test_load_jsonl_reads_non_empty_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "metrics.jsonl")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(json.dumps({"event": "train_report"}) + "\n\n")
                handle.write(json.dumps({"event": "checkpoint"}) + "\n")

            rows = load_jsonl(path)

        self.assertEqual(rows, [{"event": "train_report"}, {"event": "checkpoint"}])


if __name__ == "__main__":
    unittest.main()

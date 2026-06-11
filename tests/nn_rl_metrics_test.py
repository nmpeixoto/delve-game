import json
import os
import sys
import tempfile
import unittest

import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NN_RL_DIR = os.path.join(REPO_ROOT, "automation", "nn_rl")
sys.path.insert(0, NN_RL_DIR)

import evaluate
from train import (
    append_jsonl_record,
    build_training_metrics_row,
    new_episode_window,
    record_episode,
    parse_args as parse_train_args,
    should_use_tensorboard,
)


class NnRlMetricsTest(unittest.TestCase):
    def test_build_training_metrics_row_includes_core_rates_and_probe(self):
        window = new_episode_window(window=4)
        record_episode(window, {
            "total_reward": 12.0,
            "total_steps": 40,
            "won": True,
            "final_floor": 5,
            "outcome": "won",
            "curriculum_success": False,
            "class_name": "warrior",
        })
        record_episode(window, {
            "total_reward": -8.0,
            "total_steps": 80,
            "won": False,
            "final_floor": 3,
            "outcome": "timeout",
            "curriculum_success": False,
            "class_name": "mage",
        })

        row = build_training_metrics_row(
            total_steps=123456,
            elapsed=42.5,
            phase_index=0,
            phase_name="full_dungeon",
            progress_label="Full Win",
            progress_rate=0.25,
            progress_raw_rate=0.30,
            progress_delta=-0.05,
            win_rate=0.5,
            avg_reward=2.0,
            avg_length=60.0,
            avg_floor=4.0,
            timeout_rate=0.5,
            death_rate=0.25,
            policy_loss=-0.01,
            value_loss=1.25,
            entropy=0.75,
            action_counts=np.array([1, 2, 3] + [0] * 15, dtype=np.int64),
            episode_window=window,
            progress_key="wins",
            probe_metrics={"descend_prob_on_stairs": 0.95},
        )

        self.assertEqual(row["total_steps"], 123456)
        self.assertEqual(row["phase_name"], "full_dungeon")
        self.assertEqual(row["progress_label"], "Full Win")
        self.assertAlmostEqual(row["progress_rate"], 0.25)
        self.assertAlmostEqual(row["progress_raw_rate"], 0.30)
        self.assertAlmostEqual(row["win_rate"], 0.5)
        self.assertIn("warrior", row["class_summary"])
        self.assertIn("Desc", row["actions_summary"])
        self.assertEqual(row["probe_metrics"]["descend_prob_on_stairs"], 0.95)

    def test_append_jsonl_record_writes_one_json_object_per_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "metrics.jsonl")
            append_jsonl_record(path, {"step": 1, "win_rate": 0.1})
            append_jsonl_record(path, {"step": 2, "win_rate": 0.2})

            with open(path, "r", encoding="utf-8") as handle:
                lines = [json.loads(line) for line in handle.read().splitlines()]

        self.assertEqual(lines, [
            {"step": 1, "win_rate": 0.1},
            {"step": 2, "win_rate": 0.2},
        ])

    def test_evaluate_parse_args_defaults_to_unlimited_full_dungeon_rollout(self):
        args = evaluate.parse_args([])

        self.assertEqual(args.max_episode_steps, 0)
        self.assertFalse(args.deterministic)

    def test_advance_prev_actions_clears_completed_envs(self):
        updated = evaluate.advance_prev_actions(
            prev_actions=[None, 9, 4],
            action_list=[1, 2, 3],
            dones=np.array([False, True, False]),
        )

        self.assertEqual(updated, [1, None, 3])

    def test_train_respects_no_tensorboard_flag(self):
        args = parse_train_args(["--no-tensorboard"])

        self.assertTrue(args.no_tensorboard)
        self.assertFalse(should_use_tensorboard(args))


if __name__ == "__main__":
    unittest.main()

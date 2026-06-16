import json
import os
import sys
import tempfile
import unittest

import numpy as np
import torch

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NN_RL_DIR = os.path.join(REPO_ROOT, "automation", "nn_rl")
sys.path.insert(0, NN_RL_DIR)

import evaluate
from network import DelveNet
from train import (
    append_jsonl_record,
    build_ppo_config,
    build_training_metrics_row,
    new_episode_window,
    record_episode,
    parse_args as parse_train_args,
    should_use_tensorboard,
)
from config import ACTION_DIM, ACTIONS, DEFAULT_MAX_EPISODE_STEPS, STATE_DIM


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
            "reward_components": {"terminal_win": 3500.0, "floor_progress": 500.0},
        })
        record_episode(window, {
            "total_reward": -8.0,
            "total_steps": 80,
            "won": False,
            "final_floor": 3,
            "outcome": "timeout",
            "curriculum_success": False,
            "class_name": "mage",
            "reward_components": {"terminal_timeout": -1500.0, "floor_progress": 300.0},
        })
        action_counts = np.zeros(ACTION_DIM, dtype=np.int64)
        action_counts[ACTIONS["MOVE_UP"]] = 10
        action_counts[ACTIONS["DESCEND"]] = 2

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
            action_counts=action_counts,
            episode_window=window,
            progress_key="wins",
            probe_metrics={
                "descend_prob_on_stairs": 0.95,
                "on_stairs_desc_action_rate": 0.9,
            },
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
        self.assertAlmostEqual(row["action_distribution"]["Up"], 10 / 12)
        self.assertAlmostEqual(row["action_distribution"]["Desc"], 2 / 12)
        self.assertEqual(row["outcome_summary"]["won"]["count"], 1)
        self.assertEqual(row["outcome_summary"]["timeout"]["count"], 1)
        self.assertAlmostEqual(row["reward_components"]["floor_progress"], 400.0)
        self.assertAlmostEqual(row["reward_components"]["terminal_timeout"], -750.0)

    def test_build_training_metrics_row_includes_perf_when_supplied(self):
        row = build_training_metrics_row(
            total_steps=200,
            elapsed=4.0,
            phase_index=0,
            phase_name="full_dungeon",
            progress_label="Full Win",
            progress_rate=0.0,
            progress_raw_rate=0.0,
            win_rate=0.0,
            avg_reward=0.0,
            avg_length=0.0,
            avg_floor=0.0,
            timeout_rate=0.0,
            death_rate=0.0,
            policy_loss=0.0,
            value_loss=0.0,
            entropy=0.0,
            stage_seconds={"collect": 3.0, "learner": 1.0},
        )

        self.assertEqual(row["perf"]["steps_per_second"], 50.0)
        self.assertEqual(row["perf"]["stage_seconds"], {"collect": 3.0, "learner": 1.0})

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

    def test_evaluate_parse_args_defaults_to_training_stall_guard(self):
        args = evaluate.parse_args([])

        self.assertEqual(args.max_episode_steps, DEFAULT_MAX_EPISODE_STEPS)
        self.assertFalse(args.deterministic)

    def test_evaluate_parse_args_accepts_fixed_seed_class_gate_options(self):
        args = evaluate.parse_args([
            "--checkpoint",
            "checkpoint.pt",
            "--seed-base",
            "42",
            "--per-class",
            "5",
            "--classes",
            "mage,ranger",
            "--summary-json",
            "summary.json",
        ])

        self.assertEqual(args.model, "checkpoint.pt")
        self.assertEqual(args.seed_base, 42)
        self.assertEqual(args.per_class, 5)
        self.assertEqual(args.classes, "mage,ranger")
        self.assertEqual(args.summary_json, "summary.json")

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

    def test_train_accepts_direct_observation_mode(self):
        args = parse_train_args(["--observation-mode", "direct"])

        self.assertEqual(args.observation_mode, "direct")

    def test_train_accepts_shared_transport_mode(self):
        args = parse_train_args(["--transport-mode", "shared"])

        self.assertEqual(args.transport_mode, "shared")

    def test_train_defaults_to_sync_trainer_mode(self):
        args = parse_train_args([])

        self.assertEqual(args.trainer_mode, "sync")

    def test_train_accepts_async_double_buffer_trainer_mode(self):
        args = parse_train_args(["--trainer-mode", "async-double-buffer"])

        self.assertEqual(args.trainer_mode, "async-double-buffer")

    def test_train_accepts_hidden_dim_override(self):
        args = parse_train_args(["--hidden-dim", "384"])

        self.assertEqual(args.hidden_dim, 384)

    def test_train_accepts_optimizer_stability_overrides(self):
        args = parse_train_args([
            "--learning-rate",
            "0.00003",
            "--entropy-coeff",
            "0.01",
        ])
        config = build_ppo_config(args)

        self.assertEqual(args.learning_rate, 0.00003)
        self.assertEqual(args.entropy_coeff, 0.01)
        self.assertEqual(config["lr"], 0.00003)
        self.assertEqual(config["lr_start"], 0.00003)
        self.assertEqual(config["entropy_coeff"], 0.01)

    def test_train_accepts_large_tactical_model_variant(self):
        args = parse_train_args(["--model-variant", "large_tactical"])

        self.assertEqual(args.model_variant, "large_tactical")


class NnRlNetworkShapeTest(unittest.TestCase):
    def test_gru_hidden_constant_matches_instance_hidden_dim(self):
        net = DelveNet(hidden_dim=384)

        self.assertEqual(net.hidden_dim, 384)
        self.assertEqual(net.gru.hidden_size, 384)


class NnRlModelVariantTest(unittest.TestCase):
    def test_model_variant_config_defines_base_and_large_tactical(self):
        from config import MODEL_VARIANTS

        self.assertEqual(MODEL_VARIANTS["base"]["hidden_dim"], 256)
        self.assertEqual(MODEL_VARIANTS["large_tactical"]["hidden_dim"], 384)
        self.assertEqual(MODEL_VARIANTS["large_tactical"]["cnn_out_dim"], 256)

    def test_large_model_forward_shape(self):
        net = DelveNet(hidden_dim=384, cnn_out_dim=256, head_hidden_dim=256)
        states = torch.zeros(2, STATE_DIM)
        maps = torch.zeros(2, 21, 16, 16)
        masks = torch.ones(2, ACTION_DIM, dtype=torch.bool)

        logits, values, hidden = net(states, maps, action_mask=masks)

        self.assertEqual(logits.shape, (2, ACTION_DIM))
        self.assertEqual(values.shape, (2, 1))
        self.assertEqual(hidden.shape, (1, 2, 384))
        self.assertGreater(net.count_parameters(), 724549)


class NnRlEvalGateTest(unittest.TestCase):
    def test_summarize_class_eval_reports_weak_classes(self):
        from eval_gate import summarize_class_eval

        rows = [
            {"class_name": "ranger", "won": False, "final_floor": 3},
            {"class_name": "ranger", "won": True, "final_floor": 5},
            {"class_name": "paladin", "won": True, "final_floor": 5},
        ]

        summary = summarize_class_eval(rows)

        self.assertAlmostEqual(summary["by_class"]["ranger"]["win_rate"], 0.5)
        self.assertEqual(summary["by_class"]["paladin"]["wins"], 1)
        self.assertIn("ranger", summary["weak_classes"])


if __name__ == "__main__":
    unittest.main()

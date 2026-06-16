import os
import sys
import tempfile
import unittest

import torch

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NN_RL_DIR = os.path.join(REPO_ROOT, "automation", "nn_rl")
sys.path.insert(0, NN_RL_DIR)

from checkpoint_migration import copy_overlapping_tensor, migrate_checkpoint, migrate_state_dict
from config import ACTION_DIM, MODEL_VARIANTS, STATE_DIM
from network import DelveNet


class NnRlCheckpointMigrationTest(unittest.TestCase):
    def test_copy_overlapping_tensor_preserves_old_slice(self):
        old = torch.arange(6, dtype=torch.float32).reshape(2, 3)
        new = torch.zeros(4, 5)

        migrated = copy_overlapping_tensor(old, new)

        torch.testing.assert_close(migrated[:2, :3], old)
        torch.testing.assert_close(migrated[2:, :], torch.zeros(2, 5))
        torch.testing.assert_close(migrated[:, 3:], torch.zeros(4, 2))

    def test_copy_overlapping_tensor_zeros_new_inputs_for_existing_outputs(self):
        old = torch.ones(2, 3)
        new = torch.arange(20, dtype=torch.float32).reshape(4, 5)

        migrated = copy_overlapping_tensor(old, new)

        torch.testing.assert_close(migrated[:2, :3], old)
        torch.testing.assert_close(migrated[:2, 3:], torch.zeros(2, 2))
        torch.testing.assert_close(migrated[2:, :], new[2:, :])

    def test_migrate_state_dict_reports_partial_and_exact_copies(self):
        old_state = {
            "same": torch.ones(2, 2),
            "expanded": torch.full((2, 3), 7.0),
        }
        new_state = {
            "same": torch.zeros(2, 2),
            "expanded": torch.zeros(4, 5),
            "new_only": torch.ones(1),
        }

        migrated, report = migrate_state_dict(old_state, new_state)

        torch.testing.assert_close(migrated["same"], old_state["same"])
        torch.testing.assert_close(migrated["expanded"][:2, :3], old_state["expanded"])
        torch.testing.assert_close(migrated["new_only"], new_state["new_only"])
        self.assertEqual(report["same"], "exact")
        self.assertIn("partial", report["expanded"])
        self.assertEqual(report["new_only"], "new")

    def test_migrate_checkpoint_preserves_legacy_policy_action_rows(self):
        old_model = DelveNet(action_dim=36)
        with tempfile.TemporaryDirectory() as tmp:
            source = os.path.join(tmp, "old.pt")
            target = os.path.join(tmp, "migrated.pt")
            torch.save({"network": old_model.state_dict(), "total_steps": 123}, source)

            migrate_checkpoint(source, target, model_variant="base")
            migrated = torch.load(target, map_location="cpu")

        old_policy = old_model.state_dict()["policy.2.weight"]
        migrated_policy = migrated["network"]["policy.2.weight"]
        self.assertEqual(migrated_policy.shape[0], ACTION_DIM)
        torch.testing.assert_close(migrated_policy[:36], old_policy)
        self.assertEqual(migrated["total_steps"], 123)
        self.assertIn("partial", migrated["migration_report"]["policy.2.weight"])

    def test_large_tactical_migration_preserves_base_forward_outputs(self):
        torch.manual_seed(123)
        base_model = DelveNet(
            state_dim=STATE_DIM,
            action_dim=ACTION_DIM,
            **MODEL_VARIANTS["base"],
        )
        target_model = DelveNet(
            state_dim=STATE_DIM,
            action_dim=ACTION_DIM,
            **MODEL_VARIANTS["large_tactical"],
        )
        migrated_state, _ = migrate_state_dict(
            base_model.state_dict(),
            target_model.state_dict(),
        )
        target_model.load_state_dict(migrated_state)

        state = torch.randn(4, STATE_DIM)
        maps = torch.randn(4, 21, 16, 16)
        mask = torch.ones(4, ACTION_DIM, dtype=torch.bool)

        with torch.inference_mode():
            base_logits, base_value, _ = base_model(state, maps, action_mask=mask)
            migrated_logits, migrated_value, _ = target_model(
                state,
                maps,
                action_mask=mask,
            )

        torch.testing.assert_close(migrated_logits, base_logits, rtol=1e-5, atol=1e-5)
        torch.testing.assert_close(migrated_value, base_value, rtol=1e-5, atol=1e-5)


if __name__ == "__main__":
    unittest.main()

import os
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NN_RL_DIR = os.path.join(REPO_ROOT, "automation", "nn_rl")
sys.path.insert(0, NN_RL_DIR)

from tactical_actions import choose_line_clear_enemy, safest_adjacent_move
from action_mask import get_action_mask
from config import ACTIONS, ACTION_DIM, LEGACY_ACTION_DIM
from vector_env import DelveVectorEnv


class NnRlTacticalActionsTest(unittest.TestCase):
    def test_choose_line_clear_enemy_prefers_visible_low_hp_target(self):
        state = {
            "player": {"x": 5, "y": 5, "class": "ranger"},
            "map": [[1 for _ in range(12)] for _ in range(12)],
            "visible": {5 * 56 + 8, 5 * 56 + 7},
            "enemies": [
                {"id": "strong", "x": 8, "y": 5, "hp": 20, "maxHp": 20, "dying": False},
                {"id": "weak", "x": 7, "y": 5, "hp": 3, "maxHp": 20, "dying": False},
            ],
        }

        self.assertEqual(choose_line_clear_enemy(state)["id"], "weak")

    def test_safest_adjacent_move_increases_enemy_distance(self):
        state = {
            "player": {"x": 5, "y": 5, "class": "mage"},
            "map": [[1 for _ in range(12)] for _ in range(12)],
            "visible": {5 * 56 + 6},
            "enemies": [{"id": "e", "x": 6, "y": 5, "hp": 10, "dying": False}],
        }

        self.assertEqual(safest_adjacent_move(state), {"type": "key", "val": "ArrowLeft"})

    def test_safest_adjacent_move_can_require_distance_gain(self):
        state = {
            "player": {"x": 5, "y": 5, "class": "mage"},
            "map": [[1 for _ in range(12)] for _ in range(12)],
            "visible": {3 * 56 + 5},
            "enemies": [{"id": "e", "x": 5, "y": 3, "hp": 10, "dying": False}],
        }

        self.assertEqual(
            safest_adjacent_move(state, threat_enemies=state["enemies"], require_increase=True),
            {"type": "key", "val": "ArrowDown"},
        )

    def test_safest_adjacent_move_rejects_non_improving_moves_when_required(self):
        state = {
            "player": {"x": 5, "y": 5, "class": "mage"},
            "map": [[0 for _ in range(12)] for _ in range(12)],
            "visible": {6 * 56 + 6},
            "enemies": [{"id": "e", "x": 6, "y": 6, "hp": 10, "dying": False}],
        }
        state["map"][5][5] = 1
        state["map"][5][6] = 1

        self.assertIsNone(
            safest_adjacent_move(state, threat_enemies=state["enemies"], require_increase=True)
        )

    def test_tactical_actions_are_appended_after_legacy_action_space(self):
        self.assertEqual(LEGACY_ACTION_DIM, 36)
        self.assertEqual(ACTIONS["RANGED_ATTACK_WEAK"], LEGACY_ACTION_DIM)
        self.assertEqual(ACTIONS["RANGED_ATTACK_NEAREST"], LEGACY_ACTION_DIM + 1)
        self.assertEqual(ACTIONS["KITE_SAFE_MOVE"], LEGACY_ACTION_DIM + 2)
        self.assertEqual(ACTION_DIM, LEGACY_ACTION_DIM + 3)

    def test_action_mask_exposes_tactical_actions_when_valid(self):
        state = {
            "player": {"x": 5, "y": 5, "class": "ranger", "hp": 10, "maxHp": 20},
            "map": [[1 for _ in range(12)] for _ in range(12)],
            "visible": {5 * 56 + 7, 5 * 56 + 8},
            "enemies": [
                {"id": "weak", "x": 7, "y": 5, "hp": 3, "maxHp": 20, "dying": False},
                {"id": "strong", "x": 8, "y": 5, "hp": 20, "maxHp": 20, "dying": False},
            ],
            "items": [],
            "shops": [],
        }

        mask = get_action_mask(state)

        self.assertTrue(mask[ACTIONS["RANGED_ATTACK_WEAK"]])
        self.assertTrue(mask[ACTIONS["RANGED_ATTACK_NEAREST"]])
        self.assertTrue(mask[ACTIONS["KITE_SAFE_MOVE"]])

    def test_action_mask_hides_kite_without_visible_pressure(self):
        state = {
            "player": {"x": 5, "y": 5, "class": "mage", "hp": 10, "maxHp": 20},
            "map": [[1 for _ in range(12)] for _ in range(12)],
            "visible": set(),
            "enemies": [
                {"id": "far", "x": 10, "y": 5, "hp": 10, "maxHp": 10, "dying": False},
            ],
            "items": [],
            "shops": [],
        }

        mask = get_action_mask(state)

        self.assertFalse(mask[ACTIONS["KITE_SAFE_MOVE"]])

    def test_action_mask_hides_kite_when_safe_move_does_not_increase_distance(self):
        state = {
            "player": {"x": 5, "y": 5, "class": "mage", "hp": 10, "maxHp": 20},
            "map": [[0 for _ in range(12)] for _ in range(12)],
            "visible": {6 * 56 + 6},
            "enemies": [
                {"id": "e", "x": 6, "y": 6, "hp": 10, "maxHp": 10, "dying": False},
            ],
            "items": [],
            "shops": [],
        }
        state["map"][5][5] = 1
        state["map"][5][6] = 1

        mask = get_action_mask(state)

        self.assertFalse(mask[ACTIONS["KITE_SAFE_MOVE"]])

    def test_vector_env_translates_tactical_actions(self):
        state = {
            "player": {"x": 5, "y": 5, "class": "ranger"},
            "map": [[1 for _ in range(12)] for _ in range(12)],
            "visible": {5 * 56 + 7, 5 * 56 + 8},
            "enemies": [
                {"id": "weak", "x": 7, "y": 5, "hp": 3, "maxHp": 20, "dying": False},
                {"id": "strong", "x": 8, "y": 5, "hp": 20, "maxHp": 20, "dying": False},
            ],
            "items": [],
            "shops": [],
        }
        env = DelveVectorEnv(num_envs=1, envs_per_worker=1)
        try:
            self.assertEqual(
                env.action_to_decision(state, ACTIONS["RANGED_ATTACK_WEAK"]),
                {"type": "attack", "target": "weak"},
            )
            self.assertEqual(
                env.action_to_decision(state, ACTIONS["KITE_SAFE_MOVE"]),
                {"type": "key", "val": "ArrowLeft"},
            )
        finally:
            env.close()


if __name__ == "__main__":
    unittest.main()

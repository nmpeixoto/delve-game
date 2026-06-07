import os
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NN_RL_DIR = os.path.join(REPO_ROOT, "automation", "nn_rl")
sys.path.insert(0, NN_RL_DIR)

from headless_bridge import HeadlessWorker, RL_RUNNER
from action_mask import get_action_mask
from config import ACTION_DIM, ACTIONS
from reward import compute_reward
from state_extractor import extract_state
from train import curriculum_phase_for_step, resolve_resume_checkpoint
from vector_env import DelveVectorEnv


class NnRlBridgeTest(unittest.TestCase):
    def test_runner_path_points_to_existing_repo_script(self):
        self.assertTrue(os.path.exists(str(RL_RUNNER)), str(RL_RUNNER))
        self.assertTrue(str(RL_RUNNER).endswith(os.path.join("automation", "headless_rl_runner.js")))

    def test_worker_init_returns_real_player_snapshot(self):
        worker = HeadlessWorker(num_envs=1)
        try:
            states = worker.init_envs([1234], ["mage"])
            self.assertEqual(len(states), 1)
            state = states[0]
            self.assertTrue(state["ready"])
            self.assertIn("player", state)
            self.assertEqual(state["player"]["class"], "mage")
            self.assertGreater(state["player"]["hp"], 0)
        finally:
            worker.shutdown()

    def test_vector_env_uses_real_game_states_for_observations(self):
        env = DelveVectorEnv(num_envs=1, envs_per_worker=1)
        try:
            state = env.get_states()[0]
            obs = extract_state(state)
            self.assertEqual(obs.shape, (148,))
            self.assertGreater(obs[0], 0.0)

            first_valid_action = int(env.get_action_masks()[0].nonzero()[0][0])
            next_states, rewards, dones, infos = env.step([first_valid_action])
            self.assertEqual(len(next_states), 1)
            self.assertEqual(rewards.shape, (1,))
            self.assertEqual(dones.shape, (1,))
            self.assertIn("total_steps", infos[0])
        finally:
            env.close()

    def test_vector_env_caps_episode_length_with_timeout_penalty(self):
        env = DelveVectorEnv(
            num_envs=1,
            envs_per_worker=1,
            max_episode_steps=1,
            timeout_penalty=-7.0,
        )
        try:
            _, rewards, dones, infos = env.step([17])
            self.assertTrue(dones[0])
            self.assertTrue(infos[0]["timeout"])
            self.assertLessEqual(rewards[0], -7.0)
            self.assertEqual(infos[0]["total_steps"], 1)
        finally:
            env.close()

    def test_curriculum_target_floor_ends_episode_as_success(self):
        env = DelveVectorEnv.__new__(DelveVectorEnv)
        env.max_episode_steps = 5000
        env.timeout_penalty = -250.0
        env.curriculum_max_floor = 2
        env.curriculum_reward = 125.0
        env.episode_lengths = [42]
        env.episode_rewards = [10.0]

        reward, done, info = env._apply_terminal_rules(
            env_id=0,
            state={"floor": 3, "won": False, "gameOver": False},
            done=False,
            reward=5.0,
        )

        self.assertTrue(done)
        self.assertEqual(info["outcome"], "curriculum")
        self.assertTrue(info["curriculum_success"])
        self.assertEqual(info["final_floor"], 3)
        self.assertEqual(reward, 130.0)

    def test_curriculum_does_not_end_before_target_floor_is_cleared(self):
        env = DelveVectorEnv.__new__(DelveVectorEnv)
        env.max_episode_steps = 5000
        env.timeout_penalty = -250.0
        env.curriculum_max_floor = 2
        env.curriculum_reward = 125.0
        env.episode_lengths = [42]
        env.episode_rewards = [10.0]

        reward, done, info = env._apply_terminal_rules(
            env_id=0,
            state={"floor": 2, "won": False, "gameOver": False},
            done=False,
            reward=5.0,
        )

        self.assertFalse(done)
        self.assertEqual(info["outcome"], "running")
        self.assertFalse(info["curriculum_success"])
        self.assertEqual(reward, 5.0)

    def test_resume_latest_uses_highest_step_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            open(os.path.join(tmp, "delve_ppo_100.pt"), "wb").close()
            open(os.path.join(tmp, "delve_ppo_250.pt"), "wb").close()
            open(os.path.join(tmp, "not_a_checkpoint.pt"), "wb").close()

            path, step = resolve_resume_checkpoint("latest", tmp)

            self.assertEqual(os.path.basename(path), "delve_ppo_250.pt")
            self.assertEqual(step, 250)

    def test_curriculum_phase_for_step_uses_cumulative_boundaries(self):
        curriculum = [
            {"name": "easy", "max_floor": 2, "steps": 10},
            {"name": "medium", "max_floor": 3, "steps": 20},
            {"name": "hard", "max_floor": 4, "steps": 30},
        ]

        self.assertEqual(curriculum_phase_for_step(0, curriculum), (0, 0))
        self.assertEqual(curriculum_phase_for_step(9, curriculum), (0, 9))
        self.assertEqual(curriculum_phase_for_step(10, curriculum), (1, 0))
        self.assertEqual(curriculum_phase_for_step(29, curriculum), (1, 19))
        self.assertEqual(curriculum_phase_for_step(30, curriculum), (2, 0))
        self.assertEqual(curriculum_phase_for_step(100, curriculum), (2, 70))

    def test_reward_penalizes_no_progress_seen_tile_loops(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 5, "y": 5, "lvl": 1, "gold": 0},
            "enemies": [],
            "seen_count": 100,
            "known_stairs": False,
        }

        reward = compute_reward(state, 0, {**state, "player": {**state["player"], "x": 6}})

        self.assertLessEqual(reward, -0.04)

    def test_reward_makes_single_tile_exploration_nearly_neutral(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 5, "y": 5, "lvl": 1, "gold": 0},
            "enemies": [],
            "seen_count": 100,
            "known_stairs": False,
        }

        reward = compute_reward(state, 0, {**state, "seen_count": 101, "player": {**state["player"], "x": 6}})

        self.assertLess(reward, 0.05)

    def test_reward_strongly_prefers_floor_progress_over_exploration(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 5, "y": 5, "lvl": 1, "gold": 0},
            "enemies": [],
            "seen_count": 100,
            "known_stairs": True,
        }

        reward = compute_reward(state, 13, {**state, "floor": 2, "seen_count": 0})

        self.assertGreaterEqual(reward, 100.0)

    def test_reward_for_picking_up_key(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 5, "y": 5, "lvl": 1, "gold": 0},
            "enemies": [],
            "items": [{"id": "key-1", "type": "key", "carried": False}],
            "seen_count": 100,
            "known_stairs": False,
        }
        after = {**state, "items": [{"id": "key-1", "type": "key", "carried": True}]}

        reward = compute_reward(state, 0, after)

        self.assertGreaterEqual(reward, 15.0)

    def test_reward_for_unlocking_locked_door(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 5, "y": 5, "lvl": 1, "gold": 0},
            "enemies": [],
            "items": [{"id": "key-1", "type": "key", "carried": True}],
            "map": [[1, 4]],
            "seen_count": 100,
            "known_stairs": False,
        }
        after = {
            **state,
            "items": [],
            "map": [[1, 1]],
        }

        reward = compute_reward(state, 0, after)

        self.assertGreaterEqual(reward, 25.0)

    def test_reward_for_revealing_secret_door(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 5, "y": 5, "lvl": 1, "gold": 0},
            "enemies": [],
            "map": [[1, 5]],
            "seen_count": 100,
            "known_stairs": False,
        }
        after = {**state, "map": [[1, 1]]}

        reward = compute_reward(state, 0, after)

        self.assertGreaterEqual(reward, 20.0)

    def test_reward_for_revealing_trap_with_detection(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 5, "y": 5, "lvl": 1, "gold": 0},
            "enemies": [],
            "traps": [{"x": 2, "y": 2, "revealed": False, "triggered": False}],
            "seen_count": 100,
            "known_stairs": False,
        }
        after = {**state, "traps": [{"x": 2, "y": 2, "revealed": True, "triggered": False}]}

        reward = compute_reward(state, 12, after)

        self.assertGreaterEqual(reward, 8.0)

    def test_action_space_excludes_non_gameplay_wait_and_inventory_toggle(self):
        self.assertEqual(ACTION_DIM, 18)
        self.assertNotIn("WAIT", ACTIONS)
        self.assertNotIn("INVENTORY", ACTIONS)
        self.assertEqual(max(ACTIONS.values()), ACTION_DIM - 1)

    def test_action_mask_uses_current_action_space_without_wait_slot(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 1, "y": 1, "lvl": 1, "class": "warrior"},
            "map": [
                [0, 0, 0],
                [0, 1, 1],
                [0, 1, 0],
            ],
            "enemies": [],
            "items": [],
            "shops": [],
            "seen": {57},
            "visible": {57},
            "ability1Cooldown": 0,
            "ability2Cooldown": 0,
        }

        mask = get_action_mask(state)

        self.assertEqual(mask.shape, (ACTION_DIM,))
        self.assertTrue(mask.any())
        self.assertFalse(mask[ACTIONS["ABILITY1"]])

    def test_action_to_decision_never_returns_hidden_wait(self):
        env = DelveVectorEnv.__new__(DelveVectorEnv)
        state = {
            "player": {"x": 1, "y": 1, "hp": 20, "maxHp": 20},
            "enemies": [],
            "items": [],
            "shopOpen": False,
        }

        for action in range(ACTION_DIM + 3):
            decision = env.action_to_decision(state, action)
            self.assertNotEqual(decision.get("type"), "wait")


if __name__ == "__main__":
    unittest.main()

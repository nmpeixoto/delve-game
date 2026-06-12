import os
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NN_RL_DIR = os.path.join(REPO_ROOT, "automation", "nn_rl")
sys.path.insert(0, NN_RL_DIR)

from headless_bridge import HeadlessWorker, RL_RUNNER
from action_mask import get_action_mask
from config import (
    ACTION_DIM, ACTIONS, CURRICULUM, MAX_SHOP_SLOTS, REWARD_CURRICULUM_SUCCESS,
    SHOP_ITEM_FEATURES, STATE_DIM,
)

from reward import compute_reward
from state_extractor import extract_state
from train import (
    episode_class_summary,
    curriculum_metric_label,
    curriculum_phase_for_step,
    curriculum_phase_target,
    format_episode_cap,
    format_training_status,
    curriculum_should_advance,
    new_episode_window,
    parse_args,
    record_episode,
    resolve_resume_checkpoint,
    summarize_actions,
)
from vector_env import DelveVectorEnv, SubprocVecEnv


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
            self.assertEqual(obs.shape, (STATE_DIM,))
            self.assertGreater(obs[0], 0.0)

            first_valid_action = int(env.get_action_masks()[0].nonzero()[0][0])
            next_states, rewards, dones, infos = env.step([first_valid_action])
            self.assertEqual(len(next_states), 1)
            self.assertEqual(rewards.shape, (1,))
            self.assertEqual(dones.shape, (1,))
            self.assertIn("total_steps", infos[0])
        finally:
            env.close()

    def test_extract_state_includes_current_shop_stock(self):
        state = {
            "floor": 2,
            "turn": 10,
            "player": {"hp": 20, "maxHp": 20, "atk": 5, "def": 3, "lvl": 1, "x": 1, "y": 1, "gold": 100, "class": "warrior"},
            "map": [[1, 1], [1, 2]],
            "items": [],
            "enemies": [],
            "seen": {0, 1, 2, 3},
            "visible": {0, 1, 2, 3},
            "shopOpen": True,
            "currentShop": {
                "stock": [
                    {"id": "p1", "type": "potion", "price": 25, "heal": 15, "atk": 0, "def": 0, "amount": 0, "rarity": "common", "sold": False},
                    {"id": "u1", "type": "upgrade", "price": 100, "heal": 0, "atk": 0, "def": 0, "amount": 2, "rarity": "rare", "sold": False},
                ],
            },
        }

        obs = extract_state(state)
        shop_start = STATE_DIM - MAX_SHOP_SLOTS * SHOP_ITEM_FEATURES

        self.assertEqual(obs.shape, (STATE_DIM,))
        self.assertEqual(obs[shop_start], 1.0)
        self.assertEqual(obs[shop_start + 1], 1.0)

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
        env.curriculum_reward = REWARD_CURRICULUM_SUCCESS
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
        self.assertGreaterEqual(reward, 300.0)

    def test_curriculum_does_not_end_before_target_floor_is_cleared(self):
        env = DelveVectorEnv.__new__(DelveVectorEnv)
        env.max_episode_steps = 5000
        env.timeout_penalty = -250.0
        env.curriculum_max_floor = 2
        env.curriculum_reward = REWARD_CURRICULUM_SUCCESS
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

    def test_default_curriculum_requires_full_normal_clear_before_hard_mode(self):
        self.assertEqual(len(CURRICULUM), 2)
        self.assertEqual(CURRICULUM[0]["name"], "full_dungeon_normal")
        self.assertIsNone(CURRICULUM[0]["max_floor"])
        self.assertFalse(CURRICULUM[0]["hard_mode"])
        self.assertEqual(CURRICULUM[0]["success_threshold"], 0.80)
        self.assertEqual(CURRICULUM[1]["name"], "full_dungeon_hard")
        self.assertIsNone(CURRICULUM[1]["max_floor"])
        self.assertTrue(CURRICULUM[1]["hard_mode"])

    def test_extract_state_exposes_hard_mode(self):
        normal = self._known_stairs_state(player_x=5, player_y=5, stairs_x=8, stairs_y=5)
        hard = self._known_stairs_state(player_x=5, player_y=5, stairs_x=8, stairs_y=5)
        normal["hardMode"] = False
        hard["hardMode"] = True

        normal_obs = extract_state(normal)
        hard_obs = extract_state(hard)
        changed = np.flatnonzero(normal_obs != hard_obs)

        self.assertEqual(len(changed), 1)
        self.assertEqual(normal_obs[changed[0]], 0.0)
        self.assertEqual(hard_obs[changed[0]], 1.0)

    def test_curriculum_metric_label_names_active_goal(self):
        self.assertEqual(curriculum_metric_label({"max_floor": 1}), "Floor 2")
        self.assertEqual(curriculum_metric_label({"max_floor": 4}), "Floor 5")
        self.assertEqual(curriculum_metric_label({"max_floor": None}), "Full Win")

    def test_curriculum_phase_target_describes_mastery_goal(self):
        target = curriculum_phase_target({
            "max_floor": 1,
            "success_threshold": 0.8,
            "success_window": 100,
        })

        self.assertEqual(target, "reach Floor 2 at 80% over 100 episodes")

    def test_curriculum_phase_target_describes_full_clear_mastery_goal(self):
        target = curriculum_phase_target({
            "max_floor": None,
            "success_threshold": 0.8,
            "success_window": 1000,
        })

        self.assertEqual(target, "clear full dungeon at 80% over 1000 episodes")

    def test_curriculum_does_not_advance_on_timer_without_mastery(self):
        phase = {
            "name": "descend_floor_1",
            "max_floor": 1,
            "steps": 2_000_000,
            "min_steps": 500_000,
            "success_threshold": 0.80,
            "success_window": 100,
        }
        results = [True] * 45 + [False] * 55

        should_advance = curriculum_should_advance(phase, results, steps_in_phase=2_500_000)

        self.assertFalse(should_advance)

    def test_curriculum_advances_after_mastery_window(self):
        phase = {
            "name": "descend_floor_1",
            "max_floor": 1,
            "min_steps": 500_000,
            "success_threshold": 0.80,
            "success_window": 100,
        }
        window = new_episode_window(window=100)
        for _ in range(41):
            record_episode(window, {
                "total_reward": 10.0,
                "total_steps": 20,
                "won": False,
                "final_floor": 2,
                "outcome": "curriculum",
                "curriculum_success": True,
                "class_name": "warrior",
            })
        for _ in range(9):
            record_episode(window, {
                "total_reward": 10.0,
                "total_steps": 20,
                "won": False,
                "final_floor": 2,
                "outcome": "curriculum",
                "curriculum_success": False,
                "class_name": "warrior",
            })
        for _ in range(41):
            record_episode(window, {
                "total_reward": 10.0,
                "total_steps": 20,
                "won": False,
                "final_floor": 2,
                "outcome": "curriculum",
                "curriculum_success": True,
                "class_name": "mage",
            })
        for _ in range(9):
            record_episode(window, {
                "total_reward": 10.0,
                "total_steps": 20,
                "won": False,
                "final_floor": 2,
                "outcome": "curriculum",
                "curriculum_success": False,
                "class_name": "mage",
            })

        should_advance = curriculum_should_advance(phase, window, steps_in_phase=750_000)

        self.assertTrue(should_advance)

    def test_curriculum_does_not_advance_when_one_class_carries_window(self):
        phase = {
            "name": "descend_floor_1",
            "max_floor": 1,
            "min_steps": 500_000,
            "success_threshold": 0.80,
            "success_window": 100,
        }
        window = new_episode_window(window=100)
        for _ in range(90):
            record_episode(window, {
                "total_reward": 10.0,
                "total_steps": 20,
                "won": False,
                "final_floor": 2,
                "outcome": "curriculum",
                "curriculum_success": True,
                "class_name": "warrior",
            })
        for _ in range(10):
            record_episode(window, {
                "total_reward": 10.0,
                "total_steps": 20,
                "won": False,
                "final_floor": 2,
                "outcome": "curriculum",
                "curriculum_success": False,
                "class_name": "mage",
            })

        should_advance = curriculum_should_advance(phase, window, steps_in_phase=750_000)

        self.assertFalse(should_advance)

    def test_new_phase_window_starts_empty(self):
        window = new_episode_window(window=4)
        record_episode(window, {
            "total_reward": 10.0,
            "total_steps": 20,
            "won": False,
            "final_floor": 2,
            "outcome": "curriculum",
            "curriculum_success": True,
        })

        reset_window = new_episode_window(window=4)

        self.assertEqual(list(window["curriculum"]), [True])
        self.assertEqual(len(reset_window["rewards"]), 0)
        self.assertEqual(len(reset_window["curriculum"]), 0)
        self.assertEqual(len(reset_window["classes"]), 0)

    def test_train_default_episode_cap_allows_unbounded_full_dungeon_rollouts(self):
        with patch.object(sys, "argv", ["train.py"]):
            args = parse_args()

        self.assertEqual(args.max_episode_steps, 0)

    def test_train_accepts_explicit_episode_cap_for_stall_guard(self):
        with patch.object(sys, "argv", ["train.py", "--max-episode-steps", "6000"]):
            args = parse_args()

        self.assertEqual(args.max_episode_steps, 6000)

    def test_vector_env_default_has_no_hidden_episode_timeout(self):
        env = DelveVectorEnv(num_envs=1, envs_per_worker=1)
        try:
            self.assertEqual(env.max_episode_steps, 0)
        finally:
            env.close()

    def test_episode_cap_label_reports_unlimited_rollouts(self):
        self.assertEqual(format_episode_cap(0), "unlimited")
        self.assertEqual(format_episode_cap(-1), "unlimited")
        self.assertEqual(format_episode_cap(6000), "6,000 steps")

    def test_train_defaults_use_multiple_workers(self):
        with patch.object(sys, "argv", ["train.py"]):
            args = parse_args()

        self.assertGreater(args.num_envs, args.envs_per_worker)
        self.assertEqual(args.num_envs, 128)
        self.assertEqual(args.envs_per_worker, 16)

    def test_subproc_vec_env_keeps_remainder_envs(self):
        created = []

        class FakePipe:
            def send(self, _msg):
                pass

        class FakeProcess:
            def __init__(self, target, args):
                self.target = target
                self.args = args
                created.append(args)

            def start(self):
                pass

        with patch("vector_env.mp.Pipe", side_effect=lambda: (FakePipe(), FakePipe())):
            with patch("vector_env.mp.Process", FakeProcess):
                env = SubprocVecEnv(num_envs=5, envs_per_worker=2)

        self.assertEqual(env.num_workers, 3)
        self.assertEqual(env.worker_env_counts, [2, 2, 1])
        self.assertEqual([args[1]["num_envs"] for args in created], [2, 2, 1])

    def test_subproc_vec_env_surfaces_worker_errors(self):
        class FailingPipe:
            def send(self, _msg):
                pass

            def recv(self):
                return ("error", "worker traceback")

        env = SubprocVecEnv.__new__(SubprocVecEnv)
        env.pipes = [FailingPipe()]

        with self.assertRaisesRegex(RuntimeError, "worker traceback"):
            env.reset()

    def test_resume_can_reset_optimizer_for_changed_reward(self):
        with patch.object(sys, "argv", ["train.py", "--resume", "latest", "--reset-optimizer"]):
            args = parse_args()

        self.assertTrue(args.reset_optimizer)

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

        self.assertLess(reward, 0.2)

    def test_reward_strongly_prefers_floor_progress_over_exploration(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 5, "y": 5, "lvl": 1, "gold": 0},
            "enemies": [],
            "seen_count": 100,
            "known_stairs": True,
        }

        reward = compute_reward(state, 13, {**state, "floor": 2, "seen_count": 0})

        self.assertGreaterEqual(reward, 49.0)

    def test_full_win_reward_dominates_shaped_progress(self):
        state = self._known_stairs_state(player_x=5, player_y=5, stairs_x=5, stairs_y=5)
        state["floor"] = 5
        state["player"].update({"lvl": 12, "atk": 24, "def": 12, "maxHp": 120, "hp": 115})

        reward = compute_reward(state, ACTIONS["DESCEND"], {**state, "won": True})

        self.assertGreaterEqual(reward, 3000.0)

    def test_death_reward_is_strongly_negative_even_after_progress(self):
        state = self._known_stairs_state(player_x=5, player_y=5, stairs_x=8, stairs_y=5)
        state["floor"] = 3

        reward = compute_reward(state, ACTIONS["MOVE_RIGHT"], {**state, "gameOver": True})

        self.assertLessEqual(reward, -500.0)

    def test_prepared_descend_is_better_than_underprepared_rush(self):
        prepared = self._known_stairs_state(player_x=5, player_y=5, stairs_x=5, stairs_y=5)
        prepared["floor"] = 3
        prepared["player"].update({
            "lvl": 7,
            "atk": 16,
            "def": 8,
            "maxHp": 90,
            "hp": 85,
        })
        prepared["items"] = [
            {"id": "p1", "type": "potion", "carried": True},
            {"id": "b1", "type": "bomb", "carried": True},
        ]

        rushed = self._known_stairs_state(player_x=5, player_y=5, stairs_x=5, stairs_y=5)
        rushed["floor"] = 3
        rushed["seen"] = {5 * 56 + 5}
        rushed["seen_count"] = 1
        rushed["player"].update({
            "lvl": 2,
            "atk": 5,
            "def": 1,
            "maxHp": 30,
            "hp": 14,
        })

        prepared_reward = compute_reward(prepared, ACTIONS["DESCEND"], {**prepared, "floor": 4})
        rushed_reward = compute_reward(rushed, ACTIONS["DESCEND"], {**rushed, "floor": 4})

        self.assertGreater(prepared_reward, rushed_reward + 100.0)
        self.assertGreater(rushed_reward, 0.0)

    def test_reward_prefers_moving_toward_known_stairs(self):
        state = self._known_stairs_state(player_x=5, player_y=5, stairs_x=8, stairs_y=5)
        after = {**state, "player": {**state["player"], "x": 6}}

        reward = compute_reward(state, ACTIONS["MOVE_RIGHT"], after)

        self.assertGreater(reward, 2.0)

    def test_reward_penalizes_moving_away_from_known_stairs(self):
        state = self._known_stairs_state(player_x=5, player_y=5, stairs_x=8, stairs_y=5)
        after = {**state, "player": {**state["player"], "x": 4}}

        reward = compute_reward(state, ACTIONS["MOVE_LEFT"], after)

        self.assertLess(reward, -0.08)

    def test_reward_for_picking_up_key(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 5, "y": 5, "lvl": 1, "gold": 0},
            "enemies": [],
            "items": [{"id": "key-1", "type": "key", "carried": False}],
            "seen_count": 100,
            "known_stairs": False,
            "_current_step": 10,
            "_last_key_pickup_step": -999,
        }
        after = {**state, "items": [{"id": "key-1", "type": "key", "carried": True}],
                 "_last_key_pickup_step": 10}

        reward = compute_reward(state, 0, after)

        self.assertGreaterEqual(reward, 25.0)

    def test_reward_for_unlocking_locked_door(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 5, "y": 5, "lvl": 1, "gold": 0},
            "enemies": [],
            "items": [{"id": "key-1", "type": "key", "carried": True}],
            "map": [[1, 4]],
            "seen_count": 100,
            "known_stairs": False,
            "_current_step": 10,
            "_last_key_pickup_step": 5,
        }
        after = {
            **state,
            "items": [],
            "_doors_unlocked_this_step": 1,
            "_last_door_unlock_step": 10,
        }

        reward = compute_reward(state, 0, after)

        self.assertGreaterEqual(reward, 40.0)

    def test_reward_for_revealing_secret_door(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 5, "y": 5, "lvl": 1, "gold": 0},
            "enemies": [],
            "map": [[1, 5]],
            "seen_count": 100,
            "known_stairs": False,
        }
        after = {**state, "_secrets_revealed_this_step": 1}

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

        self.assertLess(reward, 0.0)

    def test_reward_treats_new_consumable_resources_as_progress(self):
        state = {
            "floor": 1,
            "player": {"hp": 20, "maxHp": 20, "x": 5, "y": 5, "lvl": 1, "gold": 100},
            "enemies": [],
            "items": [],
            "seen_count": 100,
            "known_stairs": False,
        }

        for item_type in ("potion", "bomb", "scroll_teleport"):
            with self.subTest(item_type=item_type):
                after = {
                    **state,
                    "player": {**state["player"], "gold": 75},
                    "items": [{"id": f"{item_type}-1", "type": item_type, "carried": True}],
                }

                reward = compute_reward(state, ACTIONS["SHOP_BUY_0"], after)

                self.assertGreater(reward, 0.0)

    def test_action_space_excludes_non_gameplay_wait_and_inventory_toggle(self):
        self.assertEqual(ACTION_DIM, 36)
        self.assertNotIn("WAIT", ACTIONS)
        self.assertNotIn("INVENTORY", ACTIONS)
        self.assertEqual(max(ACTIONS.values()), ACTION_DIM - 1)
        self.assertIn("SHOP_BUY_0", ACTIONS)

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

    def test_action_mask_allows_exploration_with_known_stairs_before_floor_is_mostly_seen(self):
        state = self._known_stairs_state(player_x=5, player_y=5, stairs_x=8, stairs_y=5)
        state["player"]["class"] = "warrior"
        state["shops"] = []
        state["seen"] = {5 * 56 + x for x in range(5, 9)}
        state["seen_count"] = len(state["seen"])
        state["visible"] = set(state["seen"])
        state["ability1Cooldown"] = 0
        state["ability2Cooldown"] = 0

        mask = get_action_mask(state)

        self.assertTrue(mask[ACTIONS["MOVE_RIGHT"]])
        self.assertTrue(mask[ACTIONS["MOVE_LEFT"]])
        self.assertTrue(mask[ACTIONS["MOVE_UP"]])
        self.assertTrue(mask[ACTIONS["MOVE_DOWN"]])

    def test_action_mask_keeps_exploration_open_when_known_stairs_are_still_far(self):
        state = self._known_stairs_state(player_x=5, player_y=5, stairs_x=11, stairs_y=5)
        state["player"]["class"] = "warrior"
        state["shops"] = []
        state["ability1Cooldown"] = 0
        state["ability2Cooldown"] = 0

        mask = get_action_mask(state)

        self.assertTrue(mask[ACTIONS["MOVE_RIGHT"]])
        self.assertTrue(mask[ACTIONS["MOVE_LEFT"]])
        self.assertTrue(mask[ACTIONS["MOVE_UP"]])
        self.assertTrue(mask[ACTIONS["MOVE_DOWN"]])

    def test_action_mask_prefers_path_to_known_stairs_when_close_and_mostly_seen(self):
        state = self._known_stairs_state(player_x=5, player_y=5, stairs_x=6, stairs_y=5)
        state["player"]["class"] = "warrior"
        state["shops"] = []
        state["ability1Cooldown"] = 0
        state["ability2Cooldown"] = 0

        mask = get_action_mask(state)

        self.assertTrue(mask[ACTIONS["MOVE_RIGHT"]])
        self.assertTrue(mask[ACTIONS["MOVE_LEFT"]])
        self.assertTrue(mask[ACTIONS["MOVE_UP"]])
        self.assertTrue(mask[ACTIONS["MOVE_DOWN"]])

    def test_action_mask_keeps_tactical_options_when_enemy_visible(self):
        state = self._known_stairs_state(player_x=5, player_y=5, stairs_x=8, stairs_y=5)
        state["player"]["class"] = "warrior"
        state["shops"] = []
        state["visible"] = set(state["seen"])
        state["ability1Cooldown"] = 0
        state["ability2Cooldown"] = 0
        state["enemies"] = [{"id": "goblin", "x": 5, "y": 4, "hp": 5, "maxHp": 5}]

        mask = get_action_mask(state)

        self.assertTrue(mask[ACTIONS["MOVE_RIGHT"]])
        self.assertTrue(mask[ACTIONS["MOVE_LEFT"]])
        self.assertFalse(mask[ACTIONS["ATTACK_1"]])

    def test_action_mask_exposes_shop_buy_slots_for_visible_current_shop_stock(self):
        state = {
            "floor": 2,
            "player": {"hp": 20, "maxHp": 20, "x": 1, "y": 1, "lvl": 1, "gold": 500, "class": "warrior"},
            "map": [
                [0, 0, 0],
                [0, 1, 1],
                [0, 1, 0],
            ],
            "enemies": [],
            "items": [],
            "shops": [{"x": 1, "y": 2, "stock": []}],
            "currentShop": {
                "x": 1,
                "y": 2,
                "stock": [
                    {"id": "p1", "type": "potion", "price": 25, "heal": 15, "atk": 0, "def": 0, "amount": 0, "stat": None, "rarity": "common", "sold": False},
                    {"id": "u1", "type": "upgrade", "price": 100, "heal": 0, "atk": 0, "def": 0, "amount": 2, "stat": "atk", "rarity": "rare", "sold": False},
                ],
            },
            "seen": {57},
            "visible": {57},
            "shopOpen": True,
            "ability1Cooldown": 0,
            "ability2Cooldown": 0,
        }

        mask = get_action_mask(state)

        self.assertTrue(mask[ACTIONS["SHOP_BUY_0"]])
        self.assertTrue(mask[ACTIONS["SHOP_BUY_1"]])
        self.assertTrue(mask[ACTIONS["SHOP_SELL"]])
        self.assertTrue(mask[ACTIONS["ESCAPE"]])

    def test_action_mask_allows_final_floor_descend_to_win(self):
        state = self._known_stairs_state(player_x=3, player_y=4, stairs_x=3, stairs_y=4)
        state["floor"] = 5

        mask = get_action_mask(state)

        self.assertTrue(mask[ACTIONS["DESCEND"]])

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

    def test_action_summary_always_reports_descend_when_taken(self):
        action_counts = np.zeros(ACTION_DIM, dtype=np.int64)
        action_counts[ACTIONS["MOVE_RIGHT"]] = 260
        action_counts[ACTIONS["MOVE_LEFT"]] = 260
        action_counts[ACTIONS["MOVE_UP"]] = 220
        action_counts[ACTIONS["MOVE_DOWN"]] = 210
        action_counts[ACTIONS["DESCEND"]] = 5

        summary = summarize_actions(action_counts)

        self.assertIn("Desc", summary)
        self.assertIn("0.5%", summary)

    def test_action_summary_handles_shop_buy_slots(self):
        action_counts = np.zeros(ACTION_DIM, dtype=np.int64)
        action_counts[ACTIONS["SHOP_BUY_0"]] = 120
        action_counts[ACTIONS["DESCEND"]] = 5

        summary = summarize_actions(action_counts)

        self.assertIn("Buy1", summary)

    def test_action_to_decision_targets_specific_shop_slot_when_open(self):
        env = DelveVectorEnv.__new__(DelveVectorEnv)
        state = {
            "player": {"x": 1, "y": 1, "hp": 20, "maxHp": 20, "gold": 500},
            "shopOpen": True,
            "currentShop": {
                "stock": [
                    {"id": "p1", "type": "potion", "price": 25, "sold": False},
                    {"id": "u1", "type": "upgrade", "price": 100, "sold": False},
                ],
            },
            "shops": [{"x": 1, "y": 2, "stock": []}],
            "items": [],
            "enemies": [],
        }

        decision = env.action_to_decision(state, ACTIONS["SHOP_BUY_1"])

        self.assertEqual(decision["type"], "click")
        self.assertIn("u1", decision["target"])

    def test_class_summary_reports_per_class_counts_and_rates(self):
        window = new_episode_window(window=8)
        for class_name, success in [
            ("warrior", True),
            ("warrior", False),
            ("mage", True),
            ("mage", True),
            ("rogue", False),
        ]:
            record_episode(window, {
                "total_reward": 10.0,
                "total_steps": 20,
                "won": False,
                "final_floor": 2,
                "outcome": "curriculum",
                "curriculum_success": success,
                "class_name": class_name,
            })

        summary = episode_class_summary(window, "curriculum")

        self.assertIn("Class counts:", summary)
        self.assertIn("warrior 1/2 (50%)", summary)
        self.assertIn("mage 2/2 (100%)", summary)
        self.assertIn("rogue 0/1 (0%)", summary)

    def test_training_status_explains_when_the_run_is_below_target(self):
        readout = format_training_status(
            "Floor 3",
            progress_rate=0.222,
            progress_threshold=0.75,
            timeout_rate=0.68,
            death_rate=0.09,
            avg_floor=1.79,
            progress_delta=-0.092,
        )

        self.assertIn("Floor 3 22.2%", readout)
        self.assertIn("52.8 pts below target", readout)
        self.assertIn("slipping (-9.2 pts)", readout)
        self.assertIn("timeouts high", readout)

    def _known_stairs_state(self, player_x, player_y, stairs_x, stairs_y):
        width = 12
        height = 10
        map_data = [[1 for _ in range(width)] for _ in range(height)]
        map_data[stairs_y][stairs_x] = 2
        seen = {y * 56 + x for y in range(height) for x in range(width)}
        return {
            "floor": 1,
            "player": {
                "hp": 20,
                "maxHp": 20,
                "x": player_x,
                "y": player_y,
                "lvl": 1,
                "gold": 0,
            },
            "enemies": [],
            "items": [],
            "map": map_data,
            "seen": seen,
            "seen_count": len(seen),
            "known_stairs": True,
            "_stair_coords": [(stairs_x, stairs_y)],
            "_walkable_total": width * height,
        }


if __name__ == "__main__":
    unittest.main()

import os
import sys
import unittest

import torch

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NN_RL_DIR = os.path.join(REPO_ROOT, "automation", "nn_rl")
sys.path.insert(0, NN_RL_DIR)

from config import ACTIONS
from game_engine import DelveGame, FLOOR_ENEMY_PROFILES, TILE_FLOOR
from pathfinding import floor_exploration_ratio
from ppo import RolloutBuffer
from state_extractor import extract_local_map
from train import curriculum_should_advance, new_episode_window, parse_args, record_episode
from vector_env import DelveVectorEnv


class NnRlPretrainingBugHuntTest(unittest.TestCase):
    def test_vector_env_injects_doors_unlocked_this_step_for_reward(self):
        env = DelveVectorEnv.__new__(DelveVectorEnv)
        env.last_floor = [1]
        env.last_floor_change_step = [0]
        env.last_key_pickup_step = [4]
        env.last_door_unlock_step = [-999]
        env.last_enemy_kill_step = [-999]
        env.doors_opened_this_floor = [0]
        env.keys_used_this_floor = [0]
        env.episode_lengths = [7]

        curr_state = {"floor": 1, "_door_count": 1, "_secret_count": 0, "items": [], "enemies": []}
        env._detect_events(
            0,
            {"floor": 1, "_door_count": 2, "_secret_count": 0, "items": [], "enemies": []},
            curr_state,
            ACTIONS["MOVE_RIGHT"],
        )

        self.assertEqual(curr_state["_doors_unlocked_this_step"], 1)
        self.assertEqual(env.doors_opened_this_floor[0], 1)
        self.assertEqual(env.last_door_unlock_step[0], 7)

    def test_python_snapshot_exports_walkable_total_for_exploration_ratio(self):
        game = DelveGame(seed=42, player_class="ranger")
        state = game.snapshot()

        self.assertGreater(state["_walkable_total"], 0)
        self.assertGreater(floor_exploration_ratio(state, state["map"]), 0.0)

    def test_detection_scroll_updates_secret_count_when_revealing_secret_doors(self):
        game = DelveGame(seed=42, player_class="ranger")
        initial_secret_count = game._secret_count
        self.assertGreater(initial_secret_count, 0)
        initial_walkable = game._walkable_total
        game.items.append({
            "id": "detect-1",
            "name": "Scroll of Detection",
            "type": "scroll",
            "carried": True,
        })

        game.use_item("scroll")

        self.assertEqual(game._secret_count, 0)
        self.assertEqual(game._walkable_total, initial_walkable + initial_secret_count)

    def test_bosses_are_encoded_in_boss_channel_not_standard_enemy_channel(self):
        state = {
            "player": {"x": 4, "y": 4},
            "map": [[TILE_FLOOR for _ in range(9)] for _ in range(9)],
            "seen": {y * 56 + x for y in range(9) for x in range(9)},
            "enemies": [{"id": "boss", "x": 5, "y": 4, "hp": 10, "maxHp": 10, "boss": True}],
            "items": [],
        }

        local_map = extract_local_map(state)

        self.assertEqual(local_map[6, 4, 5], 1.0)
        self.assertEqual(local_map[4, 4, 5], 0.0)

    def test_greed_shrine_applies_two_full_js_level_ups(self):
        game = DelveGame(seed=1, player_class="warrior")
        game.current_shrine = {"id": "greed", "shrineType": "Greed"}
        game.items.append({"id": "greed", "type": "shrine", "shrineType": "Greed"})
        before = dict(game.player)
        game.player["gold"] = 123

        game.accept_shrine()

        self.assertEqual(game.player["gold"], 0)
        self.assertEqual(game.player["lvl"], before["lvl"] + 2)
        self.assertEqual(game.player["atk"], before["atk"] + 2)
        self.assertEqual(game.player["def"], before["def"] + 2)
        self.assertEqual(game.player["maxHp"], before["maxHp"] + 16)
        self.assertFalse(any(item.get("id") == "greed" for item in game.items))

    def test_cursed_shrine_spawns_js_scaled_named_elites(self):
        game = DelveGame(seed=7, player_class="warrior")
        game.floor = 3
        game.map = [[TILE_FLOOR for _ in range(56)] for _ in range(36)]
        game.enemies = []
        game.player["x"] = 20
        game.player["y"] = 20
        game.current_shrine = {"id": "cursed", "shrineType": "Cursed"}
        game.items.append({"id": "cursed", "type": "shrine", "shrineType": "Cursed"})

        game.accept_shrine()

        spawned = [enemy for enemy in game.enemies if enemy.get("isElite")]
        profile = FLOOR_ENEMY_PROFILES[2]
        self.assertEqual(len(spawned), 3)
        self.assertTrue(all(enemy["name"].startswith("Cursed ") for enemy in spawned))
        self.assertTrue(all(enemy["atk"] % 2 == 0 for enemy in spawned))
        self.assertTrue(all(enemy["xp"] > 0 and enemy["gold"] > 0 for enemy in spawned))
        self.assertTrue(all(profile["tierMin"] <= _enemy_tier(enemy["sym"]) <= profile["tierMax"] for enemy in spawned))

    def test_shop_buy_and_sell_actions_do_not_advance_game_turns(self):
        game = DelveGame(seed=11, player_class="warrior")
        game.enemies = []
        game.player["gold"] = 100
        game.current_shop = {
            "x": game.player["x"],
            "y": game.player["y"],
            "stock": [{"id": "shop-potion", "name": "Health Potion", "type": "potion", "heal": 15, "price": 25, "sold": False}],
        }
        env = DelveVectorEnv.__new__(DelveVectorEnv)
        turn_before = game.turn

        env._resolve_click_action(
            game,
            game.snapshot(),
            {"type": "click", "target": '.shop-item[onclick*="shop-potion"]'},
        )
        env._resolve_click_action(
            game,
            game.snapshot(),
            {"type": "click", "target": 'button[onclick="sellWeakerGear()"]'},
        )

        self.assertEqual(game.turn, turn_before)
        self.assertTrue(game.current_shop["stock"][0]["sold"])

    def test_full_dungeon_curriculum_can_advance_on_class_average_wins(self):
        phase = {
            "name": "full_dungeon_normal",
            "max_floor": None,
            "success_threshold": 0.80,
            "success_window": 4,
            "min_steps": 10,
        }
        window = new_episode_window(window=4)
        for class_name, won in [
            ("warrior", True),
            ("warrior", True),
            ("mage", True),
            ("mage", True),
        ]:
            record_episode(window, {
                "won": won,
                "curriculum_success": False,
                "final_floor": 5 if won else 3,
                "outcome": "won" if won else "dead",
                "class_name": class_name,
            })

        self.assertTrue(curriculum_should_advance(phase, window, steps_in_phase=10))

    def test_training_cli_accepts_final_handoff_aliases(self):
        args = parse_args(["--steps", "1234", "--envs", "4"])

        self.assertEqual(args.total_timesteps, 1234)
        self.assertEqual(args.num_envs, 4)

    def test_rollout_buffer_stores_zero_hidden_for_first_step(self):
        buffer = RolloutBuffer(num_envs=2, rollout_steps=1, state_dim=3, action_dim=4, hidden_dim=5, device="cpu")

        buffer.store(
            step=0,
            states=torch.zeros(2, 3),
            maps=torch.zeros(2, 9, 8, 8),
            actions=torch.zeros(2, dtype=torch.long),
            log_probs=torch.zeros(2),
            values=torch.zeros(2),
            rewards=torch.zeros(2),
            dones=torch.zeros(2, dtype=torch.bool),
            masks=torch.ones(2, 4, dtype=torch.bool),
            hidden=None,
        )

        self.assertTrue(torch.equal(buffer.hiddens[0], torch.zeros(2, 5)))

    def test_rollout_buffer_batches_short_smoke_rollouts(self):
        buffer = RolloutBuffer(num_envs=2, rollout_steps=2, state_dim=3, action_dim=4, hidden_dim=5, device="cpu")

        batches = list(buffer.get_batches(batch_size=4))

        self.assertGreater(len(batches), 0)
        self.assertEqual({batch["seq_len"] for batch in batches}, {2})
        self.assertEqual(sum(batch["actions"].numel() for batch in batches), 4)


def _enemy_tier(sym):
    return {
        "r": 0,
        "g": 1,
        "s": 2,
        "o": 3,
        "T": 4,
        "D": 5,
        "L": 6,
    }[sym]


if __name__ == "__main__":
    unittest.main()

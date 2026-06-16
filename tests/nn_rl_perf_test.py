import os
import inspect
import sys
import unittest

import numpy as np

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NN_RL_DIR = os.path.join(REPO_ROOT, "automation", "nn_rl")
sys.path.insert(0, NN_RL_DIR)

from action_mask import get_action_mask
from async_trainer import RolloutPacket, collect_rollout
from config import ACTION_DIM, STATE_DIM
from game_engine import DelveGame
from observation import allocate_observation_arrays, observe_game_into
from pathfinding import compute_navigation_features, nearest_poi_direction, nearest_unseen_direction, shortest_stairs_distance
from perf_probe import summarize_stage_timings
from state_extractor import extract_local_map, extract_state, numpyize_maps, numpyize_states
from vector_env import DelveVectorEnv, SubprocVecEnv


class NnRlPerfTest(unittest.TestCase):
    def test_summarize_stage_timings_reports_percentages(self):
        summary = summarize_stage_timings({
            "env_step": 6.0,
            "observe": 3.0,
            "learner": 1.0,
        })

        self.assertEqual(summary["total_seconds"], 10.0)
        self.assertAlmostEqual(summary["stages"]["env_step"]["pct"], 60.0)
        self.assertAlmostEqual(summary["stages"]["observe"]["pct"], 30.0)
        self.assertAlmostEqual(summary["stages"]["learner"]["pct"], 10.0)


class NnRlPathfindingCacheTest(unittest.TestCase):
    def test_navigation_feature_bundle_matches_existing_helpers(self):
        game = DelveGame(seed=789, player_class="rogue", hard_mode=False)
        state = game.snapshot()
        p = state["player"]
        bundle = compute_navigation_features(state, state["map"], p["x"], p["y"])

        self.assertEqual(
            bundle["stairs_distance"],
            shortest_stairs_distance(state, state["map"], p["x"], p["y"]),
        )
        self.assertEqual(
            (bundle["unseen_dx"], bundle["unseen_dy"]),
            nearest_unseen_direction(state, state["map"]),
        )
        self.assertEqual(
            (bundle["shop_dx"], bundle["shop_dy"]),
            nearest_poi_direction(state, state["map"], "shop"),
        )
        self.assertEqual(
            (bundle["shrine_dx"], bundle["shrine_dy"]),
            nearest_poi_direction(state, state["map"], "shrine"),
        )
        self.assertEqual(
            (bundle["locked_door_dx"], bundle["locked_door_dy"]),
            nearest_poi_direction(state, state["map"], "locked_door"),
        )


class NnRlAsyncTrainerTest(unittest.TestCase):
    def test_rollout_packet_tracks_policy_version(self):
        packet = RolloutPacket(policy_version=7, total_steps=1024, payload={"loss": 1.0})

        self.assertEqual(packet.policy_version, 7)
        self.assertEqual(packet.total_steps, 1024)
        self.assertEqual(packet.payload["loss"], 1.0)

    def test_collect_rollout_wraps_payload_with_policy_version(self):
        packet = collect_rollout(
            policy_version=3,
            collector_fn=lambda: {"total_steps": "64", "value": 12},
        )

        self.assertEqual(packet.policy_version, 3)
        self.assertEqual(packet.total_steps, 64)
        self.assertEqual(packet.payload["value"], 12)


class NnRlSharedRolloutTest(unittest.TestCase):
    def test_shared_observation_buffer_shapes(self):
        from shared_rollout import SharedObservationBuffer

        buf = SharedObservationBuffer.create(num_envs=3)
        try:
            self.assertEqual(buf.states.shape, (3, STATE_DIM))
            self.assertEqual(buf.maps.shape, (3, 21, 16, 16))
            self.assertEqual(buf.masks.shape, (3, ACTION_DIM))
            buf.states[1, 0] = 0.5
            self.assertAlmostEqual(float(buf.states[1, 0]), 0.5)
        finally:
            buf.close()
            buf.unlink()

    def test_shared_observation_buffer_can_attach_worker_slice(self):
        from shared_rollout import SharedObservationBuffer

        owner = SharedObservationBuffer.create(num_envs=5)
        worker = SharedObservationBuffer.attach(
            owner.state_shm.name,
            owner.map_shm.name,
            owner.mask_shm.name,
            total_envs=5,
            start=2,
            count=2,
        )
        try:
            worker.states[:, 0] = np.array([0.25, 0.75], dtype=np.float32)

            self.assertAlmostEqual(float(owner.states[2, 0]), 0.25)
            self.assertAlmostEqual(float(owner.states[3, 0]), 0.75)
            self.assertEqual(worker.states.shape, (2, STATE_DIM))
            self.assertEqual(worker.maps.shape, (2, 21, 16, 16))
            self.assertEqual(worker.masks.shape, (2, ACTION_DIM))
        finally:
            worker.close()
            owner.close()
            owner.unlink()


class NnRlTensorTransferTest(unittest.TestCase):
    def test_copy_numpy_observation_into_existing_tensors_reuses_targets(self):
        import torch
        from train import copy_numpy_observation_into_tensors

        states_np = np.ones((2, STATE_DIM), dtype=np.float32)
        maps_np = np.ones((2, 21, 16, 16), dtype=np.float32)
        masks_np = np.ones((2, ACTION_DIM), dtype=bool)
        state_t = torch.empty((2, STATE_DIM), dtype=torch.float32)
        map_t = torch.empty((2, 21, 16, 16), dtype=torch.float32)
        mask_t = torch.empty((2, ACTION_DIM), dtype=torch.bool)

        state_id = id(state_t)
        map_id = id(map_t)
        mask_id = id(mask_t)
        result = copy_numpy_observation_into_tensors(
            states_np,
            maps_np,
            masks_np,
            state_t,
            map_t,
            mask_t,
        )

        self.assertIs(result[0], state_t)
        self.assertIs(result[1], map_t)
        self.assertIs(result[2], mask_t)
        self.assertEqual(id(state_t), state_id)
        self.assertEqual(id(map_t), map_id)
        self.assertEqual(id(mask_t), mask_id)
        self.assertTrue(torch.all(state_t == 1.0))
        self.assertTrue(torch.all(map_t == 1.0))
        self.assertTrue(torch.all(mask_t))


class NnRlObservationParityTest(unittest.TestCase):
    def test_observe_game_into_matches_existing_extractors(self):
        game = DelveGame(seed=123, player_class="ranger", hard_mode=False)
        state = game.snapshot()
        arrays = allocate_observation_arrays(1)

        observe_game_into(game, arrays, 0, prev_action=None)

        np.testing.assert_allclose(arrays.states[0], extract_state(state), rtol=0, atol=1e-6)
        np.testing.assert_allclose(arrays.maps[0], extract_local_map(state), rtol=0, atol=1e-6)
        np.testing.assert_array_equal(arrays.masks[0], get_action_mask(state))
        self.assertEqual(arrays.states.shape, (1, STATE_DIM))
        self.assertEqual(arrays.maps.shape, (1, 21, 16, 16))
        self.assertEqual(arrays.masks.shape, (1, ACTION_DIM))

    def test_direct_observation_matches_after_game_steps(self):
        game = DelveGame(seed=456, player_class="mage", hard_mode=False)
        arrays = allocate_observation_arrays(1)
        actions = [
            {"type": "key", "val": "ArrowRight"},
            {"type": "key", "val": "ArrowDown"},
            {"type": "key", "val": "ArrowLeft"},
        ]

        prev_action = None
        for decision in actions:
            game.step(decision)
            state = game.snapshot()
            observe_game_into(game, arrays, 0, prev_action=prev_action)
            np.testing.assert_allclose(arrays.states[0], extract_state(state, prev_action), rtol=0, atol=1e-6)
            np.testing.assert_allclose(arrays.maps[0], extract_local_map(state), rtol=0, atol=1e-6)
            np.testing.assert_array_equal(arrays.masks[0], get_action_mask(state))
            prev_action = 0

    def test_observation_hot_path_does_not_call_snapshot(self):
        import observation

        self.assertNotIn(".snapshot(", inspect.getsource(observation.observe_game_into))

    def test_vector_env_direct_observations_match_legacy_arrays(self):
        env = DelveVectorEnv(num_envs=2, envs_per_worker=2)
        try:
            states = env.get_states()
            direct_states, direct_maps, direct_masks = env.observe_arrays()
            legacy_states = numpyize_states(states, env.get_prev_actions())
            legacy_maps = numpyize_maps(states)
            legacy_masks = np.stack([get_action_mask(state) for state in states])

            np.testing.assert_allclose(direct_states, legacy_states, rtol=0, atol=1e-6)
            np.testing.assert_allclose(direct_maps, legacy_maps, rtol=0, atol=1e-6)
            np.testing.assert_array_equal(direct_masks, legacy_masks)
        finally:
            env.close()

    def test_subproc_vec_env_supports_direct_observation_mode(self):
        env = SubprocVecEnv(num_envs=2, envs_per_worker=2, observation_mode="direct")
        try:
            states, maps, masks = env.reset()

            self.assertEqual(states.shape, (2, STATE_DIM))
            self.assertEqual(maps.shape, (2, 21, 16, 16))
            self.assertEqual(masks.shape, (2, ACTION_DIM))
        finally:
            env.close()

    def test_subproc_vec_env_supports_shared_direct_transport_mode(self):
        env = SubprocVecEnv(
            num_envs=2,
            envs_per_worker=2,
            observation_mode="direct",
            transport_mode="shared",
        )
        try:
            states, maps, masks = env.reset()
            self.assertEqual(states.shape, (2, STATE_DIM))
            self.assertEqual(maps.shape, (2, 21, 16, 16))
            self.assertEqual(masks.shape, (2, ACTION_DIM))

            states, maps, masks, rewards, dones, infos = env.step(np.zeros(2, dtype=np.int64))
            self.assertEqual(states.shape, (2, STATE_DIM))
            self.assertEqual(maps.shape, (2, 21, 16, 16))
            self.assertEqual(masks.shape, (2, ACTION_DIM))
            self.assertEqual(rewards.shape, (2,))
            self.assertEqual(dones.shape, (2,))
            self.assertEqual(len(infos), 2)
        finally:
            env.close()

    def test_subproc_vec_env_supports_shared_contiguous_transport_mode(self):
        env = SubprocVecEnv(
            num_envs=4,
            envs_per_worker=2,
            observation_mode="direct",
            transport_mode="shared-contiguous",
        )
        try:
            states, maps, masks = env.reset()
            self.assertEqual(states.shape, (4, STATE_DIM))
            self.assertEqual(maps.shape, (4, 21, 16, 16))
            self.assertEqual(masks.shape, (4, ACTION_DIM))

            states, maps, masks, rewards, dones, infos = env.step(
                np.zeros(4, dtype=np.int64)
            )
            self.assertEqual(states.shape, (4, STATE_DIM))
            self.assertEqual(maps.shape, (4, 21, 16, 16))
            self.assertEqual(masks.shape, (4, ACTION_DIM))
            self.assertEqual(rewards.shape, (4,))
            self.assertEqual(dones.shape, (4,))
            self.assertEqual(len(infos), 4)
        finally:
            env.close()


if __name__ == "__main__":
    unittest.main()

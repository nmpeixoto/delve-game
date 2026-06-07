import os
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NN_RL_DIR = os.path.join(REPO_ROOT, "automation", "nn_rl")
sys.path.insert(0, NN_RL_DIR)

from headless_bridge import HeadlessWorker, RL_RUNNER
from state_extractor import extract_state
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

            next_states, rewards, dones, infos = env.step([19])
            self.assertEqual(len(next_states), 1)
            self.assertEqual(rewards.shape, (1,))
            self.assertEqual(dones.shape, (1,))
            self.assertIn("total_steps", infos[0])
        finally:
            env.close()


if __name__ == "__main__":
    unittest.main()

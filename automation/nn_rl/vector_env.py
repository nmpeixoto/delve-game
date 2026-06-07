"""
Vectorized environment wrapper for DELVE RL training.
Manages multiple game instances in parallel.
"""

import random
import numpy as np
from typing import List, Dict, Tuple, Optional
from headless_bridge import WorkerPool
from state_extractor import extract_state
from action_mask import get_action_mask
from reward import compute_reward

CLASSES = ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk']


class DelveVectorEnv:
    """
    Wraps multiple headless DELVE game instances for parallel RL training.
    """
    
    def __init__(self, num_envs=128, envs_per_worker=8):
        self.num_envs = num_envs
        self.envs_per_worker = num_envs  # Use single worker for all envs
        self.pool = WorkerPool(num_envs, num_envs)
        self.states = [None] * num_envs
        self.prev_states = [None] * num_envs
        self.episode_rewards = [0.0] * num_envs
        self.episode_lengths = [0] * num_envs
        self._reset_all()
    
    def _reset_all(self):
        """Initialize all environments."""
        seeds = [random.randint(1, 10_000_000) for _ in range(self.num_envs)]
        classes = [CLASSES[i % len(CLASSES)] for i in range(self.num_envs)]
        self.pool.init_all(seeds, classes)
        
        # Get initial states
        for i in range(self.num_envs):
            results = self.pool.step_all({i: {'type': 'key', 'val': '.'}})
            if i in results:
                self.states[i] = results[i][0]
            self.prev_states[i] = self.states[i]
            self.episode_rewards[i] = 0.0
            self.episode_lengths[i] = 0
    
    def reset(self, env_ids=None):
        """Reset specific environments."""
        if env_ids is None:
            env_ids = list(range(self.num_envs))
        
        decisions = {}
        for eid in env_ids:
            decisions[eid] = {'type': 'key', 'val': 'i'}  # dummy action to get state
        
        results = self.pool.step_all(decisions)
        
        for eid in env_ids:
            if eid in results:
                state, _ = results[eid]
                self.states[eid] = state
                self.prev_states[eid] = state
                self.episode_rewards[eid] = 0.0
                self.episode_lengths[eid] = 0
    
    def step(self, actions):
        """
        Execute actions in all environments.
        
        Args:
            actions: numpy array of shape (num_envs,) with action indices
        
        Returns:
            states: list of state dicts
            rewards: numpy array of rewards
            dones: numpy array of booleans
            infos: list of info dicts
        """
        ACTION_MAP = {
            0: {'type': 'key', 'val': 'ArrowUp'},
            1: {'type': 'key', 'val': 'ArrowDown'},
            2: {'type': 'key', 'val': 'ArrowLeft'},
            3: {'type': 'key', 'val': 'ArrowRight'},
            4: {'type': 'key', 'val': 'b'},  # ability1
            5: {'type': 'key', 'val': 'v'},  # ability2
            6: {'type': 'key', 'val': 'b'},  # alias
            7: {'type': 'key', 'val': 'v'},  # alias
            8: {'type': 'key', 'val': 'i'},  # open inventory (will need follow-up click)
            9: {'type': 'key', 'val': 'i'},  # open inventory
            10: {'type': 'key', 'val': 'i'},  # open inventory
            11: {'type': 'key', 'val': 'i'},  # open inventory
            12: {'type': 'key', 'val': 'i'},  # open inventory
            13: {'type': 'key', 'val': '>'},  # descend
            14: {'type': 'key', 'val': 't'},  # open shop
            15: {'type': 'key', 'val': 't'},  # buy (needs shop open)
            16: {'type': 'key', 'val': 'Escape'},  # sell
            17: {'type': 'key', 'val': 'Escape'},  # close shop
            18: {'type': 'key', 'val': 'i'},  # inventory toggle
            19: {'type': 'key', 'val': '.'},  # wait
        }
        
        decisions = {}
        for i, action in enumerate(actions):
            a = int(action)
            if a in ACTION_MAP:
                decisions[i] = ACTION_MAP[a]
            else:
                decisions[i] = {'type': 'key', 'val': '.'}
        
        results = self.pool.step_all(decisions)
        
        new_states = []
        rewards = []
        dones = []
        infos = []
        
        for i in range(self.num_envs):
            if i in results:
                state, done = results[i]
                self.prev_states[i] = self.states[i]
                self.states[i] = state
                
                if state:
                    reward = compute_reward(self.prev_states[i], int(actions[i]), state)
                    self.episode_rewards[i] += reward
                    self.episode_lengths[i] += 1
                else:
                    reward = 0.0
                    done = True
                
                new_states.append(state)
                rewards.append(reward)
                dones.append(done)
                infos.append({
                    'won': state.get('won', False) if state else False,
                    'total_reward': self.episode_rewards[i],
                    'total_steps': self.episode_lengths[i],
                })
            else:
                new_states.append(None)
                rewards.append(0.0)
                dones.append(True)
                infos.append({'won': False, 'total_reward': 0, 'total_steps': 0})
        
        return new_states, np.array(rewards), np.array(dones), infos
    
    def get_states(self):
        """Get current states for all environments."""
        return self.states.copy()
    
    def get_action_masks(self):
        """Get action masks for all environments."""
        masks = []
        for state in self.states:
            if state:
                masks.append(get_action_mask(state))
            else:
                masks.append(np.zeros(20, dtype=bool))
        return np.array(masks)
    
    def close(self):
        """Shutdown all workers."""
        self.pool.shutdown()

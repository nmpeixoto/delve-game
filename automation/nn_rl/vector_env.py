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
from config import ACTION_DIM

CLASSES = ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk']


class DelveVectorEnv:
    """
    Wraps multiple headless DELVE game instances for parallel RL training.
    """
    
    def __init__(
        self,
        num_envs=128,
        envs_per_worker=8,
        max_episode_steps=5000,
        timeout_penalty=-250.0,
        curriculum_max_floor=None,
        curriculum_reward=125.0,
    ):
        self.num_envs = num_envs
        self.envs_per_worker = envs_per_worker
        self.max_episode_steps = max_episode_steps
        self.timeout_penalty = timeout_penalty
        self.curriculum_max_floor = curriculum_max_floor
        self.curriculum_reward = curriculum_reward
        self.pool = WorkerPool(num_envs, envs_per_worker)
        self.states = [None] * num_envs
        self.prev_states = [None] * num_envs
        self.episode_rewards = [0.0] * num_envs
        self.episode_lengths = [0] * num_envs
        self._reset_all()
    
    def _reset_all(self):
        """Initialize all environments."""
        seeds = [random.randint(1, 10_000_000) for _ in range(self.num_envs)]
        classes = [CLASSES[i % len(CLASSES)] for i in range(self.num_envs)]
        states = self.pool.init_all(seeds, classes)

        for i in range(self.num_envs):
            self.states[i] = states[i]
            self.prev_states[i] = self.states[i]
            self.episode_rewards[i] = 0.0
            self.episode_lengths[i] = 0
    
    def reset(self, env_ids=None):
        """Reset specific environments."""
        if env_ids is None:
            env_ids = list(range(self.num_envs))

        specs = {
            eid: (random.randint(1, 10_000_000), CLASSES[eid % len(CLASSES)])
            for eid in env_ids
        }
        states = self.pool.reset_envs(specs)

        for eid in env_ids:
            state = states[eid]
            self.states[eid] = state
            self.prev_states[eid] = state
            self.episode_rewards[eid] = 0.0
            self.episode_lengths[eid] = 0
        return [self.states[eid] for eid in env_ids]

    def set_curriculum_max_floor(self, max_floor):
        self.curriculum_max_floor = max_floor

    def action_to_decision(self, state, action):
        """Map a discrete RL action to the runner's game decision format."""
        p = state.get('player', {}) if state else {}
        enemies = [e for e in (state or {}).get('enemies', []) if not e.get('dying') and not e.get('isPet')]
        items = [i for i in (state or {}).get('items', []) if i.get('carried')]

        if action == 0:
            return {'type': 'key', 'val': 'ArrowUp'}
        if action == 1:
            return {'type': 'key', 'val': 'ArrowDown'}
        if action == 2:
            return {'type': 'key', 'val': 'ArrowLeft'}
        if action == 3:
            return {'type': 'key', 'val': 'ArrowRight'}
        if action in (4, 5):
            adjacent = [
                e for e in enemies
                if abs(e.get('x', 0) - p.get('x', 0)) + abs(e.get('y', 0) - p.get('y', 0)) == 1
            ]
            adjacent.sort(key=lambda e: (0 if e.get('boss') else 1, e.get('hp', 0), str(e.get('id', ''))))
            idx = action - 4
            if idx < len(adjacent):
                return {'type': 'attack', 'target': adjacent[idx]['id']}
            return self._escape_decision()
        if action == 6:
            return {'type': 'key', 'val': 'b'}
        if action == 7:
            return {'type': 'key', 'val': 'v'}
        if action == 8:
            potion = self._choose_potion(items, p)
            return self._item_click(potion) if potion else self._escape_decision()
        if action == 9:
            item = next((i for i in items if i.get('type') == 'potion_buff'), None)
            return self._item_click(item) if item else self._escape_decision()
        if action == 10:
            item = next((i for i in items if i.get('type') == 'bomb'), None)
            return self._item_click(item) if item else self._escape_decision()
        if action == 11:
            item = next((i for i in items if i.get('type') == 'scroll_teleport'), None)
            return self._item_click(item) if item else self._escape_decision()
        if action == 12:
            item = next((i for i in items if i.get('type') == 'scroll' and 'detection' in i.get('name', '').lower()), None)
            return self._item_click(item) if item else self._escape_decision()
        if action == 13:
            return {'type': 'key', 'val': '>'}
        if action == 14:
            return {'type': 'key', 'val': 't'}
        if action == 15:
            item = self._choose_shop_item(state)
            return {'type': 'click', 'target': f'.shop-item[onclick*="{item["id"]}"]'} if item else self._escape_decision()
        if action == 16:
            return {'type': 'click', 'target': 'button[onclick="sellWeakerGear()"]'}
        if action == 17:
            return {'type': 'key', 'val': 'Escape'}
        return self._escape_decision()

    def _escape_decision(self):
        return {'type': 'key', 'val': 'Escape'}

    def _item_click(self, item):
        return {'type': 'click', 'target': f'.inv-slot[onclick*="{item["id"]}"]'}

    def _choose_potion(self, items, player):
        potions = [i for i in items if i.get('type') == 'potion']
        if not potions:
            return None
        missing = max(player.get('maxHp', 1) - player.get('hp', 0), 0)
        sufficient = [i for i in potions if i.get('heal', 0) >= missing]
        if sufficient:
            return min(sufficient, key=lambda i: i.get('heal', 0))
        return max(potions, key=lambda i: i.get('heal', 0))

    def _choose_shop_item(self, state):
        if not state or not state.get('shopOpen'):
            return None
        gold = state.get('player', {}).get('gold', 0)
        stock = []
        for shop in state.get('shops', []):
            stock.extend(shop.get('stock', []))
        affordable = [i for i in stock if not i.get('sold') and i.get('price', 0) <= gold]
        priority = {'potion': 0, 'weapon': 1, 'armor': 2, 'potion_buff': 3, 'bomb': 4, 'scroll_teleport': 5, 'scroll': 6}
        affordable.sort(key=lambda i: (priority.get(i.get('type'), 99), -i.get('heal', 0), i.get('price', 0)))
        return affordable[0] if affordable else None

    def _apply_terminal_rules(self, env_id, state, done, reward):
        if state is None:
            return reward, True, {
                'won': False,
                'timeout': False,
                'curriculum_success': False,
                'outcome': 'done',
                'final_floor': 0,
                'total_reward': self.episode_rewards[env_id],
                'total_steps': self.episode_lengths[env_id],
                'terminal_state': None,
            }

        timed_out = (
            not done
            and self.max_episode_steps > 0
            and self.episode_lengths[env_id] >= self.max_episode_steps
        )
        curriculum_success = (
            not done
            and not timed_out
            and self.curriculum_max_floor is not None
            and state.get('floor', 1) > self.curriculum_max_floor
        )

        if timed_out:
            reward += self.timeout_penalty
            self.episode_rewards[env_id] += self.timeout_penalty
            done = True
        elif curriculum_success:
            reward += self.curriculum_reward
            self.episode_rewards[env_id] += self.curriculum_reward
            done = True

        won = bool(state.get('won', False))
        game_over = bool(state.get('gameOver', False))
        if won:
            outcome = 'won'
        elif curriculum_success:
            outcome = 'curriculum'
        elif timed_out:
            outcome = 'timeout'
        elif game_over:
            outcome = 'dead'
        elif done:
            outcome = 'done'
        else:
            outcome = 'running'

        return reward, done, {
            'won': won,
            'timeout': timed_out,
            'curriculum_success': curriculum_success,
            'outcome': outcome,
            'final_floor': state.get('floor', 0),
            'total_reward': self.episode_rewards[env_id],
            'total_steps': self.episode_lengths[env_id],
            'terminal_state': state if done else None,
        }
    
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
        decisions = {}
        for i, action in enumerate(actions):
            decisions[i] = self.action_to_decision(self.states[i], int(action))
        
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

                reward, done, info = self._apply_terminal_rules(i, state, done, reward)
                
                new_states.append(state)
                rewards.append(reward)
                dones.append(done)
                infos.append(info)
            else:
                new_states.append(None)
                rewards.append(0.0)
                dones.append(True)
                infos.append({'won': False, 'total_reward': 0, 'total_steps': 0})

        done_ids = [i for i, done in enumerate(dones) if done]
        if done_ids:
            reset_states = self.reset(done_ids)
            for env_id, reset_state in zip(done_ids, reset_states):
                new_states[env_id] = reset_state

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
                masks.append(np.zeros(ACTION_DIM, dtype=bool))
        return np.array(masks)
    
    def close(self):
        """Shutdown all workers."""
        self.pool.shutdown()

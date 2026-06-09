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
        timeout_penalty=-400.0,
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
        self.prev_actions = [None] * num_envs        # Track previous action per env
        self.last_floor = [1] * num_envs              # Track floor for change detection
        self.last_key_pickup_step = [-999] * num_envs  # Step of last key pickup
        self.last_door_unlock_step = [-999] * num_envs # Step of last door unlock
        self.last_enemy_kill_step = [-999] * num_envs  # Step of last enemy kill
        self.doors_opened_this_floor = [0] * num_envs
        self.keys_used_this_floor = [0] * num_envs
        self._reset_all()

    def _reset_all(self):
        seeds = [random.randint(1, 10_000_000) for _ in range(self.num_envs)]
        classes = [CLASSES[i % len(CLASSES)] for i in range(self.num_envs)]
        states = self.pool.init_all(seeds, classes)

        for i in range(self.num_envs):
            self.states[i] = states[i]
            self.prev_states[i] = self.states[i]
            self.episode_rewards[i] = 0.0
            self.episode_lengths[i] = 0
            self.prev_actions[i] = None
            self.last_floor[i] = 1
            self.last_key_pickup_step[i] = -999
            self.last_door_unlock_step[i] = -999
            self.last_enemy_kill_step[i] = -999
            self.doors_opened_this_floor[i] = 0
            self.keys_used_this_floor[i] = 0

    def reset(self, env_ids=None):
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
            self.prev_actions[eid] = None
            self.last_floor[eid] = 1
            self.last_key_pickup_step[eid] = -999
            self.last_door_unlock_step[eid] = -999
            self.last_enemy_kill_step[eid] = -999
            self.doors_opened_this_floor[eid] = 0
            self.keys_used_this_floor[eid] = 0
        return [self.states[eid] for eid in env_ids]

    def set_curriculum_max_floor(self, max_floor):
        self.curriculum_max_floor = max_floor

    def action_to_decision(self, state, action):
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

    def _detect_events(self, env_id, prev_state, curr_state, action):
        """Detect key game events for reward and state features."""
        prev_floor = self.last_floor[env_id]
        curr_floor = curr_state.get('floor', 1) if curr_state else 1

        # Floor change
        if curr_floor != prev_floor:
            self.last_floor[env_id] = curr_floor
            self.doors_opened_this_floor[env_id] = 0
            self.keys_used_this_floor[env_id] = 0

        if prev_state is None or curr_state is None:
            return

        # Key pickup
        prev_keys_carried = sum(1 for i in prev_state.get('items', [])
                                if i.get('type') == 'key' and i.get('carried'))
        curr_keys_carried = sum(1 for i in curr_state.get('items', [])
                                if i.get('type') == 'key' and i.get('carried'))

        if curr_keys_carried > prev_keys_carried:
            self.last_key_pickup_step[env_id] = self.episode_lengths[env_id]

        # Door unlock (locked doors disappeared)
        prev_doors = sum(1 for row in prev_state.get('map', []) for t in row if t == 4)
        curr_doors = sum(1 for row in curr_state.get('map', []) for t in row if t == 4)
        if curr_doors < prev_doors:
            self.last_door_unlock_step[env_id] = self.episode_lengths[env_id]
            self.doors_opened_this_floor[env_id] += prev_doors - curr_doors
            self.keys_used_this_floor[env_id] += prev_doors - curr_doors

        # Enemy kill
        prev_alive = {e['id'] for e in prev_state.get('enemies', []) if not e.get('dying')}
        curr_alive = {e['id'] for e in curr_state.get('enemies', []) if not e.get('dying')}
        if len(prev_alive) > len(curr_alive):
            self.last_enemy_kill_step[env_id] = self.episode_lengths[env_id]

    def _inject_state_metadata(self, env_id, state):
        """Inject event tracking metadata into state dict for reward and features."""
        if state is None:
            return
        state['_current_step'] = self.episode_lengths[env_id]
        state['_last_key_pickup_step'] = self.last_key_pickup_step[env_id]
        state['_last_door_unlock_step'] = self.last_door_unlock_step[env_id]
        state['_last_enemy_kill_step'] = self.last_enemy_kill_step[env_id]
        state['_doors_opened_this_floor'] = self.doors_opened_this_floor[env_id]
        state['_keys_used_this_floor'] = self.keys_used_this_floor[env_id]

        # Compute steps-since features
        step = self.episode_lengths[env_id]
        # Approximate: steps since floor change = steps on current floor
        state['_steps_since_floor_change'] = min(step, 999)  # Simplified
        state['_steps_since_key_pickup'] = min(step - self.last_key_pickup_step[env_id], 999) if self.last_key_pickup_step[env_id] >= 0 else 999
        state['_steps_since_enemy_kill'] = min(step - self.last_enemy_kill_step[env_id], 999) if self.last_enemy_kill_step[env_id] >= 0 else 999
        state['_steps_since_door_unlock'] = min(step - self.last_door_unlock_step[env_id], 999) if self.last_door_unlock_step[env_id] >= 0 else 999

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
                'class_name': None,
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
            'class_name': state.get('player', {}).get('class'),
        }

    def step(self, actions):
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

                # Detect events before injecting metadata
                self._detect_events(i, self.prev_states[i], state, int(actions[i]))

                # Inject metadata for reward and features
                self._inject_state_metadata(i, state)
                if self.prev_states[i] is not None:
                    self._inject_state_metadata(i, self.prev_states[i])

                if state:
                    reward = compute_reward(self.prev_states[i], int(actions[i]), state)
                    self.episode_rewards[i] += reward
                    self.episode_lengths[i] += 1
                else:
                    reward = 0.0
                    done = True

                reward, done, info = self._apply_terminal_rules(i, state, done, reward)

                self.prev_actions[i] = int(actions[i])

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
        return self.states.copy()

    def get_prev_actions(self):
        return self.prev_actions.copy()

    def get_action_masks(self):
        masks = []
        for state in self.states:
            if state:
                masks.append(get_action_mask(state))
            else:
                masks.append(np.zeros(ACTION_DIM, dtype=bool))
        return np.array(masks)

    def close(self):
        self.pool.shutdown()

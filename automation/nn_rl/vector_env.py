"""
Vectorized environment wrapper for DELVE RL training.
Manages multiple game instances in parallel.
"""

import random
import numpy as np
from typing import List, Dict, Tuple, Optional
from game_engine import DelveGame
from state_extractor import extract_state
from action_mask import get_action_mask
from reward import compute_reward_with_components
from config import (
    ACTION_DIM,
    ACTIONS,
    DEFAULT_TIMEOUT_PENALTY,
    FLOORS,
    MAX_SHOP_SLOTS,
    REWARD_CURRICULUM_SUCCESS,
    REWARD_WIN,
    CLASS_WEIGHTS,
)

CLASSES = ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk']


class DelveVectorEnv:
    """
    Wraps multiple DELVE game instances for parallel RL training.
    Uses the pure-Python game engine directly (no Node.js IPC).
    """

    def __init__(
        self,
        num_envs=128,
        envs_per_worker=8,
        max_episode_steps=0,
        timeout_penalty=DEFAULT_TIMEOUT_PENALTY,
        curriculum_max_floor=None,
        curriculum_reward=REWARD_CURRICULUM_SUCCESS,
        curriculum_hard_mode=False,
        class_schedule=None,
        seed_base=None,
    ):
        self.num_envs = num_envs
        self.envs_per_worker = envs_per_worker
        self.max_episode_steps = max_episode_steps
        self.timeout_penalty = timeout_penalty
        self.curriculum_max_floor = curriculum_max_floor
        self.curriculum_hard_mode = curriculum_hard_mode
        self.curriculum_reward = curriculum_reward
        self.class_schedule = list(class_schedule or [])
        self.seed_base = seed_base
        self._scheduled_game_index = 0
        self.games = [None] * num_envs
        self.states = [None] * num_envs
        self.prev_states = [None] * num_envs
        self.episode_rewards = [0.0] * num_envs
        self.episode_reward_components = [dict() for _ in range(num_envs)]
        self.episode_lengths = [0] * num_envs
        self.prev_actions = [None] * num_envs
        self.last_floor = [1] * num_envs
        self.last_floor_change_step = [0] * num_envs
        self.last_key_pickup_step = [-999] * num_envs
        self.last_door_unlock_step = [-999] * num_envs
        self.last_enemy_kill_step = [-999] * self.num_envs
        self.doors_opened_this_floor = [0] * self.num_envs
        self.keys_used_this_floor = [0] * self.num_envs
        self.consecutive_stagnant_actions = [0] * self.num_envs
        self._reset_all()

    def _make_game(self, env_id):
        if self.class_schedule:
            schedule_index = self._scheduled_game_index
            self._scheduled_game_index += 1
            entry = self.class_schedule[schedule_index % len(self.class_schedule)]
            if isinstance(entry, dict):
                cls = entry.get('class_name') or entry.get('class') or entry.get('player_class')
                seed = entry.get('seed')
                hard = entry.get('hard_mode', getattr(self, 'curriculum_hard_mode', False))
            else:
                cls = str(entry)
                seed = None
                hard = getattr(self, 'curriculum_hard_mode', False)
            if seed is None:
                base = self.seed_base if self.seed_base is not None else 1
                seed = int(base) + schedule_index
            return DelveGame(seed=int(seed), player_class=cls, hard_mode=hard)

        seed = random.randint(1, 10_000_000)
        
        weights = [CLASS_WEIGHTS.get(c, 1.0) for c in CLASSES]
        cls = random.choices(CLASSES, weights=weights, k=1)[0]
        
        hard = getattr(self, 'curriculum_hard_mode', False)
        return DelveGame(seed=seed, player_class=cls, hard_mode=hard)

    def _reset_all(self):
        for i in range(self.num_envs):
            self.games[i] = self._make_game(i)
            self.states[i] = self.games[i].snapshot()
            self.prev_states[i] = self.states[i]
            self.episode_rewards[i] = 0.0
            self.episode_reward_components[i] = {}
            self.episode_lengths[i] = 0
            self.prev_actions[i] = None
            self.last_floor[i] = 1
            self.last_floor_change_step[i] = 0
            self.last_key_pickup_step[i] = -999
            self.last_door_unlock_step[i] = -999
            self.last_enemy_kill_step[i] = -999
            self.doors_opened_this_floor[i] = 0
            self.keys_used_this_floor[i] = 0
            self.consecutive_stagnant_actions[i] = 0
            self._inject_state_metadata(i, self.states[i])

    def reset(self, env_ids=None):
        if env_ids is None:
            env_ids = list(range(self.num_envs))

        for eid in env_ids:
            self.games[eid] = self._make_game(eid)
            state = self.games[eid].snapshot()
            self.states[eid] = state
            self.prev_states[eid] = state
            self.episode_rewards[eid] = 0.0
            self.episode_reward_components[eid] = {}
            self.episode_lengths[eid] = 0
            self.prev_actions[eid] = None
            self.last_floor[eid] = 1
            self.last_floor_change_step[eid] = 0
            self.last_key_pickup_step[eid] = -999
            self.last_door_unlock_step[eid] = -999
            self.last_enemy_kill_step[eid] = -999
            self.doors_opened_this_floor[eid] = 0
            self.keys_used_this_floor[eid] = 0
            self.consecutive_stagnant_actions[eid] = 0
            self._inject_state_metadata(eid, state)
        return [self.states[eid] for eid in env_ids]

    def set_curriculum_max_floor(self, max_floor):
        self.curriculum_max_floor = max_floor

    def set_curriculum_hard_mode(self, hard_mode):
        self.curriculum_hard_mode = hard_mode

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
        if action == 16:
            return {'type': 'click', 'target': 'button[onclick="sellWeakerGear()"]'}
        if action == 17:
            return {'type': 'key', 'val': 'Escape'}
        if action == ACTIONS.get('RANGED_ATTACK_WEAK'):
            from tactical_actions import choose_line_clear_enemy

            target = choose_line_clear_enemy(state)
            return {'type': 'attack', 'target': target['id']} if target else self._escape_decision()
        if action == ACTIONS.get('RANGED_ATTACK_NEAREST'):
            from tactical_actions import choose_line_clear_enemy

            target = choose_line_clear_enemy(state, prefer='nearest')
            return {'type': 'attack', 'target': target['id']} if target else self._escape_decision()
        if action == ACTIONS.get('KITE_SAFE_MOVE'):
            from tactical_actions import safest_adjacent_move, visible_enemies

            player = state.get('player', {})
            px, py = player.get('x', 0), player.get('y', 0)
            pressure_enemies = [
                enemy
                for enemy in visible_enemies(state)
                if abs(enemy.get('x', 0) - px) + abs(enemy.get('y', 0) - py) <= 4
            ]
            return (
                safest_adjacent_move(
                    state,
                    threat_enemies=pressure_enemies,
                    require_increase=True,
                )
                or self._escape_decision()
            )
        shop_buy_start = ACTIONS.get('SHOP_BUY_0', 18)
        if shop_buy_start <= action < shop_buy_start + MAX_SHOP_SLOTS:
            item = self._choose_shop_item_at_slot(state, action - shop_buy_start)
            return self._shop_item_click(item) if item else self._escape_decision()
        return self._escape_decision()

    def _escape_decision(self):
        return {'type': 'key', 'val': 'Escape'}

    def _item_click(self, item):
        return {'type': 'click', 'target': f'.inv-slot[onclick*="{item["id"]}"]'}

    def _shop_item_click(self, item):
        return {'type': 'click', 'target': f'.shop-item[onclick*="{item["id"]}"]'}

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
        stock = self._current_shop_stock(state)
        affordable = [i for i in stock if not i.get('sold') and i.get('price', 0) <= gold]
        priority = {'potion': 0, 'weapon': 1, 'armor': 2, 'potion_buff': 3, 'bomb': 4, 'scroll_teleport': 5, 'scroll': 6}
        affordable.sort(key=lambda i: (priority.get(i.get('type'), 99), -i.get('heal', 0), i.get('price', 0)))
        return affordable[0] if affordable else None

    def _choose_shop_item_at_slot(self, state, slot):
        if not state or not state.get('shopOpen'):
            return None
        stock = self._current_shop_stock(state)
        if slot < 0 or slot >= len(stock):
            return None
        item = stock[slot]
        if not item or item.get('sold'):
            return None
        if item.get('price', 0) > state.get('player', {}).get('gold', 0):
            return None
        return item

    def _current_shop_stock(self, state):
        shop = state.get('currentShop') or {}
        stock = list(shop.get('stock') or [])
        if stock:
            return stock
        fallback_stock = []
        for fallback_shop in state.get('shops', []):
            fallback_stock.extend(fallback_shop.get('stock', []))
        return fallback_stock

    def _detect_events(self, env_id, prev_state, curr_state, action):
        prev_floor = self.last_floor[env_id]
        curr_floor = curr_state.get('floor', 1) if curr_state else 1

        if curr_floor != prev_floor:
            self.last_floor[env_id] = curr_floor
            self.last_floor_change_step[env_id] = self.episode_lengths[env_id]
            self.doors_opened_this_floor[env_id] = 0
            self.keys_used_this_floor[env_id] = 0

        if prev_state is None or curr_state is None:
            return

        curr_state['_doors_unlocked_this_step'] = 0

        prev_keys_carried = sum(1 for i in prev_state.get('items', [])
                                if i.get('type') == 'key' and i.get('carried'))
        curr_keys_carried = sum(1 for i in curr_state.get('items', [])
                                if i.get('type') == 'key' and i.get('carried'))

        if curr_keys_carried > prev_keys_carried:
            self.last_key_pickup_step[env_id] = self.episode_lengths[env_id]

        prev_doors = prev_state.get('_door_count', 0)
        curr_doors = curr_state.get('_door_count', 0)
        if curr_doors < prev_doors:
            unlocked = prev_doors - curr_doors
            curr_state['_doors_unlocked_this_step'] = unlocked
            self.last_door_unlock_step[env_id] = self.episode_lengths[env_id]
            self.doors_opened_this_floor[env_id] += unlocked
            self.keys_used_this_floor[env_id] += unlocked
            
        prev_secrets = prev_state.get('_secret_count', 0)
        curr_secrets = curr_state.get('_secret_count', 0)
        curr_state['_secrets_revealed_this_step'] = max(0, prev_secrets - curr_secrets)

        prev_alive = {e['id'] for e in prev_state.get('enemies', []) if not e.get('dying')}
        curr_alive = {e['id'] for e in curr_state.get('enemies', []) if not e.get('dying')}
        if len(prev_alive) > len(curr_alive):
            self.last_enemy_kill_step[env_id] = self.episode_lengths[env_id]

    def _inject_state_metadata(self, env_id, state):
        if state is None:
            return
        state.update(self._state_metadata(env_id))

    def _state_metadata(self, env_id):
        step = self.episode_lengths[env_id]
        return {
            '_current_step': self.episode_lengths[env_id],
            '_last_key_pickup_step': self.last_key_pickup_step[env_id],
            '_last_door_unlock_step': self.last_door_unlock_step[env_id],
            '_last_enemy_kill_step': self.last_enemy_kill_step[env_id],
            '_doors_opened_this_floor': self.doors_opened_this_floor[env_id],
            '_keys_used_this_floor': self.keys_used_this_floor[env_id],
            '_consecutive_stagnant_actions': getattr(self, 'consecutive_stagnant_actions', [0] * self.num_envs)[env_id],
            '_steps_since_floor_change': min(step - self.last_floor_change_step[env_id], 999),
            '_steps_since_key_pickup': min(step - self.last_key_pickup_step[env_id], 999) if self.last_key_pickup_step[env_id] >= 0 else 999,
            '_steps_since_enemy_kill': min(step - self.last_enemy_kill_step[env_id], 999) if self.last_enemy_kill_step[env_id] >= 0 else 999,
            '_steps_since_door_unlock': min(step - self.last_door_unlock_step[env_id], 999) if self.last_door_unlock_step[env_id] >= 0 else 999,
        }

    def _observation_arrays(self):
        from observation import allocate_observation_arrays

        arrays = getattr(self, '_direct_observation_arrays', None)
        if arrays is None or arrays.states.shape[0] != self.num_envs:
            arrays = allocate_observation_arrays(self.num_envs)
            self._direct_observation_arrays = arrays
        return arrays

    def observe_arrays(self):
        from observation import observe_game_into

        arrays = self._observation_arrays()
        arrays.states.fill(0.0)
        arrays.maps.fill(0.0)
        arrays.masks.fill(False)
        for env_id, game in enumerate(self.games):
            if game is None:
                continue
            observe_game_into(
                game,
                arrays,
                env_id,
                prev_action=self.prev_actions[env_id],
                metadata=self._state_metadata(env_id),
            )
        return arrays.states, arrays.maps, arrays.masks

    def _add_reward_component(self, env_id, name, value):
        if not value:
            return
        if not hasattr(self, 'episode_reward_components'):
            self.episode_reward_components = [{} for _ in getattr(self, 'episode_rewards', [0.0])]
        components = self.episode_reward_components[env_id]
        components[name] = components.get(name, 0.0) + float(value)

    def _failed_episode_reward_cap(self, state):
        floor = max(int(state.get('floor', 1) or 1), 1)
        if FLOORS <= 1:
            return 0.0
        depth_ratio = (min(floor, FLOORS) - 1) / (FLOORS - 1)
        return REWARD_WIN * depth_ratio

    def _clamp_failed_episode_reward(self, env_id, state, reward):
        cap = self._failed_episode_reward_cap(state)
        total_reward = self.episode_rewards[env_id]
        if total_reward <= cap:
            return reward

        adjustment = cap - total_reward
        self.episode_rewards[env_id] = cap
        self._add_reward_component(env_id, 'terminal_failure_clamp', adjustment)
        return reward + adjustment

    def _apply_terminal_rules(self, env_id, state, done, reward):
        if not hasattr(self, 'episode_reward_components'):
            self.episode_reward_components = [{} for _ in getattr(self, 'episode_rewards', [0.0])]
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
                'reward_components': dict(self.episode_reward_components[env_id]),
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
            self._add_reward_component(env_id, 'terminal_timeout', self.timeout_penalty)
            done = True
        elif curriculum_success:
            reward += self.curriculum_reward
            self.episode_rewards[env_id] += self.curriculum_reward
            self._add_reward_component(env_id, 'terminal_curriculum', self.curriculum_reward)
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

        if outcome in ('dead', 'timeout'):
            reward = self._clamp_failed_episode_reward(env_id, state, reward)

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
            'reward_components': dict(self.episode_reward_components[env_id]) if done else {},
        }

    def _resolve_click_action(self, game, state, decision):
        target = decision.get('target', '')
        if 'inv-slot' in target or 'shop-item' in target:
            import re
            m = re.search(r'onclick\*="([^"]+)"', target)
            if not m:
                return
            item_id = m.group(1)
            if 'shop-item' in target:
                game.buy_item(item_id)
            else:
                it = next((i for i in game.items if i['id'] == item_id), None)
                if it and it.get('carried'):
                    game.use_item(it.get('type', ''))
        elif 'sellWeakerGear' in target:
            game.sell_weaker_gear()

    def step(self, actions):
        new_states = []
        rewards = []
        dones = []
        infos = []

        for i in range(self.num_envs):
            game = self.games[i]
            action = int(actions[i])
            decision = self.action_to_decision(self.states[i], action)

            prev_state = self.states[i]
            self.prev_states[i] = prev_state

            atype = decision.get('type')
            if prev_state and prev_state.get('shrineOpen'):
                if action == ACTIONS['USE_BUFF']:
                    game.accept_shrine()
                elif action == ACTIONS['ESCAPE']:
                    game.decline_shrine()
            elif atype == 'click':
                self._resolve_click_action(game, self.states[i], decision)
            else:
                game.step(decision)

            state = game.snapshot()
            if prev_state and prev_state.get('turn') == state.get('turn'):
                self.consecutive_stagnant_actions[i] += 1
            else:
                self.consecutive_stagnant_actions[i] = 0

            done = bool(state.get('gameOver', False)) or bool(state.get('won', False))

            self._detect_events(i, prev_state, state, action)
            self._inject_state_metadata(i, state)
            self.states[i] = state

            if state:
                reward, reward_components = compute_reward_with_components(prev_state, action, state)
                self.episode_rewards[i] += reward
                for name, value in reward_components.items():
                    self._add_reward_component(i, name, value)
                self.episode_lengths[i] += 1
            else:
                reward = 0.0
                done = True

            reward, done, info = self._apply_terminal_rules(i, state, done, reward)
            self.prev_actions[i] = action

            new_states.append(state)
            rewards.append(reward)
            dones.append(done)
            infos.append(info)

            if done:
                self.games[i] = self._make_game(i)
                reset_state = self.games[i].snapshot()
                self.states[i] = reset_state
                self.prev_states[i] = reset_state
                self.episode_rewards[i] = 0.0
                self.episode_reward_components[i] = {}
                self.episode_lengths[i] = 0
                self.prev_actions[i] = None
                self.last_floor[i] = 1
                self.last_floor_change_step[i] = 0
                self.last_key_pickup_step[i] = -999
                self.last_door_unlock_step[i] = -999
                self.last_enemy_kill_step[i] = -999
                self.doors_opened_this_floor[i] = 0
                self.keys_used_this_floor[i] = 0
                self.consecutive_stagnant_actions[i] = 0
                self._inject_state_metadata(i, reset_state)
                new_states[i] = reset_state

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
        pass


import multiprocessing as mp
import numpy as np

def _subproc_worker(pipe, env_kwargs):
    import signal
    try:
        signal.signal(signal.SIGINT, signal.SIG_IGN)
    except Exception:
        pass

    from vector_env import DelveVectorEnv
    from state_extractor import numpyize_states, numpyize_maps
    from action_mask import get_action_mask

    observation_mode = env_kwargs.pop('observation_mode', 'legacy')
    transport_mode = env_kwargs.pop('transport_mode', 'pipe')
    shared_config = env_kwargs.pop('shared_observation_buffer', None)
    shared_buffer = None
    env = None

    def collect_observations(states):
        if observation_mode == 'direct':
            return env.observe_arrays()
        np_states = numpyize_states(states, env.prev_actions)
        np_maps = numpyize_maps(states)
        masks = np.stack([get_action_mask(s) for s in states]).astype(np.float32, copy=False)
        return np_states, np_maps, masks

    def send_observations(np_states, np_maps, masks, rewards=None, dones=None, infos=None):
        if transport_mode in ('shared', 'shared-contiguous'):
            shared_buffer.states[...] = np_states
            shared_buffer.maps[...] = np_maps
            shared_buffer.masks[...] = masks
            message = {'ok': True}
            if rewards is not None:
                message.update({'rewards': rewards, 'dones': dones, 'infos': infos})
            pipe.send(message)
        else:
            if rewards is None:
                pipe.send((np_states, np_maps, masks))
            else:
                pipe.send((np_states, np_maps, masks, rewards, dones, infos))

    try:
        if transport_mode in ('shared', 'shared-contiguous'):
            from shared_rollout import SharedObservationBuffer

            if not shared_config:
                raise ValueError("shared transport requires shared_observation_buffer")
            shared_buffer = SharedObservationBuffer.attach(
                shared_config['state_name'],
                shared_config['map_name'],
                shared_config['mask_name'],
                num_envs=shared_config.get('num_envs'),
                total_envs=shared_config.get('total_envs'),
                start=shared_config.get('start', 0),
                count=shared_config.get('count'),
            )

        env = DelveVectorEnv(**env_kwargs)
        while True:
            cmd, args = pipe.recv()
            if cmd == 'reset':
                states = env.reset()
                np_states, np_maps, masks = collect_observations(states)
                send_observations(np_states, np_maps, masks)
            elif cmd == 'step':
                actions = args['actions']
                states, rewards, dones, infos = env.step(actions)
                np_states, np_maps, masks = collect_observations(states)
                send_observations(
                    np_states,
                    np_maps,
                    masks,
                    rewards=rewards,
                    dones=dones,
                    infos=infos,
                )
            elif cmd == 'set_curriculum':
                env.set_curriculum_max_floor(args['max_floor'])
                env.set_curriculum_hard_mode(args.get('hard_mode', False))
                pipe.send(True)
            elif cmd == 'set_class_weights':
                global CLASS_WEIGHTS
                CLASS_WEIGHTS.update(args['weights'])
                pipe.send(True)
            elif cmd == 'close':
                break
    except Exception as e:
        import traceback
        import os
        tb = traceback.format_exc()
        with open("worker_crash.log", "a") as f:
            f.write(f"Worker PID {os.getpid()} crashed:\n{tb}\n\n")
        traceback.print_exc()
        try:
            pipe.send(('error', tb))
        except Exception:
            pass
    finally:
        if env is not None:
            env.close()
        if shared_buffer is not None:
            shared_buffer.close()
        try:
            pipe.close()
        except Exception:
            pass

class SubprocVecEnv:
    def __init__(self, num_envs=128, envs_per_worker=16, **kwargs):
        if num_envs <= 0:
            raise ValueError("num_envs must be positive")
        if envs_per_worker <= 0:
            raise ValueError("envs_per_worker must be positive")

        self.num_envs = num_envs
        self.envs_per_worker = envs_per_worker
        self.observation_mode = kwargs.pop('observation_mode', 'legacy')
        if self.observation_mode not in ('legacy', 'direct'):
            raise ValueError("observation_mode must be 'legacy' or 'direct'")
        self.transport_mode = kwargs.pop('transport_mode', 'pipe')
        if self.transport_mode not in ('pipe', 'shared', 'shared-contiguous'):
            raise ValueError(
                "transport_mode must be 'pipe', 'shared', or 'shared-contiguous'"
            )
        self.num_workers = (num_envs + envs_per_worker - 1) // envs_per_worker
        self.worker_env_counts = [
            min(envs_per_worker, num_envs - i * envs_per_worker)
            for i in range(self.num_workers)
        ]
        self.pipes = []
        self.processes = []
        self.shared_buffers = []
        self.contiguous_shared_buffer = None
        if self.transport_mode == 'shared-contiguous':
            from shared_rollout import SharedObservationBuffer

            self.contiguous_shared_buffer = SharedObservationBuffer.create(num_envs)
        
        for i, worker_envs in enumerate(self.worker_env_counts):
            parent_pipe, child_pipe = mp.Pipe()
            env_kwargs = kwargs.copy()
            shared_buffer = None
            env_kwargs['num_envs'] = worker_envs
            env_kwargs['envs_per_worker'] = worker_envs
            env_kwargs['observation_mode'] = self.observation_mode
            env_kwargs['transport_mode'] = self.transport_mode
            if self.transport_mode == 'shared':
                from shared_rollout import SharedObservationBuffer

                shared_buffer = SharedObservationBuffer.create(worker_envs)
                env_kwargs['shared_observation_buffer'] = {
                    'state_name': shared_buffer.state_shm.name,
                    'map_name': shared_buffer.map_shm.name,
                    'mask_name': shared_buffer.mask_shm.name,
                    'num_envs': worker_envs,
                }
            elif self.transport_mode == 'shared-contiguous':
                shared_buffer = self.contiguous_shared_buffer
                env_kwargs['shared_observation_buffer'] = {
                    'state_name': shared_buffer.state_shm.name,
                    'map_name': shared_buffer.map_shm.name,
                    'mask_name': shared_buffer.mask_shm.name,
                    'total_envs': num_envs,
                    'start': i * envs_per_worker,
                    'count': worker_envs,
                }
            p = mp.Process(target=_subproc_worker, args=(child_pipe, env_kwargs))
            p.daemon = False
            p.start()
            if hasattr(child_pipe, 'close'):
                child_pipe.close()
            self.pipes.append(parent_pipe)
            self.processes.append(p)
            self.shared_buffers.append(shared_buffer)
            
    def reset(self, env_ids=None):
        if env_ids is not None:
            raise ValueError("SubprocVecEnv does not support partial reset from main thread.")
        for p in self.pipes:
            p.send(('reset', {}))
        
        np_states, np_maps, masks = [], [], []
        transport_mode = getattr(self, 'transport_mode', 'pipe')
        if transport_mode == 'shared-contiguous':
            for p in self.pipes:
                self._validate_shared_worker_message(self._recv_worker(p))
            buf = self.contiguous_shared_buffer
            return buf.states, buf.maps, buf.masks

        shared_buffers = getattr(self, 'shared_buffers', [None] * len(self.pipes))
        for p, shared_buffer in zip(self.pipes, shared_buffers):
            message = self._recv_worker(p)
            if transport_mode == 'shared':
                self._validate_shared_worker_message(message)
                np_states.append(shared_buffer.states.copy())
                np_maps.append(shared_buffer.maps.copy())
                masks.append(shared_buffer.masks.copy())
            else:
                ns, nm, m = message
                np_states.append(ns)
                np_maps.append(nm)
                masks.append(m)
            
        return np.concatenate(np_states), np.concatenate(np_maps), np.concatenate(masks)

    def step(self, actions):
        start = 0
        for p, worker_envs in zip(self.pipes, self.worker_env_counts):
            end = start + worker_envs
            p.send(('step', {'actions': actions[start:end]}))
            start = end
            
        np_states, np_maps, masks, rewards, dones, infos = [], [], [], [], [], []
        transport_mode = getattr(self, 'transport_mode', 'pipe')
        if transport_mode == 'shared-contiguous':
            for p in self.pipes:
                message = self._recv_worker(p)
                self._validate_shared_worker_message(message)
                rewards.append(message['rewards'])
                dones.append(message['dones'])
                infos.extend(message['infos'])
            buf = self.contiguous_shared_buffer
            return (
                buf.states,
                buf.maps,
                buf.masks,
                np.concatenate(rewards),
                np.concatenate(dones),
                infos,
            )

        shared_buffers = getattr(self, 'shared_buffers', [None] * len(self.pipes))
        for p, shared_buffer in zip(self.pipes, shared_buffers):
            message = self._recv_worker(p)
            if transport_mode == 'shared':
                self._validate_shared_worker_message(message)
                np_states.append(shared_buffer.states.copy())
                np_maps.append(shared_buffer.maps.copy())
                masks.append(shared_buffer.masks.copy())
                rewards.append(message['rewards'])
                dones.append(message['dones'])
                infos.extend(message['infos'])
            else:
                ns, nm, m, r, d, i = message
                np_states.append(ns)
                np_maps.append(nm)
                masks.append(m)
                rewards.append(r)
                dones.append(d)
                infos.extend(i)
            
        return (
            np.concatenate(np_states),
            np.concatenate(np_maps),
            np.concatenate(masks),
            np.concatenate(rewards),
            np.concatenate(dones),
            infos
        )

    def set_curriculum(self, max_floor, hard_mode=False):
        for p in self.pipes:
            p.send(('set_curriculum', {'max_floor': max_floor, 'hard_mode': hard_mode}))
        for p in self.pipes:
            self._recv_worker(p)

    def set_class_weights(self, weights):
        for p in self.pipes:
            p.send(('set_class_weights', {'weights': weights}))
        for p in self.pipes:
            self._recv_worker(p)

    def _recv_worker(self, pipe):
        message = pipe.recv()
        if isinstance(message, tuple) and len(message) == 2 and message[0] == 'error':
            raise RuntimeError(f"Subproc worker failed:\n{message[1]}")
        return message

    def _validate_shared_worker_message(self, message):
        if not isinstance(message, dict) or not message.get('ok'):
            raise RuntimeError(f"Subproc worker returned invalid shared transport message: {message!r}")
        
    def close(self):
        for p in self.pipes:
            try:
                p.send(('close', {}))
            except Exception:
                pass
        for p in self.processes:
            p.join(timeout=2)
            if p.is_alive():
                p.terminate()
                p.join(timeout=2)
        for p in self.pipes:
            try:
                p.close()
            except Exception:
                pass
        seen_buffers = set()
        for shared_buffer in self.shared_buffers:
            if shared_buffer is None:
                continue
            marker = id(shared_buffer)
            if marker in seen_buffers:
                continue
            seen_buffers.add(marker)
            try:
                shared_buffer.close()
            except Exception:
                pass
            try:
                shared_buffer.unlink()
            except FileNotFoundError:
                pass

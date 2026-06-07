# DELVE Neural Network Reinforcement Learning Bot (PPO)

## 1. Overview

This document designs a PPO (Proximal Policy Optimization) reinforcement learning agent that learns to play DELVE across all 8 classes. The agent uses a shared neural network backbone with class-specific heads, trained via GPU-accelerated vectorized environments.

**Hardware**: AMD Ryzen 7 9800X3D (8c/16t), NVIDIA RTX 5070 Ti (16GB VRAM), 64GB RAM, Windows 11.

**Baseline**: The current heuristic bot (`bot_brain.js`) wins ~0.7% of games. The evolutionary strategy approach (`LEARNING_BOT_DESIGN.md`) targets 10-30% win rate via parameter tuning. This NN approach targets 40-70% by learning entirely new decision policies.

**Training throughput**: The headless runner plays 1 game in ~1 second with 15 workers. We vectorize 128 environments in parallel, yielding ~128 games/second of experience. A 10M-step training run (~78,000 games) completes in ~10 minutes of wall-clock time on the headless runner.

---

## 2. State Representation

### 2.1 Observation Space

The neural network sees a fixed-size feature vector extracted from the game state `G`. We do NOT use raw map tiles as pixel inputs — the 56x36 grid is too sparse for CNNs to learn efficiently. Instead, we extract a structured **148-dimensional** feature vector (expanded from 128 to include critical missing features).

```
State vector (148 floats):
─────────────────────────────────────────────────────
PLAYER CORE (10 floats):
  hp_ratio              = player.hp / player.maxHp
  max_hp_norm           = player.maxHp / 100        # normalized
  atk_norm              = player.atk / 30            # normalized
  def_norm              = player.def / 20            # normalized
  level_norm            = player.lvl / 15            # normalized
  xp_to_level_norm      = (xpNext - xp) / 100       # normalized, clamped [0,1]
  gold_norm             = player.gold / 300          # normalized
  class_id              = one-hot index (8 dims)     # one-hot encoded
  total                 = 10 (1 scalar + 1 one-hot of 8)

PLAYER BUFFS (9 floats):
  has_shield_wall       = shieldWallTurns > 0 ? 1 : 0
  has_vanish            = vanishTurns > 0 ? 1 : 0
  has_strength          = strengthTurns > 0 ? 1 : 0
  has_bloodlust         = bloodlustTurns > 0 ? 1 : 0
  has_rooted            = rootedTurns > 0 ? 1 : 0
  has_poisoned          = poisonedTurns > 0 ? 1 : 0
  free_moves_norm       = freeMoves / 5
  ability1_ready        = ability1Cooldown == 0 ? 1 : 0
  ability2_ready        = ability2Cooldown == 0 && lvl >= 5 ? 1 : 0
  total                 = 9

PLAYER GEAR (8 floats):
  has_weapon            = weapon != null ? 1 : 0
  weapon_atk_norm       = weapon.atk / 20
  weapon_is_magic       = (weapon.sym == '♦') ? 1 : 0
  weapon_is_ranged      = (weapon.sym == '🏹') ? 1 : 0
  has_armor             = armor != null ? 1 : 0
  armor_def_norm        = armor.def / 15
  vampirism_norm        = vampirism / 3
  regen_norm            = regen / 3
  total                 = 8

PASSIVE COMBAT STATS (6 floats):
  dodge_norm            = dodgeBonus / 0.5
  crit_norm             = critChance / 0.3
  swiftness_norm        = swiftness / 3
  perception_norm       = perception / 3
  gold_bonus_norm       = goldBonus / 10
  xp_mult_norm          = xpMult / 0.5
  total                 = 6

DUNGEON CONTEXT (14 floats):
  floor_norm            = G.floor / 5
  is_boss_floor         = G.floor >= 5 ? 1 : 0
  turn_norm             = G.turn / 2000
  explored_ratio        = G.seen.size / (56*36)
  has_key               = has_key ? 1 : 0
  is_on_stairs          = (G.map[py][px] == STAIRS) ? 1 : 0
  is_on_shop            = (G.map[py][px] == SHOP) ? 1 : 0
  map_cleared           = is_map_cleared ? 1 : 0
  turns_on_floor_norm   = turnsOnFloor / 300        # How long on this floor
  has_stairs            = hasKnownStairs() ? 1 : 0   # Have we found stairs?
  shop_distance_norm    = min(shopDist / 30, 1)      # Distance to nearest shop
  locked_door_count_norm = lockedDoors / 4            # Locked doors on floor
  floor_difficulty      = floor * pressureScale / 5  # Difficulty indicator
  total                 = 14

CARRIED ITEMS (8 floats):
  potion_count_norm     = count(potion) / 6
  buff_count_norm       = count(potion_buff) / 3
  bomb_count_norm       = count(bomb) / 3
  teleport_count_norm   = count(scroll_teleport) / 3
  detection_count_norm  = count(scroll_detection) / 2
  key_count             = count(key) / 2
  carried_total_norm    = count(carried) / 12
  upgrade_available     = has_floor_upgrade ? 1 : 0
  total                 = 8

ENEMY SUMMARY (16 floats):
  adj_enemy_count_norm  = adj_count / 4          # max 4 adjacent
  vis_enemy_count_norm  = vis_count / 6          # max 6 visible
  closest_enemy_dist_norm = min_dist / 10        # normalized manhattan
  closest_enemy_hp_norm = closest.hp / closest.maxHp
  closest_enemy_atk_norm = closest.atk / 30
  closest_enemy_def_norm = closest.def / 10
  total_enemy_hp_norm   = sum(enemy.hp) / 300
  total_enemy_atk_norm  = sum(enemy.atk) / 60
  has_boss_visible      = boss_visible ? 1 : 0
  has_elite_visible     = elite_visible ? 1 : 0
  avg_enemy_dist_norm   = avg_dist / 15
  strongest_enemy_hp_norm = strongest.hp / strongest.maxHp
  weakest_enemy_hp_norm = weakest.hp / weakest.maxHp
  adj_threat_total_norm = sum(max_incoming) / 50   # total max damage adjacent
  boss_phase            = boss.phase / 2           # 0, 0.5, or 1
  has_pet               = has_pet ? 1 : 0
  total                 = 16

NEAREST ENEMY DETAIL (8 floats):
  nearest_enemy_hp_ratio    = nearest.hp / nearest.maxHp
  nearest_enemy_dist_norm   = manhattan(nearest) / 10
  can_kill_in_1_hit         = (normalDmg >= nearest.hp) ? 1 : 0
  can_kill_in_2_hits        = (normalDmg * 2 >= nearest.hp) ? 1 : 0
  incoming_will_kill         = (max_incoming >= hp) ? 1 : 0
  can_kill_me               = (nearest.atk >= hp) ? 1 : 0
  has_wall_behind           = wall_behind_nearest ? 1 : 0   # for monk
  is_adjacent               = (manhattan == 1) ? 1 : 0
  total                     = 8

LOCAL MAP ENCODING (48 floats):
  12x4 local neighborhood around player (12 tiles up/down/left/right)
  Each tile encoded as: [is_wall, is_floor, is_stairs, is_shop, is_locked_door,
                         is_item, is_enemy, is_trap, is_secret, is_unknown,
                         dist_to_player_norm, has_seen]
  total = 12 * 4 = 48

TOTAL: 10 + 9 + 8 + 6 + 8 + 8 + 16 + 8 + 48 = 121 features
```

**Rounding to 128** with padding zeros for alignment to SIMD-friendly dimensions.

### 2.2 Feature Extraction Function

```python
def extract_state(G: dict) -> np.ndarray:
    """
    Extract 128-dim feature vector from game state dict G.
    Called once per turn, returns a float32 array.
    """
    p = G['player']
    features = []

    # PLAYER CORE
    features.append(p['hp'] / max(p['maxHp'], 1))
    features.append(min(p['maxHp'] / 100, 1.0))
    features.append(min(p['atk'] / 30, 1.0))
    features.append(min(p['def'] / 20, 1.0))
    features.append(min(p['lvl'] / 15, 1.0))
    features.append(clamp((p['xpNext'] - p['xp']) / 100))
    features.append(min(p['gold'] / 300, 1.0))
    # One-hot class
    class_onehot = [0] * 8
    class_onehot[CLASS_INDEX[p['class']]] = 1.0
    features.extend(class_onehot)

    # ... (remaining feature extraction per spec above)
    return np.array(features, dtype=np.float32)
```

---

## 3. Action Space

The action space is **discrete** with 20 actions. This covers all meaningful decisions the bot can make:

```
ACTION_SPACE (20 discrete actions):
─────────────────────────────────────
 0: MOVE_UP              ArrowUp
 1: MOVE_DOWN            ArrowDown
 2: MOVE_LEFT            ArrowLeft
 3: MOVE_RIGHT           ArrowRight
 4: ATTACK_NEAREST       Attack closest adjacent enemy
 5: ATTACK_SECOND        Attack second closest adjacent enemy
 6: ABILITY1             Use class ability 1 (bash/fireball/smite/etc.)
 7: ABILITY2             Use class ability 2 (shield wall/vanish/etc.)
 8: USE_POTION           Drink best carried healing potion
 9: USE_BUFF             Drink strength buff potion
10: USE_BOMB             Throw bomb (adjacent AoE)
11: USE_TELEPORT         Read teleport scroll
12: USE_DETECTION        Read detection scroll
13: DESCEND              Go down stairs
14: OPEN_SHOP            Open shop UI (if adjacent)
15: BUY_BEST             Buy best item in shop (if shop open)
16: SELL_GEAR            Sell unwanted gear (if shop open)
17: CLOSE_SHOP           Close shop UI
18: OPEN_INVENTORY       Toggle inventory
19: WAIT                 Do nothing (skip turn)
```

### 3.1 Action Masking

Many actions are invalid in certain states. We use **action masking** to zero out invalid actions before the softmax:

```python
def get_action_mask(G: dict) -> np.ndarray:
    """
    Returns a boolean mask of shape (20,).
    True = action is valid, False = invalid.
    """
    mask = np.zeros(20, dtype=bool)
    p = G['player']
    vis = [e for e in G['enemies'] if not e['dying'] and visible(e)]
    adj = [e for e in vis if manhattan(e, p) == 1]

    # Movement: always possible unless dead/won
    if not G['gameOver'] and not G['won']:
        for i in range(4):
            dx, dy = DIRS[i]
            nx, ny = p['x'] + dx, p['y'] + dy
            if in_bounds(nx, ny) and G['map'][ny][nx] != WALL:
                mask[i] = True

    # Attack: adjacent enemies (up to 2 attack slots)
    for i, _ in enumerate(adj[:2]):
        mask[4 + i] = True

    # Abilities
    if G['ability1Cooldown'] == 0:
        mask[6] = True
    if p['lvl'] >= 5 and G['ability2Cooldown'] == 0:
        mask[7] = True

    # Items (if in inventory)
    if any(i['type'] == 'potion' for i in carried(G)):
        mask[8] = True
    if any(i['type'] == 'potion_buff' for i in carried(G)):
        mask[9] = True
    # Bomb: valid if we have one AND there are enemies within 2 tiles (AoE range)
    if any(i['type'] == 'bomb' for i in carried(G)):
        nearby = [e for e in vis if manhattan(e, p) <= 2]
        if len(nearby) > 0:
            mask[10] = True
    if any(i['type'] == 'scroll_teleport' for i in carried(G)):
        mask[11] = True
    if any(i['type'] == 'scroll' and 'detection' in i['name'] for i in carried(G)):
        mask[12] = True

    # Descend
    if G['map'][p['y']][p['x']] == STAIRS and G['floor'] < FLOORS:
        mask[13] = True

    # Shop
    near_shop = any(manhattan(s, p) <= 1 for s in G.get('shops', []))
    if near_shop:
        mask[14] = True
    if G.get('shopOpen'):
        mask[15] = True  # buy
        mask[16] = True  # sell
        mask[17] = True  # close shop

    # Inventory toggle (always valid if not in special overlay)
    if not G.get('shopOpen') and not G.get('emergencyOpen'):
        mask[18] = True

    # Wait (always valid)
    mask[19] = True

    # CRITICAL: Block actions when stunned or rooted
    if p.get('rootedTurns', 0) > 0:
        mask[0:4] = False  # Can't move when rooted
    if p.get('stunnedTurns', 0) > 0:
        mask[:] = False    # Can't do anything when stunned
        mask[19] = True     # Except wait

    # Block abilities when stunned
    if p.get('stunnedTurns', 0) > 0:
        mask[6] = False
        mask[7] = False

    return mask
    mask[18] = True

    # Wait (always valid)
    mask[19] = True

    return mask
```

### 3.2 Action Execution

Each network output maps to a headless runner command:

```python
ACTION_TO_COMMAND = {
    0:  {'type': 'key', 'val': 'ArrowUp'},
    1:  {'type': 'key', 'val': 'ArrowDown'},
    2:  {'type': 'key', 'val': 'ArrowLeft'},
    3:  {'type': 'key', 'val': 'ArrowRight'},
    4:  lambda G: {'type': 'attack', 'target': closest_adjacent(G)},
    5:  lambda G: {'type': 'attack', 'target': second_closest_adjacent(G)},
    6:  {'type': 'key', 'val': 'b'},
    7:  {'type': 'key', 'val': 'v'},
    8:  lambda G: {'type': 'click', 'target': best_potion_selector(G)},
    9:  lambda G: {'type': 'click', 'target': buff_potion_selector(G)},
    10: lambda G: {'type': 'click', 'target': bomb_selector(G)},
    11: lambda G: {'type': 'click', 'target': teleport_selector(G)},
    12: lambda G: {'type': 'click', 'target': detection_selector(G)},
    13: {'type': 'key', 'val': '>'},
    14: {'type': 'key', 'val': 't'},
    15: lambda G: {'type': 'click', 'target': best_shop_buy(G)},
    16: lambda G: {'type': 'click', 'target': 'button[onclick="sellWeakerGear()"]'},
    17: {'type': 'key', 'val': 'Escape'},
    18: {'type': 'key', 'val': 'i'},
    19: None,  # skip turn
}
```

---

## 4. Network Architecture

### 4.1 Shared Backbone + Class-Specific Heads

```
Input: (batch, 128)  — state features
  │
  ├─► Shared MLP Backbone
  │     Linear(128, 256) → LayerNorm → ReLU
  │     Linear(256, 256) → LayerNorm → ReLU
  │     Linear(256, 128) → LayerNorm → ReLU
  │
  ├─► Policy Head (Actor)
  │     Linear(128, 64) → ReLU
  │     Linear(64, 20)  → [mask + softmax]
  │
  └─► Value Head (Critic)
        Linear(128, 64) → ReLU
        Linear(64, 1)   → scalar V(s)
```

**Parameters**: ~350K total (~270K backbone + 40K policy + 40K value).

### 4.2 Why This Architecture

- **MLP over CNN**: The state vector is already structured and compact (148 floats). A CNN would process raw map tiles, but the map is mostly walls (80%+) and fog of war means most tiles are unseen. The structured representation is far more sample-efficient.
- **No separate class networks**: A single shared backbone learns universal dungeon-crawling skills (exploration, resource management, positioning). Class-specific behavior emerges from the one-hot class input and action masking.
- **Moderate size**: 350K params trains fast on GPU and avoids overfitting with ~50K-200K game trajectories.

### 4.3 PyTorch Implementation

```python
import torch
import torch.nn as nn

class DelveNet(nn.Module):
    def __init__(self, state_dim=148, action_dim=20, hidden=256):
        super().__init__()
        # Backbone
        self.backbone = nn.Sequential(
            nn.Linear(state_dim, hidden),
            nn.LayerNorm(hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.LayerNorm(hidden),
            nn.ReLU(),
            nn.Linear(hidden, 128),
            nn.LayerNorm(128),
            nn.ReLU(),
        )
        # Policy head
        self.policy = nn.Sequential(
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, action_dim),
        )
        # Value head
        self.value = nn.Sequential(
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
        )

    def forward(self, state, action_mask=None):
        features = self.backbone(state)
        logits = self.policy(features)
        value = self.value(features)

        # Apply action masking
        if action_mask is not None:
            logits[~action_mask] = -1e9

        return logits, value

    def get_action(self, state, action_mask, deterministic=False):
        logits, value = self.forward(state, action_mask)
        probs = torch.softmax(logits, dim=-1)
        if deterministic:
            action = probs.argmax(dim=-1)
        else:
            dist = torch.distributions.Categorical(probs)
            action = dist.sample()
        log_prob = torch.log(probs.gather(-1, action.unsqueeze(-1)))
        return action, log_prob.squeeze(-1), value.squeeze(-1)
```

---

## 5. Training Loop (PPO)

### 5.1 PPO Hyperparameters

```python
CONFIG = {
    # PPO
    'lr': 3e-4,                    # Learning rate
    'gamma': 0.99,                 # Discount factor (long episodes)
    'lam': 0.95,                   # GAE lambda
    'clip_eps': 0.2,               # PPO clip range
    'entropy_coeff': 0.02,         # Entropy bonus (exploration)
    'value_coeff': 0.5,            # Value loss coefficient
    'max_grad_norm': 0.5,          # Gradient clipping
    'epochs_per_update': 3,        # Mini-batch epochs per rollout (reduced from 4)
    'batch_size': 1024,            # Mini-batch size (increased from 256)

    # Rollout
    'num_envs': 128,               # Parallel environments
    'rollout_steps': 256,          # Steps per env per rollout (reduced from 512)
    'total_timesteps': 10_000_000, # Total training steps

    # Network
    'state_dim': 148,              # Updated from 128
    'action_dim': 20,
    'hidden_dim': 256,

    # LR schedule
    'lr_start': 3e-4,
    'lr_end': 1e-5,
    'lr_decay_steps': 5_000_000,  # Linear decay over 5M steps

    # Checkpointing
    'save_every': 500_000,         # Save model every 500K steps
    'eval_every': 250_000,         # Eval win rate every 250K steps
    'eval_games': 100,             # Games per eval
}
```

### 5.2 Vectorized Environment

The key insight: run 128 headless games simultaneously. Each env is a Node.js VM sandbox instance (same as `headless_balance.js`). The Python training script communicates with a pool of worker threads.

```python
class DelveVectorEnv:
    """
    Wraps 128 headless DELVE game instances.
    Each env is a worker thread running the headless VM sandbox.
    Communication via shared memory or IPC.
    """
    def __init__(self, num_envs=128):
        self.num_envs = num_envs
        self.envs = []
        # Launch worker pool (reuse headless_balance.js infrastructure)
        self.worker_pool = WorkerPool(num_envs)
        self._reset_all()

    def _reset_all(self):
        """Reset all environments with different seeds."""
        seeds = [i * 10000 + random.randint(0, 9999) for i in range(self.num_envs)]
        classes = [CLASSES[i % 8] for i in range(self.num_envs)]
        self.worker_pool.reset_batch(seeds, classes)
        self.states = [None] * self.num_envs

    def reset(self, env_ids=None):
        """Reset specific environments, return initial states."""
        if env_ids is None:
            env_ids = list(range(self.num_envs))
        seeds = [random.randint(1, 10_000_000) for _ in env_ids]
        classes = [random.choice(CLASSES) for _ in env_ids]
        self.worker_pool.reset_batch(seeds, classes)
        states = self.worker_pool.get_states(env_ids)
        for i, s in zip(env_ids, states):
            self.states[i] = s
        return states

    def step(self, actions):
        """
        Execute actions in all environments.
        Returns: states, rewards, dones, infos
        """
        # Map discrete actions to game commands
        commands = [ACTION_TO_COMMAND[a](self.states[i]) if callable(ACTION_TO_COMMAND[a])
                    else ACTION_TO_COMMAND[a] for i, a in enumerate(actions)]

        # Execute in worker pool
        results = self.worker_pool.step_batch(commands)

        new_states = []
        rewards = []
        dones = []
        infos = []
        for i, result in enumerate(results):
            self.states[i] = result['state']
            new_states.append(result['state'])
            rewards.append(result['reward'])
            dones.append(result['done'])
            infos.append(result['info'])

        return new_states, rewards, dones, infos
```

### 5.3 Communication Architecture

**Strategy**: Use `subprocess` with stdin/stdout JSON lines. Each Node.js worker runs 8-16 game VMs internally and communicates via JSON lines over stdin/stdout. This is simpler and more reliable than TCP sockets.

```
┌─────────────────────────────────────────────────────────┐
│                    Python PPO Trainer (GPU)               │
│                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐  │
│  │  Rollout   │    │  PPO     │    │  Model Checkpoint│  │
│  │  Buffer    │◄──▶│  Update  │    │  Manager         │  │
│  └─────┬─────┘    └────┬─────┘    └────────┬─────────┘  │
│        │               │                    │             │
│        ▼               ▼                    ▼             │
│  ┌──────────────────────────────────────────────────┐   │
│  │         Worker Pool Manager (Python)              │   │
│  │  • Launches N Node.js worker processes            │   │
│  │  • Routes tasks to workers via stdin/stdout        │   │
│  │  • Collects results and assembles batch           │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │                                │
└─────────────────────────┼────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Node.js Worker│  │ Node.js Worker│  │ Node.js Worker│
│ 8-16 VM envs │  │ 8-16 VM envs │  │ 8-16 VM envs │
│ stdin/stdout │  │ stdin/stdout │  │ stdin/stdout │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Protocol**: Simple JSON lines over stdin/stdout:
```
Python → Worker: {"type":"step","env_id":0,"action":5}
Worker → Python: {"type":"result","env_id":0,"state":[...],"reward":3.5,"done":false}
```

**Why subprocess over TCP**:
- No network overhead (~0.1ms vs ~1ms per round trip)
- Simpler error handling (worker crash = subprocess exit)
- No port management or connection pooling
- Works on Windows without special configuration

---

## 6. Reward Shaping

The reward function is critical. We use a combination of **dense** (per-turn) and **sparse** (terminal) rewards:

### 6.1 Reward Components

```python
def compute_reward(prev_G, action, curr_G) -> float:
    """
    Compute reward after each action.
    Designed to prevent reward hacking and encourage winning.
    """
    reward = 0.0
    p = curr_G['player']
    pp = prev_G['player']

    # ── SURVIVAL ──
    if curr_G['won']:
        return +100.0              # Massive reward for winning
    if curr_G['gameOver']:
        return -50.0               # Penalty for dying

    # ── FLOOR PROGRESS ──
    if curr_G['floor'] > prev_G['floor']:
        reward += 20.0 * curr_G['floor']  # Bigger reward for deeper floors

    # ── COMBAT ──
    # Kill reward scales with enemy difficulty (prevents farming easy kills)
    prev_alive = {e['id'] for e in prev_G['enemies'] if not e['dying']}
    curr_alive = {e['id'] for e in curr_G['enemies'] if not e['dying']}
    killed = prev_alive - curr_alive
    for eid in killed:
        prev_en = next(e for e in prev_G['enemies'] if e['id'] == eid)
        xp = prev_en.get('xp', 0)
        if prev_en.get('boss'):
            reward += 40.0
        elif prev_en.get('isElite'):
            reward += 15.0
        else:
            # Scale with XP: Rat=3 -> +5, Troll=25 -> +15
            reward += 5.0 + xp * 0.4

    # ── HEALTH MANAGEMENT ──
    hp_delta = (p['hp'] - pp['hp']) / max(p['maxHp'], 1)
    # Reward healing when hurt (encourages potion use)
    if hp_delta > 0 and pp['hp'] < pp['maxHp'] * 0.6:
        reward += hp_delta * 8.0
    # Small penalty for taking damage from traps (no adjacent enemy)
    if hp_delta < -0.05 and len([e for e in curr_G['enemies'] if not e['dying'] and manhattan(e, p) <= 1]) == 0:
        reward -= 3.0

    # ── EXPLORATION ──
    explored_delta = (curr_G['seen_count'] - prev_G['seen_count'])
    if explored_delta > 0:
        reward += 0.1 * explored_delta  # 2x previous - encourages finding stairs/items

    # ── RESOURCE MANAGEMENT ──
    # Penalty for using potion at high HP (waste)
    if action == 8:  # USE_POTION
        if p['hp'] > p['maxHp'] * 0.8:
            reward -= 3.0

    # ── STAIR DISCOVERY ──
    if not prev_G.get('known_stairs') and curr_G.get('known_stairs'):
        reward += 8.0  # One-time bonus for finding stairs

    # ── GOLD ──
    gold_delta = p['gold'] - pp['gold']
    if gold_delta > 0:
        reward += gold_delta * 0.01  # Small gold reward (encourages shops)

    # ── LEVEL UP ──
    if p['lvl'] > pp['lvl']:
        reward += 8.0

    # ── TURN PENALTY ──
    reward -= 0.005  # Gentle penalty (encourages efficiency without discouraging exploration)

    return reward
```

### 6.2 Reward Scale Summary

| Event | Reward | Notes |
|-------|--------|-------|
| Win game | +100 | Terminal reward |
| Die | -50 | Terminal penalty |
| Descend floor | +15 × floor | Deeper = more valuable |
| Kill enemy | +3 to +30 | Scales with difficulty |
| Heal when low | up to +5 | Encourages healing |
| Take trap damage | -2 | Encourages caution |
| Explore new tiles | +0.05/tile | Encourages exploration |
| Waste potion | -2 | Discourages potion waste |
| Discover stairs | +5 | One-time bonus |
| Level up | +5 | Encourages combat |
| Each turn | -0.01 | Encourages efficiency |

### 6.3 Why This Works

The heuristic bot's primary failure is `lowHpCombatNoHealing` — it fights at low HP without drinking potions. The reward function directly addresses this by:
1. Rewarding healing when HP < 50%
2. Penalizing potion use when HP > 80%
3. Giving large kill rewards that make combat attractive when healthy
4. The turn penalty discourages endless exploration without progressing

---

## 7. Multi-Class Handling

### 7.1 Shared Policy with Class Conditioning

One network handles all 8 classes. The class is encoded as a one-hot vector in the state, so the network learns to condition its behavior on the class.

**Why not separate networks per class?**
- 8x less training data per class with separate networks
- Shared backbone learns universal dungeon-crawling skills
- The one-hot class input is sufficient for the network to learn class-specific behavior
- Action masking already handles class-specific ability availability

### 7.2 Class-Balanced Sampling

During training, we ensure equal representation of all classes:

```python
def sample_classes(batch_size):
    """
    Sample class assignments for a batch of environments.
    Ensures roughly equal distribution across 8 classes.
    """
    classes = []
    for i in range(batch_size):
        classes.append(CLASSES[i % 8])  # Round-robin
    random.shuffle(classes)
    return classes
```

### 7.3 Expected Class-Specific Learning

The network should learn:
- **Warrior**: Use Shield Wall defensively, Bash for burst damage, invest in DEF/HP
- **Rogue**: Vanish for stealth kills, Dash for escape, invest in Crit/Dodge
- **Mage**: Fireball for AoE, Blink for escape, use magic weapons, invest in ATK
- **Paladin**: Lay on Hands for sustain, Smite for stun, invest in HP/DEF
- **Ranger**: Bear Trap for kiting, Piercing Shot for line AoE, invest in Perception
- **Barbarian**: Bloodlust for vampiric combat, Cleave for AoE, invest in ATK/HP
- **Necromancer**: Siphon Life for sustain, Raise Dead for pets, invest in Vamp/HP
- **Monk**: Push Kick for wall slams, Flurry for burst, invest in Swiftness/Dodge

---

## 8. Headless Runner Integration

### 8.1 Modified `headless_balance.js` for RL

The existing headless runner is almost perfect for RL data collection. We need to modify it to:

1. Accept actions from an external source (Python) instead of `botDecisionLogic()`
2. Return the full game state after each action
3. Return whether the game is done

```javascript
// automation/headless_rl_runner.js
// Modified headless runner for RL data collection

function createRLEnv(seed, className) {
    const runtime = createRuntime(seed);
    const { context, flushTimers, captureSnapshot } = runtime;

    context.initGame(className);
    flushTimers();

    return {
        getState() {
            return captureSnapshot();
        },

        step(action) {
            // Execute the action
            interpretAndExecute(action, context, runtime.document);
            flushTimers();

            const after = captureSnapshot();
            const done = context.G.gameOver || context.G.won;
            const reward = computeReward(prevState, action, after);
            const info = { won: context.G.won, dead: context.G.gameOver };

            return { state: after, reward, done, info };
        },

        reset(newSeed, newClass) {
            const newRuntime = createRuntime(newSeed);
            newRuntime.context.initGame(newClass);
            newRuntime.flushTimers();
            return newRuntime.captureSnapshot();
        }
    };
}
```

### 8.2 Python-Node.js Bridge

For high-throughput data collection, we use a simple TCP socket protocol:

```python
class HeadlessBridge:
    """
    Connects to a pool of headless game workers via TCP.
    Each worker runs a Node.js process hosting 8-16 game VMs.
    """
    def __init__(self, workers=8, envs_per_worker=16):
        self.workers = []
        for i in range(workers):
            port = 9000 + i
            # Launch Node.js worker process
            proc = subprocess.Popen(
                ['node', 'automation/headless_rl_worker.js', '--port', str(port),
                 '--envs', str(envs_per_worker)],
                stdout=subprocess.PIPE
            )
            self.workers.append({'proc': proc, 'port': port, 'envs': envs_per_worker})

    def step_batch(self, env_ids, actions):
        """
        Send actions to workers, receive next states.
        Uses batched JSON over TCP for throughput.
        """
        # Group by worker
        by_worker = defaultdict(list)
        for env_id, action in zip(env_ids, actions):
            worker_id = env_id // 16
            local_id = env_id % 16
            by_worker[worker_id].append((local_id, action))

        # Send batched requests
        results = {}
        for worker_id, batch in by_worker.items():
            # Send JSON batch
            request = json.dumps({'type': 'step', 'batch': batch})
            socket = self.connections[worker_id]
            socket.send(request.encode())
            response = json.loads(socket.recv())
            for local_id, result in response['results']:
                global_id = worker_id * 16 + local_id
                results[global_id] = result

        return results
```

### 8.3 Alternative: Pure Python Simulation

If Node.js IPC proves too slow (< 1000 envs/sec), we port the critical game logic to Python. The game is simple enough that the core mechanics (movement, combat, item usage, FOV) can be replicated in ~2000 lines of Python/NumPy.

**Estimated performance**: ~5000 games/sec in pure Python vs ~128 games/sec via Node.js IPC. The Python approach is preferred for throughput.

---

## 9. Training Pipeline

### 9.1 File Structure

```
automation/
├── nn_rl/
│   ├── __init__.py
│   ├── config.py              # Hyperparameters
│   ├── network.py             # DelveNet architecture
│   ├── ppo.py                 # PPO algorithm
│   ├── reward.py              # Reward computation
│   ├── state_extractor.py     # Feature extraction from G
│   ├── action_mask.py         # Action validity masking
│   ├── vector_env.py          # Vectorized environment wrapper
│   ├── train.py               # Main training loop
│   ├── evaluate.py            # Evaluation and benchmarking
│   └── headless_bridge.py     # Node.js/headless runner bridge
├── headless_rl_runner.js      # Modified headless runner for RL
├── headless_rl_worker.js      # Worker process for parallel envs
└── NN_RL_DESIGN.md            # This file
```

### 9.2 Training Script (`train.py`)

```python
#!/usr/bin/env python3
"""
DELVE RL Training Script — PPO with vectorized environments.
Usage: python automation/nn_rl/train.py
"""
import torch
import numpy as np
from config import CONFIG
from network import DelveNet
from ppo import PPO
from vector_env import DelveVectorEnv
from evaluate import evaluate

def main():
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"Training on {device}")

    # Initialize
    env = DelveVectorEnv(num_envs=CONFIG['num_envs'])
    agent = PPO(DelveNet, CONFIG, device)
    rollout_buffer = RolloutBuffer(CONFIG)

    total_steps = 0
    episode_rewards = []
    episode_lengths = []

    print(f"Starting training: {CONFIG['total_timesteps']:,} steps, "
          f"{CONFIG['num_envs']} envs, {CONFIG['rollout_steps']} steps/env")

    while total_steps < CONFIG['total_timesteps']:
        # Collect rollout
        states = env.states  # Current states from all envs
        for step in range(CONFIG['rollout_steps']):
            # Extract features
            state_tensors = torch.stack([
                extract_state(s) for s in states
            ]).to(device)

            # Get action masks
            masks = torch.stack([
                torch.tensor(get_action_mask(s), dtype=torch.bool)
                for s in states
            ]).to(device)

            # Get actions from policy
            with torch.no_grad():
                actions, log_probs, values = agent.get_action(
                    state_tensors, masks
                )

            # Step environments
            next_states, rewards, dones, infos = env.step(actions.cpu().numpy())

            # Store transition
            rollout_buffer.store(
                states=state_tensors,
                actions=actions,
                log_probs=log_probs,
                values=values,
                rewards=torch.tensor(rewards, dtype=torch.float32),
                dones=torch.tensor(dones, dtype=torch.bool),
                masks=masks,
            )

            states = next_states
            total_steps += CONFIG['num_envs']

            # Track episodes
            for i, done in enumerate(dones):
                if done:
                    episode_rewards.append(infos[i].get('total_reward', 0))
                    episode_lengths.append(infos[i].get('total_steps', 0))

        # Update policy
        last_states = torch.stack([
            extract_state(s) for s in states
        ]).to(device)
        with torch.no_grad():
            _, _, last_values = agent.get_action(
                last_states,
                torch.stack([torch.tensor(get_action_mask(s), dtype=torch.bool) for s in states]).to(device)
            )
        rollout_buffer.compute_gae(last_values, CONFIG['gamma'], CONFIG['lam'])

        # PPO update
        update_info = agent.update(rollout_buffer, CONFIG)

        # Logging
        if len(episode_rewards) > 0:
            recent = episode_rewards[-100:]
            print(f"Step {total_steps:>10,} | "
                  f"Win Rate: {sum(1 for r in recent if r > 50) / len(recent):.1%} | "
                  f"Avg Reward: {np.mean(recent):.1f} | "
                  f"Avg Length: {np.mean(episode_lengths[-100:]):.0f} | "
                  f"Policy Loss: {update_info['policy_loss']:.4f} | "
                  f"Value Loss: {update_info['value_loss']:.4f}")

        # Evaluation
        if total_steps % CONFIG['eval_every'] == 0:
            eval_results = evaluate(agent, num_games=CONFIG['eval_games'])
            print(f"  EVAL: {eval_results['win_rate']:.1%} win rate, "
                  f"avg floor {eval_results['avg_floor']:.1f}")

        # Save checkpoint
        if total_steps % CONFIG['save_every'] == 0:
            agent.save(f"checkpoints/delve_ppo_{total_steps}.pt")

    # Final save
    agent.save("checkpoints/delve_ppo_final.pt")
    print("Training complete!")

if __name__ == '__main__':
    main()
```

### 9.3 PPO Update Algorithm

```python
class PPO:
    def __init__(self, network_class, config, device):
        self.network = network_class(
            state_dim=config['state_dim'],
            action_dim=config['action_dim'],
            hidden_dim=config['hidden_dim']
        ).to(device)
        self.optimizer = torch.optim.Adam(
            self.network.parameters(),
            lr=config['lr'],
            eps=1e-5
        )
        self.scheduler = torch.optim.lr_scheduler.LinearLR(
            self.optimizer,
            start_factor=1.0,
            end_factor=config['lr_end'] / config['lr_start'],
            total_iters=config['lr_decay_steps'] // (config['num_envs'] * config['rollout_steps'])
        )
        self.device = device

    def get_action(self, state, mask, deterministic=False):
        return self.network.get_action(state, mask, deterministic)

    def update(self, buffer, config):
        """PPO clipped objective update."""
        total_policy_loss = 0
        total_value_loss = 0
        total_entropy = 0

        # Flatten rollout
        states = buffer.states.reshape(-1, config['state_dim'])
        actions = buffer.actions.reshape(-1)
        old_log_probs = buffer.log_probs.reshape(-1)
        returns = buffer.returns.reshape(-1)
        advantages = buffer.advantages.reshape(-1)
        masks = buffer.masks.reshape(-1, config['action_dim'])

        dataset = torch.utils.data.TensorDataset(
            states, actions, old_log_probs, returns, advantages, masks
        )
        loader = torch.utils.data.DataLoader(
            dataset, batch_size=config['batch_size'], shuffle=True
        )

        for epoch in range(config['epochs_per_update']):
            for batch in loader:
                s, a, old_lp, ret, adv, m = [b.to(self.device) for b in batch]

                # Normalize advantages
                adv = (adv - adv.mean()) / (adv.std() + 1e-8)

                # Forward pass
                logits, value = self.network(s, action_mask=m)
                probs = torch.softmax(logits, dim=-1)
                dist = torch.distributions.Categorical(probs)

                new_lp = dist.log_prob(a)
                entropy = dist.entropy().mean()

                # PPO clipped objective
                ratio = torch.exp(new_lp - old_lp)
                surr1 = ratio * adv
                surr2 = torch.clamp(ratio, 1 - config['clip_eps'], 1 + config['clip_eps']) * adv
                policy_loss = -torch.min(surr1, surr2).mean()

                # Value loss
                value_loss = 0.5 * (ret - value.squeeze()).pow(2).mean()

                # Total loss
                loss = (policy_loss
                        + config['value_coeff'] * value_loss
                        - config['entropy_coeff'] * entropy)

                self.optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(
                    self.network.parameters(), config['max_grad_norm']
                )
                self.optimizer.step()

                total_policy_loss += policy_loss.item()
                total_value_loss += value_loss.item()
                total_entropy += entropy.item()

        self.scheduler.step()

        n = config['epochs_per_update'] * len(loader)
        return {
            'policy_loss': total_policy_loss / n,
            'value_loss': total_value_loss / n,
            'entropy': total_entropy / n,
        }
```

---

## 10. Training Timeline & Expectations

### 10.1 Throughput Estimates

| Component | Rate | Notes |
|-----------|------|-------|
| Headless runner (Node.js) | ~128 games/sec | 128 envs, ~1 game/sec each |
| Pure Python sim | ~5000 games/sec | If ported to Python |
| Feature extraction | ~500K states/sec | Numpy, no bottleneck |
| PPO update (GPU) | ~50ms per update | 330K params, tiny |
| Rollout collection | 512 steps × 128 envs | 65K steps, ~8 min with Node.js |
| Total steps/sec | ~135 | With Node.js IPC |
| | ~5000 | With Python sim |

### 10.2 Training Schedule (with Curriculum)

**Phase 1: Floor 1-2 (Easy)**
| Steps | Time (Python) | Expected Win Rate |
|-------|---------------|-------------------|
| 500K | ~2 min | 5-10% |
| 1M | ~3 min | 10-20% |
| 2M | ~7 min | 20-30% |

**Phase 2: Add Floor 3 (Medium)**
| Steps | Time (Python) | Expected Win Rate |
|-------|---------------|-------------------|
| 3M | ~10 min | 15-25% |
| 5M | ~17 min | 20-30% |

**Phase 3: Add Floor 4 (Hard)**
| Steps | Time (Python) | Expected Win Rate |
|-------|---------------|-------------------|
| 7M | ~23 min | 20-30% |
| 8M | ~27 min | 25-35% |

**Phase 4: Add Floor 5 + Self-Play (Boss)**
| Steps | Time (Python) | Expected Win Rate |
|-------|---------------|-------------------|
| 10M | ~33 min | 25-40% |
| 15M | ~50 min | 30-50% |

### 10.3 Expected Performance Curve

```
Win Rate vs Training Steps:
│
│ 60% ──────────────────────────────────────────── ╱──── ceiling
│ 50% ─────────────────────────────────────── ╱───╱
│ 40% ────────────────────────────────── ╱───╱
│ 30% ───────────────────────────── ╱───╱
│ 20% ─────────────────────── ╱───╱
│ 10% ───────────────── ╱───╱
│  5% ──────────── ╱───╱
│  0% ──────╱───╱
│       └────┴────┴────┴────┴────┴────┴────┴────┘
│       0   1M   2M   5M   8M  10M  15M  20M
│                    Training Steps
```

---

## 11. Hardware Utilization

### 11.1 GPU (RTX 5070 Ti, 16GB VRAM)

- **Network size**: 350K params = ~1.4MB in FP32
- **Batch size**: 1024 states × 148 features = ~606KB per batch
- **Peak VRAM**: ~600MB (network + optimizer + batch buffers)
- **GPU utilization**: Low-Medium. The bottleneck is environment interaction, not training.
- **Recommendation**: Use the remaining VRAM for larger batch sizes or multiple model copies for self-play.

### 11.2 CPU (Ryzen 7 9800X3D, 16 threads)

- **Node.js workers**: 16 workers × 8 envs each = 128 environments
- **CPU utilization**: ~80% during rollout collection
- **Python training**: 2-4 threads for data loading and preprocessing

### 11.3 RAM (64GB)

- **Headless VMs**: ~50MB per VM × 128 = ~6.4GB
- **Rollout buffer**: ~100MB (128 envs × 512 steps × 128 features)
- **PyTorch**: ~200MB
- **Total**: ~7GB peak. Plenty of headroom.

---

## 12. Implementation Plan

### Phase 1: Infrastructure (Day 1-2)

**Files to create:**
1. `automation/nn_rl/config.py` — All hyperparameters (updated state_dim=148)
2. `automation/nn_rl/state_extractor.py` — Extract 148-dim vector from game state
3. `automation/nn_rl/action_mask.py` — Compute valid action mask (with stun/root handling)
4. `automation/nn_rl/reward.py` — Reward function (with anti-hacking safeguards)
5. `automation/nn_rl/network.py` — DelveNet architecture (148 input dims)

**Validation:**
- Run state extractor on 1000 game frames from headless runner
- Verify feature ranges are [0, 1] where expected
- Test action masking against actual valid moves
- Unit test reward function
- Verify stun/root blocking works correctly
- Test action masking with all 8 classes

### Phase 2: Environment Bridge (Day 2-3)

**Files to create:**
1. `automation/headless_rl_runner.js` — Modified headless runner accepting external actions
2. `automation/nn_rl/headless_bridge.py` — Python→Node.js communication layer
3. `automation/nn_rl/vector_env.py` — Vectorized environment wrapper

**Validation:**
- Run 128 environments for 1000 steps each
- Measure throughput: must exceed 100 envs/sec via subprocess
- Verify state extraction matches headless runner snapshots
- Test action execution produces valid game states
- Test worker crash recovery (kill a worker, verify others continue)
- Verify JSON lines protocol handles malformed messages gracefully

### Phase 3: PPO Training (Day 3-4)

**Files to create:**
1. `automation/nn_rl/ppo.py` — PPO algorithm
2. `automation/nn_rl/rollout_buffer.py` — Experience storage with GAE
3. `automation/nn_rl/train.py` — Main training loop (with curriculum)
4. `automation/nn_rl/evaluate.py` — Evaluation harness

**Validation:**
- Train Phase 1 (floors 1-2) for 2M steps, verify loss decreases
- Run 100 eval games, measure survival rate to floor 3
- Verify GPU utilization is reasonable
- Check that entropy doesn't collapse too early
- Test curriculum transitions (floor 2→3, 3→4, 4→5)

### Phase 4: Optimization (Day 4-7)

**Tuning targets:**
- Action masking: ensure no illegal actions are taken
- Reward shaping: adjust weights based on early training behavior
- Hyperparameter sweep: learning rate, entropy coeff, rollout length
- Curriculum learning: verify phase transitions work correctly
- Self-play: train against own previous policies
- Class balance: ensure all 8 classes learn effectively

### Phase 5: Integration (Day 7-10)

**Files to create:**
1. `automation/nn_rl/inference.js` — Load trained model, replace `botDecisionLogic`
2. `automation/nn_rl/export.py` — Export PyTorch model to ONNX/TorchScript

**Integration:**
- Create wrapper that tries NN first, falls back to heuristic bot if NN fails or is uncertain
- Run 1000-game validation sweep across all 8 classes
- Compare win rates: heuristic vs ES vs NN-RL
- Benchmark inference latency: must be < 50ms per decision
- Test with both Puppeteer runner and headless runner

---

## 13. Risk Mitigation

### Risk 1: Slow Environment Interaction
**Mitigation**: If Node.js IPC is too slow (< 100 envs/sec), port the game simulation to Python. The game logic is ~3000 lines of JS that can be translated to Python/NumPy. This would give 5000+ envs/sec.

### Risk 2: Reward Shaping Causes Pathological Behavior
**Mitigation**: Start with minimal rewards (only terminal + floor progress). Add dense rewards incrementally. Monitor for reward hacking (e.g., agent farming easy kills instead of progressing).

### Risk 3: Overfitting to Training Seeds
**Mitigation**: Use 1000+ unique seeds during training. The game has procedural generation with seed-based RNG, so each seed is a unique dungeon. Hold out 100 seeds for evaluation.

### Risk 4: Class Imbalance
**Mitigation**: Round-robin class assignment ensures equal training. If one class is harder to learn, increase its weight in the loss function.

### Risk 5: Training Takes Too Long
**Mitigation**: Start with `num_envs=32` for fast iteration, scale to 128 for final training. Use a smaller network (128 hidden) for initial experiments, scale up if needed.

---

## 13.5 Curriculum Learning

Training on all difficulties simultaneously is 8x harder than learning one class at a time. Use a curriculum approach:

### Phase 1: Floor 1-2 Only (Easy)
- Train only on floors 1-2 (Rats, Goblins)
- Learn basic movement, combat, healing
- Target: 50% survival to floor 3
- ~2M steps, ~7 minutes

### Phase 2: Add Floor 3 (Medium)
- Add Skeletons, Orcs with enrage
- Learn to manage resources across floors
- Target: 30% survival to floor 4
- ~3M steps, ~10 minutes

### Phase 3: Add Floor 4 (Hard)
- Add Trolls with regen, Demons with vampiric
- Learn to conserve potions for late floors
- Target: 20% survival to floor 5
- ~3M steps, ~10 minutes

### Phase 4: Add Floor 5 (Boss)
- Add Dungeon Lord boss fight
- Learn boss-specific strategies
- Target: 10%+ win rate
- ~2M steps, ~7 minutes

**Total**: ~10M steps, ~35 minutes with Python simulation.

### Why Curriculum Works
- Each phase builds on skills learned in previous phases
- Easier early phases provide more positive rewards (faster learning)
- Later phases refine strategies learned in easier environments
- Prevents the agent from getting stuck in local optima

---

## 13.6 Self-Play Training

After basic training against the game AI, train against the bot's own previous policies to create stronger opponents:

### Phase 1: Game AI (0-5M steps)
- Train against the game's built-in enemy AI
- Learn basic dungeon crawling skills

### Phase 2: Self-Play (5-10M steps)
- Play against snapshots of the bot's own policy from 100K steps ago
- Forces the bot to adapt to its own strategies
- Prevents overfitting to game AI patterns

### Phase 3: Ensemble Self-Play (10-15M steps)
- Play against an ensemble of 3 past policies (100K, 500K, 1M steps ago)
- Harder than single self-play
- Forces robust, generalizable strategies

### Why Self-Play Works
- Game AI is too easy — doesn't prepare the bot for hard scenarios
- Self-play creates progressively harder opponents
- Prevents the bot from exploiting game AI weaknesses
- Forces the bot to develop robust strategies that work against any playstyle

---

## 14. Comparison with Existing Approaches

| Approach | Win Rate | Training Time | Complexity | Ceiling |
|----------|----------|---------------|------------|---------|
| Heuristic (bot_brain.js) | ~0.7% | N/A (manual) | High (1400 lines) | ~5% |
| Evolutionary Strategy | ~10-30% | 2-15 hours | Medium | ~40% |
| **NN-RL (PPO)** | **~25-40%** | **1-2 hours** | **High** | **~50%** |
| NN-RL + ES Hybrid | ~35-50% | 3-5 hours | Very High | ~60% |

The NN-RL approach has the highest ceiling because:
1. It learns generalizable strategies, not just parameter tuning
2. It can discover novel strategies (e.g., kiting, bait-and-switch)
3. It handles partial observability natively through its state representation
4. It can learn from its own mistakes via the value function
5. Self-play creates progressively harder opponents

**Conservative estimate**: 15-25% win rate after 10M steps (~30 min with Python simulation).
**Realistic target**: 25-40% win rate after 15M steps (~50 min with Python simulation).

---

## 15. Success Criteria

| Metric | Conservative | Target | Stretch |
|--------|-------------|--------|---------|
| Win Rate (all classes avg) | 15% | 30% | 50% |
| Best single-class win rate | 25% | 45% | 65% |
| Floor 5 reach rate | 30% | 50% | 70% |
| Training time to 15% | < 10 hours | < 5 hours | < 2 hours |
| Inference latency | < 50ms | < 20ms | < 10ms |

**Note**: These targets are based on:
- Current heuristic bot: ~0.7% win rate
- Evolutionary strategy: ~10-30% win rate
- NN-RL should significantly outperform both
- 40-60% may require months of iteration beyond initial training

---

## 16. Appendix: Key Game Constants

```
MAP_W = 56, MAP_H = 36, FLOORS = 5
TILE: WALL=0, FLOOR=1, STAIRS=2, SHOP=3, LOCKED_DOOR=4, SECRET_DOOR=5

Player starts at floor 1, ~50 HP, ~4 ATK, ~1 DEF
Level up: +8 HP, +1 ATK, +1 DEF per level
XP curve: xpNext *= 1.6 per level

Enemy tiers:
  Rat:     HP=8,  ATK=3,  DEF=0, XP=3
  Goblin:  HP=15, ATK=6,  DEF=1, XP=6
  Skeleton:HP=25, ATK=9,  DEF=2, XP=10 (revive)
  Orc:     HP=40, ATK=12, DEF=3, XP=15 (enrage)
  Troll:   HP=60, ATK=18, DEF=4, XP=25 (regen)
  Demon:   HP=85, ATK=22, DEF=5, XP=35 (vampiric)
  Lich:    HP=120,ATK=26, DEF=6, XP=50 (freeze)
  Boss:    HP=260,ATK=24, DEF=6, XP=250 (phase)

Vision radius: 6 tiles (raycasting)
Dodge base: 40% for rogues, 0% for others
Critical hit: from gear only (0-15%)
```

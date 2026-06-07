"""
DELVE RL Training Configuration
All hyperparameters for PPO training of the DELVE neural network bot.
"""

# ─── GAME CONSTANTS ──────────────────────────────────────────────────────────
MAP_W = 56
MAP_H = 36
FLOORS = 5
NUM_CLASSES = 8
CLASSES = ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk']

# ─── STATE / ACTION ──────────────────────────────────────────────────────────
STATE_DIM = 148        # 128 original + 6 missing features (shop, keys, floor difficulty, etc.)
ACTION_DIM = 20        # 4 move + 2 attack + 2 ability + 5 item + descend + shop + inventory + wait

# Action indices
ACTIONS = {
    'MOVE_UP': 0, 'MOVE_DOWN': 1, 'MOVE_LEFT': 2, 'MOVE_RIGHT': 3,
    'ATTACK_1': 4, 'ATTACK_2': 5,
    'ABILITY1': 6, 'ABILITY2': 7,
    'USE_POTION': 8, 'USE_BUFF': 9, 'USE_BOMB': 10, 'USE_TELEPORT': 11, 'USE_DETECTION': 12,
    'DESCEND': 13,
    'SHOP_OPEN': 14, 'SHOP_BUY': 15, 'SHOP_SELL': 16, 'SHOP_CLOSE': 17,
    'INVENTORY': 18, 'WAIT': 19,
}

# ─── NETWORK ─────────────────────────────────────────────────────────────────
STATE_DIM = 148
HIDDEN_DIM = 256

# ─── PPO HYPERPARAMETERS ─────────────────────────────────────────────────────
LR = 3e-4
GAMMA = 0.99              # Discount factor (long episodes)
LAM = 0.95                # GAE lambda
CLIP_EPS = 0.2            # PPO clip range
ENTROPY_COEFF = 0.02      # Entropy bonus (exploration)
VALUE_COEFF = 0.5         # Value loss coefficient
MAX_GRAD_NORM = 0.5       # Gradient clipping
EPOCHS_PER_UPDATE = 3     # Mini-batch epochs per rollout
BATCH_SIZE = 1024         # Mini-batch size

# ─── ROLLOUT ─────────────────────────────────────────────────────────────────
NUM_ENVS = 8             # Parallel environments (single worker)
ROLLOUT_STEPS = 256       # Steps per env per rollout
TOTAL_TIMESTEPS = 10_000_000

# ─── LR SCHEDULE ─────────────────────────────────────────────────────────────
LR_START = 3e-4
LR_END = 1e-5
LR_DECAY_STEPS = 5_000_000

# ─── CHECKPOINTING ───────────────────────────────────────────────────────────
SAVE_EVERY = 500_000
EVAL_EVERY = 250_000
EVAL_GAMES = 100

# ─── REWARD SHAPING ──────────────────────────────────────────────────────────
REWARD_WIN = 100.0
REWARD_DIE = -50.0
REWARD_FLOOR_PROGRESS = 20.0    # per floor
REWARD_KILL_BASE = 5.0
REWARD_KILL_XP_MULT = 0.4
REWARD_KILL_BOSS = 40.0
REWARD_KILL_ELITE = 15.0
REWARD_HEAL_MULT = 8.0
REWARD_TRAP_PENALTY = -3.0
REWARD_EXPLORE_MULT = 0.1
REWARD_STAIR_DISCOVERY = 8.0
REWARD_GOLD_MULT = 0.01
REWARD_LEVEL_UP = 8.0
REWARD_TURN_PENALTY = -0.005
REWARD_POTION_WASTE = -3.0

# ─── CURRICULUM ──────────────────────────────────────────────────────────────
# Phase 1: Floors 1-2 (easy enemies)
# Phase 2: Floors 1-3 (add Skeletons, Orcs)
# Phase 3: Floors 1-4 (add Trolls, Demons)
# Phase 4: Floors 1-5 (add Boss)
CURRICULUM = [
    {'name': 'easy', 'max_floor': 2, 'steps': 2_000_000},
    {'name': 'medium', 'max_floor': 3, 'steps': 3_000_000},
    {'name': 'hard', 'max_floor': 4, 'steps': 3_000_000},
    {'name': 'boss', 'max_floor': 5, 'steps': 2_000_000},
]

# ─── SELF-PLAY ───────────────────────────────────────────────────────────────
SELF_PLAY_START = 5_000_000   # Start self-play after 5M steps
SELF_PLAY_SNAPSHOT_AGE = 100_000  # Play against policy from 100K steps ago

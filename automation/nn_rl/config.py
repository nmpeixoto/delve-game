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
MAX_SHOP_SLOTS = 18
SHOP_ITEM_FEATURES = 19  # +4 upgrade-stat bits: atk/def/hp/other
STATE_DIM = 46 + MAX_SHOP_SLOTS * SHOP_ITEM_FEATURES
ACTION_DIM = 18 + MAX_SHOP_SLOTS        # Base gameplay actions + explicit shop buy-slot actions

# Action indices
ACTIONS = {
    'MOVE_UP': 0, 'MOVE_DOWN': 1, 'MOVE_LEFT': 2, 'MOVE_RIGHT': 3,
    'ATTACK_1': 4, 'ATTACK_2': 5,
    'ABILITY1': 6, 'ABILITY2': 7,
    'USE_POTION': 8, 'USE_BUFF': 9, 'USE_BOMB': 10, 'USE_TELEPORT': 11, 'USE_DETECTION': 12,
    'DESCEND': 13,
    'SHOP_OPEN': 14, 'SHOP_BUY': 15, 'SHOP_SELL': 16, 'ESCAPE': 17,
    # NOTE: SHOP_BUY (15) is a legacy generic-buy action. It is PERMANENTLY MASKED
    # by action_mask.py and never exposed to the policy. The per-slot SHOP_BUY_N
    # actions (indices 18+) are used instead. Do not remove: removing it would
    # shift all subsequent action indices and break saved checkpoints.
}

for slot in range(MAX_SHOP_SLOTS):
    ACTIONS[f'SHOP_BUY_{slot}'] = 18 + slot

# ─── NETWORK ─────────────────────────────────────────────────────────────────
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
# Throughput notes:
#   The env step bottleneck is JSON IPC over stdin/stdout between Python and
#   Node.js workers.  Each step sends a full game snapshot (~15-20KB) across a
#   pipe.  To amortize the per-message overhead:
#     - Use fewer, larger workers (ENVS_PER_WORKER=16 → only 8 Node processes)
#     - Use longer rollouts (ROLLOUT_STEPS=512) so we spend less % of time in
#       the PPO update and more time collecting experience in parallel.
#     - Keep NUM_ENVS high so Node processes stay busy.
NUM_ENVS = 128           # Parallel environments (128 = 8 workers × 16 envs each)
ENVS_PER_WORKER = 16     # 16 envs per Node.js worker → 8 workers total
ROLLOUT_STEPS = 512      # Steps per env per rollout (longer = better GPU fill)
TOTAL_TIMESTEPS = 200_000_000

# ─── LR SCHEDULE ─────────────────────────────────────────────────────────────
LR_START = 3e-4
LR_END = 1e-5
LR_DECAY_STEPS = 1_000_000_000   # Much longer decay: LR stays high to escape local minima

# ─── CHECKPOINTING ───────────────────────────────────────────────────────────
SAVE_EVERY = 500_000
EVAL_EVERY = 250_000
EVAL_GAMES = 100

# ─── REWARD SHAPING ──────────────────────────────────────────────────────────
REWARD_WIN = 300.0
REWARD_DIE = -80.0
REWARD_FLOOR_PROGRESS = 50.0    # per floor (reduced from 75 to avoid dominating)
REWARD_KILL_BASE = 5.0
REWARD_KILL_XP_MULT = 0.4
REWARD_KILL_BOSS = 40.0
REWARD_KILL_ELITE = 15.0
REWARD_HEAL_MULT = 8.0
REWARD_TRAP_PENALTY = -3.0
REWARD_EXPLORE_MULT = 0.1
REWARD_STAIR_DISCOVERY = 50.0   # increased from 30
REWARD_GOLD_MULT = 0.01
REWARD_LEVEL_UP = 8.0
REWARD_TURN_PENALTY = -0.075
REWARD_POTION_WASTE = -3.0
REWARD_KEY_DOOR_CHAIN = 40.0    # NEW: bonus for unlocking door within 20 steps of key pickup

# ─── CURRICULUM ──────────────────────────────────────────────────────────────
# The bot ALWAYS plays for a full dungeon clear (all 5 floors).
# No floor caps: floor caps teach the wrong objective — the bot learns to reach
# floor N, not to *win*. The two phases here progress Normal → Hard mode once
# the agent has demonstrated real competency at clearing the full dungeon.
#
# Phase advances when success_threshold is met over success_window episodes,
# checked per-class so no single class can carry the window.

# ─── SELF-PLAY ───────────────────────────────────────────────────────────────
SELF_PLAY_START = 5_000_000   # Start self-play after 5M steps
SELF_PLAY_SNAPSHOT_AGE = 100_000  # Play against policy from 100K steps ago

CURRICULUM = [
    {
        'name': 'full_dungeon_normal',
        'max_floor': None,          # No floor cap — always aim for a full win
        'hard_mode': False,
        'success_threshold': 0.80,  # 80% class-avg win rate before advancing to Hard
        'success_window': 1000,
        'min_steps': 10_000_000,
        'steps': 120_000_000,       # Up to 120M steps on Normal before Hard starts
    },
    {
        'name': 'full_dungeon_hard',
        'max_floor': None,          # No floor cap — always aim for a full win
        'hard_mode': True,
        'steps': 80_000_000,
    },
]

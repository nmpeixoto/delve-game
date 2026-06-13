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
STATE_DIM = 64 + MAX_SHOP_SLOTS * SHOP_ITEM_FEATURES
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
LR = 1e-4
GAMMA = 0.999             # Discount factor (long episodes)
LAM = 0.95                # GAE lambda
CLIP_EPS = 0.2            # PPO clip range
CLIP_V_LOSS = False       # MUST BE FALSE: Returns are unnormalized, clamping to 0.2 locks gradients
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
DEFAULT_MAX_EPISODE_STEPS = 8000  # Generous full-dungeon stall guard; pass 0 to disable.
TOTAL_TIMESTEPS = 200_000_000

# ─── LR SCHEDULE ─────────────────────────────────────────────────────────────
LR_START = 1e-4
LR_END = 1e-5
LR_DECAY_STEPS = 1_000_000_000   # Much longer decay: LR stays high to escape local minima

# ─── CHECKPOINTING ───────────────────────────────────────────────────────────
SAVE_EVERY = 500_000
EVAL_EVERY = 250_000
EVAL_GAMES = 100

# ─── REWARD SHAPING ──────────────────────────────────────────────────────────
REWARD_WIN = 35.0               # full clear must dominate all shaping
REWARD_DIE = -6.5               # losing after a long shaped run must still be bad
DEFAULT_TIMEOUT_PENALTY = -16.0
REWARD_FLOOR_PROGRESS = 1.8     # base reward for going deeper
REWARD_DESCEND_DEPTH_MULT = 1.5
REWARD_DESCEND_PREP_BONUS = 2.2
REWARD_UNPREPARED_DESCEND_PENALTY = -5.0
REWARD_CURRICULUM_SUCCESS = 3.0
REWARD_KILL_BASE = 0.05
REWARD_KILL_XP_MULT = 0.004
REWARD_KILL_BOSS = 2.0
REWARD_KILL_ELITE = 0.15
REWARD_HEAL_MULT = 0.08
REWARD_TRAP_PENALTY = -0.03
REWARD_EXPLORE_MULT = 0.001
REWARD_KEY_PICKUP = 0.2
REWARD_DOOR_UNLOCK = 0.3
REWARD_SECRET_REVEAL = 0.2
REWARD_EXPLORE_MILESTONE = 0.4
REWARD_STAT_ATK_DEF = 0.1
REWARD_STAT_MAX_HP = 0.05
REWARD_DAMAGE_PENALTY_MULT = 1.0
REWARD_STAIR_DISCOVERY = 0.5    # increased from 0.3
REWARD_GOLD_MULT = 0.0001
REWARD_LEVEL_UP = 0.08
REWARD_TURN_PENALTY = -0.00075
REWARD_POTION_WASTE = -0.03
REWARD_KEY_DOOR_CHAIN = 0.4     # NEW: bonus for unlocking door within 20 steps of key pickup
REWARD_STAIR_APPROACH = 0.04
REWARD_STAIR_RETREAT = -0.02

# ─── CURRICULUM ──────────────────────────────────────────────────────────────
# The bot must master full Normal dungeon clears before advancing to Hard mode.
# Reward shaping still teaches exploration, gearing, strength, and descent,
# but phase mastery is always based on complete dungeon wins.

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

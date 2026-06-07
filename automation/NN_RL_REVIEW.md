# Critical Review of NN_RL_DESIGN.md

## Overall Assessment

The design is well-structured and comprehensive. However, there are several weak spots, potential bugs, and unrealistic assumptions that need to be addressed before implementation.

---

## BUG 1: State Representation Missing Critical Features

**Location**: Section 2.1 (State vector, lines 22-160)

**Problem**: The 128-dim state vector is missing several critical features:

1. **No shop awareness**: The state doesn't include whether we've visited a shop on this floor, what shops exist, or their distances. The bot can't learn to seek out shops for upgrades.

2. **No key/locked door awareness**: The state includes `has_key` but not whether there are locked doors on the current floor or their distances. The bot can't learn to find keys and use them.

3. **No floor-specific strategy signals**: The state doesn't indicate whether we're on floor 1 (easy) vs floor 4 (hard). The bot needs to know to play conservatively on harder floors.

4. **Missing potion/heal ratio**: The state has `has_potion` but not `potion_count` or `potion_heal_ratio`. The bot can't learn to save potions for later floors.

5. **No turn counter**: The state has `turn_norm` but it's normalized to 2000. For a 500-turn game, this is always <0.25. The bot can't learn time pressure.

**Fix**: Add these features:
```python
# Missing features to add:
visited_shop_this_floor: bool  # Have we visited a shop this floor?
shop_distance: float           # Distance to nearest shop (normalized)
locked_door_count: int         # Number of locked doors on floor
key_count: int                 # Number of keys carried
potion_heal_ratio: float       # Average heal of carried potions / maxHp
floor_difficulty: float        # Floor * enemy_pressure_scale
turns_on_floor: int            # How long we've been on this floor
```

---

## BUG 2: Action Space Missing Important Actions

**Location**: Section 2.2 (Action space, lines 160-195)

**Problem**: The 20-action space is missing several important actions:

1. **No "use specific potion"**: The bot can only use "a potion" but not choose between Health Potion (15HP), Greater Potion (30HP), or Elixir of Life (60HP). On floor 5, using a small potion when you need a big one is wasteful.

2. **No "use specific item"**: The bot can't choose WHICH bomb, teleport, or buff to use. This matters when carrying multiple types.

3. **No "pick up item" action**: The bot can't explicitly pick up items on the ground. It relies on walking over them, which might not always work.

4. **No "open inventory" action**: The bot needs to open inventory to use items, but this isn't a separate action.

**Fix**: Either expand the action space or add item selection as a sub-action after the main action.

---

## BUG 3: Reward Function Has Reward Hacking Risks

**Location**: Section 6 (Reward shaping, lines 514-622)

**Problems**:

1. **Kill farming**: +3-30 per kill could cause the bot to farm easy kills (Rats) instead of progressing. The reward for killing a Rat (3 XP) is almost as much as exploring a new tile (0.05 × 10 tiles = 0.5).

2. **Exploration reward too small**: +0.05 per tile is negligible compared to kill rewards. The bot will ignore exploration.

3. **Gold reward too small**: +0.005 per gold means 100 gold = +0.5 reward. This is nothing compared to +100 for winning. The bot will ignore gold/shops.

4. **Turn penalty too aggressive**: -0.01 per turn means a 1000-turn game costs -10 reward. This discourages necessary exploration.

5. **Heal reward conditional on HP < 50%**: If the bot is at 51% HP and takes damage to 49%, it gets rewarded for healing but not for the damage taken. This creates a perverse incentive to take damage.

**Fix**:
```python
# Better reward scaling:
kill_reward = 5 + enemy_xp * 0.5  # Scale with enemy difficulty
explore_reward = 0.1 * tiles  # 2x current
gold_reward = 0.01 * gold  # 2x current  
turn_penalty = -0.005  # 50% less aggressive
# Remove heal reward conditional - just reward healing when hurt
```

---

## BUG 4: Vectorized Environment Communication is Too Complex

**Location**: Section 5.3 (Communication architecture, lines 478-512)

**Problem**: The design proposes TCP socket communication between Python and Node.js. This is:

1. **Slow**: TCP overhead is ~1ms per round trip. With 128 envs, that's 128ms per step. At 512 steps per rollout, that's 65 seconds just for communication.

2. **Complex**: Managing 128 TCP connections, handling failures, serializing/deserializing game state.

3. **Fragile**: If one Node.js worker crashes, the entire training loop breaks.

**Fix**: Use the `subprocess` approach from the existing `autoplay_test.js`:
- Launch one Node.js process per worker
- Communicate via stdin/stdout (JSON lines)
- Each worker handles 8-16 envs internally
- Much simpler and more reliable

---

## BUG 5: PPO Hyperparameters May Be Wrong

**Location**: Section 5.1 (PPO hyperparameters, lines 378-412)

**Problems**:

1. **`rollout_steps: 512`** is too large for this game. Games last 500-2000 turns. With 128 envs × 512 steps = 65K steps per rollout. But many envs will finish early (died/won), wasting compute.

2. **`batch_size: 256`** is too small for 65K steps. This means 256 mini-batches per update, which is slow.

3. **`epochs_per_update: 4`** is standard but may be too many for early training when the policy changes rapidly.

**Fix**:
```python
'rollout_steps': 256,  # Smaller rollout, more frequent updates
'batch_size': 1024,    # Larger batches for efficiency
'epochs_per_update': 3,  # Fewer epochs early, more later
```

---

## BUG 6: Reward Function Doesn't Handle Game Over Correctly

**Location**: Section 6.1 (Reward computation, lines 521-595)

**Problem**: The reward function checks `curr_G['won']` and `curr_G['gameOver']` but these are set AFTER the action is executed. The reward should be computed from the RESULT of the action, not the current state.

In the headless runner, `G.won` and `G.gameOver` are set during `advanceTurn()`. The reward function needs to check these AFTER the turn advances, not before.

**Fix**: The reward function should be called AFTER `advanceTurn()`, not before. The current design has this right in the code (`computeReward(prevState, action, after)`) but the description is confusing.

---

## BUG 7: Action Masking May Be Incomplete

**Location**: Section 2.3 (Action masking, lines 195-260)

**Problems**:

1. **Attack masking only checks first 2 adjacent enemies**: `mask[4 + i] = True` for `i in range(2)`. But the game allows attacking any adjacent enemy. The bot can only attack the first 2 enemies.

2. **Bomb requires adjacent enemies**: `mask[10] = True` only when `len(adj) > 0`. But bombs work on ALL enemies within 1 tile, not just adjacent ones.

3. **No check for "can act"**: The game has a `canAct()` function that prevents actions during animations. The mask doesn't account for this.

4. **No check for stunned/rooted**: If the player is stunned or rooted, they can't move. The mask doesn't check these conditions.

**Fix**:
```python
# Fix attack masking to handle all adjacent enemies
for i, e in enumerate(adj):
    if i < 2:  # Only first 2 attack slots
        mask[4 + i] = True

# Fix bomb to work at range
if any(i['type'] == 'bomb' for i in carried(G)):
    mask[10] = True  # Always valid if we have a bomb

# Add stunned/rooted check
if p.get('rootedTurns', 0) > 0:
    mask[0:4] = False  # Can't move
```

---

## BUG 8: Training May Not Converge

**Location**: Section 10 (Training timeline, lines 1013-1065)

**Problems**:

1. **8 classes share one network**: The network must learn 8 different playstyles. This is 8x harder than learning one class. The expected 40-60% win rate is optimistic.

2. **Partial observability**: The game has fog of war. The bot can't see the full map. Learning to explore efficiently under partial observability is very hard for RL.

3. **Sparse rewards**: Win/loss are the only meaningful rewards. The intermediate rewards (kills, exploration) are too small to guide learning effectively.

4. **Long episodes**: Games last 500-2000 turns. PPO struggles with long episodes because credit assignment is hard.

**Fix**: Consider training one class at a time first, then combining. Or use a curriculum: start with easy seeds, progress to hard ones.

---

## BUG 9: Integration May Break Existing Bot

**Location**: Section 15 (Success criteria, lines 1194-1203)

**Problem**: The design proposes replacing `botDecisionLogic()` with neural network inference. But:

1. The existing bot has 1400+ lines of logic that work. Replacing it entirely is risky.
2. The NN bot needs to handle ALL the same edge cases (overlays, modals, shop UI, inventory).
3. The NN bot needs to work with both the Puppeteer runner AND the headless runner.

**Fix**: Instead of replacing, create a wrapper that tries the NN first and falls back to the heuristic bot if the NN fails or is uncertain.

---

## BUG 10: No Baseline Comparison

**Location**: Section 16 (Appendix, lines 1206-1229)

**Problem**: The design claims the current bot wins ~0.7% but doesn't specify which version. The bot has been modified multiple times. The baseline should be:
1. The original unmodified bot
2. The bot with all my improvements
3. The evolutionary strategy bot

Without a clear baseline, we can't measure improvement.

**Fix**: Run a 1000-game audit of the current bot before starting NN training. This gives a reliable baseline.

---

## Weak Spots

### Weak Spot 1: No Curriculum Learning

The design doesn't mention curriculum learning. Training on all difficulties simultaneously is harder than starting easy and progressing. Consider:
- Start with floor 1-2 only
- Add floor 3 after reaching 20% win rate
- Add floor 4 after 40%
- Add floor 5 after 60%

### Weak Spot 2: No Self-Play

The bot trains against the game's built-in AI, which is simple. Self-play (training against itself) produces stronger opponents and better strategies. Consider:
- Phase 1: Train against game AI
- Phase 2: Train against own previous policy
- Phase 3: Train against ensemble of past policies

### Weak Spot 3: No Model Distillation

The NN model (330K params) is large for inference. Consider distilling to a smaller model (50K params) for faster inference in the actual bot.

### Weak Spot 4: No Adversarial Training

The bot should be trained against adversarial examples:
- Unlucky map generation (all enemies near spawn)
- Resource scarcity (no potions in shops)
- Boss with bad RNG (frequent crits)

### Weak Spot 5: No Transfer Learning

The design trains from scratch. Consider pre-training on simpler tasks:
- Learn to explore and find stairs (floor 1-2)
- Learn to fight basic enemies
- Learn to use items
- Then combine all skills

---

## Summary of Fixes Needed

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | HIGH | Missing state features | Add shop/key/floor features |
| 2 | HIGH | Incomplete action space | Add item selection sub-actions |
| 3 | HIGH | Reward hacking risks | Rescale rewards, add constraints |
| 4 | HIGH | TCP communication too slow | Use subprocess stdin/stdout |
| 5 | MEDIUM | PPO hyperparameters | Adjust rollout/batch sizes |
| 6 | LOW | Reward timing | Already correct in code |
| 7 | HIGH | Action masking incomplete | Fix attack/bomb/stun handling |
| 8 | MEDIUM | Training convergence | Add curriculum learning |
| 9 | MEDIUM | Integration risk | Add fallback to heuristic bot |
| 10 | LOW | No baseline | Run 1000-game audit first |

**Overall**: The design is 70% ready. It needs fixes to state representation, action masking, reward scaling, and communication architecture before implementation.

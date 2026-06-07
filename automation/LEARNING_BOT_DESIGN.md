# DELVE Learning Bot Design

## Current State

The bot (`bot_brain.js`, 1411 lines) is a hand-tuned heuristic system with ~50 strategy parameters per class defined in `strategy_config.json`. The headless runner (`headless_balance.js`) plays a full game in ~1 second using a VM sandbox (no browser needed). Current performance across 4424 runs:

| Class | Win Rate | Avg Floor | Best Floor |
|-------|----------|-----------|------------|
| warrior | 0% | 3.3 | 5 |
| rogue | 0% | 3.5 | 5 |
| mage | 1.4% | 3.6 | 5 |
| paladin | 0.7% | 3.5 | 5 |
| ranger | 0.7% | 3.4 | 5 |
| barbarian | 0% | 3.5 | 5 |
| necromancer | 0% | 3.4 | 5 |
| monk | 0% | 3.3 | 5 |

**Primary failure mode**: `lowHpCombatNoHealing` — the bot fights at low HP without drinking potions. Secondary: poor late-floor positioning, missed ability usage, and inefficient resource management.

**Key bottleneck**: The 50+ strategy parameters per class were manually tuned. The decision tree has ~30 conditional branches that interact in complex ways. Manual tuning has plateaued.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   LEARNING LOOP                      │
│                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐  │
│  │  Population │──▶│ Headless │──▶│   Fitness     │  │
│  │  of Params  │   │  Runner  │   │  Evaluation   │  │
│  │  (8 classes)│   │ (15 parallel)│ │ (win rate,   │  │
│  └──────────┘    └──────────┘    │  avg floor)   │  │
│       ▲                          └──────┬───────┘  │
│       │                                 │           │
│       │         ┌──────────┐            │           │
│       └─────────│ Mutation │◀───────────┘           │
│                 │ & Selection│                       │
│                 └──────────┘                        │
└─────────────────────────────────────────────────────┘
```

---

## Approach 1: Evolutionary Strategy (RECOMMENDED)

### How It Works

The bot's behavior is controlled by a **parameter vector** — the 50+ numbers in `strategy_config.json` that define thresholds, weights, and biases for each class. Instead of hand-tuning these, we evolve them.

**The genome** per class (~50 floats):
```
exitHp, combatHpFloor, combatPotionFloor, exploreThreshold, trapHpThreshold,
goldReserve, potionTarget, buffTarget, teleportTarget, bombTarget, detectionTarget,
bloodHpThreshold, bloodMinRemainingHp, greedGoldCap, cursedHpThreshold,
weaponBias, armorBias, buffAggression,
secondaryWeights.{perception, vampirism, regen, swiftness, goldBonus, xpMult, critChance, dodgeBonus},
upgradeWeights.{atk, def, hp, all, all5, vamp, regen, swift, perception, crit, dodge, goldBonus, xpMult, magicMult}
```

**The algorithm** (CMA-ES style, simplified):

1. **Initialize**: Start with current `strategy_config.json` as the seed genome
2. **Sample**: Generate N variations by adding Gaussian noise to each parameter
3. **Evaluate**: Run each variation through K headless games (different seeds)
4. **Select**: Keep the top M performers
5. **Mutate**: Generate new variations from the survivors
6. **Repeat**: Until win rate plateaus

**Concrete parameters**:
- Population size: 20 variations per class
- Games per variation: 10 (different seeds for statistical significance)
- Selection: Top 5 survive
- Mutation rate: 10% of each parameter's range
- Generations: 100-500 (depending on convergence)
- Total games per generation: 20 × 10 = 200 games
- At 15 parallel, ~13 seconds per generation
- 500 generations = ~2 hours of compute

### Implementation

```javascript
// automation/evolve_strategy.js

const CLASSES = ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk'];

// Parameter ranges (min, max, step)
const PARAM_RANGES = {
  exitHp:              [0.4, 0.85, 0.01],
  combatHpFloor:       [0.3, 0.7, 0.01],
  combatPotionFloor:   [0.25, 0.6, 0.01],
  exploreThreshold:    [0.1, 0.5, 0.01],
  trapHpThreshold:     [0.3, 0.8, 0.01],
  goldReserve:         [20, 120, 5],
  potionTarget:        [1, 6, 1],
  buffTarget:          [0, 3, 1],
  teleportTarget:      [0, 4, 1],
  bombTarget:          [0, 3, 1],
  detectionTarget:     [0, 2, 1],
  bloodHpThreshold:    [0.5, 0.9, 0.01],
  bloodMinRemainingHp: [8, 30, 1],
  greedGoldCap:        [100, 400, 10],
  cursedHpThreshold:   [0.2, 0.5, 0.01],
  weaponBias:          [0.5, 2.0, 0.05],
  armorBias:           [0.5, 2.0, 0.05],
  buffAggression:      [0.5, 2.0, 0.05],
  // secondaryWeights: each [0.3, 2.0, 0.05]
  // upgradeWeights: each [0.3, 2.0, 0.05]
};

function mutateGenome(genome, mutationRate = 0.1) {
  const mutated = { ...genome };
  for (const [key, range] of Object.entries(PARAM_RANGES)) {
    if (Math.random() < mutationRate) {
      const [min, max, step] = range;
      const noise = (Math.random() - 0.5) * (max - min) * 0.2;
      mutated[key] = Math.round((genome[key] + noise) / step) * step;
      mutated[key] = Math.max(min, Math.min(max, mutated[key]));
    }
  }
  // Same for secondaryWeights and upgradeWeights sub-objects
  return mutated;
}

function evaluateGenome(genome, className, seeds, maxTurns = 5000) {
  // Write genome to strategy_config.json temporarily
  // Run headless_balance.js with those params
  // Return fitness score: wins * 1000 + avgFloor * 100 + avgTurns
}
```

### Expected Improvement

- **Conservative**: 5-15% win rate within 200 generations (1 hour)
- **Optimistic**: 20-30% win rate within 500 generations (3 hours)
- **Ceiling**: 40-60% win rate (limited by RNG and game difficulty)

### Time to Train

| Phase | Games | Time (15 parallel) |
|-------|-------|-------------------|
| Per generation | 200 | ~13 seconds |
| 100 generations | 20,000 | ~22 minutes |
| 500 generations | 100,000 | ~2 hours |
| Full run (8 classes) | 800,000 | ~15 hours |

### Hardware Requirements

- **CPU**: Any modern multi-core (4+ cores)
- **RAM**: 500MB (VM sandboxes are lightweight)
- **GPU**: Not needed
- **Storage**: 100MB for logs and checkpoints

### Pros & Cons

| Pros | Cons |
|------|------|
| Simple to implement | Only optimizes parameters, not decision logic |
| Parallelizes perfectly | May get stuck in local optima |
| Fast feedback loop | Doesn't learn new strategies |
| Works with existing codebase | Mutation is random, not directed |
| Deterministic with seeds | 50 params per class = large search space |

---

## Approach 2: Q-Learning with Linear Function Approximation

### How It Works

Instead of evolving parameters, learn a **value function** that estimates "how good is this state?" and a **policy** that picks the best action in each state.

**State representation** (feature vector, ~30 features):
```javascript
{
  hpRatio: p.hp / p.maxHp,           // 0-1
  floor: G.floor / 5,                // 0-1
  hasPotion: carriedPotions().length > 0 ? 1 : 0,
  hasTeleport: carriedTeleports().length > 0 ? 1 : 0,
  hasBomb: carriedBombs().length > 0 ? 1 : 0,
  adjEnemyCount: adjEnemies.length / 4,  // normalized
  visEnemyCount: visEnemies.length / 6,
  isBossFloor: G.floor >= 5 ? 1 : 0,
  exploredRatio: G.seen.size / (56 * 36),
  goldRatio: p.gold / 300,            // normalized
  hasStairs: hasKnownStairs() ? 1 : 0,
  distToStairs: min(distToStairs / 30, 1),
  // ... more features
}
```

**Action space** (~12 discrete actions):
```
move_up, move_down, move_left, move_right,
ability1, ability2, use_potion, use_teleport, use_bomb,
descend, open_shop, wait
```

**Q-function**: `Q(state, action) = dot(state_features, action_weights)`

**Learning rule**:
```
Q(s,a) ← Q(s,a) + α[r + γ·max_a' Q(s',a') - Q(s,a)]
```

### Implementation Complexity

**High**. Requires:
- Feature engineering (what to observe)
- Reward shaping (what counts as "good")
- Exploration strategy (epsilon-greedy or softmax)
- Experience replay buffer
- Handling partial observability (the bot can't see the whole map)

### Expected Improvement

- **Conservative**: 10-20% win rate after 50,000 games
- **Optimistic**: 30-50% win rate after 200,000 games
- **Ceiling**: 50-70% (can learn non-trivial strategies)

### Time to Train

| Phase | Games | Time |
|-------|-------|------|
| Data collection | 50,000 | ~55 minutes |
| Training (CPU) | N/A | ~30 minutes |
| Total | 50,000 | ~1.5 hours |
| Full convergence | 200,000 | ~6 hours |

### Hardware Requirements

- **CPU**: 4+ cores (for parallel game collection)
- **RAM**: 2GB (replay buffer)
- **GPU**: Not needed (linear model)
- **Storage**: 500MB (replay buffer on disk)

### Pros & Cons

| Pros | Cons |
|------|------|
| Can learn non-trivial strategies | Complex to implement correctly |
| Handles partial observability | Feature engineering is critical |
| Theoretically optimal | Slow to converge |
| Can discover novel strategies | Reward shaping is tricky |

---

## Approach 3: Monte Carlo Tree Search (MCTS)

### How It Works

For each decision point, simulate many possible futures and pick the action that leads to the best outcomes.

**Algorithm**:
1. **Select**: Walk the tree from root using UCB1 (explore/exploit)
2. **Expand**: Add a new node for an untried action
3. **Simulate**: Play out the game randomly from the new node
4. **Backprop**: Update win counts along the path

**Key insight**: MCTS doesn't need a value function — it learns from simulation outcomes.

### Implementation

```javascript
// Per decision: simulate 100-500 random futures
// Each simulation: play until game ends (win/lose)
// Time per decision: ~10-50ms (100 simulations)
// Time per game: ~50-250 seconds (too slow for training)

// Optimization: only use MCTS for critical decisions
// (boss fights, low HP, stair descents)
// Use heuristic bot for routine movement
```

### Expected Improvement

- **Conservative**: 15-25% win rate
- **Optimistic**: 40-60% win rate
- **Ceiling**: 60-80% (with good simulation model)

### Time to Train

**No training needed** — MCTS is a planning algorithm, not a learning algorithm. But:
- Each game takes 50-250 seconds (vs 1 second for heuristic)
- Can only run 1-2 games in parallel (CPU bound)
- Not practical for bulk evaluation

### Hardware Requirements

- **CPU**: Single-core bottleneck (tree search is sequential)
- **RAM**: 100MB per search tree
- **GPU**: Not needed

### Pros & Cons

| Pros | Cons |
|------|------|
| No training required | Very slow per game |
| Theoretically optimal play | Can't parallelize well |
| Adapts to any game state | High implementation complexity |
| No feature engineering | Doesn't "learn" across games |

---

## Approach 4: Genetic Algorithm

### How It Works

Similar to Evolutionary Strategy but with crossover (combining two good genomes).

**Genome**: Same parameter vector as ES (50 floats per class)

**Operations**:
1. **Selection**: Tournament selection (pick best from random subset)
2. **Crossover**: Blend two parent genomes (weighted average)
3. **Mutation**: Add Gaussian noise
4. **Evaluation**: Run K games, compute fitness

### Expected Improvement

Same as ES (5-30% win rate) but:
- Crossover can combine good traits from different lineages
- More complex to implement
- Slightly better exploration of parameter space

### Time to Train

Same as ES: ~2-15 hours for full convergence.

### Pros & Cons

| Pros | Cons |
|------|------|
| Can combine good traits | More complex than ES |
| Well-studied algorithm | Crossover may not help much |
| Works with any fitness function | Same local optima problem |

---

## RECOMMENDED: Hybrid Approach

### Phase 1: Evolutionary Strategy (Quick Win)

**Goal**: Get to 10-20% win rate within 1 hour.

**How**:
1. Use current `strategy_config.json` as seed population
2. Run CMA-ES for 200 generations per class
3. 20 variations × 10 games × 8 classes = 16,000 games
4. At 15 parallel: ~18 minutes total
5. Write best parameters back to `strategy_config.json`

**Files to create**:
- `automation/evolve_strategy.js` — Main evolution loop
- `automation/fitness.js` — Fitness evaluation (wraps headless runner)
- `automation/genome.js` — Genome encoding/decoding

### Phase 2: Decision Tree Learning (Medium-Term)

**Goal**: Learn better decision rules from Phase 1 data.

**How**:
1. Record all decision points from winning games (Phase 1 output)
2. Build a decision tree classifier: "given this state, what action did the winner take?"
3. Replace hard-coded thresholds with learned rules
4. Validate with held-out games

**Files to create**:
- `automation/collect_trajectories.js` — Record state-action-outcome
- `automation/learn_rules.js` — Decision tree induction
- `automation/applied_rules.json` — Learned decision rules

### Phase 3: Hybrid Bot (Long-Term)

**Goal**: Combine evolved parameters with learned rules.

**How**:
1. Use evolved parameters for thresholds and weights
2. Use learned rules for complex decisions (when to fight vs flee)
3. Use MCTS only for boss fights (critical moments)
4. A/B test hybrid vs pure heuristic

---

## Implementation Plan

### Week 1: Infrastructure

**File: `automation/evolve_strategy.js`**

```javascript
#!/usr/bin/env node
// Evolutionary strategy for DELVE bot parameter optimization

const fs = require('fs');
const path = require('path');
const { main: runBalance } = require('./headless-balance/headless_balance.js');

const POPULATION_SIZE = 20;
const GAMES_PER_GENOME = 10;
const SURVIVORS = 5;
const MUTATION_RATE = 0.15;
const MUTATION_STRENGTH = 0.2; // 20% of parameter range

// Load current strategy as seed
function loadSeedStrategy() {
  const config = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'strategy_config.json'), 'utf8'
  ));
  return config.classes;
}

// Generate a mutant genome from a parent
function mutate(parent, paramRanges) {
  const child = JSON.parse(JSON.stringify(parent));
  for (const [key, range] of Object.entries(paramRanges)) {
    if (typeof child[key] === 'number' && Math.random() < MUTATION_RATE) {
      const [min, max] = range;
      const noise = (Math.random() - 0.5) * (max - min) * MUTATION_STRENGTH;
      child[key] = Math.max(min, Math.min(max, child[key] + noise));
      child[key] = Math.round(child[key] * 100) / 100; // 2 decimal places
    }
  }
  // Mutate nested objects (secondaryWeights, upgradeWeights)
  for (const key of Object.keys(child.secondaryWeights || {})) {
    if (Math.random() < MUTATION_RATE) {
      child.secondaryWeights[key] = Math.max(0.3, Math.min(2.0,
        child.secondaryWeights[key] + (Math.random() - 0.5) * 0.4
      ));
    }
  }
  for (const key of Object.keys(child.upgradeWeights || {})) {
    if (Math.random() < MUTATION_RATE) {
      child.upgradeWeights[key] = Math.max(0.3, Math.min(2.0,
        child.upgradeWeights[key] + (Math.random() - 0.5) * 0.4
      ));
    }
  }
  return child;
}

// Evaluate a genome's fitness
async function evaluate(genome, className, seedBase, games) {
  // Write temporary strategy config
  const tempConfig = { version: 99, classes: { [className]: genome } };
  const tempPath = path.join(__dirname, 'strategy_config_evolve.json');
  fs.writeFileSync(tempPath, JSON.stringify(tempConfig));

  // Run headless balance
  let totalWins = 0, totalFloor = 0;
  for (let i = 0; i < games; i++) {
    const result = runSingle({
      className,
      seed: seedBase + i,
      maxTurns: 5000,
      trace: false,
    });
    if (result.status === 'won') totalWins++;
    totalFloor += result.finalFloor;
  }

  // Fitness: wins are worth 1000 points, floor progress is worth 10
  return totalWins * 1000 + (totalFloor / games) * 10;
}

// Main evolution loop
async function evolve(className, generations = 200) {
  const seed = loadSeedStrategy();
  let population = [];
  let bestFitness = 0;
  let bestGenome = seed[className];

  // Initialize population with mutations of seed
  for (let i = 0; i < POPULATION_SIZE; i++) {
    population.push(mutate(seed[className], PARAM_RANGES));
  }

  for (let gen = 0; gen < generations; gen++) {
    // Evaluate all genomes
    const scored = [];
    for (const genome of population) {
      const fitness = await evaluate(genome, className, gen * 1000, GAMES_PER_GENOME);
      scored.push({ genome, fitness });
    }

    // Sort by fitness
    scored.sort((a, b) => b.fitness - a.fitness);

    // Track best
    if (scored[0].fitness > bestFitness) {
      bestFitness = scored[0].fitness;
      bestGenome = scored[0].genome;
      console.log(`[${className}] Gen ${gen}: new best fitness ${bestFitness}`);
    }

    // Select survivors
    const survivors = scored.slice(0, SURVIVORS).map(s => s.genome);

    // Generate next population
    population = [...survivors];
    while (population.length < POPULATION_SIZE) {
      const parent = survivors[Math.floor(Math.random() * survivors.length)];
      population.push(mutate(parent, PARAM_RANGES));
    }

    // Log progress
    if (gen % 10 === 0) {
      const avgFitness = scored.reduce((s, x) => s + x.fitness, 0) / scored.length;
      console.log(`[${className}] Gen ${gen}: avg=${avgFitness.toFixed(0)} best=${bestFitness}`);
    }
  }

  return bestGenome;
}

// Run evolution for all classes
async function main() {
  const classes = process.argv.slice(2);
  const targetClasses = classes.length ? classes : CLASSES;

  for (const cls of targetClasses) {
    console.log(`\n=== Evolving ${cls} ===`);
    const bestGenome = await evolve(cls, 200);

    // Update strategy_config.json
    const config = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'strategy_config.json'), 'utf8'
    ));
    config.classes[cls] = bestGenome;
    config.lastImproved = new Date().toISOString();
    fs.writeFileSync(
      path.join(__dirname, 'strategy_config.json'),
      JSON.stringify(config, null, 2)
    );
    console.log(`[${cls}] Saved best genome to strategy_config.json`);
  }
}

if (require.main === module) main();
```

### Week 2: Trajectory Collection

**File: `automation/collect_trajectories.js`**

Record every decision point during gameplay:
```javascript
// For each turn, record:
{
  state: {              // What the bot observed
    hp, maxHp, floor, gold, lvl,
    adjEnemyCount, visEnemyCount,
    hasPotion, hasTeleport, hasBomb,
    exploredRatio, distToStairs,
    // ... 30 features
  },
  action: 'move_up',   // What the bot did
  reward: 0,           // Immediate reward (+10 for kill, -100 for death, 0 otherwise)
  nextState: {...},    // State after action
  outcome: 'ongoing'   // 'won', 'dead', 'ongoing'
}
```

### Week 3: Rule Learning

**File: `automation/learn_rules.js`**

Build decision trees from winning trajectories:
```javascript
// For each decision type (combat, exploration, recovery):
// 1. Filter trajectories where the bot won
// 2. Extract state features at each decision point
// 3. Build decision tree: features → action
// 4. Prune tree to prevent overfitting
// 5. Export as JSON rules

// Example learned rule:
{
  "condition": "hpRatio < 0.4 && hasPotion && adjEnemyCount >= 2",
  "action": "use_potion",
  "confidence": 0.92,
  "support": 150  // seen in 150 winning trajectories
}
```

### Week 4: Integration & Testing

1. Integrate evolved parameters into `strategy_config.json`
2. Integrate learned rules into `bot_brain.js`
3. Run 1000-game validation sweep
4. Compare win rates: baseline vs evolved vs hybrid
5. A/B test on different seed sets

---

## File Structure

```
automation/
├── evolve_strategy.js          # Phase 1: Parameter evolution
├── collect_trajectories.js     # Phase 2: Data collection
├── learn_rules.js              # Phase 3: Rule learning
├── fitness.js                  # Fitness evaluation helper
├── genome.js                   # Genome encoding/decoding
├── strategy_config.json        # Current best parameters (evolved)
├── learned_rules.json          # Decision rules (learned)
├── evolution_log.json          # Evolution history
├── trajectories/               # Recorded game trajectories
│   ├── warrior_001.json
│   ├── mage_042.json
│   └── ...
├── bot_brain.js                # Bot decision logic (updated)
├── headless-balance/
│   └── headless_balance.js     # Headless game runner
└── LEARNING_BOT_DESIGN.md      # This file
```

---

## Risk Mitigation

### Risk 1: Local Optima
**Mitigation**: 
- Restart evolution from 3 different random seeds
- Use adaptive mutation rate (start high, decrease)
- occasionally inject random genomes (10% of population)

### Risk 2: Overfitting to Specific Seeds
**Mitigation**:
- Use 10+ different seeds per evaluation
- Rotate seed sets each generation
- Validate on held-out seed set every 50 generations

### Risk 3: Training Takes Too Long
**Mitigation**:
- Start with small population (10) and scale up
- Use early stopping (stop if no improvement for 50 generations)
- Run evolution overnight (8 hours = ~3500 generations)

### Risk 4: Evolved Params Break Existing Logic
**Mitigation**:
- Validate evolved params against current best before applying
- Run regression tests (`npm test`) after each evolution
- Keep human-tuned params as fallback

---

## Success Metrics

| Metric | Baseline | Phase 1 Target | Phase 2 Target | Phase 3 Target |
|--------|----------|----------------|----------------|----------------|
| Win Rate | 0.7% | 10-20% | 20-30% | 30-50% |
| Avg Floor | 3.4 | 3.8-4.2 | 4.0-4.5 | 4.2-4.8 |
| Floor 5 Rate | 8% | 25-40% | 35-50% | 45-60% |
| Training Time | N/A | 1 hour | 2 hours | 4 hours |

---

## Quick Start

```bash
# Phase 1: Evolve parameters for all classes
node automation/evolve_strategy.js

# Phase 1: Evolve for a specific class
node automation/evolve_strategy.js warrior mage

# Phase 2: Collect trajectories from winning games
node automation/collect_trajectories.js --games 1000

# Phase 3: Learn decision rules from trajectories
node automation/learn_rules.js --input automation/trajectories

# Validate evolved params
node automation/headless-balance/headless_balance.js --classes all --per-class 50
```

---

## Conclusion

The **Evolutionary Strategy** approach is recommended because:

1. **Fits the existing architecture**: The bot already has 50+ tunable parameters
2. **Fast feedback**: 1 second per game, 15 parallel = 200 games in 13 seconds
3. **No GPU needed**: Pure CPU, runs on any machine
4. **Simple to debug**: If a parameter looks wrong, we can see why
5. **Incremental improvement**: Each generation is better than the last

The hybrid approach (ES + decision tree learning) can push win rates from 10-20% to 30-50% by learning complex decision rules that parameter tuning alone cannot capture.

**Expected timeline**: 1 week for Phase 1, 2 weeks for Phase 2, 1 month for Phase 3.

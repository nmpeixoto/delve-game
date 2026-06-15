# RL Training Efficiency and Class Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the DELVE PPO training path so rollout generation no longer starves the GPU, then expand the agent's action space and model capacity so ranged and fragile classes can learn real tactical play.

**Architecture:** The current trainer is CPU bound because Python workers repeatedly create dict snapshots, rebuild observations, compute action masks, and send large NumPy arrays through multiprocessing pipes. This plan first adds measurement, then replaces snapshot-heavy rollout transport with direct observation buffers and shared memory, then overlaps actors with the learner, then adds tactical actions and a larger class-aware network. Model expansion is deliberately late so the extra GPU work is fed by a faster sample pipeline.

**Tech Stack:** Python 3.14, PyTorch PPO, NumPy, multiprocessing shared memory, optional Numba for numeric hot paths, existing DELVE pure-Python game engine, existing Node/browser parity tests.

---

## Current Evidence

The current live run showed roughly:

- About 3.5k environment steps per second over the latest 20 Tensor rows.
- GPU utilization around 5-7 percent average, with short spikes during PPO updates.
- Eight Python worker processes doing most of the CPU work.
- Latest class split still weak for Ranger, Mage, Monk, Warrior, and Rogue compared with Paladin, Barbarian, and Necromancer.

The bottleneck is not that the neural network is too small to occupy the GPU. The bottleneck is that the learner waits for CPU rollout collection. Increasing the network first would make PPO updates heavier, but it would not fix samples per hour.

## Success Targets

Do not accept subjective "feels faster" results. Each phase must report:

| Metric | Current Baseline | Phase 1 Target | Phase 2 Target | Final Target |
|---|---:|---:|---:|---:|
| Env steps/sec | ~3.5k | 5k-7k | 8k-15k | 20k+ |
| GPU average utilization | ~5-7% | 10-18% | 20-35% | 40%+ |
| CPU seconds per 1M env steps | high baseline | -30% | -50% | -70% or better |
| Latest class-avg win rate | volatile ~16-30% | no regression | no regression | improved fixed-seed eval |
| Ranger/Mage/Rogue fixed-seed win rate | weak | no regression | no regression | measurable improvement |

If a phase increases GPU utilization but lowers env steps/sec enough that fixed wall-clock learning gets worse, reject or revise it.

## Non-Goals

- Do not rewrite the browser game or `dungeon.html`.
- Do not add external assets.
- Do not discard checkpoints unless a migration attempt fails and the user explicitly accepts a reset.
- Do not tune rewards at the same time as the transport rewrite. That would make performance and learning changes impossible to interpret.
- Do not expand the model before the benchmark harness can compare throughput and fixed-seed behavior.

## File Structure

Planned new files:

- `automation/nn_rl/perf_probe.py`  
  Standalone benchmark runner for env stepping, observation building, PPO update timing, and GPU sampling.
- `automation/nn_rl/observation.py`  
  Direct array-based observation writer that replaces dict snapshot extraction in training.
- `automation/nn_rl/shared_rollout.py`  
  Shared-memory rollout transport between actor workers and the main learner.
- `automation/nn_rl/async_trainer.py`  
  Optional second trainer path using double-buffered actor collection and learner updates.
- `automation/nn_rl/tactical_actions.py`  
  Class-aware tactical action helpers for ranged targeting, kiting, and safe movement.
- `automation/nn_rl/checkpoint_migration.py`  
  Weight migration utility for expanding network capacity without wiping all learned parameters.
- `tests/nn_rl_perf_test.py`  
  Focused tests for benchmark accounting, shared-memory shapes, and observation parity.
- `tests/nn_rl_tactical_actions_test.py`  
  Tests for ranged/kiting action masks and decision translation.
- `tests/nn_rl_checkpoint_migration_test.py`  
  Tests that old checkpoints can load into expanded networks with compatible weights copied.

Planned modified files:

- `automation/nn_rl/game_engine.py`  
  Add direct observation support without changing gameplay logic.
- `automation/nn_rl/state_extractor.py`  
  Keep existing extractor for parity and tests; route trainer to direct writer once parity passes.
- `automation/nn_rl/action_mask.py`  
  Add tactical/ranged action validity.
- `automation/nn_rl/vector_env.py`  
  Introduce direct observation and shared-memory worker modes.
- `automation/nn_rl/train.py`  
  Add CLI flags for transport mode, perf logging, and model variant selection.
- `automation/nn_rl/network.py`  
  Add model variants after throughput phases pass.
- `automation/nn_rl/config.py`  
  Add action/model config constants. Preserve existing user edits in this file.
- `automation/nn_rl/ppo.py`  
  Fix hidden-size plumbing and support larger recurrent models.
- `tests/nn_rl_bridge_test.py`, `tests/nn_rl_metrics_test.py`, `tests/nn_rl_pretraining_bug_hunt_test.py`  
  Extend regression coverage for class split metrics, action masks, and trainer configuration.

## Critical Design Choices

### Choice 1: Direct Observation Before Shared Memory

Recommendation: implement `observe_into()` first.

Reasoning: Shared memory removes transport overhead, but the current workers still spend too much CPU constructing dict snapshots and rebuilding state from those dicts. If shared memory is added first, it may hide only part of the problem.

Risk: Direct observation touches core RL state semantics and can silently change learning. Mitigation: write parity tests comparing direct arrays against `extract_state()`, `extract_local_map()`, and `get_action_mask()` for fixed seeds before using it in training.

### Choice 2: Tactical Action Space Before Huge Network

Recommendation: add ranged/kiting actions before a major model expansion.

Reasoning: Ranger and Mage cannot learn robust ranged play if the action space does not expose useful ranged target choices. `ATTACK_1` and `ATTACK_2` are currently masked out, and their decision translation only chooses adjacent enemies. A bigger network cannot select actions that are unavailable.

Risk: Tactical actions can become too hand-authored and reduce the learning problem to heuristics. Mitigation: keep actions as primitives, not policies. Example: expose "attack nearest line-clear enemy" and "move to safest adjacent tile"; let PPO learn when to use them.

### Choice 3: Checkpoint Migration Instead of Step-0 Reset

Recommendation: migrate compatible old weights into larger networks.

Reasoning: Resetting 600M+ steps is unnecessarily expensive. A migration script can copy matching tensors and copy overlapping slices for expanded layers.

Risk: Migrated weights can bias the bigger model into the old local optimum. Mitigation: reset optimizer state, optionally increase entropy temporarily, and compare against a clean-start short run.

### Choice 4: Async Actors Only After Synchronous Parity

Recommendation: keep deterministic synchronous mode until direct observation and shared memory are correct.

Reasoning: Async actor/learner bugs are harder to debug. First make a faster synchronous path with identical semantics.

Risk: PPO can degrade if async data is too stale. Mitigation: double-buffer only one rollout of staleness at first; log policy version per rollout.

---

## Task 1: Performance Benchmark Harness

**Files:**
- Create: `automation/nn_rl/perf_probe.py`
- Create: `tests/nn_rl_perf_test.py`
- Modify: `automation/nn_rl/train.py`

- [ ] **Step 1: Write the failing perf accounting test**

Create `tests/nn_rl_perf_test.py` with:

```python
import os
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NN_RL_DIR = os.path.join(REPO_ROOT, "automation", "nn_rl")
sys.path.insert(0, NN_RL_DIR)

from perf_probe import summarize_stage_timings


class NnRlPerfTest(unittest.TestCase):
    def test_summarize_stage_timings_reports_percentages(self):
        summary = summarize_stage_timings({
            "env_step": 6.0,
            "observe": 3.0,
            "learner": 1.0,
        })

        self.assertEqual(summary["total_seconds"], 10.0)
        self.assertAlmostEqual(summary["stages"]["env_step"]["pct"], 60.0)
        self.assertAlmostEqual(summary["stages"]["observe"]["pct"], 30.0)
        self.assertAlmostEqual(summary["stages"]["learner"]["pct"], 10.0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python -m unittest tests.nn_rl_perf_test -v
```

Expected: import failure for `perf_probe` or missing `summarize_stage_timings`.

- [ ] **Step 3: Implement the benchmark summary helper**

Create `automation/nn_rl/perf_probe.py` with:

```python
#!/usr/bin/env python3
"""Benchmark helpers for DELVE PPO training performance."""

from __future__ import annotations

import argparse
import json
import time
from collections.abc import Mapping


def summarize_stage_timings(stage_seconds: Mapping[str, float]) -> dict:
    total = sum(max(float(value), 0.0) for value in stage_seconds.values())
    stages = {}
    for name, seconds in sorted(stage_seconds.items()):
        value = max(float(seconds), 0.0)
        stages[name] = {
            "seconds": value,
            "pct": (100.0 * value / total) if total > 0 else 0.0,
        }
    return {"total_seconds": total, "stages": stages}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Probe DELVE PPO training throughput.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = parser.parse_args(argv)

    start = time.perf_counter()
    result = {
        "wall_seconds": time.perf_counter() - start,
        "stage_summary": summarize_stage_timings({}),
    }
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        print(result)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
python -m unittest tests.nn_rl_perf_test -v
```

Expected: PASS.

- [ ] **Step 5: Add trainer timing hooks**

Modify `automation/nn_rl/train.py` around rollout collection and PPO update to record:

```python
stage_t0 = time.perf_counter()
# env/action/observe collection block
stage_seconds["collect"] += time.perf_counter() - stage_t0

stage_t0 = time.perf_counter()
info = ppo.update(buffer, last_states, last_maps, last_masks, hidden)
stage_seconds["learner"] += time.perf_counter() - stage_t0
```

Include these fields in `build_training_metrics_row()`:

```python
"perf": {
    "steps_per_second": total_steps / max(elapsed, 1e-9),
    "stage_seconds": dict(stage_seconds),
}
```

- [ ] **Step 6: Verify no training metric regression**

Run:

```bash
python -m unittest tests.nn_rl_metrics_test -v
```

Expected: PASS. If existing tests assert exact row keys, update them to assert `perf` exists only when supplied.

- [ ] **Step 7: Commit**

```bash
git add automation/nn_rl/perf_probe.py automation/nn_rl/train.py tests/nn_rl_perf_test.py tests/nn_rl_metrics_test.py
git commit -m "chore: add rl training performance probes"
```

---

## Task 2: Direct Observation Parity Harness

**Files:**
- Create: `automation/nn_rl/observation.py`
- Modify: `automation/nn_rl/game_engine.py`
- Test: `tests/nn_rl_perf_test.py`

- [ ] **Step 1: Write the failing observation parity test**

Append to `tests/nn_rl_perf_test.py`:

```python
import numpy as np

from config import ACTION_DIM, STATE_DIM
from game_engine import DelveGame
from observation import allocate_observation_arrays, observe_game_into
from state_extractor import extract_local_map, extract_state
from action_mask import get_action_mask


class NnRlObservationParityTest(unittest.TestCase):
    def test_observe_game_into_matches_existing_extractors(self):
        game = DelveGame(seed=123, player_class="ranger", hard_mode=False)
        state = game.snapshot()
        arrays = allocate_observation_arrays(1)

        observe_game_into(game, arrays, 0, prev_action=None)

        np.testing.assert_allclose(arrays.states[0], extract_state(state), rtol=0, atol=1e-6)
        np.testing.assert_allclose(arrays.maps[0], extract_local_map(state), rtol=0, atol=1e-6)
        np.testing.assert_array_equal(arrays.masks[0], get_action_mask(state))
        self.assertEqual(arrays.states.shape, (1, STATE_DIM))
        self.assertEqual(arrays.maps.shape, (1, 21, 16, 16))
        self.assertEqual(arrays.masks.shape, (1, ACTION_DIM))
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python -m unittest tests.nn_rl_perf_test.NnRlObservationParityTest -v
```

Expected: import failure for `observation`.

- [ ] **Step 3: Implement direct observation wrapper using existing extractors first**

Create `automation/nn_rl/observation.py`:

```python
"""Array-oriented observation helpers for DELVE PPO training."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from action_mask import get_action_mask
from config import ACTION_DIM, STATE_DIM
from state_extractor import extract_local_map, extract_state


@dataclass
class ObservationArrays:
    states: np.ndarray
    maps: np.ndarray
    masks: np.ndarray


def allocate_observation_arrays(num_envs: int) -> ObservationArrays:
    return ObservationArrays(
        states=np.zeros((num_envs, STATE_DIM), dtype=np.float32),
        maps=np.zeros((num_envs, 21, 16, 16), dtype=np.float32),
        masks=np.zeros((num_envs, ACTION_DIM), dtype=bool),
    )


def observe_game_into(game, arrays: ObservationArrays, index: int, prev_action=None):
    state = game.snapshot()
    arrays.states[index] = extract_state(state, prev_action)
    arrays.maps[index] = extract_local_map(state)
    arrays.masks[index] = get_action_mask(state)
    return state
```

This first implementation intentionally still calls `snapshot()`. It creates a stable interface and a parity test before optimization.

- [ ] **Step 4: Add `DelveGame.observe_into` delegating to the wrapper**

Modify `automation/nn_rl/game_engine.py` inside `class DelveGame`:

```python
    def observe_into(self, arrays, index: int, prev_action=None):
        from observation import observe_game_into
        return observe_game_into(self, arrays, index, prev_action)
```

- [ ] **Step 5: Run parity test**

Run:

```bash
python -m unittest tests.nn_rl_perf_test.NnRlObservationParityTest -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add automation/nn_rl/observation.py automation/nn_rl/game_engine.py tests/nn_rl_perf_test.py
git commit -m "test: add direct observation parity harness"
```

---

## Task 3: Remove Snapshot Allocation From Observation Hot Path

**Files:**
- Modify: `automation/nn_rl/observation.py`
- Modify: `automation/nn_rl/game_engine.py`
- Test: `tests/nn_rl_perf_test.py`

- [ ] **Step 1: Add multi-step parity test**

Append to `tests/nn_rl_perf_test.py`:

```python
    def test_direct_observation_matches_after_game_steps(self):
        game = DelveGame(seed=456, player_class="mage", hard_mode=False)
        arrays = allocate_observation_arrays(1)
        actions = [
            {"type": "key", "val": "ArrowRight"},
            {"type": "key", "val": "ArrowDown"},
            {"type": "key", "val": "ArrowLeft"},
        ]

        prev_action = None
        for decision in actions:
            game.step(decision)
            state = game.snapshot()
            observe_game_into(game, arrays, 0, prev_action=prev_action)
            np.testing.assert_allclose(arrays.states[0], extract_state(state, prev_action), rtol=0, atol=1e-6)
            np.testing.assert_allclose(arrays.maps[0], extract_local_map(state), rtol=0, atol=1e-6)
            np.testing.assert_array_equal(arrays.masks[0], get_action_mask(state))
            prev_action = 0
```

- [ ] **Step 2: Run test before optimization**

Run:

```bash
python -m unittest tests.nn_rl_perf_test.NnRlObservationParityTest -v
```

Expected: PASS using the wrapper implementation.

- [ ] **Step 3: Replace wrapper internals incrementally with named parity checkpoints**

Modify `automation/nn_rl/observation.py` so `observe_game_into` fills arrays from `DelveGame` fields directly. Keep the public function signature unchanged:

```python
def observe_game_into(game, arrays: ObservationArrays, index: int, prev_action=None):
    fill_state_features_from_game(game, arrays.states[index], prev_action)
    fill_local_map(game, arrays.maps[index])
    fill_action_mask(game, arrays.masks[index])
    return None
```

Implement these functions in this order. Run `python -m unittest tests.nn_rl_perf_test.NnRlObservationParityTest -v` after each numbered slice:

1. `fill_state_features_from_game`: player core fields 0-6 only; all remaining fields still copied from `extract_state(game.snapshot(), prev_action)` into `out[7:]`.
2. `fill_state_features_from_game`: navigation fields 7-10; remaining fields still copied from the legacy extractor into `out[11:]`.
3. `fill_state_features_from_game`: context/resource/previous-action fields 11-27; remaining fields still copied from the legacy extractor into `out[28:]`.
4. `fill_state_features_from_game`: temporal, enemy, stat, hard-mode, and class fields 28-63; shop tail still copied from the legacy extractor into `out[64:]`.
5. `fill_state_features_from_game`: shop tail fields 64 through `STATE_DIM - 1`; no legacy state extractor calls remain.
6. `fill_local_map`: channels 0-3 for terrain/seen/stairs/doors; remaining channels still copied from `extract_local_map(game.snapshot())`.
7. `fill_local_map`: enemy channels 4-6 and 10-11 plus 14-20; remaining channels still copied from legacy map extraction.
8. `fill_local_map`: item/trap channels 7-9 and 12-13; no legacy map extractor calls remain.
9. `fill_action_mask`: movement, stairs, shop, and escape actions; unsupported action classes still copied from `get_action_mask(game.snapshot())`.
10. `fill_action_mask`: ability, item, shrine, and shop-buy actions; no legacy action mask calls remain.

Use this temporary helper while slices are being ported:

```python
def _legacy_state_tail(game, prev_action, start_index: int):
    from state_extractor import extract_state
    return extract_state(game.snapshot(), prev_action)[start_index:]


def _legacy_map_tail(game, start_channel: int):
    from state_extractor import extract_local_map
    return extract_local_map(game.snapshot())[start_channel:]


def _legacy_mask(game):
    from action_mask import get_action_mask
    return get_action_mask(game.snapshot())
```

Critical rule: delete these helper calls before committing Task 3. The final diff for Task 3 must contain no `game.snapshot()` call inside `observation.py`.

- [ ] **Step 4: Skip `fast_state_view` unless profiling proves direct field access is messy**

Prefer direct access to `game.player`, `game.map`, `game.seen`, `game.visible`, `game.enemies`, `game.items`, `game.traps`, `game.shops`, and `game.current_shop` from `observation.py`. Only add this method to `automation/nn_rl/game_engine.py` if the direct implementation repeats the same long bundle of attributes in three or more places:

```python
    def fast_state_view(self):
        return {
            "floor": self.floor,
            "hardMode": bool(self.hard_mode),
            "turn": self.turn,
            "player": self.player,
            "map": self.map,
            "seen": self.seen,
            "visible": self.visible,
            "enemies": self.enemies,
            "items": self.items,
            "traps": self.traps,
            "shops": self.shops,
            "currentShop": self.current_shop,
            "ability1Cooldown": self.ability1_cooldown,
            "ability2Cooldown": self.ability2_cooldown,
            "_walkable_total": self._walkable_total,
            "_stair_coords": self._stair_coords,
            "shopOpen": self.current_shop is not None,
            "shrineOpen": getattr(self, "current_shrine", None) is not None,
            "gameOver": self.game_over,
            "won": self.won,
        }
```

This view must not allocate nested enemy/item copies. If it appears in the final Task 3 implementation, benchmark it against direct field access before enabling direct mode for long runs.

- [ ] **Step 5: Verify parity and speed**

Run:

```bash
python -m unittest tests.nn_rl_perf_test -v
python automation/nn_rl/perf_probe.py --json
```

Expected: tests pass. Perf probe should show lower observation time once detailed probes are added.

- [ ] **Step 6: Commit**

```bash
git add automation/nn_rl/observation.py automation/nn_rl/game_engine.py tests/nn_rl_perf_test.py
git commit -m "perf: write rl observations without snapshots"
```

---

## Task 4: Worker Direct Observation Mode

**Files:**
- Modify: `automation/nn_rl/vector_env.py`
- Modify: `automation/nn_rl/train.py`
- Test: `tests/nn_rl_perf_test.py`

- [ ] **Step 1: Write worker shape test**

Append to `tests/nn_rl_perf_test.py`:

```python
from vector_env import SubprocVecEnv


class NnRlWorkerObservationTest(unittest.TestCase):
    def test_subproc_vec_env_direct_observation_shapes(self):
        env = SubprocVecEnv(
            num_envs=4,
            envs_per_worker=2,
            max_episode_steps=100,
            observation_mode="direct",
        )
        try:
            states, maps, masks = env.reset()
            self.assertEqual(states.shape, (4, STATE_DIM))
            self.assertEqual(maps.shape, (4, 21, 16, 16))
            self.assertEqual(masks.shape, (4, ACTION_DIM))
            next_states, next_maps, next_masks, rewards, dones, infos = env.step(np.zeros(4, dtype=np.int64))
            self.assertEqual(next_states.shape, (4, STATE_DIM))
            self.assertEqual(next_maps.shape, (4, 21, 16, 16))
            self.assertEqual(next_masks.shape, (4, ACTION_DIM))
            self.assertEqual(rewards.shape, (4,))
            self.assertEqual(dones.shape, (4,))
            self.assertEqual(len(infos), 4)
        finally:
            env.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python -m unittest tests.nn_rl_perf_test.NnRlWorkerObservationTest -v
```

Expected: `SubprocVecEnv` does not accept `observation_mode`.

- [ ] **Step 3: Add observation mode to worker kwargs**

Modify `automation/nn_rl/vector_env.py`:

```python
class SubprocVecEnv:
    def __init__(self, num_envs=128, envs_per_worker=16, observation_mode="legacy", **kwargs):
        self.observation_mode = observation_mode
        ...
        env_kwargs["observation_mode"] = observation_mode
```

Modify `DelveVectorEnv.__init__`:

```python
        observation_mode="legacy",
```

and store:

```python
        self.observation_mode = observation_mode
```

- [ ] **Step 4: Use direct observation in `_subproc_worker`**

Modify `_subproc_worker`:

```python
from observation import allocate_observation_arrays

arrays = allocate_observation_arrays(env.num_envs)

def observe_all():
    if getattr(env, "observation_mode", "legacy") == "direct":
        for idx, game in enumerate(env.games):
            game.observe_into(arrays, idx, env.prev_actions[idx])
        return arrays.states.copy(), arrays.maps.copy(), arrays.masks.copy()
    states = env.get_states()
    return (
        numpyize_states(states, env.prev_actions),
        numpyize_maps(states),
        np.stack([get_action_mask(s) for s in states]).astype(np.float32, copy=False),
    )
```

Use `observe_all()` in both `reset` and `step`.

- [ ] **Step 5: Add CLI flag**

Modify `automation/nn_rl/train.py`:

```python
parser.add_argument(
    "--observation-mode",
    choices=["legacy", "direct"],
    default="legacy",
    help="Observation extraction path for rollout workers.",
)
```

Pass it into `SubprocVecEnv`.

- [ ] **Step 6: Verify tests**

Run:

```bash
python -m unittest tests.nn_rl_perf_test.NnRlWorkerObservationTest -v
python -m unittest tests.nn_rl_bridge_test -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add automation/nn_rl/vector_env.py automation/nn_rl/train.py tests/nn_rl_perf_test.py
git commit -m "perf: add direct observation worker mode"
```

---

## Task 5: Shared-Memory Rollout Transport

**Files:**
- Create: `automation/nn_rl/shared_rollout.py`
- Modify: `automation/nn_rl/vector_env.py`
- Modify: `automation/nn_rl/train.py`
- Test: `tests/nn_rl_perf_test.py`

- [ ] **Step 1: Write shared buffer allocation test**

Append to `tests/nn_rl_perf_test.py`:

```python
from shared_rollout import SharedObservationBuffer


class NnRlSharedRolloutTest(unittest.TestCase):
    def test_shared_observation_buffer_shapes(self):
        buf = SharedObservationBuffer.create(num_envs=3)
        try:
            self.assertEqual(buf.states.shape, (3, STATE_DIM))
            self.assertEqual(buf.maps.shape, (3, 21, 16, 16))
            self.assertEqual(buf.masks.shape, (3, ACTION_DIM))
            buf.states[1, 0] = 0.5
            self.assertAlmostEqual(float(buf.states[1, 0]), 0.5)
        finally:
            buf.close()
            buf.unlink()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python -m unittest tests.nn_rl_perf_test.NnRlSharedRolloutTest -v
```

Expected: import failure for `shared_rollout`.

- [ ] **Step 3: Implement shared buffer wrapper**

Create `automation/nn_rl/shared_rollout.py`:

```python
"""Shared-memory observation buffers for DELVE PPO workers."""

from __future__ import annotations

from dataclasses import dataclass
from multiprocessing import shared_memory

import numpy as np

from config import ACTION_DIM, STATE_DIM


@dataclass
class SharedObservationBuffer:
    state_shm: shared_memory.SharedMemory
    map_shm: shared_memory.SharedMemory
    mask_shm: shared_memory.SharedMemory
    states: np.ndarray
    maps: np.ndarray
    masks: np.ndarray
    owner: bool

    @classmethod
    def create(cls, num_envs: int):
        state_shape = (num_envs, STATE_DIM)
        map_shape = (num_envs, 21, 16, 16)
        mask_shape = (num_envs, ACTION_DIM)
        state_shm = shared_memory.SharedMemory(create=True, size=np.zeros(state_shape, dtype=np.float32).nbytes)
        map_shm = shared_memory.SharedMemory(create=True, size=np.zeros(map_shape, dtype=np.float32).nbytes)
        mask_shm = shared_memory.SharedMemory(create=True, size=np.zeros(mask_shape, dtype=bool).nbytes)
        return cls.attach(
            state_shm.name,
            map_shm.name,
            mask_shm.name,
            num_envs,
            owner=True,
            existing=(state_shm, map_shm, mask_shm),
        )

    @classmethod
    def attach(cls, state_name, map_name, mask_name, num_envs: int, owner=False, existing=None):
        state_shm, map_shm, mask_shm = existing or (
            shared_memory.SharedMemory(name=state_name),
            shared_memory.SharedMemory(name=map_name),
            shared_memory.SharedMemory(name=mask_name),
        )
        return cls(
            state_shm=state_shm,
            map_shm=map_shm,
            mask_shm=mask_shm,
            states=np.ndarray((num_envs, STATE_DIM), dtype=np.float32, buffer=state_shm.buf),
            maps=np.ndarray((num_envs, 21, 16, 16), dtype=np.float32, buffer=map_shm.buf),
            masks=np.ndarray((num_envs, ACTION_DIM), dtype=bool, buffer=mask_shm.buf),
            owner=owner,
        )

    def close(self):
        self.state_shm.close()
        self.map_shm.close()
        self.mask_shm.close()

    def unlink(self):
        if self.owner:
            self.state_shm.unlink()
            self.map_shm.unlink()
            self.mask_shm.unlink()
```

- [ ] **Step 4: Add shared transport mode**

Modify `SubprocVecEnv` to accept `transport_mode`:

```python
def __init__(..., observation_mode="legacy", transport_mode="pipe", **kwargs):
    if transport_mode not in ("pipe", "shared"):
        raise ValueError("transport_mode must be 'pipe' or 'shared'")
```

For `"shared"`, allocate one `SharedObservationBuffer` per worker and pass names to `_subproc_worker`.

- [ ] **Step 5: Worker writes arrays into shared buffers**

Modify `_subproc_worker` so `reset` and `step` send only metadata when using shared transport:

```python
if shared_buffer is not None:
    ns, nm, m = observe_all()
    shared_buffer.states[:] = ns
    shared_buffer.maps[:] = nm
    shared_buffer.masks[:] = m
    pipe.send({"ok": True, "rewards": rewards, "dones": dones, "infos": done_infos})
else:
    pipe.send((ns, nm, m, rewards, dones, infos))
```

Return only done infos in shared mode:

```python
done_infos = [(idx, info) for idx, info in enumerate(infos) if dones[idx]]
```

- [ ] **Step 6: Main process reads arrays from shared buffers**

Modify `SubprocVecEnv.step()` to concatenate views copied from shared buffers:

```python
np_states.append(worker_shared.states.copy())
np_maps.append(worker_shared.maps.copy())
masks.append(worker_shared.masks.copy())
```

This still copies into the main process. It removes pickling first. A later task can write directly into rollout tensors.

- [ ] **Step 7: Add CLI flag**

Modify `train.py`:

```python
parser.add_argument(
    "--transport-mode",
    choices=["pipe", "shared"],
    default="pipe",
    help="How rollout workers return observations.",
)
```

- [ ] **Step 8: Verify tests and resource cleanup**

Run:

```bash
python -m unittest tests.nn_rl_perf_test.NnRlSharedRolloutTest -v
python -m unittest tests.nn_rl_perf_test.NnRlWorkerObservationTest -v
```

Expected: PASS. No leaked shared memory warnings on process exit.

- [ ] **Step 9: Commit**

```bash
git add automation/nn_rl/shared_rollout.py automation/nn_rl/vector_env.py automation/nn_rl/train.py tests/nn_rl_perf_test.py
git commit -m "perf: add shared memory rollout transport"
```

---

## Task 6: Cache Pathfinding and Observation Searches

**Files:**
- Modify: `automation/nn_rl/pathfinding.py`
- Modify: `automation/nn_rl/observation.py`
- Modify: `automation/nn_rl/vector_env.py`
- Test: `tests/nn_rl_perf_test.py`

- [ ] **Step 1: Add pathfinding cache parity test**

Append to `tests/nn_rl_perf_test.py`:

```python
from pathfinding import compute_navigation_features, shortest_stairs_distance, nearest_unseen_direction


class NnRlPathfindingCacheTest(unittest.TestCase):
    def test_navigation_feature_bundle_matches_existing_helpers(self):
        game = DelveGame(seed=789, player_class="rogue", hard_mode=False)
        state = game.snapshot()
        p = state["player"]
        bundle = compute_navigation_features(state, state["map"], p["x"], p["y"])

        self.assertEqual(
            bundle["stairs_distance"],
            shortest_stairs_distance(state, state["map"], p["x"], p["y"]),
        )
        self.assertEqual(
            (bundle["unseen_dx"], bundle["unseen_dy"]),
            nearest_unseen_direction(state, state["map"]),
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python -m unittest tests.nn_rl_perf_test.NnRlPathfindingCacheTest -v
```

Expected: import failure for `compute_navigation_features`.

- [ ] **Step 3: Implement bundled BFS helper**

Modify `automation/nn_rl/pathfinding.py`:

```python
def compute_navigation_features(G, map_data, start_x, start_y):
    return {
        "stairs_distance": shortest_stairs_distance(G, map_data, start_x, start_y),
        "unseen_dx": nearest_unseen_direction(G, map_data)[0],
        "unseen_dy": nearest_unseen_direction(G, map_data)[1],
        "shop_dx": nearest_poi_direction(G, map_data, "shop")[0],
        "shop_dy": nearest_poi_direction(G, map_data, "shop")[1],
        "shrine_dx": nearest_poi_direction(G, map_data, "shrine")[0],
        "shrine_dy": nearest_poi_direction(G, map_data, "shrine")[1],
        "locked_door_dx": nearest_poi_direction(G, map_data, "locked_door")[0],
        "locked_door_dy": nearest_poi_direction(G, map_data, "locked_door")[1],
    }
```

This first version is intentionally redundant. Then optimize internals to compute targets and blocked sets once, keeping the test passing.

- [ ] **Step 4: Use the bundle from observation extraction**

Modify `state_extractor.extract_state()` and `observation.fill_state_features()` to call the bundled helper once per state instead of repeating target setup.

- [ ] **Step 5: Verify parity**

Run:

```bash
python -m unittest tests.nn_rl_perf_test.NnRlPathfindingCacheTest -v
python -m unittest tests.nn_rl_bridge_test -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add automation/nn_rl/pathfinding.py automation/nn_rl/observation.py automation/nn_rl/state_extractor.py tests/nn_rl_perf_test.py
git commit -m "perf: bundle rl navigation feature searches"
```

---

## Task 7: Async Actor and Learner Pipeline

**Files:**
- Create: `automation/nn_rl/async_trainer.py`
- Modify: `automation/nn_rl/train.py`
- Test: `tests/nn_rl_perf_test.py`

- [ ] **Step 1: Write version-staleness test**

Append to `tests/nn_rl_perf_test.py`:

```python
from async_trainer import RolloutPacket


class NnRlAsyncTrainerTest(unittest.TestCase):
    def test_rollout_packet_tracks_policy_version(self):
        packet = RolloutPacket(policy_version=7, total_steps=1024, payload={"loss": 1.0})
        self.assertEqual(packet.policy_version, 7)
        self.assertEqual(packet.total_steps, 1024)
        self.assertEqual(packet.payload["loss"], 1.0)
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python -m unittest tests.nn_rl_perf_test.NnRlAsyncTrainerTest -v
```

Expected: import failure for `async_trainer`.

- [ ] **Step 3: Create async packet types**

Create `automation/nn_rl/async_trainer.py`:

```python
"""Double-buffered actor/learner helpers for DELVE PPO."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RolloutPacket:
    policy_version: int
    total_steps: int
    payload: dict
```

- [ ] **Step 4: Add opt-in trainer mode**

Modify `train.py`:

```python
parser.add_argument(
    "--trainer-mode",
    choices=["sync", "async-double-buffer"],
    default="sync",
    help="Synchronous PPO or one-rollout-stale actor/learner overlap.",
)
```

Keep default `"sync"`.

- [ ] **Step 5: Implement double buffering only after sync shared mode passes**

In `async_trainer.py`, implement:

```python
def collect_rollout(policy_version, collector_fn):
    payload = collector_fn()
    return RolloutPacket(
        policy_version=policy_version,
        total_steps=int(payload["total_steps"]),
        payload=payload,
    )
```

Then wire `train.py` so while PPO updates packet N, workers collect packet N+1 with the last published policy. Log:

```python
"policy_version": policy_version,
"rollout_policy_version": packet.policy_version,
"policy_staleness": policy_version - packet.policy_version,
```

- [ ] **Step 6: Reject if staleness exceeds one rollout**

Add a guard in async mode:

```python
if policy_version - packet.policy_version > 1:
    raise RuntimeError("Async PPO staleness exceeded one rollout")
```

- [ ] **Step 7: Verify sync mode remains default**

Run:

```bash
python -m unittest tests.nn_rl_perf_test.NnRlAsyncTrainerTest -v
python automation/nn_rl/train.py --total-timesteps 65536 --num-envs 8 --envs-per-worker 4 --no-tensorboard --metrics-log ""
```

Expected: test PASS and short sync training run completes.

- [ ] **Step 8: Commit**

```bash
git add automation/nn_rl/async_trainer.py automation/nn_rl/train.py tests/nn_rl_perf_test.py
git commit -m "perf: add opt-in async rollout pipeline"
```

---

## Task 8: Tactical Action Space for Ranged and Fragile Classes

**Files:**
- Create: `automation/nn_rl/tactical_actions.py`
- Modify: `automation/nn_rl/config.py`
- Modify: `automation/nn_rl/action_mask.py`
- Modify: `automation/nn_rl/vector_env.py`
- Test: `tests/nn_rl_tactical_actions_test.py`

- [ ] **Step 1: Write tactical action tests**

Create `tests/nn_rl_tactical_actions_test.py`:

```python
import os
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NN_RL_DIR = os.path.join(REPO_ROOT, "automation", "nn_rl")
sys.path.insert(0, NN_RL_DIR)

from tactical_actions import choose_line_clear_enemy, safest_adjacent_move


class NnRlTacticalActionsTest(unittest.TestCase):
    def test_choose_line_clear_enemy_prefers_visible_low_hp_target(self):
        state = {
            "player": {"x": 5, "y": 5, "class": "ranger"},
            "map": [[1 for _ in range(12)] for _ in range(12)],
            "visible": {5 * 56 + 8, 5 * 56 + 7},
            "enemies": [
                {"id": "strong", "x": 8, "y": 5, "hp": 20, "maxHp": 20, "dying": False},
                {"id": "weak", "x": 7, "y": 5, "hp": 3, "maxHp": 20, "dying": False},
            ],
        }

        self.assertEqual(choose_line_clear_enemy(state)["id"], "weak")

    def test_safest_adjacent_move_increases_enemy_distance(self):
        state = {
            "player": {"x": 5, "y": 5, "class": "mage"},
            "map": [[1 for _ in range(12)] for _ in range(12)],
            "enemies": [{"id": "e", "x": 6, "y": 5, "hp": 10, "dying": False}],
        }

        self.assertEqual(safest_adjacent_move(state), {"type": "key", "val": "ArrowLeft"})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python -m unittest tests.nn_rl_tactical_actions_test -v
```

Expected: import failure for `tactical_actions`.

- [ ] **Step 3: Implement tactical helper functions**

Create `automation/nn_rl/tactical_actions.py`:

```python
"""Tactical action helpers exposed as trainable PPO primitives."""

from __future__ import annotations

MAP_W = 56
WALL = 0
DIR_TO_KEY = {
    (0, -1): "ArrowUp",
    (0, 1): "ArrowDown",
    (-1, 0): "ArrowLeft",
    (1, 0): "ArrowRight",
}


def visible_enemies(state):
    visible = state.get("visible", set())
    if isinstance(visible, list):
        visible = set(visible)
    return [
        e for e in state.get("enemies", [])
        if not e.get("dying") and not e.get("isPet") and (e.get("y", 0) * MAP_W + e.get("x", 0)) in visible
    ]


def is_line_clear(state, enemy):
    p = state.get("player", {})
    dx = enemy.get("x", 0) - p.get("x", 0)
    dy = enemy.get("y", 0) - p.get("y", 0)
    if not (dx == 0 or dy == 0 or abs(dx) == abs(dy)):
        return False
    sx = 0 if dx == 0 else (1 if dx > 0 else -1)
    sy = 0 if dy == 0 else (1 if dy > 0 else -1)
    x, y = p.get("x", 0) + sx, p.get("y", 0) + sy
    map_data = state.get("map", [])
    while x != enemy.get("x", 0) or y != enemy.get("y", 0):
        if y < 0 or y >= len(map_data) or x < 0 or x >= len(map_data[y]):
            return False
        if map_data[y][x] == WALL:
            return False
        x += sx
        y += sy
    return True


def choose_line_clear_enemy(state):
    candidates = [e for e in visible_enemies(state) if is_line_clear(state, e)]
    if not candidates:
        return None
    return min(candidates, key=lambda e: (e.get("hp", 0), abs(e.get("x", 0) - state["player"]["x"]) + abs(e.get("y", 0) - state["player"]["y"])))


def safest_adjacent_move(state):
    p = state.get("player", {})
    map_data = state.get("map", [])
    enemies = [e for e in state.get("enemies", []) if not e.get("dying") and not e.get("isPet")]
    best = None
    for dx, dy in DIR_TO_KEY:
        x, y = p.get("x", 0) + dx, p.get("y", 0) + dy
        if y < 0 or y >= len(map_data) or x < 0 or x >= len(map_data[y]) or map_data[y][x] == WALL:
            continue
        min_dist = min((abs(e.get("x", 0) - x) + abs(e.get("y", 0) - y) for e in enemies), default=99)
        candidate = (min_dist, -abs(dx), -abs(dy), dx, dy)
        if best is None or candidate > best[0]:
            best = (candidate, {"type": "key", "val": DIR_TO_KEY[(dx, dy)]})
    return best[1] if best else None
```

- [ ] **Step 4: Add action constants without shifting existing actions**

Modify `automation/nn_rl/config.py` after shop slot actions:

```python
TACTICAL_ACTIONS = {
    "RANGED_ATTACK_WEAK": ACTION_DIM,
    "RANGED_ATTACK_NEAREST": ACTION_DIM + 1,
    "KITE_SAFE_MOVE": ACTION_DIM + 2,
}
ACTION_DIM = ACTION_DIM + len(TACTICAL_ACTIONS)
ACTIONS.update(TACTICAL_ACTIONS)
```

Critical check: this changes `ACTION_DIM` and checkpoint compatibility. Do this only after checkpoint migration tooling exists, or gate it behind a new model/action-space version.

- [ ] **Step 5: Add masks**

Modify `action_mask.py`:

```python
from tactical_actions import choose_line_clear_enemy, safest_adjacent_move

if choose_line_clear_enemy(G) is not None:
    mask[ACTIONS["RANGED_ATTACK_WEAK"]] = True
    mask[ACTIONS["RANGED_ATTACK_NEAREST"]] = True
if safest_adjacent_move(G) is not None:
    mask[ACTIONS["KITE_SAFE_MOVE"]] = True
```

- [ ] **Step 6: Add decision translation**

Modify `vector_env.action_to_decision()`:

```python
if action == ACTIONS.get("RANGED_ATTACK_WEAK"):
    from tactical_actions import choose_line_clear_enemy
    target = choose_line_clear_enemy(state)
    return {"type": "attack", "target": target["id"]} if target else self._escape_decision()
if action == ACTIONS.get("KITE_SAFE_MOVE"):
    from tactical_actions import safest_adjacent_move
    return safest_adjacent_move(state) or self._escape_decision()
```

- [ ] **Step 7: Verify tests**

Run:

```bash
python -m unittest tests.nn_rl_tactical_actions_test -v
python -m unittest tests.nn_rl_bridge_test -v
```

Expected: PASS. If action dimension changes break old tests, add explicit action-space version handling before merging.

- [ ] **Step 8: Commit**

```bash
git add automation/nn_rl/tactical_actions.py automation/nn_rl/config.py automation/nn_rl/action_mask.py automation/nn_rl/vector_env.py tests/nn_rl_tactical_actions_test.py
git commit -m "feat: expose tactical ranged and kiting actions"
```

---

## Task 9: Hidden-Size Plumbing Fix

**Files:**
- Modify: `automation/nn_rl/network.py`
- Modify: `automation/nn_rl/train.py`
- Modify: `automation/nn_rl/ppo.py`
- Test: `tests/nn_rl_metrics_test.py`

- [ ] **Step 1: Write hidden-size regression test**

Append to `tests/nn_rl_metrics_test.py`:

```python
from network import DelveNet


class NnRlNetworkShapeTest(unittest.TestCase):
    def test_gru_hidden_constant_matches_instance_hidden_dim(self):
        net = DelveNet(hidden_dim=384)
        self.assertEqual(net.hidden_dim, 384)
        self.assertEqual(net.gru.hidden_size, 384)
```

- [ ] **Step 2: Run test**

Run:

```bash
python -m unittest tests.nn_rl_metrics_test.NnRlNetworkShapeTest -v
```

Expected: PASS for the assertions above, but this test does not yet catch `model.GRU_HIDDEN`. The next step removes that hard-coded use.

- [ ] **Step 3: Remove hard-coded `GRU_HIDDEN` usage**

Modify `train.py`:

```python
        model.hidden_dim,
```

instead of:

```python
        model.GRU_HIDDEN,
```

Modify `network.py` to either remove `GRU_HIDDEN = 256` or set it from the instance only. Preferred: remove class constant and use `self.hidden_dim`.

- [ ] **Step 4: Verify short training with non-default hidden size**

Add a CLI option in `train.py`:

```python
parser.add_argument("--hidden-dim", type=int, default=HIDDEN_DIM)
```

Use:

```python
model = DelveNet(state_dim=STATE_DIM, action_dim=ACTION_DIM, hidden_dim=args.hidden_dim).to(device)
```

Run:

```bash
python automation/nn_rl/train.py --total-timesteps 65536 --num-envs 8 --envs-per-worker 4 --hidden-dim 384 --no-tensorboard --metrics-log ""
```

Expected: completes without hidden tensor shape errors.

- [ ] **Step 5: Commit**

```bash
git add automation/nn_rl/network.py automation/nn_rl/train.py automation/nn_rl/ppo.py tests/nn_rl_metrics_test.py
git commit -m "fix: derive rollout hidden size from network instance"
```

---

## Task 10: Larger Class-Aware Network Variant

**Files:**
- Modify: `automation/nn_rl/network.py`
- Modify: `automation/nn_rl/config.py`
- Modify: `automation/nn_rl/train.py`
- Test: `tests/nn_rl_metrics_test.py`

- [ ] **Step 1: Write model variant tests**

Append to `tests/nn_rl_metrics_test.py`:

```python
import torch
from config import ACTION_DIM, STATE_DIM


class NnRlModelVariantTest(unittest.TestCase):
    def test_large_model_forward_shape(self):
        net = DelveNet(hidden_dim=384, cnn_out_dim=256, head_hidden_dim=256)
        states = torch.zeros(2, STATE_DIM)
        maps = torch.zeros(2, 21, 16, 16)
        masks = torch.ones(2, ACTION_DIM, dtype=torch.bool)

        logits, values, hidden = net(states, maps, action_mask=masks)

        self.assertEqual(logits.shape, (2, ACTION_DIM))
        self.assertEqual(values.shape, (2, 1))
        self.assertEqual(hidden.shape, (1, 2, 384))
        self.assertGreater(net.count_parameters(), 724549)
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python -m unittest tests.nn_rl_metrics_test.NnRlModelVariantTest -v
```

Expected: `DelveNet` does not accept `cnn_out_dim` or `head_hidden_dim`.

- [ ] **Step 3: Parameterize CNN and heads**

Modify `network.py`:

```python
class SpatialCNN(nn.Module):
    def __init__(self, in_channels=21, out_dim=128, channels=(32, 32), pool_size=4, pool_kind="avg"):
        ...
```

Use both pool modes:

```python
pool = nn.AdaptiveAvgPool2d(pool_size) if pool_kind == "avg" else nn.AdaptiveMaxPool2d(pool_size)
```

Modify `DelveNet.__init__`:

```python
def __init__(
    self,
    state_dim=STATE_DIM,
    action_dim=ACTION_DIM,
    hidden_dim=HIDDEN_DIM,
    cnn_out_dim=128,
    cnn_channels=(32, 32),
    cnn_pool_size=4,
    cnn_pool_kind="avg",
    head_hidden_dim=64,
):
```

Use `cnn_out_dim` in both CNN and GRU input size. Use `head_hidden_dim` in policy/value heads.

- [ ] **Step 4: Add model variant config**

Modify `config.py`:

```python
MODEL_VARIANTS = {
    "base": {
        "hidden_dim": 256,
        "cnn_out_dim": 128,
        "cnn_channels": (32, 32),
        "cnn_pool_size": 4,
        "cnn_pool_kind": "avg",
        "head_hidden_dim": 64,
    },
    "large_tactical": {
        "hidden_dim": 384,
        "cnn_out_dim": 256,
        "cnn_channels": (32, 64, 96),
        "cnn_pool_size": 8,
        "cnn_pool_kind": "avg",
        "head_hidden_dim": 256,
    },
}
```

Critical note: use `avg` first, not `max`, because current channels include continuous HP/threat values. Test max pooling later as an ablation, not as the default.

- [ ] **Step 5: Add CLI variant**

Modify `train.py`:

```python
parser.add_argument("--model-variant", choices=sorted(MODEL_VARIANTS), default="base")
```

Build model from the selected variant:

```python
variant = dict(MODEL_VARIANTS[args.model_variant])
model = DelveNet(state_dim=STATE_DIM, action_dim=ACTION_DIM, **variant).to(device)
```

- [ ] **Step 6: Verify**

Run:

```bash
python -m unittest tests.nn_rl_metrics_test.NnRlModelVariantTest -v
python automation/nn_rl/train.py --total-timesteps 65536 --num-envs 8 --envs-per-worker 4 --model-variant large_tactical --no-tensorboard --metrics-log ""
```

Expected: PASS and short training run completes.

- [ ] **Step 7: Commit**

```bash
git add automation/nn_rl/network.py automation/nn_rl/config.py automation/nn_rl/train.py tests/nn_rl_metrics_test.py
git commit -m "feat: add configurable larger rl network variant"
```

---

## Task 11: Checkpoint Migration

**Files:**
- Create: `automation/nn_rl/checkpoint_migration.py`
- Test: `tests/nn_rl_checkpoint_migration_test.py`

- [ ] **Step 1: Write migration tests**

Create `tests/nn_rl_checkpoint_migration_test.py`:

```python
import os
import sys
import unittest

import torch

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NN_RL_DIR = os.path.join(REPO_ROOT, "automation", "nn_rl")
sys.path.insert(0, NN_RL_DIR)

from checkpoint_migration import copy_overlapping_tensor


class NnRlCheckpointMigrationTest(unittest.TestCase):
    def test_copy_overlapping_tensor_preserves_old_slice(self):
        old = torch.arange(6, dtype=torch.float32).reshape(2, 3)
        new = torch.zeros(4, 5)

        migrated = copy_overlapping_tensor(old, new)

        torch.testing.assert_close(migrated[:2, :3], old)
        torch.testing.assert_close(migrated[2:, :], torch.zeros(2, 5))
        torch.testing.assert_close(migrated[:, 3:], torch.zeros(4, 2))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python -m unittest tests.nn_rl_checkpoint_migration_test -v
```

Expected: import failure.

- [ ] **Step 3: Implement tensor overlap copying**

Create `automation/nn_rl/checkpoint_migration.py`:

```python
#!/usr/bin/env python3
"""Migrate DELVE PPO checkpoints across compatible network expansions."""

from __future__ import annotations

import argparse

import torch


def copy_overlapping_tensor(old_tensor, new_tensor):
    result = new_tensor.clone()
    slices = tuple(slice(0, min(old, new)) for old, new in zip(old_tensor.shape, new_tensor.shape))
    result[slices] = old_tensor[slices]
    return result


def migrate_state_dict(old_state, new_state):
    migrated = {}
    copied = {}
    for name, new_tensor in new_state.items():
        old_tensor = old_state.get(name)
        if old_tensor is None or old_tensor.ndim != new_tensor.ndim:
            migrated[name] = new_tensor
            copied[name] = "new"
        elif old_tensor.shape == new_tensor.shape:
            migrated[name] = old_tensor
            copied[name] = "exact"
        else:
            migrated[name] = copy_overlapping_tensor(old_tensor, new_tensor)
            copied[name] = f"partial {tuple(old_tensor.shape)} -> {tuple(new_tensor.shape)}"
    return migrated, copied


def main(argv=None):
    parser = argparse.ArgumentParser(description="Migrate a DELVE PPO checkpoint to a new network shape.")
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    args = parser.parse_args(argv)
    print("Library helpers are available. Full checkpoint CLI is added in Step 4.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Wire full CLI after model variants exist**

Extend `main()` to:

1. Load source checkpoint.
2. Construct target `DelveNet` using `--model-variant`.
3. Migrate `checkpoint["network"]` into `target.state_dict()`.
4. Save new checkpoint with network only plus metadata:

```python
{
    "network": migrated_state,
    "migrated_from": args.source,
    "migration_report": copied,
}
```

Do not migrate optimizer state.

- [ ] **Step 5: Verify**

Run:

```bash
python -m unittest tests.nn_rl_checkpoint_migration_test -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add automation/nn_rl/checkpoint_migration.py tests/nn_rl_checkpoint_migration_test.py
git commit -m "feat: add rl checkpoint migration helpers"
```

---

## Task 12: Fixed-Seed Per-Class Evaluation Gate

**Files:**
- Modify: `automation/nn_rl/evaluate.py`
- Create: `automation/nn_rl/eval_gate.py`
- Test: `tests/nn_rl_metrics_test.py`

- [ ] **Step 1: Define evaluation gate output**

Append to `tests/nn_rl_metrics_test.py`:

```python
from eval_gate import summarize_class_eval


class NnRlEvalGateTest(unittest.TestCase):
    def test_summarize_class_eval_reports_weak_classes(self):
        rows = [
            {"class_name": "ranger", "won": False, "final_floor": 3},
            {"class_name": "ranger", "won": True, "final_floor": 5},
            {"class_name": "paladin", "won": True, "final_floor": 5},
        ]

        summary = summarize_class_eval(rows)

        self.assertAlmostEqual(summary["by_class"]["ranger"]["win_rate"], 0.5)
        self.assertEqual(summary["by_class"]["paladin"]["wins"], 1)
        self.assertIn("ranger", summary["weak_classes"])
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python -m unittest tests.nn_rl_metrics_test.NnRlEvalGateTest -v
```

Expected: import failure.

- [ ] **Step 3: Implement eval summary**

Create `automation/nn_rl/eval_gate.py`:

```python
"""Fixed-seed per-class evaluation summaries for DELVE PPO."""

from __future__ import annotations

from collections import defaultdict


def summarize_class_eval(rows, weak_threshold=0.70):
    buckets = defaultdict(list)
    for row in rows:
        buckets[row["class_name"]].append(row)
    by_class = {}
    weak = []
    for class_name, values in sorted(buckets.items()):
        wins = sum(1 for row in values if row.get("won"))
        total = len(values)
        avg_floor = sum(float(row.get("final_floor", 0)) for row in values) / max(total, 1)
        win_rate = wins / max(total, 1)
        by_class[class_name] = {
            "wins": wins,
            "total": total,
            "win_rate": win_rate,
            "avg_floor": avg_floor,
        }
        if win_rate < weak_threshold:
            weak.append(class_name)
    return {"by_class": by_class, "weak_classes": weak}
```

- [ ] **Step 4: Add eval command**

Modify `evaluate.py` so fixed seeds and class lists can be passed:

```python
parser.add_argument("--seed-base", type=int, default=1)
parser.add_argument("--per-class", type=int, default=100)
parser.add_argument("--classes", default=",".join(CLASSES))
parser.add_argument("--summary-json", default="")
```

Write a JSON summary using `summarize_class_eval`.

- [ ] **Step 5: Verify**

Run:

```bash
python -m unittest tests.nn_rl_metrics_test.NnRlEvalGateTest -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add automation/nn_rl/evaluate.py automation/nn_rl/eval_gate.py tests/nn_rl_metrics_test.py
git commit -m "test: add fixed-seed per-class rl eval gate"
```

---

## Rollout Strategy

1. Stop active training only when a phase needs files used by the trainer. Benchmark-only tasks can run while training continues.
2. After Task 4, run a short training smoke:

```bash
python automation/nn_rl/train.py --total-timesteps 262144 --num-envs 16 --envs-per-worker 4 --observation-mode direct --no-tensorboard --metrics-log runs/delve_ppo/perf_smoke.jsonl
```

3. After Task 5, compare pipe vs shared mode:

```bash
python automation/nn_rl/train.py --total-timesteps 524288 --num-envs 64 --envs-per-worker 8 --observation-mode direct --transport-mode pipe --no-tensorboard --metrics-log runs/delve_ppo/perf_pipe.jsonl
python automation/nn_rl/train.py --total-timesteps 524288 --num-envs 64 --envs-per-worker 8 --observation-mode direct --transport-mode shared --no-tensorboard --metrics-log runs/delve_ppo/perf_shared.jsonl
```

4. After Task 8, run fixed-seed eval against:

```bash
python automation/nn_rl/evaluate.py --checkpoint checkpoints/delve_ppo_544396032.pt --per-class 100 --summary-json runs/eval_544396032.json
python automation/nn_rl/evaluate.py --checkpoint checkpoints/delve_ppo_607638272.pt --per-class 100 --summary-json runs/eval_607638272.json
```

5. After Task 10 and Task 11, migrate the best checkpoint rather than reset:

```bash
python automation/nn_rl/checkpoint_migration.py --source checkpoints/delve_ppo_607638272.pt --target checkpoints/delve_ppo_607638272_large_tactical_migrated.pt --model-variant large_tactical
```

6. Start serious training only after the fixed-seed eval and perf probes show no regressions.

## Rejection Criteria

Reject or revise a phase if any of these happen:

- Observation parity differs by more than `1e-6` for state/map floats or by any bit for masks.
- Fixed-seed browser parity fails for core gameplay.
- Steps/sec improves less than 15 percent for a phase that adds meaningful complexity.
- GPU utilization rises only because env steps/sec falls.
- Tactical actions improve one class while reducing class-average fixed-seed performance by more than 5 percentage points.
- Large model cannot beat the migrated base checkpoint on fixed-seed eval within a pre-agreed wall-clock budget.

## Self-Critical Review

### Concern: This plan may be too large for one branch.

Assessment: Correct. It crosses transport, observation, action space, and network architecture. The phase gates are mandatory. The first implementation branch should stop after Task 5 unless the measurements clearly justify continuing.

### Concern: Shared memory may not help if snapshot construction dominates.

Assessment: Correct. That is why direct observation comes first. If Task 3 produces most of the gain, shared memory should still be measured, not assumed.

### Concern: Direct observation risks diverging from JS/game semantics.

Assessment: High risk. The mitigation is parity against legacy extractors and existing bridge tests. We should keep the legacy path available until several training runs prove direct mode stable.

### Concern: Tactical action primitives could make the bot less neural and more scripted.

Assessment: Medium risk. The primitives must remain low-level choices that PPO controls. Avoid high-level rules like "always kite if low HP". Expose actions; do not encode policies.

### Concern: Larger model may still overfit melee classes.

Assessment: Correct. Capacity is not enough. The model expansion must be paired with class-aware evaluation, class-balanced sampling, and tactical actions available to fragile classes.

### Concern: Checkpoint migration could preserve a bad local optimum.

Assessment: Possible. Run both migrated and clean-start short experiments. Prefer migration if it reaches old competence faster without suppressing exploration.

### Concern: Async PPO could hurt policy stability.

Assessment: Real. Keep the first async design to one rollout of staleness and log policy version. If class performance gets noisier, return to synchronous shared-memory mode.

## Final Recommendation

Implement Tasks 1-5 first as the efficiency foundation. Do not touch action dimensions or network size until the direct/shared rollout path has benchmark evidence. Then implement tactical actions and the hidden-size fix. Only after those are stable should the large model and checkpoint migration be used for long training.

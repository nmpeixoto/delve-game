# RL CPU Direct Observation And Large Tactical Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut low-risk CPU allocation overhead in rollout observation and prepare a safe large_tactical continuation path from the current strong base checkpoint.

**Architecture:** Avoid a simulator rewrite. Reuse per-worker direct-observation arrays instead of allocating fresh arrays every rollout step, keep legacy behavior unchanged, and run large_tactical only from an isolated migrated checkpoint/log directory so base rollback stays trivial.

**Tech Stack:** Python 3.14, NumPy, PyTorch PPO, existing DELVE `automation/nn_rl` vector env and checkpoint migration stack.

---

## Task 1: Reuse Direct Observation Arrays

**Files:**
- Modify: `automation/nn_rl/vector_env.py`
- Modify: `tests/nn_rl_perf_test.py`

- [x] **Step 1: Add a failing reuse test**

Add this test to `NnRlObservationParityTest` in `tests/nn_rl_perf_test.py`:

```python
    def test_vector_env_direct_observations_reuse_arrays(self):
        env = DelveVectorEnv(num_envs=2, envs_per_worker=2)
        try:
            states1, maps1, masks1 = env.observe_arrays()
            states2, maps2, masks2 = env.observe_arrays()

            self.assertIs(states1, states2)
            self.assertIs(maps1, maps2)
            self.assertIs(masks1, masks2)
        finally:
            env.close()
```

Run:

```powershell
python -m unittest tests.nn_rl_perf_test.NnRlObservationParityTest.test_vector_env_direct_observations_reuse_arrays -v
```

Expected: FAIL because `observe_arrays()` currently allocates fresh arrays on every call.

- [x] **Step 2: Implement reusable arrays**

In `automation/nn_rl/vector_env.py`, import `allocate_observation_arrays` at runtime as today, but cache the allocation on `self`:

```python
    def _observation_arrays(self):
        from observation import allocate_observation_arrays

        arrays = getattr(self, "_direct_observation_arrays", None)
        if arrays is None or arrays.states.shape[0] != self.num_envs:
            arrays = allocate_observation_arrays(self.num_envs)
            self._direct_observation_arrays = arrays
        return arrays
```

Then change `observe_arrays()` to:

```python
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
```

- [x] **Step 3: Verify direct observation tests**

Run:

```powershell
python -m unittest tests.nn_rl_perf_test.NnRlObservationParityTest -v
```

Expected: PASS.

Result: PASS. The full NN RL test suite also passes after the change:

```powershell
python -m unittest tests.nn_rl_bridge_test tests.nn_rl_perf_test tests.nn_rl_tactical_actions_test tests.nn_rl_metrics_test tests.nn_rl_checkpoint_migration_test tests.nn_rl_pretraining_bug_hunt_test tests.nn_rl_training_gate_test -v
```

Result: 132 tests passed.

---

## Task 2: Fast Direct/Async Smoke

**Files:**
- No production code changes.

- [x] **Step 1: Run a short direct-mode smoke from latest base async checkpoint**

Use:

```powershell
python automation\nn_rl\train.py --resume .\checkpoints_stable_lr_async\delve_ppo_807051520.pt --learning-rate 0.00003 --entropy-coeff 0.01 --model-variant base --observation-mode direct --transport-mode shared-contiguous --trainer-mode async-one-stale --total-timesteps 807117056 --num-envs 32 --envs-per-worker 4 --rollout-steps 256 --batch-size 512 --no-tensorboard --checkpoint-dir .tmp_direct_smoke --metrics-log runs\perf_direct_smoke\metrics.jsonl --save-every 1000000000
```

Expected: completes without shared-memory or observation parity errors.

Actual smoke used `checkpoints_stable_lr_async\delve_ppo_811049216.pt` and completed cleanly:

```text
Model: base
Observations: direct
Transport: shared-contiguous
Trainer: async-one-stale
Final smoke step: 811,114,752
Smoke throughput: ~2.1k steps/sec with 32 envs while the main 128-env run was still active
Final short-window raw win rate: 30.4%
Final short-window avg floor: 3.91
```

- [x] **Step 2: Keep or reject direct mode**

Accept direct mode for large_tactical if the smoke completes and does not show immediate policy collapse. Reject direct mode if it crashes, produces NaNs, or observation/action mask errors.

Decision: accept direct/shared-contiguous/async as the next CPU path for a restarted run. The smoke is too small for a quality judgment, but it verifies the path is operational.

---

## Task 2b: Safer Expanded Checkpoint Migration

**Files:**
- Modify: `automation/nn_rl/checkpoint_migration.py`
- Modify: `tests/nn_rl_checkpoint_migration_test.py`

- [x] **Step 1: Add a failing migration stability test**

Added coverage that old output rows in an expanded tensor are not connected to newly added random input columns.

- [x] **Step 2: Zero new input columns for existing output rows**

`copy_overlapping_tensor()` now copies the old overlapping slice, keeps genuinely new output rows initialized, and zeros only the newly added input columns for old output rows. This prevents migrated base behavior from immediately seeing random extra features while still leaving new capacity available to learn.

- [x] **Step 3: Verify migration and full NN RL tests**

Result: checkpoint migration tests pass, and the full 132-test NN RL suite passes.

---

## Task 3: Large Tactical Handoff

**Files:**
- No required production code changes.

- [x] **Step 1: Pick latest safe base checkpoint**

Use the most recent checkpoint in `checkpoints_stable_lr_async` after the current base run saves at least one fresh checkpoint.

Used `checkpoints_stable_lr_async\delve_ppo_812032256.pt`.

- [x] **Step 2: Migrate to large_tactical**

Use the existing checkpoint migration tooling already covered by tests. The output checkpoint must live in a separate directory, for example:

```text
checkpoints_large_tactical_async\delve_ppo_<step>_large_tactical.pt
```

Created:

```text
checkpoints_large_tactical_async\delve_ppo_812032256_large_tactical.pt
```

Migration report:

```text
exact tensors:   4
partial tensors: 14
optimizer:       reset
```

- [x] **Step 3: Run large_tactical isolated**

Run large_tactical with separate metrics and TensorBoard dirs:

```powershell
python automation\nn_rl\train.py --resume .\checkpoints_large_tactical_async\<migrated>.pt --reset-optimizer --learning-rate 0.00002 --entropy-coeff 0.015 --model-variant large_tactical --observation-mode direct --transport-mode shared-contiguous --trainer-mode async-one-stale --total-timesteps 2000000000 --save-every 1000000 --checkpoint-dir checkpoints_large_tactical_async --metrics-log runs\delve_ppo_large_tactical_async\metrics.jsonl --tensorboard-logdir runs\delve_ppo_large_tactical_async
```

Rollback remains the current base async command and `checkpoints_stable_lr_async`.

Actual short smoke from the safer migrated checkpoint completed without NaNs or runtime errors, but failed the quality gate for immediate production switch:

```text
Model: large_tactical
Observations: direct
Transport: shared-contiguous
Trainer: async-one-stale
Final smoke step: 812,097,792
Smoke throughput: ~2.18k steps/sec with 32 envs while the main 128-env run was still active
Final short-window raw win rate: 0.0%
Final short-window avg floor: 2.12
Death rate: 100.0%
```

Decision: do not replace the current base run with `large_tactical` yet. The checkpoint is ready for a guarded trial, but the architecture change is large enough that the migrated policy loses too much competence immediately.

---

## Self-Review

Spec coverage:

- CPU optimization is limited to low-risk allocation reuse and direct-observation validation, not a simulator rewrite.
- Large_tactical remains isolated and reversible.
- The plan does not change reward logic or gameplay mechanics.

Placeholder scan:

- No task contains TBD/fill-in placeholders.
- Commands and file paths are explicit.

Type consistency:

- `DelveVectorEnv.observe_arrays`, `_direct_observation_arrays`, and `NnRlObservationParityTest` names match existing code and tests.

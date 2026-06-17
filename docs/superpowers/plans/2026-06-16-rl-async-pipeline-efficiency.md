# RL Async Pipeline Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the rollout-efficiency work by adding a measured one-rollout-stale actor/learner pipeline that can overlap CPU environment stepping with GPU PPO updates.

**Architecture:** Keep synchronous PPO as the default and keep the new async mode opt-in. Extract rollout collection into a reusable function, double-buffer rollout storage and tensor-transfer buffers, copy bootstrap observations before shared-memory overwrite, and enforce a one-version staleness guard. Treat `async-double-buffer` as a compatibility alias for the safer `async-one-stale` implementation.

**Tech Stack:** Python 3.14, PyTorch PPO, NumPy, multiprocessing shared memory, `ThreadPoolExecutor`, DELVE `automation/nn_rl` trainer.

---

## File Structure

- Modify `automation/nn_rl/async_trainer.py`: add staleness guard and trainer-mode normalization helpers.
- Modify `automation/nn_rl/train.py`: add rollout/tensor dataclasses, shared rollout collection, sync loop refactor, and opt-in async one-stale loop.
- Modify `tests/nn_rl_perf_test.py`: add async staleness and alias tests.
- Modify `tests/nn_rl_metrics_test.py`: add parser coverage for `async-one-stale`.
- Create `docs/superpowers/plans/2026-06-16-rl-async-pipeline-efficiency.md`: this plan.

---

## Task 1: Async Safety Tests

**Files:**
- Modify: `tests/nn_rl_perf_test.py`
- Modify: `tests/nn_rl_metrics_test.py`

- [ ] **Step 1: Add failing async helper tests**

Add to `tests/nn_rl_perf_test.py` in `NnRlAsyncTrainerTest`:

```python
    def test_assert_rollout_staleness_allows_one_version(self):
        from async_trainer import assert_rollout_staleness

        assert_rollout_staleness(actor_version=9, learner_version=10, max_staleness=1)

    def test_assert_rollout_staleness_rejects_two_versions(self):
        from async_trainer import assert_rollout_staleness

        with self.assertRaisesRegex(RuntimeError, "rollout policy is too stale"):
            assert_rollout_staleness(actor_version=8, learner_version=10, max_staleness=1)

    def test_normalize_trainer_mode_maps_double_buffer_alias(self):
        from async_trainer import normalize_trainer_mode

        self.assertEqual(normalize_trainer_mode("async-double-buffer"), "async-one-stale")
        self.assertEqual(normalize_trainer_mode("sync"), "sync")
```

Add to `tests/nn_rl_metrics_test.py`:

```python
    def test_train_accepts_async_one_stale_trainer_mode(self):
        args = parse_train_args(["--trainer-mode", "async-one-stale"])

        self.assertEqual(args.trainer_mode, "async-one-stale")
```

- [ ] **Step 2: Verify red**

Run:

```powershell
python -m unittest tests.nn_rl_perf_test.NnRlAsyncTrainerTest tests.nn_rl_metrics_test.NnRlMetricsTest.test_train_accepts_async_one_stale_trainer_mode -v
```

Expected: import failure for `assert_rollout_staleness` / `normalize_trainer_mode` and parser rejection for `async-one-stale`.

---

## Task 2: Async Helper Implementation

**Files:**
- Modify: `automation/nn_rl/async_trainer.py`
- Modify: `automation/nn_rl/train.py`

- [ ] **Step 1: Implement async helper functions**

Add to `automation/nn_rl/async_trainer.py`:

```python
def normalize_trainer_mode(mode):
    return "async-one-stale" if mode == "async-double-buffer" else mode


def assert_rollout_staleness(actor_version, learner_version, max_staleness=1):
    actor_version = int(actor_version)
    learner_version = int(learner_version)
    max_staleness = int(max_staleness)
    if learner_version - actor_version > max_staleness:
        raise RuntimeError(
            f"rollout policy is too stale: actor_version={actor_version}, "
            f"learner_version={learner_version}, max_staleness={max_staleness}"
        )
```

- [ ] **Step 2: Accept the new trainer mode**

Change `automation/nn_rl/train.py` parser:

```python
    parser.add_argument(
        "--trainer-mode",
        choices=["sync", "async-double-buffer", "async-one-stale"],
        default="sync",
        help="Synchronous PPO or one-rollout-stale actor/learner overlap.",
    )
```

- [ ] **Step 3: Verify green**

Run:

```powershell
python -m unittest tests.nn_rl_perf_test.NnRlAsyncTrainerTest tests.nn_rl_metrics_test.NnRlMetricsTest.test_train_accepts_async_one_stale_trainer_mode -v
```

Expected: PASS.

---

## Task 3: Extract Reusable Rollout Collection

**Files:**
- Modify: `automation/nn_rl/train.py`

- [ ] **Step 1: Add rollout transfer and result dataclasses**

Add near the existing helper functions:

```python
@dataclass
class RolloutTransferTensors:
    state: torch.Tensor
    map: torch.Tensor
    mask: torch.Tensor
    bootstrap_state: torch.Tensor
    bootstrap_map: torch.Tensor
    bootstrap_mask: torch.Tensor


@dataclass
class RolloutResult:
    buffer: RolloutBuffer
    transfer: RolloutTransferTensors
    np_states: np.ndarray
    np_maps: np.ndarray
    np_masks: np.ndarray
    hidden: torch.Tensor | None
    action_counts: np.ndarray
    probe_accumulator: dict
    episode_infos: list
    steps_collected: int
    policy_version: int
```

- [ ] **Step 2: Add transfer allocation and bootstrap helpers**

Add:

```python
def allocate_rollout_transfer_tensors(np_states, np_maps, np_masks, device):
    state = torch.empty(np_states.shape, device=device, dtype=torch.float32)
    map_tensor = torch.empty(np_maps.shape, device=device, dtype=torch.float32)
    mask = torch.empty(np_masks.shape, device=device, dtype=torch.bool)
    return RolloutTransferTensors(
        state=state,
        map=map_tensor,
        mask=mask,
        bootstrap_state=torch.empty_like(state),
        bootstrap_map=torch.empty_like(map_tensor),
        bootstrap_mask=torch.empty_like(mask),
    )


def prepare_bootstrap_tensors(result):
    return copy_numpy_observation_into_tensors(
        result.np_states,
        result.np_maps,
        result.np_masks,
        result.transfer.bootstrap_state,
        result.transfer.bootstrap_map,
        result.transfer.bootstrap_mask,
    )
```

- [ ] **Step 3: Extract `collect_rollout_batch`**

Move the current rollout-step body into a function that receives `env`, `model`, `buffer`, `transfer`, current numpy observations, current hidden state, `args`, `device`, and `policy_version`. It must return `RolloutResult` and must append done episode infos into `episode_infos`, not mutate `episode_window`.

The function must copy observations with:

```python
state_tensor, map_tensor, mask_tensor = copy_numpy_observation_into_tensors(
    np_states,
    np_maps,
    np_masks,
    transfer.state,
    transfer.map,
    transfer.mask,
)
```

It must return:

```python
return RolloutResult(
    buffer=buffer,
    transfer=transfer,
    np_states=np_states,
    np_maps=np_maps,
    np_masks=np_masks,
    hidden=hidden,
    action_counts=action_counts,
    probe_accumulator=probe_accumulator,
    episode_infos=episode_infos,
    steps_collected=args.num_envs * args.rollout_steps,
    policy_version=int(policy_version),
)
```

- [ ] **Step 4: Refactor sync loop to use `collect_rollout_batch`**

Replace the inline rollout loop with:

```python
stage_t0 = time.perf_counter()
result = collect_rollout_batch(
    env=env,
    model=model,
    buffer=buffer,
    transfer=rollout_transfer,
    np_states=np_states,
    np_maps=np_maps,
    np_masks=np_masks,
    hidden=hidden,
    args=args,
    device=device,
    policy_version=0,
)
stage_seconds["collect"] += time.perf_counter() - stage_t0
np_states, np_maps, np_masks, hidden = result.np_states, result.np_maps, result.np_masks, result.hidden
for info_item in result.episode_infos:
    record_episode(episode_window, info_item)
total_steps += result.steps_collected
steps_in_phase += result.steps_collected
last_states, last_maps, last_masks = prepare_bootstrap_tensors(result)
```

- [ ] **Step 5: Verify sync behavior**

Run:

```powershell
python -m unittest tests.nn_rl_bridge_test tests.nn_rl_perf_test tests.nn_rl_metrics_test tests.nn_rl_pretraining_bug_hunt_test -v
```

Expected: PASS.

---

## Task 4: Implement One-Stale Async Trainer

**Files:**
- Modify: `automation/nn_rl/train.py`

- [ ] **Step 1: Import async helpers and executor**

Add imports:

```python
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
```

Add inside `main()` after parsing:

```python
from async_trainer import assert_rollout_staleness, normalize_trainer_mode
trainer_mode = normalize_trainer_mode(args.trainer_mode)
```

- [ ] **Step 2: Add two buffers and two transfer sets for async**

When `trainer_mode == "async-one-stale"`, create:

```python
buffers = [
    RolloutBuffer(...),
    RolloutBuffer(...),
]
transfers = [
    allocate_rollout_transfer_tensors(np_states, np_maps, np_masks, device),
    allocate_rollout_transfer_tensors(np_states, np_maps, np_masks, device),
]
actor_model = DelveNet(state_dim=STATE_DIM, action_dim=ACTION_DIM, **model_kwargs).to(device)
actor_model.load_state_dict(model.state_dict())
actor_model.eval()
learner_version = 0
```

- [ ] **Step 3: Add async loop**

Implement a branch:

```python
if trainer_mode == "async-one-stale":
    run_async_one_stale_training(...)
else:
    run_sync_training(...)
```

The async loop must:

1. Collect the first rollout synchronously with `actor_model`.
2. Record its done episode infos and update `total_steps`.
3. Copy bootstrap tensors with `prepare_bootstrap_tensors(result)`.
4. Set class weights and curriculum before launching the next future.
5. Launch next collection in a single-thread executor using `actor_model` and the other buffer.
6. Run `ppo.update()` on the completed result in the main thread.
7. Increment `learner_version`.
8. Wait for the next result and call:

```python
assert_rollout_staleness(result.policy_version, learner_version, max_staleness=1)
```

9. Before launching the following future, call:

```python
actor_model.load_state_dict(model.state_dict())
actor_version = learner_version
```

- [ ] **Step 4: Keep sync as default**

The existing `sync` path must remain the same observable behavior and checkpoint format. `async-double-buffer` must normalize to `async-one-stale`.

---

## Task 5: Smoke Tests, Benchmarks, And Commit

**Files:**
- Modify only files from previous tasks.

- [ ] **Step 1: Run full NN RL regression**

Run:

```powershell
python -m unittest tests.nn_rl_bridge_test tests.nn_rl_perf_test tests.nn_rl_tactical_actions_test tests.nn_rl_metrics_test tests.nn_rl_checkpoint_migration_test tests.nn_rl_pretraining_bug_hunt_test tests.nn_rl_training_gate_test -v
```

Expected: PASS.

- [ ] **Step 2: Run async smoke from the latest stable checkpoint**

Run:

```powershell
python automation\nn_rl\train.py --resume .\checkpoints_stable_lr\delve_ppo_799056128.pt --learning-rate 0.00003 --entropy-coeff 0.01 --model-variant base --observation-mode legacy --transport-mode shared-contiguous --trainer-mode async-one-stale --total-timesteps 799187200 --num-envs 16 --envs-per-worker 4 --rollout-steps 128 --batch-size 512 --no-tensorboard --checkpoint-dir .tmp_async_smoke --metrics-log runs\perf_async_smoke\metrics.jsonl --save-every 1000000000
```

Expected: completes without stale-policy errors, shared-memory errors, or NaNs.

- [ ] **Step 3: Run matched short comparison**

Run sync:

```powershell
python automation\nn_rl\train.py --resume .\checkpoints_stable_lr\delve_ppo_799056128.pt --learning-rate 0.00003 --entropy-coeff 0.01 --model-variant base --observation-mode legacy --transport-mode shared-contiguous --trainer-mode sync --total-timesteps 799318272 --num-envs 32 --envs-per-worker 4 --rollout-steps 256 --batch-size 512 --no-tensorboard --checkpoint-dir .tmp_perf_sync --metrics-log runs\perf_sync_shared_contiguous\metrics.jsonl --save-every 1000000000
```

Run async:

```powershell
python automation\nn_rl\train.py --resume .\checkpoints_stable_lr\delve_ppo_799056128.pt --learning-rate 0.00003 --entropy-coeff 0.01 --model-variant base --observation-mode legacy --transport-mode shared-contiguous --trainer-mode async-one-stale --total-timesteps 799318272 --num-envs 32 --envs-per-worker 4 --rollout-steps 256 --batch-size 512 --no-tensorboard --checkpoint-dir .tmp_perf_async --metrics-log runs\perf_async_one_stale\metrics.jsonl --save-every 1000000000
```

Expected: async completes and its metrics JSONL records comparable or better `perf.steps_per_second`. If async is slower or less stable, keep the code only if it remains opt-in and document sync as recommended.

- [ ] **Step 4: Clean temporary checkpoints**

Remove only temporary benchmark checkpoint directories:

```powershell
Remove-Item -Recurse -Force .tmp_async_smoke,.tmp_perf_sync,.tmp_perf_async -ErrorAction SilentlyContinue
```

- [ ] **Step 5: Commit and push**

Run:

```powershell
git add automation\nn_rl\async_trainer.py automation\nn_rl\train.py tests\nn_rl_perf_test.py tests\nn_rl_metrics_test.py docs\superpowers\plans\2026-06-16-rl-async-pipeline-efficiency.md
git commit -m "Add one-stale async PPO trainer"
git push origin rl-training-efficiency
```

---

## Task 6: Resumed-Run Perf Metric Fix

**Files:**
- Modify: `automation/nn_rl/train.py`
- Modify: `tests/nn_rl_metrics_test.py`

- [ ] **Step 1: Add resumed speed regression test**

Add a test that calls `build_training_metrics_row(total_steps=1000, run_start_steps=900, elapsed=10.0, stage_seconds={"collect": 3.0}, ...)` and expects:

```python
self.assertEqual(row["perf"]["steps_per_second"], 10.0)
self.assertEqual(row["perf"]["run_start_steps"], 900)
self.assertEqual(row["perf"]["steps_this_run"], 100)
```

- [ ] **Step 2: Verify red**

Run:

```powershell
python -m unittest tests.nn_rl_metrics_test.NnRlMetricsTest.test_build_training_metrics_row_uses_run_delta_for_resumed_perf -v
```

Expected: failure because `build_training_metrics_row()` does not accept `run_start_steps`.

- [ ] **Step 3: Implement run-delta speed calculation**

Add `run_start_steps=0` to `build_training_metrics_row()` and compute:

```python
steps_this_run = max(int(total_steps) - int(run_start_steps or 0), 0)
row["perf"]["steps_per_second"] = steps_this_run / max(float(elapsed), 1e-9)
row["perf"]["run_start_steps"] = int(run_start_steps or 0)
row["perf"]["steps_this_run"] = steps_this_run
```

In `main()`, save `run_start_steps = total_steps` after checkpoint resume resolution and pass it into `build_training_metrics_row()`.

- [ ] **Step 4: Verify green**

Run:

```powershell
python -m unittest tests.nn_rl_metrics_test.NnRlMetricsTest.test_build_training_metrics_row_uses_run_delta_for_resumed_perf tests.nn_rl_metrics_test.NnRlMetricsTest.test_build_training_metrics_row_includes_perf_when_supplied -v
```

Expected: PASS.

---

## Self-Review

Spec coverage:

- This plan finishes the remaining suggested efficiency work: frozen actor, double-buffer rollout storage, and one-stale overlap.
- It keeps stable sync training available and makes async opt-in.
- It uses the current stable checkpoint `checkpoints_stable_lr\delve_ppo_799056128.pt` for smoke and benchmark work.
- It includes the resumed-run speed metric fix discovered during benchmark verification.

Placeholder scan:

- No task contains TBD/fill-in placeholders.
- Each code-changing task names the files, code shapes, and verification commands.

Type consistency:

- `normalize_trainer_mode`, `assert_rollout_staleness`, `RolloutTransferTensors`, `RolloutResult`, `collect_rollout_batch`, and `prepare_bootstrap_tensors` are named consistently across tasks.

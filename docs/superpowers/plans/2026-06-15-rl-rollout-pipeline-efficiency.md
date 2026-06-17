# RL Rollout Pipeline Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the migrated base PPO model is stable, then remove the remaining rollout copy bottlenecks and add a one-rollout-stale actor/learner pipeline without damaging PPO stability.

**Architecture:** Keep the current stable synchronous trainer as the default. Add measurable opt-in modes in small phases: first contiguous shared buffers, then preallocated tensor copies, then async actor/learner overlap. Each phase must beat the previous phase on steps/sec without reducing fixed-seed class performance beyond the rejection thresholds.

**Tech Stack:** Python 3.14, PyTorch PPO, NumPy, multiprocessing shared memory, PowerShell, existing DELVE `automation/nn_rl` training stack.

---

## Recommendation Before Coding

### Current Log Review: No-Go as of ~699.8M Steps

The current `base` migrated run should not proceed to pipeline implementation yet. The latest observed window was roughly:

```text
Step: ~699,834,624
Full Win class-average: ~17-22%
Avg Floor: ~3.6-3.9
Death: ~75-82%
Fragile classes: rogue/mage/ranger/monk mostly 0-14% win
KITE_SAFE_MOVE action share: ~14-16% of all actions
```

This is not a full collapse like the `large_tactical` run, but it is below the stability gate. The action distribution suggests the newly migrated `KITE_SAFE_MOVE` row is being explored far too often. Before any efficiency rewrite, stabilize the tactical action exposure:

- Restrict `KITE_SAFE_MOVE` to visible combat pressure, not any enemy on the map.
- Require the chosen move to increase distance from the nearest visible enemy.
- Consider allowing it only for `rogue`, `mage`, and `ranger` when an enemy is within a short threat radius.
- Re-run the migrated base checkpoint after this fix and only proceed when the stability gate passes.

Let the current `base` migrated run continue until at least:

```text
705,000,000 total steps
```

That is about 10M steps after the migrated checkpoint at `694,984,960`. At the current observed base-run pace of roughly 3.8k-4.3k steps/sec, this is about 40-45 minutes of wall-clock time.

Stop earlier only if any hard failure happens:

- Full Win remains `0.0%` for 1M additional steps.
- Avg Floor stays below `3.0` for 1M additional steps.
- Death remains `98%+` for 1M additional steps.
- Training crashes or produces NaNs.

Proceed to implementation only if the run is stable:

- Full Win class-average returns to at least `25%` in training logs.
- Avg Floor is at least `3.7`.
- Death rate is below `85%` for several consecutive reports.
- The latest fixed-seed eval does not show a class-wide collapse.

If the current run rises above `40%` Full Win and keeps improving, let it run to `710,000,000` before stopping. A better checkpoint is more valuable than starting the pipeline rewrite 30 minutes earlier.

## Current Evidence

Old run:

```text
1,310,720 steps / 369s = ~3,552 steps/sec
Full Win: ~16-32%
Avg Floor: ~3.7-4.0
```

Large tactical run:

```text
~4,335 steps/sec
Full Win: 0.0%
Avg Floor: ~2.6-3.1
```

Base migrated run:

```text
Recovered from 0.0% to 29.7-38.8% Full Win within the first few reports.
This is the checkpoint family to stabilize before more pipeline work.
```

## Expected Impact

The next pipeline work should be measured against the current base run, not the broken large run.

Expected realistic gains:

| Phase | Expected Steps/Sec | Expected Gain | Notes |
|---|---:|---:|---|
| Current base sync legacy/pipe | ~3.8k-4.3k | baseline | Stable quality path |
| Contiguous shared buffers | ~4.2k-4.8k | +5-15% | Removes `.copy()` and `np.concatenate` churn |
| Preallocated tensor transfer | ~4.4k-5.1k | +5-10% | Reduces per-step tensor allocation |
| One-stale async actor/learner | ~5.0k-6.5k | +15-35% | Depends on learner/collector split |
| Combined optimistic | ~5.5k-7.0k | +30-60% | Requires no PPO degradation |

Do not expect a 10x speedup from these changes. The Python game simulation remains the dominant CPU cost.

---

## File Structure

Files to modify:

- `automation/nn_rl/shared_rollout.py`  
  Add contiguous shared-buffer slicing and optional reward/done arrays.
- `automation/nn_rl/vector_env.py`  
  Add `transport_mode="shared-contiguous"` and make workers write into assigned shared slices.
- `automation/nn_rl/train.py`  
  Add per-update perf deltas, preallocated tensor transfer, and later `trainer_mode="async-one-stale"`.
- `automation/nn_rl/ppo.py`  
  Add a safe buffer reset helper only if preallocated/double-buffer use reveals stale data risk.
- `automation/nn_rl/async_trainer.py`  
  Expand from packet metadata into a small one-stale coordinator.
- `tests/nn_rl_perf_test.py`  
  Add focused tests for shared slicing, no-copy shape behavior, and async staleness guards.

Files to create:

- `automation/nn_rl/training_gate.py`  
  Parse recent metrics JSONL and enforce the go/no-go criteria before pipeline changes.
- `tests/nn_rl_training_gate_test.py`  
  Unit tests for gate decisions.

---

## Task 0: Stabilization Gate Before Pipeline Work

**Files:**
- No code changes.

- [ ] **Step 1: Let the current base run continue**

Current command:

```powershell
python automation\nn_rl\train.py --resume .\checkpoints\delve_ppo_694984960_v2_base.pt --reset-optimizer --model-variant base --observation-mode legacy --transport-mode pipe --total-timesteps 1000000000
```

Target checkpoint:

```text
checkpoints\delve_ppo_7050xxxxx.pt or later
```

Expected: training remains in the old competence band, not the large-model collapse band.

- [ ] **Step 2: Identify the latest numbered checkpoint**

Run:

```powershell
$ckpt = Get-ChildItem .\checkpoints\delve_ppo_*.pt |
  Where-Object { $_.BaseName -match '^delve_ppo_\d+$' } |
  Sort-Object { [long]($_.BaseName -replace 'delve_ppo_','') } |
  Select-Object -Last 1

$ckpt.FullName
```

Expected: a path at or above `705,000,000` steps.

- [ ] **Step 3: Run fixed-seed per-class eval**

Run:

```powershell
python automation\nn_rl\evaluate.py --model $ckpt.FullName --model-variant base --per-class 50 --seed-base 900000 --summary-json runs\eval_base_pipeline_gate.json --device cuda
```

Expected: completes without crash and writes `runs\eval_base_pipeline_gate.json`.

- [ ] **Step 4: Decide go/no-go**

Proceed only if:

```text
Training Full Win class-average >= 25%
Training Avg Floor >= 3.7
Training Death <= 85%
Fixed-seed eval does not show all fragile classes collapsed
```

If not met, do not implement async. Continue stabilizing the base policy or investigate the checkpoint/action-space migration first.

---

## Task 1: Add an Automated Training Gate

**Files:**
- Create: `automation/nn_rl/training_gate.py`
- Create: `tests/nn_rl_training_gate_test.py`

- [ ] **Step 1: Write gate tests**

Create `tests/nn_rl_training_gate_test.py`:

```python
import json
import os
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "automation", "nn_rl"))

from training_gate import summarize_recent_reports, training_gate_passes


class TrainingGateTest(unittest.TestCase):
    def test_summarize_recent_reports_uses_last_n_train_reports(self):
        rows = [
            {"event": "ignored"},
            {"event": "train_report", "progress_rate": 0.20, "avg_floor": 3.5, "death_rate": 0.90},
            {"event": "train_report", "progress_rate": 0.30, "avg_floor": 3.9, "death_rate": 0.80},
            {"event": "train_report", "progress_rate": 0.40, "avg_floor": 4.0, "death_rate": 0.70},
        ]
        summary = summarize_recent_reports(rows, limit=2)
        self.assertAlmostEqual(summary["progress_rate"], 0.35)
        self.assertAlmostEqual(summary["avg_floor"], 3.95)
        self.assertAlmostEqual(summary["death_rate"], 0.75)

    def test_training_gate_passes_stable_base_run(self):
        summary = {"progress_rate": 0.30, "avg_floor": 3.8, "death_rate": 0.80}
        passed, reasons = training_gate_passes(summary)
        self.assertTrue(passed)
        self.assertEqual(reasons, [])

    def test_training_gate_rejects_collapsed_policy(self):
        summary = {"progress_rate": 0.0, "avg_floor": 2.7, "death_rate": 1.0}
        passed, reasons = training_gate_passes(summary)
        self.assertFalse(passed)
        self.assertIn("progress_rate 0.0% < 25.0%", reasons)
        self.assertIn("avg_floor 2.70 < 3.70", reasons)
        self.assertIn("death_rate 100.0% > 85.0%", reasons)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```powershell
python -m unittest tests.nn_rl_training_gate_test -v
```

Expected: import failure for `training_gate`.

- [ ] **Step 3: Implement the gate**

Create `automation/nn_rl/training_gate.py`:

```python
"""Go/no-go checks for DELVE PPO efficiency work."""

from __future__ import annotations

import argparse
import json


def summarize_recent_reports(rows, limit=5):
    reports = [row for row in rows if row.get("event") == "train_report"]
    recent = reports[-int(limit):]
    if not recent:
        raise ValueError("No train_report rows found")

    return {
        "progress_rate": sum(float(row["progress_rate"]) for row in recent) / len(recent),
        "avg_floor": sum(float(row["avg_floor"]) for row in recent) / len(recent),
        "death_rate": sum(float(row["death_rate"]) for row in recent) / len(recent),
    }


def training_gate_passes(summary, min_progress=0.25, min_avg_floor=3.7, max_death_rate=0.85):
    reasons = []
    if float(summary["progress_rate"]) < min_progress:
        reasons.append(f"progress_rate {summary['progress_rate']:.1%} < {min_progress:.1%}")
    if float(summary["avg_floor"]) < min_avg_floor:
        reasons.append(f"avg_floor {summary['avg_floor']:.2f} < {min_avg_floor:.2f}")
    if float(summary["death_rate"]) > max_death_rate:
        reasons.append(f"death_rate {summary['death_rate']:.1%} > {max_death_rate:.1%}")
    return not reasons, reasons


def load_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check whether PPO training is stable enough for pipeline changes.")
    parser.add_argument("metrics_log")
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args(argv)

    summary = summarize_recent_reports(load_jsonl(args.metrics_log), limit=args.limit)
    passed, reasons = training_gate_passes(summary)
    print(json.dumps({"passed": passed, "summary": summary, "reasons": reasons}, indent=2, sort_keys=True))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests**

Run:

```powershell
python -m unittest tests.nn_rl_training_gate_test -v
```

Expected: PASS.

- [ ] **Step 5: Run gate on current metrics**

Run:

```powershell
python automation\nn_rl\training_gate.py runs\delve_ppo\metrics.jsonl --limit 5
```

Expected: JSON with `"passed": true` before starting pipeline edits.

- [ ] **Step 6: Commit**

Run:

```powershell
git add automation\nn_rl\training_gate.py tests\nn_rl_training_gate_test.py
git commit -m "Add PPO training stability gate"
```

---

## Task 2: Add Contiguous Shared Observation Buffers

**Files:**
- Modify: `automation/nn_rl/shared_rollout.py`
- Modify: `tests/nn_rl_perf_test.py`

- [ ] **Step 1: Write slicing test**

Append to `tests/nn_rl_perf_test.py`:

```python
    def test_shared_observation_buffer_can_attach_worker_slice(self):
        from shared_rollout import SharedObservationBuffer

        owner = SharedObservationBuffer.create(num_envs=5)
        worker = SharedObservationBuffer.attach(
            owner.state_shm.name,
            owner.map_shm.name,
            owner.mask_shm.name,
            total_envs=5,
            start=2,
            count=2,
        )
        try:
            worker.states[:, 0] = np.array([0.25, 0.75], dtype=np.float32)
            self.assertAlmostEqual(float(owner.states[2, 0]), 0.25)
            self.assertAlmostEqual(float(owner.states[3, 0]), 0.75)
            self.assertEqual(worker.states.shape, (2, STATE_DIM))
            self.assertEqual(worker.maps.shape, (2, 21, 16, 16))
            self.assertEqual(worker.masks.shape, (2, ACTION_DIM))
        finally:
            worker.close()
            owner.close()
            owner.unlink()
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```powershell
python -m unittest tests.nn_rl_perf_test.NnRlSharedRolloutTest -v
```

Expected: failure because `attach()` does not accept `total_envs`, `start`, or `count`.

- [ ] **Step 3: Implement slicing**

Modify `automation/nn_rl/shared_rollout.py` so `attach` supports both old and sliced calls:

```python
    @classmethod
    def attach(
        cls,
        state_name,
        map_name,
        mask_name,
        num_envs: int | None = None,
        owner=False,
        existing=None,
        total_envs: int | None = None,
        start: int = 0,
        count: int | None = None,
    ):
        total = int(total_envs if total_envs is not None else num_envs)
        if total <= 0:
            raise ValueError("total env count must be positive")
        start = int(start)
        count = int(count if count is not None else total - start)
        if start < 0 or count <= 0 or start + count > total:
            raise ValueError(f"invalid shared buffer slice start={start} count={count} total={total}")

        state_shm, map_shm, mask_shm = existing or (
            shared_memory.SharedMemory(name=state_name),
            shared_memory.SharedMemory(name=map_name),
            shared_memory.SharedMemory(name=mask_name),
        )
        all_states = np.ndarray((total, STATE_DIM), dtype=np.float32, buffer=state_shm.buf)
        all_maps = np.ndarray((total, 21, 16, 16), dtype=np.float32, buffer=map_shm.buf)
        all_masks = np.ndarray((total, ACTION_DIM), dtype=bool, buffer=mask_shm.buf)
        return cls(
            state_shm=state_shm,
            map_shm=map_shm,
            mask_shm=mask_shm,
            states=all_states[start:start + count],
            maps=all_maps[start:start + count],
            masks=all_masks[start:start + count],
            owner=owner,
        )
```

- [ ] **Step 4: Run tests**

Run:

```powershell
python -m unittest tests.nn_rl_perf_test.NnRlSharedRolloutTest -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add automation\nn_rl\shared_rollout.py tests\nn_rl_perf_test.py
git commit -m "Add sliced shared observation buffers"
```

---

## Task 3: Add `shared-contiguous` Transport

**Files:**
- Modify: `automation/nn_rl/vector_env.py`
- Modify: `automation/nn_rl/train.py`
- Modify: `tests/nn_rl_perf_test.py`
- Modify: `tests/nn_rl_metrics_test.py`

- [ ] **Step 1: Add CLI/parser tests**

Append to `tests/nn_rl_metrics_test.py`:

```python
    def test_train_accepts_shared_contiguous_transport_mode(self):
        args = parse_train_args(["--transport-mode", "shared-contiguous"])
        self.assertEqual(args.transport_mode, "shared-contiguous")
```

Append to `tests/nn_rl_perf_test.py`:

```python
    def test_subproc_vec_env_supports_shared_contiguous_transport_mode(self):
        env = SubprocVecEnv(
            num_envs=4,
            envs_per_worker=2,
            observation_mode="direct",
            transport_mode="shared-contiguous",
        )
        try:
            states, maps, masks = env.reset()
            self.assertEqual(states.shape, (4, STATE_DIM))
            self.assertEqual(maps.shape, (4, 21, 16, 16))
            self.assertEqual(masks.shape, (4, ACTION_DIM))
            states, maps, masks, rewards, dones, infos = env.step(np.zeros(4, dtype=np.int64))
            self.assertEqual(states.shape, (4, STATE_DIM))
            self.assertEqual(maps.shape, (4, 21, 16, 16))
            self.assertEqual(masks.shape, (4, ACTION_DIM))
            self.assertEqual(rewards.shape, (4,))
            self.assertEqual(dones.shape, (4,))
            self.assertEqual(len(infos), 4)
        finally:
            env.close()
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```powershell
python -m unittest tests.nn_rl_metrics_test.NnRlMetricsTest.test_train_accepts_shared_contiguous_transport_mode tests.nn_rl_perf_test.NnRlObservationParityTest.test_subproc_vec_env_supports_shared_contiguous_transport_mode -v
```

Expected: invalid transport mode failure.

- [ ] **Step 3: Update train parser**

Modify `automation/nn_rl/train.py` transport choices:

```python
    parser.add_argument(
        "--transport-mode",
        choices=["pipe", "shared", "shared-contiguous"],
        default="pipe",
        help="Rollout transport used by worker processes.",
    )
```

- [ ] **Step 4: Update SubprocVecEnv validation**

Modify `automation/nn_rl/vector_env.py`:

```python
        if self.transport_mode not in ('pipe', 'shared', 'shared-contiguous'):
            raise ValueError("transport_mode must be 'pipe', 'shared', or 'shared-contiguous'")
```

- [ ] **Step 5: Allocate one shared buffer for contiguous mode**

In `SubprocVecEnv.__init__`, before the worker loop:

```python
        self.contiguous_shared_buffer = None
        if self.transport_mode == 'shared-contiguous':
            from shared_rollout import SharedObservationBuffer
            self.contiguous_shared_buffer = SharedObservationBuffer.create(num_envs)
```

Inside the worker loop, replace the shared allocation branch with:

```python
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
```

- [ ] **Step 6: Attach worker slices**

In `_subproc_worker`, replace the shared attach call with:

```python
            shared_buffer = SharedObservationBuffer.attach(
                shared_config['state_name'],
                shared_config['map_name'],
                shared_config['mask_name'],
                num_envs=shared_config.get('num_envs'),
                total_envs=shared_config.get('total_envs'),
                start=shared_config.get('start', 0),
                count=shared_config.get('count'),
            )
```

- [ ] **Step 7: Return contiguous arrays without per-worker copies**

In `SubprocVecEnv.reset()`, after receiving all worker messages:

```python
        if transport_mode == 'shared-contiguous':
            for p in self.pipes:
                self._validate_shared_worker_message(self._recv_worker(p))
            buf = self.contiguous_shared_buffer
            return buf.states, buf.maps, buf.masks
```

In `SubprocVecEnv.step()`, handle contiguous mode separately:

```python
        if transport_mode == 'shared-contiguous':
            rewards, dones, infos = [], [], []
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
```

- [ ] **Step 8: Close/unlink contiguous buffer once**

In `SubprocVecEnv.close()`, skip duplicate close/unlink of the same owner buffer:

```python
        seen_buffers = set()
        for shared_buffer in self.shared_buffers:
            if shared_buffer is None or id(shared_buffer) in seen_buffers:
                continue
            seen_buffers.add(id(shared_buffer))
            try:
                shared_buffer.close()
            except Exception:
                pass
            try:
                shared_buffer.unlink()
            except FileNotFoundError:
                pass
```

- [ ] **Step 9: Run tests**

Run:

```powershell
python -m unittest tests.nn_rl_perf_test tests.nn_rl_metrics_test -v
```

Expected: PASS.

- [ ] **Step 10: Benchmark**

Run:

```powershell
python automation\nn_rl\train.py --total-timesteps 701538304 --resume .\checkpoints\delve_ppo_700000000.pt --reset-optimizer --model-variant base --observation-mode direct --transport-mode shared-contiguous --no-tensorboard --metrics-log runs\delve_ppo\perf_shared_contiguous.jsonl --checkpoint-dir .tmp_perf_shared_contiguous --save-every 1000000000
```

Expected: at least 5% faster than `direct/shared` and no crash.

- [ ] **Step 11: Commit**

Run:

```powershell
git add automation\nn_rl\vector_env.py automation\nn_rl\train.py tests\nn_rl_perf_test.py tests\nn_rl_metrics_test.py
git commit -m "Add contiguous shared rollout transport"
```

---

## Task 4: Preallocate Observation Transfer Tensors

**Files:**
- Modify: `automation/nn_rl/train.py`
- Modify: `tests/nn_rl_perf_test.py`

- [ ] **Step 1: Add copy helper test**

Append to `tests/nn_rl_perf_test.py`:

```python
class NnRlTensorTransferTest(unittest.TestCase):
    def test_copy_numpy_observation_into_existing_tensors_reuses_targets(self):
        import torch
        from train import copy_numpy_observation_into_tensors

        states_np = np.ones((2, STATE_DIM), dtype=np.float32)
        maps_np = np.ones((2, 21, 16, 16), dtype=np.float32)
        masks_np = np.ones((2, ACTION_DIM), dtype=bool)
        state_t = torch.empty((2, STATE_DIM), dtype=torch.float32)
        map_t = torch.empty((2, 21, 16, 16), dtype=torch.float32)
        mask_t = torch.empty((2, ACTION_DIM), dtype=torch.bool)

        state_id = id(state_t)
        map_id = id(map_t)
        mask_id = id(mask_t)
        result = copy_numpy_observation_into_tensors(states_np, maps_np, masks_np, state_t, map_t, mask_t)

        self.assertIs(result[0], state_t)
        self.assertIs(result[1], map_t)
        self.assertIs(result[2], mask_t)
        self.assertEqual(id(state_t), state_id)
        self.assertEqual(id(map_t), map_id)
        self.assertEqual(id(mask_t), mask_id)
        self.assertTrue(torch.all(state_t == 1.0))
        self.assertTrue(torch.all(map_t == 1.0))
        self.assertTrue(torch.all(mask_t))
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```powershell
python -m unittest tests.nn_rl_perf_test.NnRlTensorTransferTest -v
```

Expected: import failure for `copy_numpy_observation_into_tensors`.

- [ ] **Step 3: Add copy helper**

Add to `automation/nn_rl/train.py` near metric helpers:

```python
def copy_numpy_observation_into_tensors(np_states, np_maps, np_masks, state_tensor, map_tensor, mask_tensor):
    state_tensor.copy_(torch.from_numpy(np_states), non_blocking=True)
    map_tensor.copy_(torch.from_numpy(np_maps), non_blocking=True)
    mask_tensor.copy_(torch.from_numpy(np_masks.astype(np.bool_, copy=False)), non_blocking=True)
    return state_tensor, map_tensor, mask_tensor
```

- [ ] **Step 4: Use preallocated tensors in the rollout loop**

Before the rollout step loop in `train.py`, allocate:

```python
            state_tensor_current = torch.empty((args.num_envs, STATE_DIM), device=device, dtype=torch.float32)
            map_tensor_current = torch.empty((args.num_envs, 21, 16, 16), device=device, dtype=torch.float32)
            mask_tensor_current = torch.empty((args.num_envs, ACTION_DIM), device=device, dtype=torch.bool)
```

Inside the loop, replace:

```python
                state_tensor = torch.from_numpy(np_states).to(device)
                map_tensor = torch.from_numpy(np_maps).to(device)
                mask_tensor = torch.from_numpy(np_masks).to(device=device, dtype=torch.bool)
```

with:

```python
                state_tensor, map_tensor, mask_tensor = copy_numpy_observation_into_tensors(
                    np_states,
                    np_maps,
                    np_masks,
                    state_tensor_current,
                    map_tensor_current,
                    mask_tensor_current,
                )
```

- [ ] **Step 5: Run tests**

Run:

```powershell
python -m unittest tests.nn_rl_perf_test.NnRlTensorTransferTest tests.nn_rl_pretraining_bug_hunt_test.NnRlPretrainingBugHuntTest.test_rollout_buffer_batches_short_smoke_rollouts -v
```

Expected: PASS.

- [ ] **Step 6: Benchmark**

Run the same short command as Task 3 with `--transport-mode shared-contiguous`.

Expected: at least 5% faster than Task 3 or reject this task as not worth the added complexity.

- [ ] **Step 7: Commit**

Run:

```powershell
git add automation\nn_rl\train.py tests\nn_rl_perf_test.py
git commit -m "Preallocate PPO rollout tensor transfers"
```

---

## Task 5: One-Rollout-Stale Async Actor/Learner

**Files:**
- Modify: `automation/nn_rl/async_trainer.py`
- Modify: `automation/nn_rl/train.py`
- Modify: `tests/nn_rl_perf_test.py`
- Modify: `tests/nn_rl_metrics_test.py`

- [ ] **Step 1: Add staleness guard test**

Append to `tests/nn_rl_perf_test.py`:

```python
class NnRlAsyncStalenessTest(unittest.TestCase):
    def test_assert_rollout_staleness_allows_one_version(self):
        from async_trainer import assert_rollout_staleness
        assert_rollout_staleness(actor_version=9, learner_version=10, max_staleness=1)

    def test_assert_rollout_staleness_rejects_two_versions(self):
        from async_trainer import assert_rollout_staleness
        with self.assertRaisesRegex(RuntimeError, "rollout policy is too stale"):
            assert_rollout_staleness(actor_version=8, learner_version=10, max_staleness=1)
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```powershell
python -m unittest tests.nn_rl_perf_test.NnRlAsyncStalenessTest -v
```

Expected: import failure.

- [ ] **Step 3: Implement staleness guard**

Add to `automation/nn_rl/async_trainer.py`:

```python
def assert_rollout_staleness(actor_version, learner_version, max_staleness=1):
    actor_version = int(actor_version)
    learner_version = int(learner_version)
    if learner_version - actor_version > int(max_staleness):
        raise RuntimeError(
            f"rollout policy is too stale: actor_version={actor_version}, "
            f"learner_version={learner_version}, max_staleness={max_staleness}"
        )
```

- [ ] **Step 4: Add CLI mode test**

Append to `tests/nn_rl_metrics_test.py`:

```python
    def test_train_accepts_async_one_stale_trainer_mode(self):
        args = parse_train_args(["--trainer-mode", "async-one-stale"])
        self.assertEqual(args.trainer_mode, "async-one-stale")
```

- [ ] **Step 5: Update train parser**

Change `automation/nn_rl/train.py`:

```python
    parser.add_argument(
        "--trainer-mode",
        choices=["sync", "async-double-buffer", "async-one-stale"],
        default="sync",
        help="Synchronous PPO or one-rollout-stale actor/learner overlap.",
    )
```

- [ ] **Step 6: Refactor rollout collection into a function**

Extract the existing sync rollout body into:

```python
def collect_sync_rollout(env, model, buffer, np_states, np_maps, np_masks, hidden, args, device):
    """Collect one rollout and return the next observation state plus logging data."""
    action_counts = np.zeros(ACTION_DIM, dtype=np.int64)
    probe_accumulator = new_probe_accumulator()
    for step in range(args.rollout_steps):
        state_tensor = torch.from_numpy(np_states).to(device)
        map_tensor = torch.from_numpy(np_maps).to(device)
        mask_tensor = torch.from_numpy(np_masks).to(device=device, dtype=torch.bool)
        hidden_in = hidden
        with torch.inference_mode():
            logits, values_raw, hidden = model(state_tensor, map_tensor, action_mask=mask_tensor, hidden=hidden_in)
            dist = torch.distributions.Categorical(logits=logits)
            actions = dist.sample()
            log_probs = dist.log_prob(actions)
            values = values_raw.squeeze(-1)
            action_probs = torch.softmax(logits, dim=-1)
        action_array = actions.cpu().numpy()
        update_descend_probe(probe_accumulator, np_states, np_masks, action_array, action_probs.cpu().numpy())
        action_counts += np.bincount(action_array, minlength=ACTION_DIM)
        next_np_states, next_np_maps, next_np_masks, rewards_np, dones_np, infos = env.step(action_array)
        buffer.store(
            step=step,
            states=state_tensor,
            maps=map_tensor,
            actions=actions,
            log_probs=log_probs,
            values=values,
            rewards=torch.from_numpy(rewards_np).to(device=device, dtype=torch.float32),
            dones=torch.from_numpy(dones_np).to(device=device, dtype=torch.bool),
            masks=mask_tensor,
            hidden=hidden_in,
        )
        if hidden is not None and dones_np.any():
            done_mask = torch.from_numpy(dones_np).to(device=device, dtype=torch.bool).unsqueeze(0)
            hidden = hidden.masked_fill(done_mask.unsqueeze(-1), 0.0)
        np_states, np_maps, np_masks = next_np_states, next_np_maps, next_np_masks
    return {
        "np_states": np_states,
        "np_maps": np_maps,
        "np_masks": np_masks,
        "hidden": hidden,
        "action_counts": action_counts,
        "probe_accumulator": probe_accumulator,
    }
```

This first refactor must preserve sync behavior before async is enabled.

- [ ] **Step 7: Run sync regression tests**

Run:

```powershell
python -m unittest tests.nn_rl_perf_test tests.nn_rl_metrics_test tests.nn_rl_pretraining_bug_hunt_test -v
```

Expected: PASS.

- [ ] **Step 8: Implement async one-stale mode behind the flag**

Use `concurrent.futures.ThreadPoolExecutor(max_workers=1)` in `train.py`:

```python
from concurrent.futures import ThreadPoolExecutor
```

High-level behavior:

```python
if args.trainer_mode == "async-one-stale":
    # 1. Collect first rollout synchronously.
    # 2. Start collecting next rollout in a background thread with actor_model.
    # 3. Run ppo.update() on the completed rollout in the main thread.
    # 4. Wait for the next rollout.
    # 5. Copy learner weights into actor_model at rollout boundaries.
    # 6. Reject if learner_version - actor_version > 1.
```

The implementation must keep:

```text
max_staleness = 1
actor_model.eval()
learner model remains the optimizer-owned model
actor_model.load_state_dict(model.state_dict()) only between rollouts
```

- [ ] **Step 9: Smoke async for one rollout**

Run:

```powershell
python automation\nn_rl\train.py --resume .\checkpoints\delve_ppo_705000000.pt --reset-optimizer --model-variant base --observation-mode direct --transport-mode shared-contiguous --trainer-mode async-one-stale --total-timesteps 705131072 --num-envs 16 --envs-per-worker 4 --rollout-steps 256 --batch-size 1024 --no-tensorboard --metrics-log runs\delve_ppo\async_smoke.jsonl --checkpoint-dir .tmp_async_smoke --save-every 1000000000
```

Expected: completes one short update without crash.

- [ ] **Step 10: Compare quality and speed**

Run two matched 1M-step jobs from the same checkpoint:

```powershell
python automation\nn_rl\train.py --resume .\checkpoints\delve_ppo_705000000.pt --reset-optimizer --model-variant base --observation-mode direct --transport-mode shared-contiguous --trainer-mode sync --total-timesteps 706000000 --no-tensorboard --metrics-log runs\delve_ppo\sync_compare.jsonl --checkpoint-dir .tmp_sync_compare --save-every 1000000000

python automation\nn_rl\train.py --resume .\checkpoints\delve_ppo_705000000.pt --reset-optimizer --model-variant base --observation-mode direct --transport-mode shared-contiguous --trainer-mode async-one-stale --total-timesteps 706000000 --no-tensorboard --metrics-log runs\delve_ppo\async_compare.jsonl --checkpoint-dir .tmp_async_compare --save-every 1000000000
```

Accept async only if:

```text
async steps/sec >= sync steps/sec * 1.15
async Avg Floor >= sync Avg Floor - 0.15
async Full Win >= sync Full Win - 5 percentage points
no NaNs
no stale-policy errors
```

- [ ] **Step 11: Commit or revert**

If accepted:

```powershell
git add automation\nn_rl\async_trainer.py automation\nn_rl\train.py tests\nn_rl_perf_test.py tests\nn_rl_metrics_test.py
git commit -m "Add one-stale async PPO trainer mode"
```

If rejected:

```powershell
git restore automation\nn_rl\async_trainer.py automation\nn_rl\train.py tests\nn_rl_perf_test.py tests\nn_rl_metrics_test.py
```

Do not keep a complex async path that cannot beat sync by at least 15%.

---

## Task 6: Final Benchmark and Rollout Decision

**Files:**
- No required code changes.

- [ ] **Step 1: Run final benchmark matrix**

Use the latest accepted stable base checkpoint:

```powershell
$ckpt = Get-ChildItem .\checkpoints\delve_ppo_*.pt |
  Where-Object { $_.BaseName -match '^delve_ppo_\d+$' } |
  Sort-Object { [long]($_.BaseName -replace 'delve_ppo_','') } |
  Select-Object -Last 1
```

Run sync baseline:

```powershell
python automation\nn_rl\train.py --resume $ckpt.FullName --reset-optimizer --model-variant base --observation-mode legacy --transport-mode pipe --trainer-mode sync --total-timesteps 706000000 --no-tensorboard --metrics-log runs\delve_ppo\final_legacy_pipe.jsonl --checkpoint-dir .tmp_final_legacy --save-every 1000000000
```

Run best new mode:

```powershell
python automation\nn_rl\train.py --resume $ckpt.FullName --reset-optimizer --model-variant base --observation-mode direct --transport-mode shared-contiguous --trainer-mode async-one-stale --total-timesteps 706000000 --no-tensorboard --metrics-log runs\delve_ppo\final_async_shared_contiguous.jsonl --checkpoint-dir .tmp_final_async --save-every 1000000000
```

- [ ] **Step 2: Evaluate best checkpoint**

Run:

```powershell
python automation\nn_rl\evaluate.py --model $ckpt.FullName --model-variant base --per-class 50 --seed-base 901000 --summary-json runs\eval_final_pipeline.json --device cuda
```

- [ ] **Step 3: Choose production command**

Use the new mode only if it passes both speed and quality gates. Otherwise keep:

```powershell
python automation\nn_rl\train.py --resume .\checkpoints\delve_ppo_694984960_v2_base.pt --reset-optimizer --model-variant base --observation-mode legacy --transport-mode pipe --total-timesteps 1000000000
```

---

## Rejection Criteria

Reject a phase if any condition is true:

- Steps/sec improves less than 5% for contiguous buffers.
- Steps/sec improves less than 15% for async mode.
- Full Win drops by more than 5 percentage points versus matched sync baseline.
- Avg Floor drops by more than 0.15 versus matched sync baseline.
- Death rate rises by more than 5 percentage points.
- Any observation parity test fails.
- Shared memory leaks appear on process exit.
- Async stale policy exceeds one rollout.

## Self-Review

Spec coverage:

- The plan answers how long to run first: to `705,000,000` minimum, `710,000,000` if improving strongly.
- It covers copy removal through contiguous shared buffers and preallocated tensor transfers.
- It covers async through a one-rollout-stale actor/learner path.
- It defines measurable expected impact and rejection thresholds.

Placeholder scan:

- No task depends on unspecified commands.
- Every code-changing task includes exact files, test snippets, implementation snippets, and validation commands.

Type consistency:

- `training_gate_passes`, `summarize_recent_reports`, `SharedObservationBuffer.attach`, and `assert_rollout_staleness` are named consistently in tests and implementation snippets.

## Final Recommendation

Do not interrupt the current base run yet. Let it reach `705,000,000` total steps, run the gate and fixed-seed eval, then implement Tasks 1-4 first. Only implement Task 5 async if the copy-removal phase is stable and there is still enough learner idle time to overlap.

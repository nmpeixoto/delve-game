"""
Python-Node.js bridge for DELVE RL training.
Communicates with headless game workers via subprocess stdin/stdout.
"""

import json
import os
from pathlib import Path
import subprocess
import time
from collections import defaultdict
import multiprocessing as mp

REPO_ROOT = Path(__file__).resolve().parents[2]
RL_RUNNER = REPO_ROOT / 'automation' / 'headless_rl_runner.js'


class HeadlessWorker:
    """A single Node.js worker process running multiple game VMs."""
    
    def __init__(self, num_envs=8):
        self.num_envs = num_envs
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        self.proc = subprocess.Popen(
            ['node', str(RL_RUNNER), '--worker'],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(REPO_ROOT),
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1,
            creationflags=creationflags,
        )
        self.env_ids = []
        # Per-env cache: Node only sends map/seen on floor change; we cache them here.
        self._cached_map: dict[int, list] = {}
        self._cached_seen: dict[int, list] = {}   # stored as sorted list; converted to set on demand
        self._cached_walkable: dict[int, int] = {}
        self._cached_stairs: dict[int, list] = {}

    def _reconstruct_state(self, env_id: int, state: dict) -> dict:
        """Merge delta fields into the state dict using cached map/seen.

        Node sends:
          map        – full 2D map array, or null if unchanged
          seen       – full seen array, or null if using delta
          seen_delta – list of newly-seen tile indices, or null if no change

        After this call, state['map'] and state['seen'] are always present and
        correct so all downstream code works without modification.
        """
        if state is None:
            return state

        # ── map ──────────────────────────────────────────────────────────────
        if state.get('map') is not None:
            self._cached_map[env_id] = state['map']
            # Cache expensive O(N) map calculations to save 100M+ iterations in downstream logic
            walkable_total = 0
            stair_coords = []
            for y, row in enumerate(state['map']):
                for x, tile in enumerate(row):
                    if tile in (1, 2, 3, 4):  # FLOOR, STAIRS, SHOP, LOCKED_DOOR
                        walkable_total += 1
                    if tile == 2:             # STAIRS
                        stair_coords.append((x, y))
            self._cached_walkable[env_id] = walkable_total
            self._cached_stairs[env_id] = stair_coords
            
            state['_walkable_total'] = walkable_total
            state['_stair_coords'] = stair_coords
        elif env_id in self._cached_map:
            # Apply incremental map mutations (doors unlocking, secrets revealed)
            state['_secrets_revealed_this_step'] = 0
            state['_doors_unlocked_this_step'] = 0
            if state.get('map_delta') is not None:
                for x, y, v in state['map_delta']:
                    old_v = self._cached_map[env_id][y][x]
                    self._cached_map[env_id][y][x] = v
                    
                    if old_v == 5 and v == 1:
                        state['_secrets_revealed_this_step'] += 1
                    if old_v == 4 and v == 1:
                        state['_doors_unlocked_this_step'] += 1
                    
                    # Update walkable cache
                    was_walkable = old_v in (1, 2, 3, 4)
                    is_walkable = v in (1, 2, 3, 4)
                    if not was_walkable and is_walkable:
                        self._cached_walkable[env_id] += 1
                    elif was_walkable and not is_walkable:
                        self._cached_walkable[env_id] -= 1
                        
                    # Update stairs cache
                    if old_v == 2 and v != 2:
                        self._cached_stairs[env_id] = [c for c in self._cached_stairs[env_id] if c != (x, y)]
                    elif old_v != 2 and v == 2:
                        self._cached_stairs[env_id].append((x, y))

            state['map'] = self._cached_map[env_id]
            state['_walkable_total'] = self._cached_walkable[env_id]
            state['_stair_coords'] = self._cached_stairs[env_id]

        # ── seen ─────────────────────────────────────────────────────────────
        if state.get('seen') is not None:
            # Full seen array sent (floor change or init)
            self._cached_seen[env_id] = state['seen']
        elif state.get('seen_delta') is not None:
            # Incremental update
            prev = self._cached_seen.get(env_id, [])
            merged = prev + state['seen_delta']
            self._cached_seen[env_id] = merged
            state['seen'] = merged
        elif env_id in self._cached_seen:
            # No change at all — use cached
            state['seen'] = self._cached_seen[env_id]

        # Remove the delta fields so downstream code never sees them
        state.pop('seen_delta', None)
        state.pop('map_delta', None)
        state['seen_count'] = len(state.get('seen', []))
        return state

    
    def _stderr_tail(self):
        try:
            if self.proc.stderr:
                return self.proc.stderr.read()[-2000:]
        except Exception:
            return ''
        return ''

    def _ensure_running(self):
        code = self.proc.poll()
        if code is not None:
            raise RuntimeError(f"Worker exited with code {code}: {self._stderr_tail()}")

    def _send_line(self, msg):
        """Send a JSON message to the worker."""
        try:
            self._ensure_running()
            self.proc.stdin.write(json.dumps(msg) + '\n')
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError) as e:
            print(f"Worker send error: {e}")
            raise
    
    def _recv_line(self):
        """Receive a JSON message from the worker."""
        line = self.proc.stdout.readline()
        if line:
            return json.loads(line.strip())
        self._ensure_running()
        raise RuntimeError("Worker closed stdout without a response")
    
    def init_envs(self, seeds, classes, hard_modes):
        """Initialize environments in this worker."""
        states = []
        for i, (seed, class_name, hard_mode) in enumerate(zip(seeds, classes, hard_modes)):
            env_id = i
            msg = {'type': 'init', 'envId': env_id, 'seed': seed, 'className': class_name, 'hardMode': hard_mode}
            self._send_line(msg)
            resp = self._recv_line()
            if resp and resp.get('type') == 'ready':
                self.env_ids.append(env_id)
                state = self._reconstruct_state(env_id, resp['state'])
                states.append(state)
            else:
                raise RuntimeError(f"Unexpected init response: {resp}")
        return states

    def reset_batch(self, env_specs):
        """Reset local envs.

        Args:
            env_specs: list of (local_env_id, seed, class_name)

        Returns:
            list of (local_env_id, state)
        """
        results = []
        for env_id, seed, class_name, hard_mode in env_specs:
            # Clear cached map/seen — new episode starts a fresh floor
            self._cached_map.pop(env_id, None)
            self._cached_seen.pop(env_id, None)
            self._send_line({
                'type': 'reset',
                'envId': env_id,
                'seed': seed,
                'className': class_name,
                'hardMode': hard_mode,
            })
            resp = self._recv_line()
            if resp and resp.get('type') == 'reset_done':
                state = self._reconstruct_state(env_id, resp['state'])
                results.append((env_id, state))
            else:
                raise RuntimeError(f"Unexpected reset response: {resp}")
        return results

    def get_states(self, env_ids):
        """Return current state snapshots for local env ids."""
        states = []
        for env_id in env_ids:
            self._send_line({'type': 'getState', 'envId': env_id})
            resp = self._recv_line()
            if resp and resp.get('type') == 'state':
                states.append((env_id, resp['state']))
            else:
                raise RuntimeError(f"Unexpected state response: {resp}")
        return states
    
    def step_batch(self, env_decisions):
        """Execute actions in all environments.

        Args:
            env_decisions: list of (env_id, decision_dict)

        Returns:
            list of (env_id, state, done) tuples
        """
        if not env_decisions:
            return []

        msg = {
            'type': 'stepBatch',
            'steps': [
                {'envId': env_id, 'decision': decision}
                for env_id, decision in env_decisions
            ],
        }
        self._send_line(msg)
        resp = self._recv_line()
        if resp and resp.get('type') == 'results':
            return [
                (
                    result.get('envId'),
                    self._reconstruct_state(result.get('envId'), result.get('state')),
                    result.get('done', False),
                )
                for result in resp.get('results', [])
            ]

        results = []
        for env_id, decision in env_decisions:
            msg = {'type': 'step', 'envId': env_id, 'decision': decision}
            self._send_line(msg)
            resp = self._recv_line()
            if resp and resp.get('type') == 'result':
                state = self._reconstruct_state(env_id, resp['state'])
                results.append((env_id, state, resp.get('done', False)))
            else:
                results.append((env_id, None, True))
        return results
    
    def shutdown(self):
        """Shutdown the worker."""
        try:
            if self.proc.poll() is None:
                self._send_line({'type': 'shutdown'})
                self.proc.wait(timeout=5)
        except Exception:
            if self.proc.poll() is None:
                self.proc.kill()
                self.proc.wait(timeout=5)
        finally:
            for pipe in (self.proc.stdin, self.proc.stdout, self.proc.stderr):
                try:
                    if pipe:
                        pipe.close()
                except Exception:
                    pass


import numpy as np

def _compress_state(state):
    if state is None:
        return state
    if 'map' in state and isinstance(state['map'], list):
        state['map'] = np.array(state['map'], dtype=np.int8)
    if 'seen' in state and isinstance(state['seen'], set):
        state['seen'] = np.array(list(state['seen']), dtype=np.int16)
    return state

def _worker_process(worker_id, num_envs, pipe):
    worker = HeadlessWorker(num_envs)
    try:
        while True:
            cmd, args = pipe.recv()
            if cmd == 'init_all':
                states = worker.init_envs(args['seeds'], args['classes'], args['hard_modes'])
                pipe.send([_compress_state(s) for s in states])
            elif cmd == 'step_all':
                results = worker.step_batch(args['decisions'])
                pipe.send([(eid, _compress_state(s), d) for eid, s, d in results])
            elif cmd == 'reset_envs':
                states = worker.reset_batch(args['specs'])
                pipe.send([(eid, _compress_state(s)) for eid, s in states])
            elif cmd == 'get_states':
                states = worker.get_states(args['env_ids'])
                pipe.send([(eid, _compress_state(s)) for eid, s in states])
            elif cmd == 'shutdown':
                worker.shutdown()
                break
    except Exception as e:
        import traceback
        traceback.print_exc()
        worker.shutdown()


class WorkerPool:
    """Pool of multiprocessing workers for parallel game execution."""
    
    def __init__(self, total_envs=128, envs_per_worker=8):
        self.total_envs = total_envs
        self.envs_per_worker = envs_per_worker
        self.num_workers = (total_envs + envs_per_worker - 1) // envs_per_worker
        self.workers = []
        self.pipes = []
        self.env_to_worker = {}
        self.local_to_global = {}
        
        for i in range(self.num_workers):
            worker_envs = min(envs_per_worker, total_envs - i * envs_per_worker)
            parent_conn, child_conn = mp.Pipe()
            p = mp.Process(target=_worker_process, args=(i, worker_envs, child_conn), daemon=True)
            p.start()
            self.workers.append(p)
            self.pipes.append(parent_conn)
            
            for j in range(worker_envs):
                global_id = i * envs_per_worker + j
                if global_id < total_envs:
                    self.env_to_worker[global_id] = (i, j)
                    self.local_to_global[(i, j)] = global_id
            time.sleep(0.1)

    def init_all(self, seeds, classes, hard_modes):
        """Initialize all environments across workers."""
        states = [None] * self.total_envs
        for i, pipe in enumerate(self.pipes):
            start = i * self.envs_per_worker
            end = min(start + self.envs_per_worker, self.total_envs)
            pipe.send(('init_all', {'seeds': seeds[start:end], 'classes': classes[start:end], 'hard_modes': hard_modes[start:end]}))
            
        for i, pipe in enumerate(self.pipes):
            worker_states = pipe.recv()
            for local_id, state in enumerate(worker_states):
                global_id = self.local_to_global[(i, local_id)]
                states[global_id] = state
        return states

    def step_all(self, decisions):
        """Execute actions across all workers in parallel."""
        by_worker = defaultdict(list)
        for env_id, decision in decisions.items():
            worker_idx, local_id = self.env_to_worker[env_id]
            by_worker[worker_idx].append((local_id, decision))
            
        for worker_idx, batch in by_worker.items():
            self.pipes[worker_idx].send(('step_all', {'decisions': batch}))
            
        results = {}
        for worker_idx in by_worker.keys():
            worker_results = self.pipes[worker_idx].recv()
            for env_id, state, done in worker_results:
                global_id = self.local_to_global[(worker_idx, env_id)]
                results[global_id] = (state, done)
        return results

    def reset_envs(self, specs):
        """Reset selected envs."""
        by_worker = defaultdict(list)
        for env_id, (seed, class_name, hard_mode) in specs.items():
            worker_idx, local_id = self.env_to_worker[env_id]
            by_worker[worker_idx].append((local_id, seed, class_name, hard_mode))
            
        for worker_idx, batch in by_worker.items():
            self.pipes[worker_idx].send(('reset_envs', {'specs': batch}))
            
        states = {}
        for worker_idx in by_worker.keys():
            worker_states = self.pipes[worker_idx].recv()
            for local_id, state in worker_states:
                global_id = self.local_to_global[(worker_idx, local_id)]
                states[global_id] = state
        return states

    def get_states(self, env_ids=None):
        """Get state snapshots for selected global env ids."""
        if env_ids is None:
            env_ids = list(range(self.total_envs))

        by_worker = defaultdict(list)
        for env_id in env_ids:
            worker_idx, local_id = self.env_to_worker[env_id]
            by_worker[worker_idx].append(local_id)

        for worker_idx, batch in by_worker.items():
            self.pipes[worker_idx].send(('get_states', {'env_ids': batch}))

        states = {}
        for worker_idx in by_worker.keys():
            worker_states = self.pipes[worker_idx].recv()
            for local_id, state in worker_states:
                global_id = self.local_to_global[(worker_idx, local_id)]
                states[global_id] = state
        return states
        
    def shutdown(self):
        for pipe in self.pipes:
            try:
                pipe.send(('shutdown', None))
            except Exception:
                pass
        for p in self.workers:
            p.join(timeout=2)
            if p.is_alive():
                p.terminate()

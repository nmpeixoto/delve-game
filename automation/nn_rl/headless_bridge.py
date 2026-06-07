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
from concurrent.futures import ThreadPoolExecutor, as_completed

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
    
    def init_envs(self, seeds, classes):
        """Initialize environments in this worker."""
        states = []
        for i, (seed, class_name) in enumerate(zip(seeds, classes)):
            env_id = i
            msg = {'type': 'init', 'envId': env_id, 'seed': seed, 'className': class_name}
            self._send_line(msg)
            resp = self._recv_line()
            if resp and resp.get('type') == 'ready':
                self.env_ids.append(env_id)
                states.append(resp['state'])
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
        for env_id, seed, class_name in env_specs:
            self._send_line({
                'type': 'reset',
                'envId': env_id,
                'seed': seed,
                'className': class_name,
            })
            resp = self._recv_line()
            if resp and resp.get('type') == 'reset_done':
                results.append((env_id, resp['state']))
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
                (result.get('envId'), result.get('state'), result.get('done', False))
                for result in resp.get('results', [])
            ]

        results = []
        for env_id, decision in env_decisions:
            msg = {'type': 'step', 'envId': env_id, 'decision': decision}
            self._send_line(msg)
            resp = self._recv_line()
            if resp and resp.get('type') == 'result':
                results.append((env_id, resp['state'], resp.get('done', False)))
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


class WorkerPool:
    """Pool of Node.js workers for parallel game execution."""
    
    def __init__(self, total_envs=128, envs_per_worker=8):
        self.total_envs = total_envs
        self.envs_per_worker = envs_per_worker
        self.num_workers = (total_envs + envs_per_worker - 1) // envs_per_worker
        self.workers = []
        self.worker_by_id = {}
        self.env_to_worker = {}
        self.local_to_global = {}
        
        for i in range(self.num_workers):
            worker_envs = min(envs_per_worker, total_envs - i * envs_per_worker)
            w = HeadlessWorker(worker_envs)
            self.workers.append(w)
            self.worker_by_id[id(w)] = w
            for j in range(worker_envs):
                global_id = i * envs_per_worker + j
                if global_id < total_envs:
                    self.env_to_worker[global_id] = (w, j)
                    self.local_to_global[(id(w), j)] = global_id
            # Small delay between worker creation to avoid overwhelming the system
            time.sleep(0.1)
        self.executor = ThreadPoolExecutor(max_workers=max(self.num_workers, 1))
    
    def init_all(self, seeds, classes):
        """Initialize all environments across workers."""
        states = [None] * self.total_envs
        for i, worker in enumerate(self.workers):
            start = i * self.envs_per_worker
            end = min(start + self.envs_per_worker, self.total_envs)
            worker_seeds = seeds[start:end]
            worker_classes = classes[start:end]
            worker_states = worker.init_envs(worker_seeds, worker_classes)
            for local_id, state in enumerate(worker_states):
                global_id = self.local_to_global[(id(worker), local_id)]
                states[global_id] = state
        return states
    
    def step_all(self, decisions):
        """Execute actions across all workers in parallel.
        
        Args:
            decisions: dict mapping env_id -> decision_dict
        
        Returns:
            dict mapping env_id -> (state, done)
        """
        # Group by worker
        by_worker = defaultdict(list)
        for env_id, decision in decisions.items():
            worker, local_id = self.env_to_worker[env_id]
            by_worker[id(worker)].append((local_id, decision))
        
        # Execute in each worker
        results = {}
        futures = {
            self.executor.submit(self.worker_by_id[worker_id].step_batch, batch): worker_id
            for worker_id, batch in by_worker.items()
        }
        for future in as_completed(futures):
            worker_id = futures[future]
            for env_id, state, done in future.result():
                global_id = self.local_to_global[(worker_id, env_id)]
                results[global_id] = (state, done)
        
        return results

    def reset_envs(self, specs):
        """Reset selected envs.

        Args:
            specs: dict mapping global env_id -> (seed, class_name)

        Returns:
            dict mapping global env_id -> state
        """
        by_worker = defaultdict(list)
        for env_id, (seed, class_name) in specs.items():
            worker, local_id = self.env_to_worker[env_id]
            by_worker[id(worker)].append((local_id, seed, class_name))

        states = {}
        for worker_id, batch in by_worker.items():
            worker = self.worker_by_id[worker_id]
            for local_id, state in worker.reset_batch(batch):
                global_id = self.local_to_global[(id(worker), local_id)]
                states[global_id] = state
        return states

    def get_states(self, env_ids=None):
        """Get state snapshots for selected global env ids."""
        if env_ids is None:
            env_ids = list(range(self.total_envs))

        by_worker = defaultdict(list)
        for env_id in env_ids:
            worker, local_id = self.env_to_worker[env_id]
            by_worker[id(worker)].append(local_id)

        states = {}
        for worker_id, local_ids in by_worker.items():
            worker = self.worker_by_id[worker_id]
            for local_id, state in worker.get_states(local_ids):
                global_id = self.local_to_global[(id(worker), local_id)]
                states[global_id] = state
        return states
    
    def shutdown(self):
        self.executor.shutdown(wait=True, cancel_futures=True)
        for w in self.workers:
            w.shutdown()

"""
Python-Node.js bridge for DELVE RL training.
Communicates with headless game workers via subprocess stdin/stdout.
"""

import subprocess
import json
import os
import sys
import time
from collections import defaultdict

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RL_RUNNER = os.path.join(REPO_ROOT, 'automation', 'headless_rl_runner.js')


class HeadlessWorker:
    """A single Node.js worker process running multiple game VMs."""
    
    def __init__(self, num_envs=8):
        self.num_envs = num_envs
        self.proc = subprocess.Popen(
            ['node', RL_RUNNER, '--worker'],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=REPO_ROOT,
            bufsize=0,
        )
        self.env_ids = []
    
    def _send_line(self, msg):
        """Send a JSON message to the worker."""
        try:
            data = (json.dumps(msg) + '\n').encode('utf-8')
            self.proc.stdin.write(data)
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError) as e:
            print(f"Worker send error: {e}")
            raise
    
    def _recv_line(self):
        """Receive a JSON message from the worker."""
        line = self.proc.stdout.readline()
        if line:
            return json.loads(line.decode('utf-8').strip())
        return None
    
    def init_envs(self, seeds, classes):
        """Initialize environments in this worker."""
        for i in range(self.num_envs):
            env_id = i
            msg = {'type': 'init', 'envId': env_id, 'seed': seeds[i], 'className': classes[i]}
            self._send_line(msg)
            resp = self._recv_line()
            if resp and resp.get('type') == 'ready':
                self.env_ids.append(env_id)
    
    def step_batch(self, env_decisions):
        """Execute actions in all environments.
        
        Args:
            env_decisions: list of (env_id, decision_dict)
        
        Returns:
            list of (env_id, state, done) tuples
        """
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
            self._send_line({'type': 'shutdown'})
            self.proc.wait(timeout=5)
        except:
            self.proc.kill()


class WorkerPool:
    """Pool of Node.js workers for parallel game execution."""
    
    def __init__(self, total_envs=128, envs_per_worker=8):
        self.total_envs = total_envs
        self.envs_per_worker = envs_per_worker
        self.num_workers = (total_envs + envs_per_worker - 1) // envs_per_worker
        self.workers = []
        self.env_to_worker = {}
        
        for i in range(self.num_workers):
            w = HeadlessWorker(envs_per_worker)
            self.workers.append(w)
            for j in range(envs_per_worker):
                global_id = i * envs_per_worker + j
                if global_id < total_envs:
                    self.env_to_worker[global_id] = (w, j)
            # Small delay between worker creation to avoid overwhelming the system
            time.sleep(0.1)
    
    def init_all(self, seeds, classes):
        """Initialize all environments across workers."""
        for i, worker in enumerate(self.workers):
            start = i * self.envs_per_worker
            end = min(start + self.envs_per_worker, self.total_envs)
            worker_seeds = seeds[start:end]
            worker_classes = classes[start:end]
            worker.init_envs(worker_seeds, worker_classes)
    
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
        for worker_id, batch in by_worker.items():
            worker = next(w for w in self.workers if id(w) == worker_id)
            for env_id, state, done in worker.step_batch(batch):
                global_id = next(k for k, v in self.env_to_worker.items() if v == (worker, env_id))
                results[global_id] = (state, done)
        
        return results
    
    def shutdown(self):
        for w in self.workers:
            w.shutdown()

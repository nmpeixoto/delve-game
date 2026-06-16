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
        state_shm = shared_memory.SharedMemory(
            create=True,
            size=np.zeros(state_shape, dtype=np.float32).nbytes,
        )
        map_shm = shared_memory.SharedMemory(
            create=True,
            size=np.zeros(map_shape, dtype=np.float32).nbytes,
        )
        mask_shm = shared_memory.SharedMemory(
            create=True,
            size=np.zeros(mask_shape, dtype=bool).nbytes,
        )
        return cls.attach(
            state_shm.name,
            map_shm.name,
            mask_shm.name,
            num_envs,
            owner=True,
            existing=(state_shm, map_shm, mask_shm),
        )

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
            raise ValueError(
                f"invalid shared buffer slice start={start} count={count} total={total}"
            )
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

    def close(self):
        self.state_shm.close()
        self.map_shm.close()
        self.mask_shm.close()

    def unlink(self):
        if self.owner:
            self.state_shm.unlink()
            self.map_shm.unlink()
            self.mask_shm.unlink()

"""
PPO (Proximal Policy Optimization) algorithm for DELVE RL training.
Handles GRU hidden state carry for temporal context.
"""

import torch
import torch.nn as nn
import numpy as np
from typing import Dict, Optional


class RolloutBuffer:
    """Storage for rollout experience with GAE computation."""
    
    def __init__(self, num_envs, rollout_steps, state_dim, action_dim, hidden_dim, device="cpu"):
        self.num_envs = num_envs
        self.rollout_steps = rollout_steps
        self.device = torch.device(device)
        self.states = torch.zeros(rollout_steps, num_envs, state_dim, device=self.device)
        self.maps = torch.zeros(rollout_steps, num_envs, 21, 16, 16, device=self.device)
        self.actions = torch.zeros(rollout_steps, num_envs, dtype=torch.long, device=self.device)
        self.log_probs = torch.zeros(rollout_steps, num_envs, device=self.device)
        self.rewards = torch.zeros(rollout_steps, num_envs, device=self.device)
        self.dones = torch.zeros(rollout_steps, num_envs, dtype=torch.bool, device=self.device)
        self.masks = torch.zeros(rollout_steps, num_envs, action_dim, dtype=torch.bool, device=self.device)
        self.advantages = torch.zeros(rollout_steps, num_envs, device=self.device)
        self.returns = torch.zeros(rollout_steps, num_envs, device=self.device)
        self.values = torch.zeros(rollout_steps, num_envs, device=self.device)
        self.hiddens = torch.zeros(rollout_steps, num_envs, hidden_dim, device=self.device)
    
    def store(self, step, states, maps, actions, log_probs, values, rewards, dones, masks, hidden):
        """Store a single step of experience."""
        self.states[step] = states
        self.maps[step] = maps
        self.actions[step] = actions
        self.log_probs[step] = log_probs
        self.values[step] = values
        self.rewards[step] = rewards
        self.dones[step] = dones
        self.masks[step] = masks
        if hidden is None:
            self.hiddens[step].zero_()
        else:
            self.hiddens[step] = hidden.squeeze(0)  # (num_envs, hidden_dim)
    
    def compute_gae(self, last_values, gamma=0.99, lam=0.95):
        """Compute Generalized Advantage Estimation."""
        last_gae = 0
        for t in reversed(range(self.rollout_steps)):
            if t == self.rollout_steps - 1:
                next_values = last_values
            else:
                next_values = self.values[t + 1]
            
            next_non_terminal = 1.0 - self.dones[t].float()
            delta = self.rewards[t] + gamma * next_values * next_non_terminal - self.values[t]
            last_gae = delta + gamma * lam * next_non_terminal * last_gae
            self.advantages[t] = last_gae
            self.returns[t] = last_gae + self.values[t]
    
    def get_batches(self, batch_size, seq_len=16):
        """Get mini-batches of sequential chunks to allow proper BPTT."""
        seq_len = self._effective_seq_len(seq_len)
        num_chunks = self.rollout_steps // seq_len
        
        def chunk_tensor(t):
            # t shape: (rollout_steps, num_envs, ...)
            # reshape to: (num_chunks, seq_len, num_envs, ...)
            shape = (num_chunks, seq_len, self.num_envs) + t.shape[2:]
            t_reshaped = t.view(shape)
            # swap to: (num_chunks, num_envs, seq_len, ...)
            t_swapped = t_reshaped.transpose(1, 2)
            # flatten chunks and envs: (total_chunks, seq_len, ...)
            return t_swapped.reshape(-1, seq_len, *t.shape[2:])

        states = chunk_tensor(self.states)
        maps = chunk_tensor(self.maps)
        actions = chunk_tensor(self.actions)
        old_log_probs = chunk_tensor(self.log_probs)
        returns = chunk_tensor(self.returns)
        advantages = chunk_tensor(self.advantages)
        values = chunk_tensor(self.values)
        masks = chunk_tensor(self.masks)
        dones = chunk_tensor(self.dones)
        
        # For hiddens, we only need the hidden state at the start of each chunk
        # self.hiddens shape: (rollout_steps, num_envs, hidden_dim)
        hiddens_reshaped = self.hiddens.view(num_chunks, seq_len, self.num_envs, -1)
        hiddens_swapped = hiddens_reshaped.transpose(1, 2)  # (num_chunks, num_envs, seq_len, hidden_dim)
        hiddens_starts = hiddens_swapped[:, :, 0, :].reshape(-1, self.hiddens.shape[-1]) # (total_chunks, hidden_dim)

        total_chunks = num_chunks * self.num_envs
        # Batch size is in terms of total steps, so batch_chunks = batch_size // seq_len
        batch_chunks = max(1, batch_size // seq_len)
        
        indices = torch.randperm(total_chunks, device=self.device)
        
        for start in range(0, total_chunks, batch_chunks):
            end = min(start + batch_chunks, total_chunks)
            batch_idx = indices[start:end]
            
            # We return flat tensors (batch_chunks * seq_len, ...) for the network
            # But the network will reshape them internally to (batch_chunks, seq_len, ...) using seq_len
            yield {
                'states': states[batch_idx].reshape(-1, states.shape[-1]),
                'maps': maps[batch_idx].reshape(-1, *maps.shape[2:]),
                'actions': actions[batch_idx].reshape(-1),
                'old_log_probs': old_log_probs[batch_idx].reshape(-1),
                'returns': returns[batch_idx].reshape(-1),
                'advantages': advantages[batch_idx].reshape(-1),
                'old_values': values[batch_idx].reshape(-1),
                'masks': masks[batch_idx].reshape(-1, masks.shape[-1]),
                'dones': dones[batch_idx].reshape(-1),
                'hiddens': hiddens_starts[batch_idx],
                'seq_len': seq_len,
            }

    def _effective_seq_len(self, requested_seq_len):
        seq_len = max(1, min(int(requested_seq_len), self.rollout_steps))
        while self.rollout_steps % seq_len != 0:
            seq_len -= 1
        return seq_len


class PPO:
    """PPO agent with clipped objective."""
    
    def __init__(self, network, config, device):
        self.network = network
        self.config = config
        self.device = device
        
        self.optimizer = torch.optim.Adam(
            network.parameters(),
            lr=config['lr'],
            eps=1e-5
        )
        
        total_iters = config['lr_decay_steps'] // (config['num_envs'] * config['rollout_steps'])
        self.scheduler = torch.optim.lr_scheduler.LinearLR(
            self.optimizer,
            start_factor=1.0,
            end_factor=config['lr_end'] / config['lr_start'],
            total_iters=max(total_iters, 1)
        )
    
    def get_action(self, state_tensor, map_tensor, mask_tensor, hidden=None, deterministic=False):
        """Get action from policy network."""
        with torch.inference_mode():
            return self.network.get_action(state_tensor, map_tensor, mask_tensor, hidden, deterministic)
    
    def update(self, buffer, last_states, last_maps, last_masks, last_hidden):
        """PPO clipped objective update with GRU replay."""
        config = self.config
        
        with torch.no_grad():
            last_values = self.network.get_value(last_states, last_maps, last_hidden)
        buffer.compute_gae(last_values, config['gamma'], config['lam'])
        
        total_policy_loss = 0
        total_value_loss = 0
        total_entropy = 0
        num_batches = 0
        
        # Globally normalize advantages
        buffer.advantages = (buffer.advantages - buffer.advantages.mean()) / (buffer.advantages.std() + 1e-8)
        
        for _ in range(config.get('epochs_per_update', 3)):
            for batch in buffer.get_batches(config['batch_size']):
                states = batch['states']
                maps = batch['maps']
                actions = batch['actions']
                old_log_probs = batch['old_log_probs']
                returns = batch['returns']
                advantages = batch['advantages']
                old_values = batch['old_values']
                masks = batch['masks']
                dones = batch['dones']
                # Use the hidden state recorded at the start of the chunk
                batch_hidden = batch['hiddens'].unsqueeze(0).contiguous()  # (1, batch_chunks, hidden_dim)
                seq_len = batch['seq_len']

                logits, value, _ = self.network(states, maps, action_mask=masks, hidden=batch_hidden, seq_len=seq_len, dones=dones)
                dist = torch.distributions.Categorical(logits=logits)
                
                new_log_probs = dist.log_prob(actions)
                entropy = dist.entropy().mean()
                
                ratio = torch.exp(new_log_probs - old_log_probs)
                surr1 = ratio * advantages
                surr2 = torch.clamp(ratio, 1 - config['clip_eps'], 1 + config['clip_eps']) * advantages
                policy_loss = -torch.min(surr1, surr2).mean()
                
                # Calculate value loss with optional clipping
                if config.get('clip_v_loss', True):
                    v_clipped = old_values + torch.clamp(value.squeeze(-1) - old_values, -config['clip_eps'], config['clip_eps'])
                    v_loss1 = (returns - value.squeeze(-1)).pow(2)
                    v_loss2 = (returns - v_clipped).pow(2)
                    value_loss = 0.5 * torch.max(v_loss1, v_loss2).mean()
                else:
                    value_loss = 0.5 * (returns - value.squeeze(-1)).pow(2).mean()
                
                loss = (policy_loss
                        + config.get('value_coeff', 0.5) * value_loss
                        - config.get('entropy_coeff', 0.02) * entropy)
                
                self.optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(
                    self.network.parameters(), config['max_grad_norm']
                )
                self.optimizer.step()
                
                total_policy_loss += policy_loss.item()
                total_value_loss += value_loss.item()
                total_entropy += entropy.item()
                num_batches += 1
        
        self.scheduler.step()
        
        return {
            'policy_loss': total_policy_loss / max(num_batches, 1),
            'value_loss': total_value_loss / max(num_batches, 1),
            'entropy': total_entropy / max(num_batches, 1),
        }
    
    def save(self, path, **metadata):
        checkpoint = {
            'network': self.network.state_dict(),
            'optimizer': self.optimizer.state_dict(),
            'scheduler': self.scheduler.state_dict(),
        }
        checkpoint.update(metadata)
        torch.save(checkpoint, path)
    
    def load(self, path, load_optimizer=True, override_lr=None):
        checkpoint = torch.load(path, map_location=self.device)
        self.network.load_state_dict(checkpoint['network'])
        if load_optimizer and 'optimizer' in checkpoint and 'scheduler' in checkpoint:
            self.optimizer.load_state_dict(checkpoint['optimizer'])
            self.scheduler.load_state_dict(checkpoint['scheduler'])
            if override_lr is not None:
                # Override the learning rate of the loaded optimizer
                for param_group in self.optimizer.param_groups:
                    param_group['lr'] = override_lr
                # Update scheduler's base learning rates
                self.scheduler.base_lrs = [override_lr]
                # Re-calculate end_factor based on new initial learning rate
                if hasattr(self.scheduler, 'end_factor'):
                    self.scheduler.end_factor = self.config['lr_end'] / override_lr
        return checkpoint

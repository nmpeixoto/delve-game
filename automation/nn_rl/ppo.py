"""
PPO (Proximal Policy Optimization) algorithm for DELVE RL training.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Dict


class RolloutBuffer:
    """Storage for rollout experience with GAE computation."""
    
    def __init__(self, num_envs, rollout_steps, state_dim, action_dim):
        self.num_envs = num_envs
        self.rollout_steps = rollout_steps
        self.states = torch.zeros(rollout_steps, num_envs, state_dim)
        self.actions = torch.zeros(rollout_steps, num_envs, dtype=torch.long)
        self.log_probs = torch.zeros(rollout_steps, num_envs)
        self.rewards = torch.zeros(rollout_steps, num_envs)
        self.dones = torch.zeros(rollout_steps, num_envs, dtype=torch.bool)
        self.masks = torch.zeros(rollout_steps, num_envs, action_dim, dtype=torch.bool)
        self.advantages = torch.zeros(rollout_steps, num_envs)
        self.returns = torch.zeros(rollout_steps, num_envs)
        self.values = torch.zeros(rollout_steps, num_envs)
        self.ptr = 0
    
    def store(self, step, states, actions, log_probs, values, rewards, dones, masks):
        """Store a single step of experience."""
        self.states[step] = states
        self.actions[step] = actions
        self.log_probs[step] = log_probs
        self.values[step] = values
        self.rewards[step] = rewards
        self.dones[step] = dones
        self.masks[step] = masks
    
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
    
    def get_batches(self, batch_size):
        """Get shuffled mini-batches."""
        total = self.rollout_steps * self.num_envs
        
        # Flatten
        states = self.states.reshape(total, -1)
        actions = self.actions.reshape(total)
        old_log_probs = self.log_probs.reshape(total)
        returns = self.returns.reshape(total)
        advantages = self.advantages.reshape(total)
        masks = self.masks.reshape(total, -1)
        
        # Shuffle
        indices = torch.randperm(total)
        
        for start in range(0, total, batch_size):
            end = min(start + batch_size, total)
            batch_idx = indices[start:end]
            yield {
                'states': states[batch_idx],
                'actions': actions[batch_idx],
                'old_log_probs': old_log_probs[batch_idx],
                'returns': returns[batch_idx],
                'advantages': advantages[batch_idx],
                'masks': masks[batch_idx],
            }


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
        
        # LR scheduler: linear decay
        total_iters = config['lr_decay_steps'] // (config['num_envs'] * config['rollout_steps'])
        self.scheduler = torch.optim.lr_scheduler.LinearLR(
            self.optimizer,
            start_factor=1.0,
            end_factor=config['lr_end'] / config['lr_start'],
            total_iters=max(total_iters, 1)
        )
    
    def get_action(self, state_tensor, mask_tensor, deterministic=False):
        """Get action from policy network."""
        with torch.no_grad():
            return self.network.get_action(state_tensor, mask_tensor, deterministic)
    
    def update(self, buffer, last_states, last_masks):
        """PPO clipped objective update."""
        config = self.config
        
        # Compute advantages
        with torch.no_grad():
            last_values = self.network.get_value(last_states.to(self.device)).cpu()
        buffer.compute_gae(last_values, config['gamma'], config['lam'])
        
        # Training loop
        total_policy_loss = 0
        total_value_loss = 0
        total_entropy = 0
        num_batches = 0
        
        for batch in buffer.get_batches(config['batch_size']):
            states = batch['states'].to(self.device)
            actions = batch['actions'].to(self.device)
            old_log_probs = batch['old_log_probs'].to(self.device)
            returns = batch['returns'].to(self.device)
            advantages = batch['advantages'].to(self.device)
            masks = batch['masks'].to(self.device)
            
            # Normalize advantages
            advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
            
            # Forward pass
            logits, value = self.network(states, action_mask=masks)
            probs = F.softmax(logits, dim=-1)
            dist = torch.distributions.Categorical(probs)
            
            new_log_probs = dist.log_prob(actions)
            entropy = dist.entropy().mean()
            
            # PPO clipped objective
            ratio = torch.exp(new_log_probs - old_log_probs)
            surr1 = ratio * advantages
            surr2 = torch.clamp(ratio, 1 - config['clip_eps'], 1 + config['clip_eps']) * advantages
            policy_loss = -torch.min(surr1, surr2).mean()
            
            # Value loss
            value_loss = 0.5 * (returns - value.squeeze(-1)).pow(2).mean()
            
            # Total loss
            loss = (policy_loss
                    + config['value_coeff'] * value_loss
                    - config['entropy_coeff'] * entropy)
            
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
        """Save model checkpoint."""
        checkpoint = {
            'network': self.network.state_dict(),
            'optimizer': self.optimizer.state_dict(),
            'scheduler': self.scheduler.state_dict(),
        }
        checkpoint.update(metadata)
        torch.save(checkpoint, path)
    
    def load(self, path):
        """Load model checkpoint."""
        checkpoint = torch.load(path, map_location=self.device)
        self.network.load_state_dict(checkpoint['network'])
        self.optimizer.load_state_dict(checkpoint['optimizer'])
        self.scheduler.load_state_dict(checkpoint['scheduler'])
        return checkpoint

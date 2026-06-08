"""
DelveNet neural network architecture for DELVE RL bot.
PPO-compatible actor-critic with shared backbone.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

class DelveNet(nn.Module):
    """
    Actor-Critic network for DELVE.
    
    Architecture:
        Backbone: 155 -> 256 -> 256 -> 128 (MLP with LayerNorm)
        Policy Head: 128 -> 64 -> action_dim (action logits)
        Value Head: 128 -> 64 -> 1 (state value)
    
    Total parameters: ~350K
    """
    
    def __init__(self, state_dim=155, action_dim=18, hidden_dim=256):
        super().__init__()
        
        # Backbone
        self.backbone = nn.Sequential(
            nn.Linear(state_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 128),
            nn.LayerNorm(128),
            nn.ReLU(),
        )
        
        # Policy head (actor)
        self.policy = nn.Sequential(
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, action_dim),
        )
        
        # Value head (critic)
        self.value = nn.Sequential(
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
        )
    
    def forward(self, state, action_mask=None):
        """
        Forward pass.
        
        Args:
            state: Tensor of shape (batch, state_dim)
            action_mask: Optional bool tensor of shape (batch, action_dim)
        
        Returns:
            logits: Tensor of shape (batch, action_dim)
            value: Tensor of shape (batch, 1)
        """
        features = self.backbone(state)
        logits = self.policy(features)
        value = self.value(features)
        
        # Apply action masking
        if action_mask is not None:
            logits = logits.masked_fill(~action_mask, -1e9)
        
        return logits, value
    
    def get_action(self, state, action_mask=None, deterministic=False):
        """
        Get action from policy.
        
        Args:
            state: Tensor of shape (batch, state_dim)
            action_mask: Optional bool tensor
            deterministic: If True, take greedy action
        
        Returns:
            action: Tensor of shape (batch,)
            log_prob: Tensor of shape (batch,)
            value: Tensor of shape (batch,)
        """
        logits, value = self.forward(state, action_mask)
        probs = F.softmax(logits, dim=-1)
        
        if deterministic:
            action = probs.argmax(dim=-1)
        else:
            dist = torch.distributions.Categorical(probs)
            action = dist.sample()
        
        log_prob = torch.log(probs.gather(-1, action.unsqueeze(-1)))
        return action, log_prob.squeeze(-1), value.squeeze(-1)
    
    def get_value(self, state):
        """Get state value estimate."""
        _, value = self.forward(state)
        return value.squeeze(-1)
    
    def count_parameters(self):
        """Count total parameters."""
        return sum(p.numel() for p in self.parameters())

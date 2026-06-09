"""
DelveNet neural network architecture for DELVE RL bot.
CNN + GRU + MLP actor-critic for spatial-temporal reasoning.
"""

import torch
import torch.nn as nn

from config import STATE_DIM, ACTION_DIM, HIDDEN_DIM


class SpatialCNN(nn.Module):
    """CNN that processes 8x8 local map around the player."""
    
    def __init__(self, in_channels=6, out_dim=128):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_channels, 16, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(16, 32, 3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d(4),
        )
        self.fc = nn.Sequential(
            nn.Linear(32 * 4 * 4, out_dim),
            nn.ReLU(),
        )
    
    def forward(self, x):
        """x: (batch, channels, 8, 8) -> (batch, out_dim)"""
        return self.fc(self.conv(x).flatten(1))


class DelveNet(nn.Module):
    """
    Actor-Critic network for DELVE.

    Architecture:
        Flat features (state_dim) + CNN(8x8 local map, 6 channels) -> 128 dims
        Concat -> GRU(state_dim+128, hidden_dim) -> hidden state
        Policy Head: hidden_dim -> 64 -> action_dim
        Value Head:  hidden_dim -> 64 -> 1
    """

    GRU_HIDDEN = 256

    def __init__(self, state_dim=STATE_DIM, action_dim=ACTION_DIM, hidden_dim=HIDDEN_DIM):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.action_dim = action_dim
        
        # CNN for local map
        self.cnn = SpatialCNN(in_channels=6, out_dim=128)
        
        # GRU for temporal context
        self.gru = nn.GRU(input_size=state_dim + 128, hidden_size=hidden_dim, batch_first=True)
        
        # Policy head
        self.policy = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Linear(64, action_dim),
        )
        
        # Value head
        self.value = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
        )
    
    def forward(self, state, map_tensor, action_mask=None, hidden=None, seq_len=1):
        """
        Args:
            state: (batch * seq_len, state_dim) flat features
            map_tensor: (batch * seq_len, 6, 8, 8) local map
            action_mask: optional (batch * seq_len, action_dim) bool
            hidden: optional (1, batch, hidden_dim) GRU hidden state
            seq_len: sequence length for BPTT unrolling
        
        Returns:
            logits, value, hidden
        """
        cnn_features = self.cnn(map_tensor)  # (batch*seq_len, 128)
        combined = torch.cat([state, cnn_features], dim=-1)  # (batch*seq_len, state_dim+128)
        
        batch_size = combined.shape[0] // seq_len
        
        # Reshape to (batch, seq_len, features)
        combined_seq = combined.view(batch_size, seq_len, -1)
        
        if hidden is None:
            gru_out, hidden = self.gru(combined_seq)
        else:
            gru_out, hidden = self.gru(combined_seq, hidden)
            
        gru_out = gru_out.contiguous().view(batch_size * seq_len, -1)  # (batch*seq_len, hidden_dim)
        
        logits = self.policy(gru_out)
        value = self.value(gru_out)
        
        if action_mask is not None:
            logits = logits.masked_fill(~action_mask, -1e9)
        
        return logits, value, hidden
    
    def get_action(self, state, map_tensor, action_mask=None, hidden=None, deterministic=False):
        logits, value, hidden = self.forward(state, map_tensor, action_mask, hidden)
        dist = torch.distributions.Categorical(logits=logits)
        
        if deterministic:
            action = logits.argmax(dim=-1)
        else:
            action = dist.sample()
        
        log_prob = dist.log_prob(action)
        return action, log_prob, value.squeeze(-1), hidden
    
    def get_value(self, state, map_tensor, hidden=None):
        _, value, _ = self.forward(state, map_tensor, hidden=hidden)
        return value.squeeze(-1)
    
    def count_parameters(self):
        return sum(p.numel() for p in self.parameters())

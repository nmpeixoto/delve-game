"""
DelveNet neural network architecture for DELVE RL bot.
CNN + GRU + MLP actor-critic for spatial-temporal reasoning.
"""

import torch
import torch.nn as nn

from config import STATE_DIM, ACTION_DIM, HIDDEN_DIM


class SpatialCNN(nn.Module):
    """
    Processes the local map (21 channels, 16x16 grid) around the player.
    Channels include walls, fog, enemies (HP/ATK/DEF/Dodge/Revive/Enrage/Regen/Vamp/Freeze), 
    items, traps, etc.
    """
    def __init__(
        self,
        in_channels=21,
        out_dim=128,
        channels=(32, 32),
        pool_size=4,
        pool_kind="avg",
    ):
        super().__init__()
        if pool_kind not in ("avg", "max"):
            raise ValueError("pool_kind must be 'avg' or 'max'")
        conv_layers = []
        prev_channels = in_channels
        for channel_count in channels:
            conv_layers.extend([
                nn.Conv2d(prev_channels, channel_count, 3, padding=1),
                nn.ReLU(),
            ])
            prev_channels = channel_count
        pool = (
            nn.AdaptiveAvgPool2d(pool_size)
            if pool_kind == "avg"
            else nn.AdaptiveMaxPool2d(pool_size)
        )
        conv_layers.append(pool)
        self.conv = nn.Sequential(*conv_layers)
        self.fc = nn.Sequential(
            nn.Linear(prev_channels * pool_size * pool_size, out_dim),
            nn.ReLU(),
        )
    
    def forward(self, x):
        """x: (batch, channels, 16, 16) -> (batch, out_dim)"""
        return self.fc(self.conv(x).flatten(1))


class DelveNet(nn.Module):
    """
    Actor-Critic network for DELVE.

    Architecture:
        Flat features (state_dim) + CNN(16x16 local map, 14 channels) -> 128 dims
        Concat -> GRU(state_dim+128, hidden_dim) -> hidden state
        Policy Head: hidden_dim -> 64 -> action_dim
        Value Head:  hidden_dim -> 64 -> 1
    """

    def __init__(
        self,
        state_dim=STATE_DIM,
        action_dim=ACTION_DIM,
        hidden_dim=HIDDEN_DIM,
        cnn_out_dim=128,
        cnn_channels=(32, 32),
        cnn_pool_size=4,
        cnn_pool_kind="avg",
        head_hidden_dim=64,
    ):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.action_dim = action_dim
        self.cnn_out_dim = cnn_out_dim
        self.head_hidden_dim = head_hidden_dim
        
        # CNN for local map
        self.cnn = SpatialCNN(
            in_channels=21,
            out_dim=cnn_out_dim,
            channels=cnn_channels,
            pool_size=cnn_pool_size,
            pool_kind=cnn_pool_kind,
        )
        
        # GRU for temporal context
        self.gru = nn.GRU(input_size=state_dim + cnn_out_dim, hidden_size=hidden_dim, batch_first=True)
        
        # Policy head
        self.policy = nn.Sequential(
            nn.Linear(hidden_dim, head_hidden_dim),
            nn.ReLU(),
            nn.Linear(head_hidden_dim, action_dim),
        )
        
        # Value head
        self.value = nn.Sequential(
            nn.Linear(hidden_dim, head_hidden_dim),
            nn.ReLU(),
            nn.Linear(head_hidden_dim, 1),
        )
    
    def forward(self, state, map_tensor, action_mask=None, hidden=None, seq_len=1, dones=None):
        """
        Args:
            state: (batch * seq_len, state_dim) flat features
            map_tensor: (batch * seq_len, 14, 16, 16) local map
            action_mask: optional (batch * seq_len, action_dim) bool
            hidden: optional (1, batch, hidden_dim) GRU hidden state
            seq_len: sequence length for BPTT unrolling
            dones: optional (batch * seq_len) boolean tensor to mask hidden state
        
        Returns:
            logits, value, hidden
        """
        cnn_features = self.cnn(map_tensor)  # (batch*seq_len, 128)
        combined = torch.cat([state, cnn_features], dim=-1)  # (batch*seq_len, state_dim+128)
        
        batch_size = combined.shape[0] // seq_len
        
        # Reshape to (batch, seq_len, features)
        combined_seq = combined.view(batch_size, seq_len, -1)
        
        if hidden is None:
            hidden = torch.zeros(1, batch_size, self.hidden_dim, device=state.device)
            
        if dones is not None:
            # Step-by-step unrolling to prevent cross-episode bleed
            dones_seq = dones.view(batch_size, seq_len)
            outputs = []
            h = hidden
            for t in range(seq_len):
                x_t = combined_seq[:, t:t+1, :]
                out_t, h = self.gru(x_t, h)
                # If episode ended at t, reset hidden state for t+1
                d_t = dones_seq[:, t:t+1]  # (batch, 1)
                h = h.masked_fill(d_t.unsqueeze(0), 0.0)
                outputs.append(out_t)
            gru_out = torch.cat(outputs, dim=1)
            hidden = h
        else:
            # Fast path for inference (seq_len=1, no dones needed)
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

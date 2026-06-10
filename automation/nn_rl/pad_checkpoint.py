import argparse
import torch

def pad_checkpoint(input_path, output_path, added_features=8):
    print(f"Loading checkpoint: {input_path}")
    checkpoint = torch.load(input_path, map_location='cpu')
    
    state_dict = checkpoint.get('model_state_dict', checkpoint)
    padded_keys = []
    
    # In DelveNet, the first layer that touches the flat state vector is the GRU.
    # self.gru = nn.GRU(input_size=state_dim + 128, ...)
    # The input state is concatenated as [flat_state, cnn_features].
    # flat_state was size 370 (28 base + 342 shop).
    # We inserted 8 new features after the 28 base features.
    
    for key in list(state_dict.keys()):
        tensor = state_dict[key]
        
        # We only need to pad the input-hidden weights of the GRU
        if 'gru.weight_ih_l0' in key:
            print(f"Padding layer weights: {key} (Old Shape: {tensor.shape})")
            out_features, in_features = tensor.shape
            
            # The GRU weight_ih_l0 has shape (3 * hidden_size, input_size)
            # Old input_size = 370 (old state) + 128 (cnn) = 498
            # We want to insert 8 columns at index 28 (after the 28 base features).
            
            zero_pad = torch.zeros((out_features, added_features), dtype=tensor.dtype, device=tensor.device)
            
            base_slice = tensor[:, :28]
            shop_and_cnn_slice = tensor[:, 28:]
            
            new_tensor = torch.cat([base_slice, zero_pad, shop_and_cnn_slice], dim=1)
            state_dict[key] = new_tensor
            print(f"  New shape: {new_tensor.shape}")
            padded_keys.append(key)
                
    if not padded_keys:
        print("Warning: Could not automatically find the GRU input layer to pad! Check your network architecture keys.")
        print("Available keys:", list(state_dict.keys()))
    else:
        print("Successfully padded state dict.")
        
    if 'optimizer_state_dict' in checkpoint:
        print("Removing optimizer state dict to prevent shape mismatch in Adam momentum buffers...")
        del checkpoint['optimizer_state_dict']
        
    torch.save(checkpoint, output_path)
    print(f"Saved padded checkpoint to: {output_path}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Pad a PPO checkpoint for new state features")
    parser.add_argument('input', help='Path to old checkpoint (e.g., delve_ppo_187564032.pt)')
    parser.add_argument('output', help='Path to save padded checkpoint')
    parser.add_argument('--added', type=int, default=8, help='Number of new features added')
    
    args = parser.parse_args()
    pad_checkpoint(args.input, args.output, args.added)

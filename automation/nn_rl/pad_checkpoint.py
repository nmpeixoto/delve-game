import argparse
import torch

def pad_checkpoint(input_path, output_path, added_features=5):
    print(f"Loading checkpoint: {input_path}")
    checkpoint = torch.load(input_path, map_location='cpu')
    
    state_dict = checkpoint.get('network', checkpoint)
    padded_keys = []
    
    # Pad network weights
    for key in list(state_dict.keys()):
        tensor = state_dict[key]
        if 'gru.weight_ih_l0' in key:
            print(f"Padding layer weights: {key} (Old Shape: {tensor.shape})")
            out_features, in_features = tensor.shape
            zero_pad = torch.zeros((out_features, added_features), dtype=tensor.dtype, device=tensor.device)
            base_slice = tensor[:, :406]
            shop_and_cnn_slice = tensor[:, 406:]
            new_tensor = torch.cat([base_slice, zero_pad, shop_and_cnn_slice], dim=1)
            state_dict[key] = new_tensor
            print(f"  New shape: {new_tensor.shape}")
            padded_keys.append(key)
                
    if not padded_keys:
        print("Warning: Could not automatically find the GRU input layer to pad! Check your network architecture keys.")
    else:
        print("Successfully padded state dict.")
        
    # Pad optimizer state to avoid resetting Adam momentum
    if 'optimizer' in checkpoint:
        opt_state = checkpoint['optimizer'].get('state', {})
        padded_opt_tensors = 0
        for param_id, state_vars in opt_state.items():
            for var_name in ['exp_avg', 'exp_avg_sq']:
                if var_name in state_vars:
                    tensor = state_vars[var_name]
                    # Check if this tensor matches the exact shape of our unpadded gru.weight_ih_l0
                    if tensor.shape == (1152, 662):
                        print(f"Padding optimizer state '{var_name}' for param {param_id}")
                        out_features, in_features = tensor.shape
                        zero_pad = torch.zeros((out_features, added_features), dtype=tensor.dtype, device=tensor.device)
                        base_slice = tensor[:, :406]
                        shop_and_cnn_slice = tensor[:, 406:]
                        new_tensor = torch.cat([base_slice, zero_pad, shop_and_cnn_slice], dim=1)
                        state_vars[var_name] = new_tensor
                        padded_opt_tensors += 1
                        print(f"  New {var_name} shape: {new_tensor.shape}")
        
        if padded_opt_tensors > 0:
            print(f"Successfully padded {padded_opt_tensors} optimizer state tensors.")
        else:
            print("Warning: Found optimizer state but no matching tensors to pad.")
    else:
        print("No optimizer state found in checkpoint.")
        
    torch.save(checkpoint, output_path)
    print(f"Saved padded checkpoint to: {output_path}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Pad a PPO checkpoint for new state features")
    parser.add_argument('input', help='Path to old checkpoint')
    parser.add_argument('output', help='Path to save padded checkpoint')
    parser.add_argument('--added', type=int, default=5, help='Number of new features added')
    
    args = parser.parse_args()
    pad_checkpoint(args.input, args.output, args.added)

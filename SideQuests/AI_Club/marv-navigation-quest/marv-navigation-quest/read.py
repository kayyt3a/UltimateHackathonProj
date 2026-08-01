import torch

data = torch.load("damaged_model_state_dict.pt", map_location="cpu", weights_only=True)

print(f"{'Key':30s} {'Shape':20s} {'Dtype':10s} {'Params':>10s}")
print("-" * 75)

total_params = 0
for k, v in data.items():
    if torch.is_tensor(v):
        n = v.numel()
        total_params += n
        print(f"{k:30s} {str(tuple(v.shape)):20s} {str(v.dtype):10s} {n:>10,}")
    else:
        print(f"{k:30s} -> non-tensor: {type(v)}")

print("-" * 75)
print(f"Total parameters: {total_params:,}")
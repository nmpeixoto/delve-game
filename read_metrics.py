import json

lines = open('runs/delve_ppo/metrics.jsonl').readlines()
reports = [json.loads(line) for line in lines if '"train_report"' in line]

for d in reports[-40:]:
    print(f"Steps: {d['total_steps']} Floor: {d['avg_floor']} Win: {d['win_rate']} Reward: {d['avg_reward']:.2f} Death: {d['death_rate']} TO: {d['timeout_rate']}")

with open('automation/nn_rl/game_engine.py', 'r', encoding='utf-8') as f:
    text = f.read()

lines = text.split('\n')
new_lines = []
for line in lines:
    if "if hasattr(self, 'map_np'):" in line:
        continue
    new_lines.append(line)

with open('automation/nn_rl/game_engine.py', 'w', encoding='utf-8') as f:
    f.write('\n'.join(new_lines))

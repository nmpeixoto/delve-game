import re

with open('automation/nn_rl/game_engine.py', 'r', encoding='utf-8') as f:
    text = f.read()

def replacer(m):
    original = m.group(0)
    a = m.group(1).strip()
    b = m.group(2).strip()
    val = m.group(3).strip()
    indent = m.group('indent')
    return f"{original}\n{indent}if hasattr(self, 'map_np'): self.map_np[{a}, {b}] = {val}"

text = re.sub(r'(?P<indent>[ \t]+)self\.map\[([^\]]+)\]\[([^\]]+)\]\s*=\s*(.*)', replacer, text)

with open('automation/nn_rl/game_engine.py', 'w', encoding='utf-8') as f:
    f.write(text)
print('Done patching self.map mutations!')

import json
import matplotlib.pyplot as plt
import matplotlib.patches as patches

with open('vsl_scene_example.json') as f:
    data = json.load(f)

fig, ax = plt.subplots()
canvas = data['canvas']
ax.set_xlim(0, canvas['width'])
ax.set_ylim(0, canvas['height'])
ax.set_facecolor(canvas.get('background', 'white'))

for obj in data['objects']:
    if obj['type'] == 'rectangle':
        pos = obj['position']
        size = obj['size']
        fill = obj.get('fill', 'gray')
        rect = patches.Rectangle((pos['x'], pos['y']),
                                 size['width'], size['height'],
                                 linewidth=1,
                                 edgecolor='black' if obj.get('stroke') else 'none',
                                 facecolor=fill)
        ax.add_patch(rect)

plt.gca().invert_yaxis()
plt.axis('off')
plt.show()

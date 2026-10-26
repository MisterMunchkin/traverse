"""Render README figures from the checked-in study aggregates (requires Matplotlib)."""
from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from matplotlib.ticker import FuncFormatter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/assets'
OUT.mkdir(exist_ok=True)
study = json.loads((ROOT / 'docs/research/results.json').read_text())['studies']['browser-fresh']
sol, assisted = study['arms']['sol'], study['arms']['sol-tev1']
INK, MUTED, PAPER, GRID, ORANGE, TEAL = '#242923', '#5a625b', '#faf9f5', '#dddfd6', '#bd4e2b', '#16756a'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'text.color': INK,
                     'axes.labelcolor': MUTED, 'xtick.color': MUTED, 'ytick.color': INK,
                     'svg.fonttype': 'none'})

fig = plt.figure(figsize=(10, 9.2), facecolor=PAPER)
fig.text(.07, .95, 'LESS FRONTIER WORK. FASTER MATCHED DRIVING.', size=14, weight='bold')
fig.text(.07, .915, 'Browser fixture study · same Sol 6.1 / medium · 12 tasks × 2 repeats × 2 arms', color=MUTED, size=10)
fig.text(.07, .865, f'Completed attempts: Sol {sol["completed"]}/{sol["planned"]}     ·     Sol + tev1 {assisted["completed"]}/{assisted["planned"]}', size=12, weight='bold')
panels = [
    ('Driving time', f'{study["paired"]["both"]} matched completions; seconds', study['paired']['solMs'] / 1000, study['paired']['assistedMs'] / 1000, lambda x: f'{x:,.2f} s'),
    ('Frontier input tokens', f'All {study["retained"]} attempts; tokens', sol['frontierInput'], assisted['frontierInput'], lambda x: f'{x:,.0f}'),
    ('Frontier requests', f'All {study["retained"]} attempts; requests', sol['frontierCalls'], assisted['frontierCalls'], lambda x: f'{x:,.0f}'),
]
for i, (title, scope, control, local, label) in enumerate(panels):
    y = .635 - i * .215
    ax = fig.add_axes([.23, y, .61, .125], facecolor=PAPER)
    ax.barh([1, 0], [control, local], color=[ORANGE, TEAL], height=.43, zorder=3)
    ax.set_yticks([1, 0], ['Sol alone', 'Sol + tev1'])
    ax.set_xlim(0, control * 1.22)
    ax.tick_params(axis='both', length=0, pad=8, labelsize=10)
    ax.xaxis.set_major_locator(plt.MaxNLocator(4))
    ax.xaxis.set_major_formatter(FuncFormatter(lambda x, _, scale=control: f'{x/1e6:g}M' if scale > 1e6 and x else f'{x:g}'))
    ax.grid(axis='x', color=GRID, linewidth=.7, zorder=0)
    for spine in ax.spines.values():
        spine.set_visible(False)
    for row, value in [(1, control), (0, local)]:
        ax.text(value + control * .025, row, label(value), va='center', size=11, weight='bold')
    fig.text(.07, y + .153, title, size=13, weight='bold')
    fig.text(.39, y + .153, scope, size=10, color=MUTED)
fig.text(.07, .105, f'{100 * (1 - study["paired"]["assistedMs"] / study["paired"]["solMs"]):.1f}% less matched driving time · {100 * (1 - assisted["frontierInput"] / sol["frontierInput"]):.1f}% fewer frontier input tokens', size=12, weight='bold', color=TEAL)
fig.text(.07, .065, 'Driving excludes startup/preparation. One control startup timeout remains a failed attempt.', size=9, color=MUTED)
fig.text(.07, .04, 'Small synthetic study; no causal reliability claim. Dollar charges and local compute cost were not measured.', size=9, color=MUTED)
fig.savefig(OUT / 'browser-results.png', dpi=200, facecolor=PAPER)
plt.close(fig)

fig, ax = plt.subplots(figsize=(11, 5.5), facecolor=PAPER)
fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
ax.set(xlim=(0, 1100), ylim=(0, 550)); ax.axis('off')
ax.text(55, 495, 'A MAP FOR THE AGENT. A LOOP FOR THE UI.', size=17, weight='bold')
ax.text(55, 463, 'Conceptual local-first flow · frontier-only control is also available', size=11, color=MUTED)

def box(x, y, w, h, title, detail, color=INK):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle='round,pad=0,rounding_size=12', linewidth=1.2, edgecolor=color, facecolor='white', zorder=2))
    ax.text(x + 15, y + h - 28, title, size=12, weight='bold', color=color, zorder=3)
    ax.text(x + 15, y + 18, detail, size=10, color=MUTED, zorder=3)

def arrow(start, end, color=MUTED, bend=0):
    ax.add_patch(FancyArrowPatch(start, end, arrowstyle='-|>', mutation_scale=12, color=color,
                                connectionstyle=f'arc3,rad={bend}', linewidth=1.4, zorder=1))

box(55, 330, 185, 78, 'Project source', 'Routes + evidence')
box(290, 330, 215, 78, 'Reviewed graph', 'Static; uncertainty retained')
arrow((240, 369), (290, 369))
box(55, 182, 215, 84, 'Goal + fresh UI', 'Current offered actions')
box(345, 182, 160, 84, 'tev1', 'Local choice', TEAL)
box(640, 182, 180, 84, 'agent-device', 'Act on the live UI')
box(870, 182, 180, 84, 'Observe + verify', 'Expected UI state')
box(345, 55, 215, 78, 'Codex / Claude', 'Uncertain local choice', ORANGE)
arrow((270, 224), (345, 224))
arrow((400, 330), (425, 266))
arrow((505, 224), (640, 224), TEAL)
ax.text(530, 241, 'selected', size=10, color=TEAL)
arrow((425, 182), (425, 133), ORANGE)
arrow((560, 94), (730, 182), ORANGE)
arrow((820, 224), (870, 224))
ax.plot([960, 960, 265, 265, 160], [266, 430, 430, 286, 286], color=MUTED, linewidth=1.3, zorder=1)
arrow((160, 286), (160, 266))
ax.text(580, 442, 'Observe again after each action', size=10, color=MUTED)
ax.text(640, 108, 'Source routes do not prove visibility.', size=10, color=MUTED)
ax.text(640, 86, 'UI assertions do not prove backend effects.', size=10, color=MUTED)
ax.text(55, 18, 'Prototype: Expo Router extraction supported; packaged native driving still needs end-to-end validation.', size=10, color=MUTED)
fig.savefig(OUT / 'traverse-overview.png', dpi=200, facecolor=PAPER)
plt.close(fig)
print(json.dumps({'figures': ['docs/assets/browser-results.png', 'docs/assets/traverse-overview.png'],
                  'data': 'docs/research/results.json', 'evidenceId': study['evidenceId'], 'matplotlib': matplotlib.__version__}))

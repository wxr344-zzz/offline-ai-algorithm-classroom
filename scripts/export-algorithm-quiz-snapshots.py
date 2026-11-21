"""Export deterministic, maintained algorithm examples for theory-only quizzes.

No generated source is executed. Regenerate when maintained executors change.
"""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from exam_simulator import catalog, run_trace

rows = []
for entry in catalog():
    trace = run_trace(entry['id'])
    if trace.get('verified') is not True:
        raise ValueError(f"Unverified maintained example: {entry['id']}")
    frames = trace['frames']
    # The initial frame only repeats the given input; ask about states the
    # learner reaches by executing the algorithm, as numbered in the simulator.
    last = len(frames) - 1
    selected = sorted({i for i in (len(frames) // 3, (2 * len(frames)) // 3, last) if i > 0} or {last})
    rows.append({
        'id': entry['id'], 'title': entry['title'], 'aliases': entry['aliases'],
        'input': trace['input'], 'outcome': trace['outcome'],
        'frames': [{'index': frames[i]['index'], 'label': frames[i]['label'], 'state': frames[i]['state'],
                    'views': frames[i]['views']} for i in selected],
    })
target = ROOT / 'lib/server/generation/steps/algorithm-quiz-snapshots.generated.json'
target.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'algorithms': len(rows), 'bytes': target.stat().st_size}))

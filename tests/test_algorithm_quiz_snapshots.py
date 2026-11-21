"""Published offline quiz examples must equal today's maintained executions."""
import json
from pathlib import Path
import pytest
from exam_simulator import catalog, run_trace

ROWS = json.loads((Path(__file__).resolve().parents[1] / 'lib/server/generation/steps/algorithm-quiz-snapshots.generated.json').read_text(encoding='utf-8'))

def test_every_maintained_algorithm_has_an_offline_quiz_example():
    assert {row['id'] for row in ROWS} == {row['id'] for row in catalog()}
    assert len(ROWS) == len({row['id'] for row in ROWS})

@pytest.mark.parametrize('row', ROWS, ids=lambda row: row['id'])
def test_offline_quiz_values_are_real_execution_snapshots(row):
    trace = run_trace(row['id'])
    assert trace['verified'] is True
    assert row['input'] == trace['input']
    assert row['outcome'] == trace['outcome']
    for frame in row['frames']:
        assert frame['state'] == trace['frames'][frame['index']]['state']
        assert frame['views'] == trace['frames'][frame['index']]['views']
        assert frame['label'] == trace['frames'][frame['index']]['label']

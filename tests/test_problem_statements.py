import asyncio
from copy import deepcopy
import json
from pathlib import Path
import pytest
from lab_contracts import LabDraft, FinalOutput
from lab_assembly import normalize_generated_draft
from problem_statements import review_problem_statements
from test_agent_workflow import lab_draft_payload


def test_rejects_boolean_reducer_compared_to_infinity_without_running_source():
    value = lab_draft_payload()
    value['reference_solution'] = "class Solution:\n    def solve(self, numbers: list[int]) -> int:\n        return sum(numbers) if all(numbers) != float('inf') else -1\n"
    with pytest.raises(ValueError, match='all/any'):
        normalize_generated_draft(LabDraft.model_validate(value))


def test_rejects_boolean_truthiness_of_numeric_sentinel_table():
    value = lab_draft_payload()
    value['reference_solution'] = "class Solution:\n    def solve(self, numbers: list[int]) -> int:\n        dist = [float('inf')] * len(numbers)\n        return 1 if all(dist) else 0\n"
    with pytest.raises(ValueError, match='哨兵数值表'):
        normalize_generated_draft(LabDraft.model_validate(value))


def test_statement_review_keeps_assessments_and_renders_exact_examples(monkeypatch):
    fixture = json.loads((Path(__file__).parent / 'fixtures/eduplus-generated.json').read_text(encoding='utf-8'))
    original = fixture['privateOutput']
    before = deepcopy(original)
    normalized_before = FinalOutput.model_validate(before).model_dump(mode='json')
    class Provider:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def generate(self, prompt, **kwargs):
            data = json.loads(prompt)
            assert 'reference' in data and 'publicExamples' in data
            return json.dumps({'title': '库存统计', 'context': '统计库存。', 'task': '返回指定统计量。',
                'input_explanation': '读取输入。', 'output_explanation': '输出计算结果。', 'constraints': ['允许空输入']})
    monkeypatch.setattr('problem_statements.OllamaProvider', Provider)
    result = asyncio.run(review_problem_statements(original))
    assert original == before
    for name in ('reference_solution', 'pytest_source', 'hidden_test_cases'):
        assert result['problem'][name] == normalized_before['problem'][name]
    assert result['problem']['guided_scene']['problem']['title'] == '库存统计'
    assert '示例 1' in result['problem']['guided_scene']['problem']['instructions']
    assert '返回类型' in result['problem']['guided_scene']['problem']['instructions']

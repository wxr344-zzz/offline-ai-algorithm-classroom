"""Shape-based adaptation is independent of algorithm names; no generated code is executed."""
import ast
import asyncio
import json
import pytest
from agent_workflow import parse_generation_draft, assemble_with_case_repair
from lab_assembly import assemble_lab
from lab_contracts import LabDraft
from test_agent_workflow import lab_draft_payload


@pytest.mark.parametrize('value', [[[1, 2], [2], []], {'0': [1], '1': [0]}, [[1, 0], [0, 1]]])
def test_complex_inputs_are_encoded_and_decoded_by_trusted_wrapper(value):
    payload = lab_draft_payload()
    payload.pop('scaffold_code'); payload.pop('reference_solution')
    payload['implementation'] = {'parameters': [{'name': 'data', 'type': 'list[int]'}],
                                 'return_type': 'int', 'body': 'return len(data)'}
    for case in payload['public_test_cases'] + payload['hidden_test_cases']:
        case['inputs'] = {'data': value}
        case['expected'] = len(value)
    draft = parse_generation_draft(payload)
    lab, problem = assemble_lab(draft, 'test-course')
    assert problem.guided_scene.problem.entry_point.parameters[0].type == 'str'
    assert json.loads(draft.public_test_cases[0].inputs['data']) == value
    assert 'loads(data)' in ast.unparse(ast.parse(lab.reference_solution))
    assert 'JSON 字符串' in draft.instructions
    assert 'loads' not in draft.scaffold_code


def test_case_only_repair_uses_the_exact_signature_schema():
    payload = lab_draft_payload()
    payload['public_test_cases'][0]['inputs']['numbers'] = 'wrong-type'
    draft = LabDraft.model_validate(payload)
    calls = []
    class Provider:
        async def generate(self, prompt, **kwargs):
            schema = kwargs['schema']
            calls.append((prompt, schema.model_json_schema()))
            original = lab_draft_payload()
            return json.dumps({key: [{k: v for k, v in case.items() if k != 'caseId'}
                                     for case in original[source]]
                               for key, source in [('public', 'public_test_cases'), ('hidden', 'hidden_test_cases')]})
    lab, _ = asyncio.run(assemble_with_case_repair(Provider(), draft, 'test-course'))
    assert len(calls) == 1
    assert 'inputs.numbers' in calls[0][0]
    assert calls[0][1]['$defs']['TypedExampleInputs']['properties']['numbers']['type'] == 'array'
    assert draft.public_test_cases[0].inputs['numbers'] == [1, 2, 3]
    assert '# TODO' in lab.files['solution.py']


def test_nested_result_encodes_outer_returns_only():
    payload = lab_draft_payload()
    payload.pop('scaffold_code'); payload.pop('reference_solution')
    payload['implementation'] = {'parameters': [{'name': 'data', 'type': 'list[int]'}],
        'return_type': 'list[int]', 'body': 'def helper():\n    return data\nreturn [helper()]'}
    for case in payload['public_test_cases'] + payload['hidden_test_cases']:
        case['inputs'] = {'data': [1, 2]}
        case['expected'] = [[1, 2]]
    draft = parse_generation_draft(payload)
    _, problem = assemble_lab(draft, 'nested-result')
    assert problem.guided_scene.problem.entry_point.return_type == 'str'
    assert json.loads(draft.public_test_cases[0].expected) == [[1, 2]]
    tree = ast.parse(draft.reference_solution)
    solve = tree.body[0].body[0]
    assert isinstance(solve.body[0].body[0].value, ast.Name)
    assert isinstance(solve.body[1].value, ast.Call)


def test_serializing_the_same_answer_does_not_create_a_transfer_task():
    from agent_workflow import validate_transfer_examples
    from lab_assembly import normalize_generated_draft
    payload = lab_draft_payload()
    payload['reference_solution'] = 'class Solution:\n    def solve(self, numbers: list[int]) -> list[int]:\n        return numbers\n'
    for case in payload['public_test_cases'] + payload['hidden_test_cases']:
        case['expected'] = case['inputs']['numbers']
    guided = normalize_generated_draft(LabDraft.model_validate(payload))
    independent = guided.model_copy(deep=True)
    independent.reference_solution = 'class Solution:\n    def solve(self, numbers: list[int]) -> list[str]:\n        return list(map(str, numbers))\n'
    independent = normalize_generated_draft(independent)
    for case in independent.public_test_cases + independent.hidden_test_cases:
        case.expected = [str(item) for item in case.inputs['numbers']]
    with pytest.raises(ValueError, match='不能只换背景'):
        validate_transfer_examples(guided, independent)

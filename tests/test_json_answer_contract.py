import json
import sys
import types
import pytest
from lab_assembly import build_pytest_source, assemble_lab
from lab_contracts import TestCase as Case, PublicProblem
from lesson_execution import equivalent
from executable_lessons import known_contract, compile_drafts, ApplicationLabels


@pytest.mark.parametrize('actual,passed', [
    ('{ "label":"a ", "order":[1,true] }', True),
    ('{"order":[true,1],"label":"a "}', False),
    ('{"order":[1,1],"label":"a "}', False),
    ('{"order":[1,true],"label":"a"}', False),
    ('not JSON', False),
    ({'order':[1,True], 'label':'a '}, False),
])
def test_exported_json_assertions_are_strict_but_ignore_json_format(actual, passed, monkeypatch):
    module = types.ModuleType('solution')
    class Solution:
        def solve(self, data): return actual
    module.Solution = Solution
    monkeypatch.setitem(sys.modules, 'solution', module)
    expected='{"order":[1,true],"label":"a "}'
    source=build_pytest_source([Case(case_id='x', inputs={'data':'{}'}, expected=expected, description='Example')], 'json-value')
    scope={}
    # Only the trusted assertion compiler and test-owned stub execute here.
    exec(source, scope)
    if passed: scope['test_case_0']()
    else:
        with pytest.raises(AssertionError): scope['test_case_0']()


def test_acceptance_preserves_string_content_inside_json():
    assert equivalent('{"a":1,"b":true}', '{ "b":true, "a":1 }')
    assert not equivalent('{"a":true}', '{"a":1}')
    assert not equivalent('{"a":"x"}', '{"a":"x "}')


def test_stdio_export_uses_the_same_json_verifier_without_importing_solution():
    source=build_pytest_source([Case(case_id='x',inputs={'stdin':'{}'},expected='{"a":[1,true]}',description='Example')], 'json-value', stdio_runner=True)
    assert 'from solution import Solution' not in source
    scope={'_run': lambda stdin: '{ "a": [1, true] }'}
    exec(source,scope)
    scope['test_case_0']()
    scope['_run']=lambda stdin: '{ "a": [true,1] }'
    with pytest.raises(AssertionError): scope['test_case_0']()


def test_compiled_transport_can_declare_json_semantics_without_a_new_oracle():
    guide,_=compile_drafts(known_contract('insertion'),ApplicationLabels(location='中心',actor='管理员',record='任务',summary='distinct'))
    _,private=assemble_lab(guide,'json-contract-test',answer_check='json-value')
    assert private.guided_scene.problem.answer_check=='json-value'
    assert '_json_output_equal' in private.pytest_source


@pytest.mark.parametrize('invalid', ['not JSON', 'NaN', 'Infinity', 42])
def test_json_answer_authority_refuses_invalid_expected_data(invalid):
    guide,_=compile_drafts(known_contract('insertion'),ApplicationLabels(location='中心',actor='管理员',record='任务',summary='distinct'))
    _,private=assemble_lab(guide,'json-invalid-test',answer_check='json-value')
    payload=private.guided_scene.problem.model_dump(mode='json')
    payload['public_test_cases'][0]['expected']=invalid
    with pytest.raises(ValueError): PublicProblem.model_validate(payload)

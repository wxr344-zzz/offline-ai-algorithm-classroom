"""Fault injection into the shared repair path, not topic-specific fixtures."""
import asyncio
import json
from copy import deepcopy
import pytest
from agent_workflow import parse_repairable_draft,ImplementationBodyRepair,implementation_schema_for_plan
from test_agent_workflow import lab_draft_payload


def payload(topic):
    value=lab_draft_payload()
    value.pop('scaffold_code');value.pop('reference_solution')
    value['title']=topic
    value['implementation']={'parameters':[{'name':'numbers','type':'list[int]'}],
        'return_type':'int','body':'return 0'}
    return value


@pytest.mark.parametrize('topic',['链队列','归并排序','二分查找','图遍历','线段树','自定义算法'])
def test_invalid_body_is_repaired_without_regenerating_accepted_assets(topic):
    value=payload(topic);before=deepcopy(value);calls=[]
    class Provider:
        async def generate(self,prompt,**kwargs):
            data=json.loads(prompt);calls.append(data)
            assert kwargs['schema'] is ImplementationBodyRepair
            assert data['public_examples']==before['public_test_cases']
            return json.dumps({'body':'return sum(numbers)'})
    draft=asyncio.run(parse_repairable_draft(Provider(),value))
    assert value==before
    assert len(calls)==1
    assert draft.title==topic
    assert 'sum(numbers)' in draft.reference_solution
    assert [c.expected for c in draft.public_test_cases]==[c['expected'] for c in before['public_test_cases']]


def test_bad_repairs_remain_rejected_and_attempts_are_bounded():
    calls=[]
    class Provider:
        async def generate(self,*args,**kwargs):
            calls.append(1)
            return json.dumps({'body':'return 0'})
    with pytest.raises(ValueError,match='占位'):
        asyncio.run(parse_repairable_draft(Provider(),payload('任意主题')))
    assert len(calls)==3


def test_implicit_self_and_identical_duplicate_declarations_are_wrapper_noise():
    value=payload('接口格式修复')
    value['implementation']['body']='return sum(numbers)'
    value['implementation']['parameters']=[{'name':'self','type':'int'},
        {'name':'numbers','type':'list[int]'}, {'name':'numbers','type':'list[int]'}]
    before=deepcopy(value)
    class Provider:
        async def generate(self,*args,**kwargs):
            pytest.fail('valid body and unambiguous wrapper need no model call')
    draft=asyncio.run(parse_repairable_draft(Provider(),value))
    assert 'def solve(self, numbers: list[int])' in draft.reference_solution
    assert value==before


def test_connection_failure_is_not_misclassified_as_bad_generated_code():
    from ollama_provider import OllamaConnectionError
    class Provider:
        async def generate(self,*args,**kwargs):
            raise OllamaConnectionError('unavailable')
    with pytest.raises(OllamaConnectionError):
        asyncio.run(parse_repairable_draft(Provider(),payload('任意主题')))


def test_unused_scenario_constraint_repairs_only_implementation_not_plan_or_samples():
    from test_applied_task import scenario
    from applied_task import InputRole, DecisionEvidence
    value=payload('场景参数使用修复')
    value['implementation']['parameters'].append({'name':'budget','type':'int'})
    value['implementation']['body']='return sum(numbers)'
    for case in value['public_test_cases']+value['hidden_test_cases']:
        case['inputs']['budget']=10
    plan=scenario()
    plan.input_roles.append(InputRole(parameter='budget',meaning='本次最多允许核算的物资条数。'))
    plan.decision_evidence=DecisionEvidence(base_inputs={'numbers':[1,2]},variants=[
        {'constraint':0,'expected':0,'explanation':'没有核算额度时总数为零'},
        {'constraint':2,'expected':3,'explanation':'允许核算两条时总数为三'}])
    before=deepcopy(value);calls=[]
    class Provider:
        async def generate(self,prompt,**kwargs):
            data=json.loads(prompt);calls.append(data)
            assert data['approved_scenario']['decision_evidence']==plan.decision_evidence.model_dump(mode='json')
            assert data['public_examples']==before['public_test_cases']
            return json.dumps({'body':'return sum(numbers[:budget])'})
    draft=asyncio.run(parse_repairable_draft(Provider(),value,applied_plan=plan))
    assert 'numbers[:budget]' in draft.reference_solution
    assert len(calls)==1
    assert value==before


def test_implementation_schema_disallows_unplanned_parameter_names():
    from test_applied_task import scenario
    from pydantic import ValidationError
    schema=implementation_schema_for_plan(scenario(),{'numbers':'list[int]'})
    value=payload('参数约束')
    value['implementation']['parameters']={'invented':'list[int]'}
    with pytest.raises(ValidationError):
        schema.model_validate(value,strict=True)
    value['implementation']['parameters']={'numbers':'list[int]'}
    assert schema.model_validate(value,strict=True).implementation.parameters.numbers=='list[int]'
    value['implementation']['parameters']={'numbers':'str'}
    with pytest.raises(ValidationError):schema.model_validate(value,strict=True)
    value['implementation']['parameters']={'numbers':'list[int]'}
    value['public_test_cases'][0]['inputs']['numbers']='[1,2]'
    with pytest.raises(ValidationError):schema.model_validate(value,strict=True)


def test_planned_parameter_map_is_assembled_without_regenerating_or_changing_types():
    value=payload('任意主题')
    value['implementation']['parameters']={'numbers':'list[int]'}
    value['implementation']['body']='return sum(numbers)'
    class Provider:
        async def generate(self,*args,**kwargs):pytest.fail('No repair required')
    draft=asyncio.run(parse_repairable_draft(Provider(),value))
    assert 'numbers: list[int]' in draft.reference_solution


def test_unambiguous_constraint_alias_is_renamed_in_signature_body_and_cases_together():
    from test_applied_task import scenario
    from applied_task import InputRole, DecisionEvidence
    from pydantic import ValidationError
    plan=scenario()
    plan.input_roles.append(InputRole(parameter='scenario_limit',meaning='本次最多可以处理的记录数。'))
    plan.decision_evidence=DecisionEvidence(base_inputs={'numbers':[1,2]},variants=[
        {'constraint':0,'expected':0,'explanation':'零额度不处理任何记录'},
        {'constraint':2,'expected':3,'explanation':'两条额度可以处理全部记录'}])
    schema=implementation_schema_for_plan(plan,{'numbers':'list[int]'})
    value=payload('通用参数别名修复')
    value['implementation']['parameters'].append({'name':'max_length','type':'int'})
    value['implementation']['body']='return sum(numbers[:max_length])'
    for case in value['public_test_cases']+value['hidden_test_cases']:case['inputs']['max_length']=10
    before=deepcopy(value)
    result=schema.model_validate(value,strict=True).model_dump(mode='json')
    assert 'scenario_limit' in result['implementation']['parameters']
    assert 'numbers[:scenario_limit]' in result['implementation']['body']
    assert all(c['inputs']['scenario_limit']==10 and 'max_length' not in c['inputs'] for c in result['public_test_cases'])
    assert [c['expected'] for c in result['public_test_cases']]==[c['expected'] for c in value['public_test_cases']]
    assert value==before
    value['public_test_cases'][0]['inputs']['scenario_limit']=2
    with pytest.raises(ValidationError):schema.model_validate(value,strict=True)


def test_missing_constraint_pair_is_repaired_without_replacing_the_implementation():
    from agent_workflow import repair_scenario_examples
    from lab_contracts import LabDraft
    from test_applied_decisions import draft as independent_fixture
    guided=LabDraft.model_validate(lab_draft_payload())
    independent=independent_fixture()
    before=independent.model_dump()
    class Provider:
        async def generate(self,*args,**kwargs):
            return json.dumps({'base_inputs':{'numbers':[2,3]},'variants':[
                {'constraints':{'budget':2},'expected':[0],'description':'预算只够第一件'},
                {'constraints':{'budget':5},'expected':[0,1],'description':'预算恰好够两件'}]})
    repaired=asyncio.run(repair_scenario_examples(Provider(),guided,independent))
    assert repaired.reference_solution==independent.reference_solution
    assert independent.model_dump()==before
    assert [c.case_id for c in repaired.public_test_cases]==['public-1','public-2','public-3','public-4']
    assert repaired.public_test_cases[0].inputs['numbers']==repaired.public_test_cases[1].inputs['numbers']


def test_counterfactual_pair_contract_preserves_string_inputs_and_rejects_wrong_constraint_names():
    from agent_workflow import counterfactual_pair_schema
    from lab_contracts import LabDraft
    from pydantic import ValidationError
    guided=LabDraft.model_validate(lab_draft_payload())
    guided.reference_solution='class Solution:\n    def solve(self, text: str, pattern: str) -> int:\n        return text.find(pattern)\n'
    independent=guided.model_copy(deep=True)
    independent.reference_solution='class Solution:\n    def solve(self, text: str, pattern: str, limit: int) -> int:\n        return text.count(pattern) if limit > 0 else 0\n'
    schema=counterfactual_pair_schema(guided,independent)
    value={'base_inputs':{'text':'aaaa','pattern':'aa'},'variants':[
        {'constraints':{'limit':0},'expected':0,'description':'没有额度'},
        {'constraints':{'limit':1},'expected':2,'description':'允许处理'}]}
    parsed=schema.model_validate(value,strict=True)
    assert parsed.base_inputs.text=='aaaa'
    for bad in [ {'budget':1}, {'limit':'1'}, {'limit':True}, {'limit':1,'text':'changed'} ]:
        wrong=deepcopy(value);wrong['variants'][0]['constraints']=bad
        with pytest.raises(ValidationError):schema.model_validate(wrong,strict=True)

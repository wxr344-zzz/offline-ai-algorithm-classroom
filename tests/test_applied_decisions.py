import itertools
from copy import deepcopy
import pytest
from applied_decisions import compile_cost_selection
from applied_task import AppliedTask
from lab_contracts import LabDraft
from test_agent_workflow import lab_draft_payload


def plan():
    return AppliedTask(title='公司设备采购：预算内优先选择低价设备',
        setting='一家公司需要采购一批设备，经费有限，希望按照成本优先安排本次采购。',
        actor='你是负责本次设备采购的采购经理。',objective='在公司的预算以内选择成本较低的设备，返回它们的索引列表。',
        input_roles=[{'parameter':'numbers','meaning':'设备采购成本列表，每项表示一台设备的成本。'},{'parameter':'budget','meaning':'设备采购的总预算上限。'}],
        decision_rules=['采购成本总和不能超过总预算。','优先采购成本较低的设备。'],
        output_meaning='返回所采购设备的原始索引列表。',boundary_rules=['没有可以买的设备时返回空列表。'],transfer_difference='原题只计算数组总和，新题要结合预算作选择。')


def draft():
    value=lab_draft_payload()
    value['reference_solution']='class Solution:\n    def solve(self, numbers: list[int], budget: int) -> list[int]:\n        return sorted(numbers)\n'
    value['scaffold_code']=value['reference_solution'].replace('return sorted(numbers)','# TODO\n        raise NotImplementedError')
    samples=[([10,20,30,40,50],100),([50,40,30,20,10],100),([10,20,30,40,50],60),([],0),([0,0,2],0),([3,3],3),([9],2)]
    for case,(numbers,budget) in zip(value['public_test_cases']+value['hidden_test_cases'],samples):
        case['inputs']={'numbers':numbers,'budget':budget};case['expected']=[]
    return LabDraft.model_validate(value)


def test_cost_policy_fixes_exact_budget_and_uses_independent_subset_oracle():
    original=draft(); before=original.model_dump()
    fixed,task=compile_cost_selection(original,plan())
    assert original.model_dump()==before
    assert fixed.public_test_cases[0].expected==[0,1,2,3]
    assert fixed.public_test_cases[2].expected==[0,1,2]
    assert '恰好等于预算' in task.decision_rules[1]
    scope={}
    # Fixed developer-owned policy, never the model's original implementation.
    exec(fixed.reference_solution,scope)
    for case in fixed.public_test_cases+fixed.hidden_test_cases:
        data=case.inputs;values=data['numbers'];budget=data['budget']
        actual=scope['Solution']().solve(**data)
        largest=max(len(s) for n in range(len(values)+1) for s in itertools.combinations(range(len(values)),n) if sum(values[i] for i in s)<=budget)
        assert actual==case.expected
        assert len(actual)==largest
        assert sum(values[i] for i in actual)<=budget


def test_unrelated_policy_is_not_compiled():
    original=draft()
    unrelated=plan().model_copy(update={'output_meaning':'返回图的拓扑顺序列表。'})
    result,task=compile_cost_selection(original,unrelated)
    assert result is original
    assert task is unrelated


def test_cost_list_output_has_exact_total_budget_semantics_too():
    value=draft()
    fixed,task=compile_cost_selection(value,plan().model_copy(update={
        'decision_rules':['选择价格低于预算的设备。','优先选择性价比最高的设备。'],
        'output_meaning':'返回在总采购预算内选择的设备价格列表。'}))
    assert fixed.public_test_cases[0].expected==[10,20,30,40]
    assert fixed.public_test_cases[2].expected==[10,20,30]
    assert '尽可能多件' in task.objective
    assert '性价比' not in ' '.join(task.decision_rules)


def test_unqualified_procurement_budget_is_made_explicit_without_topic_routing():
    task=plan()
    task.input_roles[1].meaning='预算上限'
    task.decision_rules=['商品价格不能超过预算上限','优先选择价格较低的商品']
    task.output_meaning='返回采购商品的价格列表。'
    fixed,reviewed=compile_cost_selection(draft(),task)
    assert fixed.public_test_cases[0].expected==[10,20,30,40]
    assert '累计总预算' in reviewed.input_roles[1].meaning
    task.input_roles[1].meaning='单件商品的预算上限'
    unchanged,_=compile_cost_selection(draft(),task)
    assert 'return sorted(numbers)' in unchanged.reference_solution


def test_policy_constructs_a_real_constraint_pair_when_all_generated_budgets_buy_everything():
    value=draft()
    for case in value.public_test_cases+value.hidden_test_cases:
        case.inputs['budget']=1000
    fixed,_=compile_cost_selection(value,plan())
    left,right=fixed.public_test_cases[:2]
    assert left.inputs['numbers']==right.inputs['numbers']==[2,3]
    assert left.inputs['budget']==1 and right.inputs['budget']==5
    assert left.expected==[] and right.expected==[0,1]

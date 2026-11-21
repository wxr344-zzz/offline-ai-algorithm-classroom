import itertools
import pytest
from canonical_case_audit import audit_canonical_cases
from bst_assets import bst_guide
from lab_contracts import LabDraft
from test_agent_workflow import lab_draft_payload


@pytest.mark.parametrize('topic',['冒泡排序','快速排序','堆排序','直接插入排序','希尔排序','归并排序','选择排序','基数排序'])
def test_sorting_expected_values_are_recomputed_independently(topic):
    data=lab_draft_payload()
    data['instructions']='将全部整数按从小到大排序，返回排序后的整数列表。'
    data['reference_solution']='class Solution:\n    def solve(self, numbers: list[int]) -> list[int]:\n        return []\n'
    data['scaffold_code']=data['reference_solution']
    for case in data['public_test_cases']+data['hidden_test_cases']:
        case['inputs']={'numbers':[3,-1,3,0]};case['expected']=[999]
    draft=LabDraft.model_validate(data)
    fixed=audit_canonical_cases(draft,topic)
    assert all(c.expected==[-1,0,3,3] for c in fixed.public_test_cases+fixed.hidden_test_cases)
    assert draft.public_test_cases[0].expected==[999]


def test_bst_empty_and_repeated_keys_are_mathematically_consistent():
    draft=bst_guide('二叉排序树 BST')
    assert draft.public_test_cases[3].inputs=={'nums':[]}
    assert draft.public_test_cases[3].expected==[]
    scope={}
    # Developer-owned tree implementation only.
    exec(draft.reference_solution,scope)
    solve=scope['Solution']().solve
    for case in draft.public_test_cases+draft.hidden_test_cases:
        assert solve(**case.inputs)==case.expected
    for n in range(5):
        for values in itertools.product([-1,0,1],repeat=n):
            nums=list(values)
            expected=[f'插入 {v}' for v in nums]+[f'删除 {v}' for v in nums]+[f'查找 {v} 失败' for v in nums]
            assert solve(nums)==expected


def test_binary_search_disallows_unsorted_input_or_ambiguous_duplicate_labels():
    data=lab_draft_payload()
    data['instructions']='返回目标下标，未找到返回-1。'
    data['reference_solution']='class Solution:\n    def solve(self, numbers: list[int], target: int) -> int:\n        return -1\n'
    data['scaffold_code']=data['reference_solution']
    for case in data['public_test_cases']+data['hidden_test_cases']:
        case['inputs']={'numbers':[1,2,3], 'target':2};case['expected']=999
    draft=LabDraft.model_validate(data)
    fixed=audit_canonical_cases(draft,'折半查找')
    assert fixed.public_test_cases[0].expected==1
    draft.public_test_cases[0].inputs['numbers']=[2,1]
    with pytest.raises(ValueError,match='有序'):
        audit_canonical_cases(draft,'折半查找')
    draft.public_test_cases[0].inputs['numbers']=[2,2]
    with pytest.raises(ValueError,match='重复目标'):
        audit_canonical_cases(draft,'折半查找')

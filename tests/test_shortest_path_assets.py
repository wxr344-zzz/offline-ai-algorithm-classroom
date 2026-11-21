from copy import deepcopy
import pytest
from shortest_path_assets import shortest_distances, review_shortest_path_draft, is_shortest_path_topic
from lab_contracts import LabDraft
from lab_assembly import normalize_generated_draft
from test_agent_workflow import lab_draft_payload


def test_math_includes_actual_edge_weights_zero_edges_and_unreachable_nodes():
    assert shortest_distances(['0 1 4','1 2 2','2 3 1','3 4 1'],0) == [0,4,6,7,8]
    assert shortest_distances(['0 1 0 1 5','1 2 2','3'],0) == [0,0,2,-1]
    assert shortest_distances([],0) == [0]
    assert shortest_distances(['0 1 2','2'],2) == [-1,-1,0]


def test_repair_checks_every_case_without_mutating_input_or_executing_model_source():
    payload=lab_draft_payload()
    payload['reference_solution']='class Solution:\n    def solve(self, graph: list[str], start: int) -> list[int]:\n        return [0] * len(graph)\n'
    payload['scaffold_code']=payload['reference_solution']
    for case in payload['public_test_cases']+payload['hidden_test_cases']:
        case.update(inputs={'graph':['0 1 4','1 2 2'],'start':0},expected=[0,1,3])
    draft=LabDraft.model_validate(payload)
    before=deepcopy(draft.model_dump())
    fixed=review_shortest_path_draft(draft,'讲解迪杰斯特拉算法')
    assert draft.model_dump()==before
    assert all(c.expected==[0,4,6] for c in fixed.public_test_cases+fixed.hidden_test_cases)
    assert 'heapq' in fixed.reference_solution
    assert is_shortest_path_topic('Dijkstra')


@pytest.mark.parametrize('body', ['return 0', 'return [0] * len(numbers)'])
def test_rejects_constant_placeholder_implementations(body):
    value=lab_draft_payload()
    value['reference_solution']='class Solution:\n    def solve(self, numbers: list[int]) -> int:\n        '+body+'\n'
    with pytest.raises(ValueError,match='占位答案'):
        normalize_generated_draft(LabDraft.model_validate(value))

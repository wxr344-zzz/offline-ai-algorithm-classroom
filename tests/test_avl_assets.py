import asyncio
import itertools
import textwrap
import pytest
from avl_assets import AVL_HELPERS, avl_guide
from lab_assembly import assemble_lab
from quicksort_applications import compile_quicksort_application
from test_quicksort_applications import spec


def check_tree(node, low=None, high=None):
    if node is None:
        return 0
    assert low is None or low < node[0]
    assert high is None or node[0] < high
    left = check_tree(node[1], low, node[0])
    right = check_tree(node[2], node[0], high)
    assert abs(left-right) <= 1
    assert node[3] == 1+max(left,right)
    return node[3]


def test_every_insertion_preserves_height_order_and_balance():
    # Execute only the developer-owned kernel, never generated model source.
    scope = {}
    exec(textwrap.dedent(AVL_HELPERS), scope)
    for size in range(7):
        for values in itertools.permutations(range(size)):
            root = None
            for key in values:
                root = scope['insert'](root, key)
                check_tree(root)


def test_guide_checks_all_rotations_duplicates_and_empty():
    draft = avl_guide('请讲解平衡二叉树AVL算法')
    assemble_lab(draft, 'avl-test')
    scope = {}; exec(draft.reference_solution, scope)
    for case in draft.public_test_cases + draft.hidden_test_cases:
        assert scope['Solution']().solve(**case.inputs) == case.expected
    assert avl_guide('快速排序') is None
    assert avl_guide('AVL算法') is not None


def test_nested_definition_is_not_a_return_from_solve():
    from lab_assembly import normalize_generated_draft
    draft = avl_guide('AVL')
    draft.reference_solution = 'class Solution:\n    def solve(self, nums: list[int]) -> list[int]:\n        def implementation(nums):\n            return nums\n'
    with pytest.raises(ValueError, match='隐式返回 None'):
        normalize_generated_draft(draft)


@pytest.mark.parametrize('order', ['ascending', 'descending'])
@pytest.mark.parametrize('result', ['values', 'indices', 'total'])
def test_avl_application_variants_against_independent_stable_sort(order, result):
    draft = compile_quicksort_application(spec(order,result), avl_guide('AVL'), 'avl-tests', algorithm='avl')
    assemble_lab(draft, 'avl-tests')
    scope = {}; exec(draft.reference_solution, scope)
    assert 'rotate_left' in draft.reference_solution and 'rotate_right' in draft.reference_solution
    assert '快速排序' not in draft.instructions
    solve = scope['Solution']().solve
    for size in range(6):
        for values in itertools.product([-1,0,1], repeat=size):
            values = list(values)
            for quota in (0,1,2,size,size+2):
                indices = sorted(range(size), key=lambda i:((-values[i] if order=='descending' else values[i]),i))[:quota]
                expected = indices if result=='indices' else sum(values[i] for i in indices) if result=='total' else [values[i] for i in indices]
                assert solve(values, quota) == expected
    for case in draft.public_test_cases + draft.hidden_test_cases:
        assert solve(**case.inputs) == case.expected


def test_workflow_compiles_avl_and_keeps_generated_narrative(monkeypatch):
    from agent_workflow import LabAgent_Node, create_initial_state
    async def generate(self, prompt, **kwargs):
        assert 'AVL' in prompt
        assert kwargs['schema'].__name__ == 'QuicksortApplicationSpec'
        return spec('descending','indices').model_dump_json()
    monkeypatch.setattr('ollama_provider.OllamaProvider.generate',generate)
    state = create_initial_state('讲解AVL算法')
    state.update(current_topic='AVL算法',requires_lab=True,final_output={
        'course_id':'avl-compiled-test','topic':'AVL算法','requires_lab':True,
        'lesson_plan':{'title':'AVL','objectives':['掌握树旋转'],'knowledge_points':['AVL']},
        'common_mistakes':[],'lab':None,'problem':None})
    result = asyncio.run(LabAgent_Node(state))['final_output']
    source = result['problem']['oj_assessment']['reference_solution']
    assert 'rotate_left' in source and 'rotate_right' in source
    assert result['problem']['oj_scene']['problem']['execution_mode'] == 'stdio'

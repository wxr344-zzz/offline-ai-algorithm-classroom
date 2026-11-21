import itertools
from copy import deepcopy
import pytest
from applied_task import AppliedTask
from lab_contracts import LabDraft
from sorting_applications import compile_score_ranking
from test_agent_workflow import lab_draft_payload


def make_assets(indexed=False):
    payload = lab_draft_payload()
    payload['reference_solution'] = 'class Solution:\n    def solve(self, nums: list[int], limit: int) -> list[int]:\n        return []\n'
    payload['scaffold_code'] = payload['reference_solution'].replace('return []', '# TODO\n        raise NotImplementedError')
    for case in payload['public_test_cases'] + payload['hidden_test_cases']:
        case['inputs'] = {'nums': [85, 92, 78, 95, 88], 'limit': 2}
        case['expected'] = [85, 88]  # Actual reported new-generation hallucination.
    task = AppliedTask(title='校园竞赛：入选名单',
        setting='学校为本学期的校园编程竞赛整理选手成绩，需要生成决赛入选名单。',
        actor='负责竞赛入选名单的教务管理员', objective='按照参赛选手成绩排名，选出给定名额内的前几名选手。',
        input_roles=[{'parameter': 'nums', 'meaning': '选手分数列表'},
                     {'parameter': 'limit', 'meaning': '入选选手数量上限'}],
        decision_rules=['按分数确定前几名选手', '同分按选手原始顺序排列'],
        output_meaning='返回入选选手编号列表' if indexed else '返回入选选手分数列表',
        boundary_rules=['分数为整数'], transfer_difference='在排序之外增加入选名额')
    return LabDraft.model_validate(payload), task


@pytest.mark.parametrize('indexed', [False, True])
@pytest.mark.parametrize('topic,as_strings', [('冒泡排序算法',False),('堆排序',False),('BST 二叉排序树',True)])
def test_generated_ranking_answers_are_corrected_without_fixed_scene(indexed,topic,as_strings):
    draft, task = make_assets(indexed)
    if as_strings:
        draft.reference_solution=draft.reference_solution.replace('-> list[int]', '-> list[str]')
        draft.scaffold_code=draft.scaffold_code.replace('-> list[int]', '-> list[str]')
    before = deepcopy(draft.model_dump())
    fixed, plan = compile_score_ranking(topic, draft, task)
    first=[3,1] if indexed else [95,92]
    assert fixed.public_test_cases[0].expected == (list(map(str,first)) if as_strings else first)
    assert draft.model_dump() == before
    assert plan.setting == task.setting and plan.title == task.title
    assert fixed.difficulty == 'Medium'
    assert len({c.case_id for c in fixed.public_test_cases + fixed.hidden_test_cases}) == 11
    replayed, _ = compile_score_ranking(topic, fixed, plan)
    assert replayed.hidden_test_cases == fixed.hidden_test_cases
    assert '降序' in plan.decision_rules[0]
    assert '为空' in plan.boundary_rules[0]
    scope = {}
    # This source is produced by the developer-owned compiler, not the model.
    exec(fixed.reference_solution, scope)
    for length in range(5):
        for values in itertools.product([-1, 0, 1], repeat=length):
            for limit in range(7):
                order = sorted(range(length), key=lambda i: (-values[i], i))[:limit]
                expected = order if indexed else [values[i] for i in order]
                if as_strings: expected=list(map(str,expected))
                assert scope['Solution']().solve(list(values), limit) == expected
    for case in fixed.public_test_cases + fixed.hidden_test_cases:
        assert scope['Solution']().solve(**case.inputs) == case.expected


def test_other_algorithms_and_other_sorting_tasks_are_not_replaced_by_ranking():
    draft, task = make_assets()
    assert compile_score_ranking('01背包', draft, task) == (draft, task)
    grouped = task.model_copy(update={'objective': '按成绩进行区间分组并统计各组人数'})
    assert compile_score_ranking('冒泡排序', draft, grouped) == (draft, grouped)

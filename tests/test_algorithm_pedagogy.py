import asyncio
import pytest
from exam_simulator import catalog,run_trace
from exam_simulator.pedagogy import FACTS,lesson_plan,overview
from agent_workflow import TeacherAgent_Node,create_initial_state


@pytest.mark.parametrize('profile',catalog(),ids=lambda p:p['id'])
def test_all_known_algorithms_have_subject_matter_not_catalog_labels(profile):
    assert profile['id'] in FACTS
    plan=lesson_plan(profile['id'],profile['title'])
    assert len(plan['knowledge_points'])>=3
    assert profile['section'] not in plan['knowledge_points']
    assert not any(token in overview(profile['id']) for token in ['自命题','原始需求','教学主题','教教学'])


def test_complete_knapsack_teacher_uses_actual_recurrence_not_trace_fragments():
    decision=asyncio.run(TeacherAgent_Node(create_initial_state('请为我讲解完全背包算法',executable_labs=True)))
    plan=decision['final_output']['lesson_plan']
    assert 'dp[i][c-w_i]' in '。'.join(plan['knowledge_points'])
    trace=run_trace('complete-knapsack',data={'weights':[2],'values':[3],'capacity':4})
    assert trace['outcome']['value']==6
    assert any('来自本行' in frame['explanation'] for frame in trace['frames'])

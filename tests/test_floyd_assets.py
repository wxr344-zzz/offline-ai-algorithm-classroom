"""Only developer-owned references execute here, with independent math checks."""
import asyncio
from itertools import product
from floyd_assets import floyd_guide,distances,repair_floyd
from autonomous_tasks import contextual_task


def test_floyd_matches_independent_all_source_oracle_on_small_directed_graphs():
    draft=floyd_guide('请为我讲解Floyd算法')
    scope={};exec(draft.reference_solution,scope)
    for weights in product([-1,0,2],repeat=6):
        matrix=[[0]*3 for _ in range(3)];index=0
        for i in range(3):
            for j in range(3):
                if i!=j:matrix[i][j]=weights[index];index+=1
        rows=[' '.join(map(str,row)) for row in matrix]
        expected=[' '.join(map(str,row)) for row in distances(matrix)]
        assert scope['Solution']().solve(rows)==expected
    for case in draft.public_test_cases+draft.hidden_test_cases:
        assert scope['Solution']().solve(**case.inputs)==case.expected
    assert draft.public_test_cases[0].expected!=draft.public_test_cases[0].inputs['graph']
    assert floyd_guide('Dijkstra 单源最短路') is None


def test_depot_task_handles_deadlines_ties_unreachable_and_zero_weight():
    task=contextual_task(floyd_guide('Floyd'),'Floyd')
    scope={};exec(task.reference_solution,scope)
    for case in task.public_test_cases+task.hidden_test_cases:
        assert scope['Solution']().solve(**case.inputs)==case.expected
    assert task.public_test_cases[0].expected=='1 5 3'
    assert task.public_test_cases[1].expected=='IMPOSSIBLE'


def test_reviewed_floyd_workflow_and_teaching_preserve_math_and_task_difference(monkeypatch):
    from agent_workflow import LabAgent_Node,EvalAgent_Node,create_initial_state
    from ollama_provider import OllamaProvider
    from lab_contracts import PublicCourse,to_public_course
    from problem_statements import review_problem_statements
    from teaching_assets import run_teaching,AlgorithmClassroomTeaching
    async def no_model(*args,**kwargs):raise AssertionError('Audited content must not be rewritten')
    monkeypatch.setattr(OllamaProvider,'generate',no_model)
    state=create_initial_state('请为我讲解Floyd算法')
    state.update(current_topic='Floyd算法',requires_lab=True,final_output={
        'course_id':'reviewed-floyd-test','topic':'Floyd算法','requires_lab':True,
        'lesson_plan':{'title':'Floyd算法','objectives':['计算所有顶点对最短路'],'knowledge_points':['动态规划中转点']},
        'common_mistakes':[],'lab':None,'problem':None})
    state.update(asyncio.run(LabAgent_Node(state,replay_reviewed_transfer=True)))
    output=asyncio.run(review_problem_statements(EvalAgent_Node(state)['final_output']))
    course=PublicCourse.model_validate(to_public_course(output))
    teaching=AlgorithmClassroomTeaching.model_validate(asyncio.run(run_teaching(course)))
    assert teaching.algorithm_trace.outcome==floyd_guide('Floyd').public_test_cases[0].expected
    assert len(teaching.algorithm_trace.steps)==5
    repaired=repair_floyd(output)
    assert repaired['publicCourse']['courseId']!=course.course_id
    assert repaired['publicCourse']['scenes'][1]['problem']['executionMode']=='stdio'

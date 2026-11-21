import itertools
import pytest
from spanning_tree_assets import spanning_tree_guide,connection_cost,is_reviewed_guide
from autonomous_tasks import contextual_task
from lab_assembly import normalize_generated_draft,assemble_lab


def exhaustive(n,edges,existing=()):
    best=None
    for size in range(len(edges)+1):
        for subset in itertools.combinations(edges,size):
            reached={0}
            for _ in range(n):
                for u,v in [*existing,*[(u,v) for u,v,w in subset]]:
                    if u in reached or v in reached: reached.update((u,v))
            if len(reached)==n:
                cost=sum(w for u,v,w in subset)
                best=cost if best is None else min(best,cost)
    return -1 if best is None else best


@pytest.mark.parametrize('topic',['讲解普里姆算法','Prim算法','普利姆最小生成树'])
def test_reviewed_prim_and_network_decision_have_independent_math(topic):
    draft=normalize_generated_draft(spanning_tree_guide(topic))
    # Only developer-owned references, never model-generated Python.
    scope={};exec(draft.reference_solution,scope)
    for case in draft.public_test_cases+draft.hidden_test_cases:
        edges=[tuple(map(int,e.split())) for e in case.inputs['edges']]
        assert case.expected==exhaustive(case.inputs['n'],edges)
        assert scope['Solution']().solve(**case.inputs)==case.expected
    lab,problem=assemble_lab(draft,'reviewed-mst')
    assert is_reviewed_guide(problem.guided_scene,draft.reference_solution)
    transfer=contextual_task(draft,topic)
    scope={};exec(transfer.reference_solution,scope)
    for case in transfer.public_test_cases+transfer.hidden_test_cases:
        assert scope['Solution']().solve(**case.inputs)==case.expected
        parts=list(map(int,case.inputs['stdin'].split()));n,m,k,b=parts[:4]
        existing=[tuple(parts[4+2*i:6+2*i]) for i in range(k)]
        p=4+2*k;edges=[tuple(parts[p+3*i:p+3*i+3]) for i in range(m)]
        cost=exhaustive(n,edges,existing)
        expected='IMPOSSIBLE' if cost<0 else ('YES ' if cost<=b else 'NO ')+str(cost)
        assert case.expected==expected
    assert transfer.public_test_cases[0].expected=='YES 5'
    assert transfer.public_test_cases[1].expected=='NO 5'


def test_spanning_contract_does_not_route_unrelated_algorithm_courses():
    assert spanning_tree_guide('解释深度优先搜索') is None
    assert spanning_tree_guide('primality test') is None


def test_prim_workflow_and_trace_do_not_regenerate_audited_assets(monkeypatch):
    import asyncio
    from agent_workflow import LabAgent_Node,EvalAgent_Node,create_initial_state
    from ollama_provider import OllamaProvider
    from lab_contracts import to_public_course,PublicCourse
    from problem_statements import review_problem_statements
    from teaching_assets import run_teaching,AlgorithmClassroomTeaching
    async def no_model(*args,**kwargs):
        raise AssertionError('Reviewed assets must not be rewritten by the model')
    monkeypatch.setattr(OllamaProvider,'generate',no_model)
    state=create_initial_state('请为我讲解普里姆算法')
    state.update(current_topic='普里姆算法',requires_lab=True,final_output={
        'course_id':'reviewed-prim-test','topic':'普里姆算法','requires_lab':True,
        'lesson_plan':{'title':'Prim 最小生成树','objectives':['理解最小生成树'],'knowledge_points':['候选边与连通性']},
        'common_mistakes':[],'lab':None,'problem':None})
    state.update(asyncio.run(LabAgent_Node(state,replay_reviewed_transfer=True)))
    output=EvalAgent_Node(state)['final_output']
    output=asyncio.run(review_problem_statements(output))
    course=PublicCourse.model_validate(to_public_course(output))
    teaching=AlgorithmClassroomTeaching.model_validate(asyncio.run(run_teaching(course)))
    assert len(course.scenes)==2
    assert teaching.algorithm_trace.outcome==6
    assert any('候选边' in value for frame in teaching.algorithm_trace.steps for value in frame.values)
    assert '施工预算' in course.scenes[1].problem.title

import asyncio
import itertools
import json
import pytest
from agent_workflow import LabAgent_Node,create_initial_state
from lab_contracts import LabDraft
from lab_assembly import normalize_generated_draft,assemble_lab
from quicksort_applications import QuicksortApplicationSpec,compile_quicksort_application
from test_agent_workflow import lab_draft_payload


def guide():
    value=lab_draft_payload()
    value.update(title='快速排序',instructions='将整数列表从小到大排序。',
        reference_solution='class Solution:\n    def solve(self, numbers: list[int]) -> list[int]:\n        return sorted(numbers)\n')
    for case in value['public_test_cases']+value['hidden_test_cases']:
        case['expected']=sorted(case['inputs']['numbers'])
    return normalize_generated_draft(LabDraft.model_validate(value))


def spec(order,result):
    return QuicksortApplicationSpec(title='校园活动的记录筛选',
        setting='学校在活动结束后汇总各工作站的处理耗时，为下一轮安排提供依据。',
        actor='活动管理员整理记录',quantity='处理耗时',order=order,result=result)


@pytest.mark.parametrize('order',['ascending','descending'])
@pytest.mark.parametrize('result',['values','indices','total'])
def test_all_rule_variants_have_independent_correct_oracle_and_real_quicksort(order,result):
    draft=compile_quicksort_application(spec(order,result),guide(),'course-property-test')
    assemble_lab(draft,'course-property-test')
    assert 'while i <= j' in draft.reference_solution
    assert 'sorted(' not in draft.reference_solution and '.sort(' not in draft.reference_solution
    # Only developer-owned compiler source executes here, never model code.
    scope={};exec(draft.reference_solution,scope)
    solve=scope['Solution']().solve
    for n in range(6):
        for values in itertools.product([-1,0,1],repeat=n):
            values=list(values)
            for quota in (0,1,2,n,n+2):
                positions=sorted(range(n),key=lambda i:((-values[i] if order=='descending' else values[i]),i))[:quota]
                expected=(positions if result=='indices' else sum(values[i] for i in positions)
                          if result=='total' else [values[i] for i in positions])
                assert solve(values,quota)==expected
    for case in draft.public_test_cases+draft.hidden_test_cases:
        assert solve(**case.inputs)==case.expected
    assert len(draft.public_test_cases)==4
    assert len(draft.hidden_test_cases)>=3
    assert 'JSON数字' not in draft.instructions  # native numeric signature, no string coercion


def test_live_workflow_uses_generated_scene_and_no_model_answers(monkeypatch):
    calls=[]
    async def generate(self,prompt,**kwargs):
        calls.append(kwargs['schema'].__name__)
        assert kwargs['schema'] is QuicksortApplicationSpec
        assert 'expected' not in json.loads(prompt)
        return spec('ascending','indices').model_dump_json()
    monkeypatch.setattr('ollama_provider.OllamaProvider.generate',generate)
    state=create_initial_state('讲解快速排序算法')
    state.update(current_topic='快速排序算法',requires_lab=True,final_output={
        'course_id':'quicksort-generated-test','topic':'快速排序算法','requires_lab':True,
        'lesson_plan':{'title':'快速排序','objectives':['掌握双指针分区'],'knowledge_points':['快速排序']},
        'common_mistakes':[],'lab':None,'problem':None})
    result=asyncio.run(LabAgent_Node(state,accepted_guided=guide()))['final_output']
    assert calls==['QuicksortApplicationSpec']
    problem=result['problem']['oj_scene']['problem']
    assert problem['execution_mode']=='stdio'
    assert '校园活动' in problem['title']
    assert '下标' in problem['instructions']
    assert len(problem['public_test_cases'])==4

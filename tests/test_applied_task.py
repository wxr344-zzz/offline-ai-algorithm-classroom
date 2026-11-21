import json
from copy import deepcopy
from pathlib import Path
import asyncio
import pytest
from applied_task import AppliedTask, apply_task


def test_generated_plan_schema_requires_every_base_role():
    from applied_task import applied_plan_schema, parse_applied_plan
    from pydantic import ValidationError
    schema=applied_plan_schema({'operations':'list[str]','initial':'list[int]'})
    required=schema.model_fields['input_roles'].annotation.model_json_schema()['required']
    assert set(required)=={'operations','initial'}
    data=scenario().model_dump(mode='json')
    data['input_roles']={'operations':'柜台按顺序处理的服务操作。','initial':'开始营业时等待服务的顾客编号。'}
    data['additional_constraint']={'parameter':'scenario_limit','meaning':'等候区可以容纳的最大人数。'}
    data['decision_evidence']={'base_inputs':{'operations':['ARRIVE 1'],'initial':[]},'variants':[
        {'constraint':0,'expected':False,'explanation':'没有候诊座位不能接收顾客'},
        {'constraint':1,'expected':True,'explanation':'有一个座位可以接收顾客'}]}
    result=parse_applied_plan(json.dumps(data),{'operations':'list[str]','initial':'list[int]'})
    assert [r.parameter for r in result.input_roles]==['operations','initial','scenario_limit']
    del data['input_roles']['initial']
    with pytest.raises(ValidationError):
        parse_applied_plan(json.dumps(data),{'operations':'list[str]','initial':'list[int]'})


def test_constraint_identity_is_valid_and_avoids_existing_names():
    from applied_task import applied_plan_schema
    from pydantic import ValidationError
    base={'scenario_limit':'int'}
    schema=applied_plan_schema(base)
    constraint=schema.model_fields['additional_constraint'].annotation
    assert constraint.model_fields['parameter'].annotation.__args__==('scenario_limit_extra',)
    with pytest.raises(ValidationError):
        constraint.model_validate({'parameter':'int, 中文说明','meaning':'等候区最多容纳的人数。'})


def test_platform_owned_constraint_alias_and_concise_real_actor_are_normalized():
    from applied_task import parse_applied_plan
    data=scenario().model_dump(mode='json')
    data['actor']='IT 部门的工程师'
    data['input_roles']={'numbers':'等待处理的物资编号。'}
    data['additional_constraint']={'parameter':'budget','meaning':'最多可以处理的物资条数。'}
    data['decision_evidence']={'base_inputs':{'numbers':[1,2]},'variants':[
        {'constraint':0,'expected':0,'explanation':'没有额度时不处理任何条目'},
        {'constraint':1,'expected':1,'explanation':'额度为一时处理第一条记录'}]}
    before=deepcopy(data)
    result=parse_applied_plan(json.dumps(data),{'numbers':'list[int]'})
    assert result.actor=='IT 部门的工程师'
    assert result.input_roles[-1].parameter=='scenario_limit'
    assert result.input_roles[-1].meaning==data['additional_constraint']['meaning']
    assert result.decision_evidence.model_dump(mode='json')==data['decision_evidence']
    assert data==before
from lab_contracts import LabDraft, FinalOutput
from autonomous_tasks import function_task_to_stdio
from test_agent_workflow import lab_draft_payload
from problem_statements import review_problem_statements


def scenario():
    return AppliedTask(title='校园物资清点：筛选可用编号',setting='学校为实验课清点仓库物资，清单中混有作废编号。',
        actor='你是实验室管理员，需要生成本次可以领用的清单。',objective='按登记的原始顺序筛选编号为正数的物资并保留所有有效记录。',
        input_roles=[{'parameter':'numbers','meaning':'仓库登记的物资编号，非正数表示已作废。'}],
        decision_rules=['过滤已经作废的非正数编号。','保留正数编号的原顺序和重复记录。'],
        output_meaning='返回仍可领用的正数编号清单。',boundary_rules=['输入清单为空或全作废时返回空清单。'],
        transfer_difference='引导题求总和，本题需要筛选记录并保持原顺序。')


@pytest.mark.parametrize('topic',['克鲁斯卡尔','快速排序','深度优先搜索','KMP','线段树'])
def test_applied_contract_has_no_topic_whitelist_and_survives_stdio(topic):
    # Same assembly contract for every topic; this checks scenario propagation,
    # not mathematical correctness of a generated implementation.
    payload=lab_draft_payload()
    payload['title']=topic
    task=scenario()
    draft=LabDraft.model_validate(payload)
    result=apply_task(draft,task)
    adapted=function_task_to_stdio(result)
    for text in (task.setting,task.actor,task.objective,task.output_meaning,*task.decision_rules):
        assert text in adapted.instructions
    assert draft.instructions != result.instructions


def test_rejects_textbook_setting_and_unbound_inputs():
    draft=LabDraft.model_validate(lab_draft_payload())
    with pytest.raises(ValueError,match='算法定义'):
        apply_task(draft,scenario().model_copy(update={'setting':'在图论中，研究最短路径。'}))
    task=scenario()
    task.input_roles[0].parameter='missing'
    with pytest.raises(ValueError,match='每个输入参数'):
        apply_task(draft,task)


def test_rejects_algorithm_description_as_business_rules():
    draft=LabDraft.model_validate(lab_draft_payload())
    with pytest.raises(ValueError,match='业务规则'):
        apply_task(draft,scenario().model_copy(update={'decision_rules':['快速排序算法的基本原理和步骤','实现快速排序算法']}))


def test_scenario_constraint_must_change_an_answer():
    from applied_task import validate_scenario_decision
    guided=LabDraft.model_validate(lab_draft_payload())
    independent=guided.model_copy(deep=True)
    with pytest.raises(ValueError,match='增加场景约束'):
        validate_scenario_decision(guided,independent)
    independent.reference_solution=independent.reference_solution.replace('numbers: list[int]', 'numbers: list[int], budget: int')
    for case in independent.public_test_cases+independent.hidden_test_cases:
        case.inputs['budget']=10
    with pytest.raises(ValueError,match='正确答案随之改变'):
        validate_scenario_decision(guided,independent)
    case=independent.public_test_cases[0].model_copy(deep=True)
    case.inputs['budget']=0
    case.expected=-1
    independent.hidden_test_cases[0]=case
    validate_scenario_decision(guided,independent)
    independent.reference_solution=independent.reference_solution.replace('numbers: list[int]','numbers: str')
    with pytest.raises(ValueError,match='保留基础参数的数据类型'):
        validate_scenario_decision(guided,independent)


def test_plan_rejects_undefined_threshold():
    from applied_task import validate_plan,InputRole
    plan=scenario().model_copy(update={'input_roles':scenario().input_roles+[InputRole(parameter='budget',meaning='用于采购的预算上限。')],
        'decision_rules':['价格不超过预算限制。','质量评分必须高于某个阈值。']})
    with pytest.raises(ValueError,match='未定义的阈值'):
        validate_plan(plan,{'numbers'})


def test_editor_cannot_erase_applied_oj_or_rewrite_its_assessment(monkeypatch):
    fixture=json.loads((Path(__file__).parent/'fixtures/eduplus-generated.json').read_text(encoding='utf-8'))['privateOutput']
    output=FinalOutput.model_validate(fixture)
    from lab_contracts import PrivateAssessment
    output.problem.oj_assessment=PrivateAssessment(reference_solution=output.problem.reference_solution,
        pytest_source=output.problem.pytest_source,hidden_test_cases=output.problem.hidden_test_cases)
    output.problem.oj_scene.problem=output.problem.oj_scene.problem.model_copy(deep=True)
    output.problem.oj_scene.problem.instructions='校园光纤升级：利用已有线路，在预算内连接全部教学楼。'
    before=deepcopy(output.problem.oj_scene.model_dump(mode='json'))
    class Provider:
        def __init__(self,**kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self,*args): pass
        async def generate(self,prompt,**kwargs):
            assert json.loads(prompt)['phase']=='guided-lab'
            return json.dumps(dict(title='引导任务',context='在图论中计算路径。',task='完成当前任务。',input_explanation='读取输入内容。',output_explanation='返回计算结果。',constraints=['允许空输入']))
    monkeypatch.setattr('problem_statements.OllamaProvider',Provider)
    result=asyncio.run(review_problem_statements(output.model_dump(mode='json')))
    assert result['problem']['oj_scene']==before
    assert '应用场景' not in result['problem']['guided_scene']['problem']['instructions']


@pytest.mark.parametrize('reuse_guide',[False,True,'maintained'])
@pytest.mark.parametrize('reject_first_review',[False,True])
def test_workflow_designs_scenario_before_implementation_and_accepts_same_result_type(monkeypatch,reuse_guide,reject_first_review):
    from agent_workflow import LabAgent_Node, create_initial_state
    from ollama_provider import OllamaProvider
    guided=lab_draft_payload()
    def no_fixed_recipe(*args, **kwargs):
        raise AssertionError('New OJ tasks must be generated, not selected from fixed recipes')
    monkeypatch.setattr('agent_workflow.contextual_task', no_fixed_recipe)
    if reuse_guide == 'maintained':
        monkeypatch.setattr('agent_workflow.spanning_tree_guide', lambda requirement: LabDraft.model_validate(guided))
    def structured(payload,parameters,body):
        return {k:v for k,v in payload.items() if k not in ('scaffold_code','reference_solution')} | {
            'implementation':{'parameters':parameters,'return_type':'int','body':body}}
    plan=scenario().model_copy(update={
        'objective':'筛选在单件预算以内可购买的物资，返回满足条件的物资件数。',
        'input_roles':scenario().input_roles+[__import__('applied_task').InputRole(parameter='budget',meaning='每件物资能够支付的最高价格。')],
        'output_meaning':'返回单件价格不超过预算的物资件数。',
        'transfer_difference':'引导题计算总和，本题新增预算限制，统计满足条件的物资件数。'})
    independent=deepcopy(guided)
    examples=[([2,5],2,1),([2,5],5,2),([],5,0),([0,0],0,2),([9],1,0),([3,3],3,2),([1,4],2,1)]
    cases=[{'caseId':f'c-{i}','inputs':{'numbers':nums,'budget':budget},'expected':answer,'description':'核对预算约束'} for i,(nums,budget,answer) in enumerate(examples)]
    independent.update(public_test_cases=cases[:4],hidden_test_cases=cases[4:])
    calls=[]
    async def generate(self,prompt,**kwargs):
        data=json.loads(prompt)
        if kwargs['schema'].__name__ == 'TaskAlignmentReview':
            calls.append('alignment')
            return json.dumps(dict(core_algorithm_matches=not (reject_first_review and calls.count('alignment') == 1), inputs_sufficient=True,
                difficulty_appropriate=True, has_meaningful_application=True,
                reason='列表遍历和条件统计直接解决任务，输入价格列表含义充分。'))
        if issubclass(kwargs['schema'], AppliedTask):
            calls.append('plan')
            return plan.model_dump_json()
        if 'approved_task' in data:
            calls.append('implementation')
            assert data['approved_task']['setting']==plan.setting
            return json.dumps(structured(independent,{'numbers':'list[int]','budget':'int'},
                'return sum(1 for x in numbers if 0 <= x <= budget)'))
        calls.append('guided')
        return json.dumps(structured(guided,[{'name':'numbers','type':'list[int]'}],'return sum(numbers)'))
    monkeypatch.setattr(OllamaProvider,'generate',generate)
    state=create_initial_state('学习列表算法')
    state.update(current_topic='列表处理',requires_lab=True,final_output={
        'course_id':'course-test','topic':'列表处理','requires_lab':True,
        'lesson_plan':{'title':'列表处理','objectives':['遍历与条件判断'],'knowledge_points':['列表']},
        'common_mistakes':[],'lab':None,'problem':None})
    result=asyncio.run(LabAgent_Node(state,accepted_guided=LabDraft.model_validate(guided) if reuse_guide is True else None))['final_output']
    expected=([] if reuse_guide else ['guided'])
    if reject_first_review: expected+=['plan','alignment']
    assert calls==expected+['plan','alignment','implementation']
    assert plan.setting in result['problem']['oj_scene']['problem']['instructions']
    assert result['problem']['oj_scene']['problem']['execution_mode']=='stdio'


def test_rejected_constraint_plan_is_redesigned_instead_of_repeating_the_same_failure(monkeypatch):
    from agent_workflow import LabAgent_Node, create_initial_state
    from ollama_provider import OllamaProvider
    guided=lab_draft_payload()
    plan=scenario().model_copy(update={'input_roles':scenario().input_roles+[
        __import__('applied_task').InputRole(parameter='budget',meaning='每件物资最高预算，等于预算时允许采购。')]})
    examples=[([2,5],2,1),([2,5],5,2),([],5,0),([0,0],0,2),([9],1,0),([3,3],3,2),([1,4],2,1)]
    cases=[{'caseId':f'c-{i}','inputs':{'numbers':nums,'budget':budget},'expected':answer,'description':'核对预算约束'} for i,(nums,budget,answer) in enumerate(examples)]
    independent=deepcopy(guided); independent.update(public_test_cases=cases[:4],hidden_test_cases=cases[4:])
    def structured(payload,parameters,body):
        return {k:v for k,v in payload.items() if k not in ('scaffold_code','reference_solution')} | {
            'implementation':{'parameters':parameters,'return_type':'int','body':body}}
    plans=[]; repairs=[]
    async def generate(self,prompt,**kwargs):
        data=json.loads(prompt)
        if kwargs['schema'].__name__ == 'TaskAlignmentReview':
            return json.dumps(dict(core_algorithm_matches=True, inputs_sufficient=True,
                difficulty_appropriate=True, has_meaningful_application=True,
                reason='列表遍历和条件统计直接解决任务，输入价格列表含义充分。'))
        if issubclass(kwargs['schema'],AppliedTask):
            plans.append(data)
            return plan.model_dump_json()
        if 'approved_task' in data:
            return json.dumps(structured(independent,{'numbers':'list[int]','budget':'int'},'return sum(1 for x in numbers if 0 <= x <= budget)'))
        return json.dumps(structured(guided,[{'name':'numbers','type':'list[int]'}],'return sum(numbers)'))
    async def reject_once(provider,source,task):
        repairs.append(1)
        if len(repairs)==1:
            raise ValueError('必须至少有一对公开或隐藏用例：新增约束改变答案')
        return task
    monkeypatch.setattr(OllamaProvider,'generate',generate)
    monkeypatch.setattr('agent_workflow.repair_scenario_examples',reject_once)
    state=create_initial_state('学习列表算法')
    state.update(current_topic='列表处理',requires_lab=True,final_output={
        'course_id':'replan-test','topic':'列表处理','requires_lab':True,
        'lesson_plan':{'title':'列表','objectives':['遍历'],'knowledge_points':['列表']},
        'common_mistakes':[],'lab':None,'problem':None})
    result=asyncio.run(LabAgent_Node(state))
    assert len(plans)==2
    assert plans[0]['previous_rejected_plan'] is None
    assert plans[1]['previous_rejected_plan']['objective']==plan.objective
    assert '不得仅改标题或捏造不同答案' in plans[1]['validation_feedback']
    assert result['final_output']['problem'] is not None


def test_new_plans_require_small_decision_examples_before_implementation():
    from applied_task import applied_plan_schema,parse_applied_plan
    schema=applied_plan_schema({'numbers':'list[int]'})
    assert 'decision_evidence' in schema.model_json_schema()['required']
    value=scenario().model_dump()
    value['input_roles']={'numbers':'每件物资对应的整数采购价格列表。'}
    value['additional_constraint']={'parameter':'scenario_limit','meaning':'每件物资可接受的最高采购价格。'}
    value['decision_evidence']={'base_inputs':{'numbers':[2,5]},'variants':[
        {'constraint':2,'expected':1,'explanation':'只允许价格二的第一件物资'},
        {'constraint':5,'expected':2,'explanation':'两件物资均符合采购单价上限'}]}
    task=parse_applied_plan(json.dumps(value),{'numbers':'list[int]'})
    assert task.decision_evidence.variants[1].expected==2
    value['decision_evidence']['variants'][1]['expected']=1
    with pytest.raises(ValueError,match='两个真实不同'):
        parse_applied_plan(json.dumps(value),{'numbers':'list[int]'})
    value['decision_evidence']['variants'][1]['expected']=2
    value['decision_evidence']['variants'][0]['constraint']="numbers = [1]"
    value['decision_evidence']['variants'][1]['constraint']="numbers = [1, 2]"
    with pytest.raises(ValueError,match='constraint|整数'):
        parse_applied_plan(json.dumps(value),{'numbers':'list[int]'})


@pytest.mark.parametrize('expected',[{'ranks':[1,2]},[[1,2]],None,1.5])
def test_decision_examples_cannot_propose_unsupported_return_shapes(expected):
    from applied_task import DecisionVariant
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        DecisionVariant.model_validate({'constraint':2,'expected':expected,
            'explanation':'对照例子的返回值必须符合沙箱入口契约'},strict=True)


def test_approved_decision_examples_are_preserved_without_becoming_answer_authority():
    from applied_task import DecisionEvidence,apply_decision_evidence
    from agent_workflow import implementation_schema_for_plan
    from lab_assembly import assemble_lab
    guided=LabDraft.model_validate(lab_draft_payload())
    independent=guided.model_copy(deep=True)
    independent.reference_solution=independent.reference_solution.replace('numbers: list[int]','numbers: list[int], budget: int')
    independent.scaffold_code=independent.scaffold_code.replace('numbers: list[int]','numbers: list[int], budget: int')
    for case in independent.public_test_cases+independent.hidden_test_cases:case.inputs['budget']=10
    task=scenario().model_copy(update={'input_roles':scenario().input_roles+[
        __import__('applied_task').InputRole(parameter='budget',meaning='每件物资允许的最高单价。')],
        'decision_evidence':DecisionEvidence(base_inputs={'numbers':[2,5]},variants=[
            {'constraint':2,'expected':1,'explanation':'只有一件物资符合单价上限'},
            {'constraint':5,'expected':2,'explanation':'两件物资都符合单价上限'}])})
    before=deepcopy(independent.model_dump())
    result=apply_decision_evidence(independent,task)
    assert independent.model_dump()==before
    assert [c.inputs for c in result.public_test_cases[:2]]==[{'numbers':[2,5],'budget':2},{'numbers':[2,5],'budget':5}]
    assert [c.expected for c in result.public_test_cases[:2]]==[1,2]
    _,private=assemble_lab(result,'proposal-test')
    assert private.guided_scene.problem.answer_check is None
    assert 'pytest.skip' not in private.pytest_source
    assert '    assert ' in private.pytest_source
    shape=implementation_schema_for_plan(task,{'numbers':'list[int]'}).model_json_schema()
    implementation=shape['$defs']['PlannedImplementation']
    assert implementation['properties']['return_type']['const']=='int'
    parameter=shape['$defs']['PlannedParameterTypes']
    assert parameter['properties']['budget']['const']=='int'
    # Regression: an omitted declaration can be recovered from the approved
    # interface, but neither input data nor a conflicting declaration is guessed.
    payload={k:v for k,v in before.items() if k not in ('scaffold_code','reference_solution')}
    payload['implementation']={'parameters':{'numbers':'list[int]'},'return_type':'int',
        'body':'return sum(1 for x in numbers if x <= budget)'}
    schema=implementation_schema_for_plan(task,{'numbers':'list[int]'})
    parsed=schema.model_validate(payload,strict=True)
    assert parsed.implementation.parameters.model_dump()=={'numbers':'list[int]','budget':'int'}
    assert payload['implementation']['parameters']=={'numbers':'list[int]'}
    from pydantic import ValidationError
    missing_input=deepcopy(payload)
    del missing_input['public_test_cases'][0]['inputs']['budget']
    with pytest.raises(ValidationError):schema.model_validate(missing_input,strict=True)
    wrong_type=deepcopy(payload)
    wrong_type['implementation']['parameters']['numbers']='list[str]'
    with pytest.raises(ValidationError):schema.model_validate(wrong_type,strict=True)

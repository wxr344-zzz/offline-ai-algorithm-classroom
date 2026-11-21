import asyncio
from copy import deepcopy
import json
import pytest
from executable_lessons import (known_contract,compile_drafts,ApplicationLabels,registry_source,
    summarize,build_executable_labs)
from exam_simulator import catalog,run_trace
from lesson_execution import verify_drafts,execute_jobs
from lab_contracts import FinalOutput,to_public_course


LABELS=ApplicationLabels(location='计算中心',actor='任务管理员',record='计算任务',summary='frequencies')


@pytest.mark.parametrize('key,required,unrelated',[
    ('bfs','allComponents',('Floyd','A*','Dijkstra','最小生成树','heuristic','校验失败')),
    ('dfs','allComponents',('Floyd','A*','Dijkstra','最小生成树','heuristic','校验失败')),
    ('floyd','最多6',('allComponents','贪婪','AOE','当前 A*')),
    ('astar','一致启发式',('Floyd','allComponents','AOE','贪婪')),
])
def test_shared_executor_exports_only_its_own_input_constraints(key,required,unrelated):
    description=known_contract(key).input_description
    assert required in description
    assert all(word not in description for word in unrelated)


@pytest.mark.parametrize('profile',catalog(),ids=lambda p:p['id'])
def test_all_catalog_algorithms_compile_without_model_authored_answers(profile):
    contract=known_contract(profile['id'])
    original=deepcopy(contract.examples)
    guide,oj=compile_drafts(contract,LABELS)
    # These sources contain only developer-maintained modules and fixed
    # compiler wrappers. No generated model Python executes on this host.
    namespace={};exec(guide.reference_solution,namespace)
    solve=namespace['Solution']().solve
    for case in guide.public_test_cases+guide.hidden_test_cases:
        data=json.loads(case.inputs['data'])
        raw=run_trace(profile['id'],data=data)['outcome']
        actual=json.loads(solve(**case.inputs))
        assert actual==raw or isinstance(raw,dict) and any(actual==v for v in raw.values())
        assert json.loads(case.expected)==json.loads(solve(**case.inputs))
    namespace={};exec(oj.reference_solution,namespace)
    for case in oj.public_test_cases+oj.hidden_test_cases:
        assert json.loads(namespace['Solution']().solve(**case.inputs))==json.loads(case.expected)
    assert contract.examples==original
    assert len(guide.public_test_cases)==4 and len(guide.hidden_test_cases)>=3
    assert len(oj.public_test_cases)==4 and len(oj.hidden_test_cases)>=3
    assert 'scenario_limit' not in oj.instructions
    assert 'requests' in oj.instructions
    assert 'exec(' not in guide.reference_solution and 'eval(' not in guide.reference_solution


@pytest.mark.parametrize('key',[p['id'] for p in catalog()])
def test_actual_browser_runtime_accepts_different_algorithm_families(key):
    guide,oj=compile_drafts(known_contract(key),LABELS)
    assert asyncio.run(verify_drafts(guide,oj))>=14


def test_stable_aggregation_handles_objects_types_and_empty_batches():
    assert summarize([], 'frequencies')==[]
    assert summarize([{'b':2,'a':1},{'a':1,'b':2},False,0], 'frequencies')==[
        {'result':{'b':2,'a':1},'count':2},{'result':False,'count':1},{'result':0,'count':1}]
    assert summarize([[2,1],[1,2],[2,1]],'distinct')==[[2,1],[1,2]]


def test_multiple_valid_witnesses_do_not_become_arbitrary_exact_answers():
    lcs=known_contract('lcs')
    mst=known_contract('kruskal')
    huffman=known_contract('huffman')
    assert lcs.examples[0][1]==4 and 'length' in lcs.output_description
    assert mst.examples[0][1]==9 and 'total' in mst.output_description
    assert huffman.examples[0][1]==224 and 'wpl' in huffman.output_description


def test_corrupted_expected_is_rejected_by_wasm_not_published():
    guide,oj=compile_drafts(known_contract('merge'),LABELS)
    guide.public_test_cases[0].expected='[999999]'
    with pytest.raises(ValueError,match='执行断言未通过'):
        asyncio.run(verify_drafts(guide,oj))


def test_missing_return_and_runtime_errors_are_detected_in_wasm():
    job={'entry':{'className':'Solution','methodName':'solve'},'cases':[{'caseId':'one','inputs':{},'expected':0}],
        'code':'class Solution:\n    def solve(self):\n        return 1/0\n'}
    result=asyncio.run(execute_jobs([job]))
    assert 'ZeroDivisionError' in result[0][0]['error']


def test_live_api_pipeline_uses_compiler_and_marks_accepted_assets(monkeypatch):
    from agent_workflow import create_initial_state,LabAgent_Node,EvalAgent_Node
    async def labels(*args):return LABELS
    monkeypatch.setattr('executable_lessons.application_labels',labels)
    state=create_initial_state('二路归并排序',executable_labs=True)
    state.update(current_topic='二路归并排序',course_kind='algorithm',requires_lab=True,final_output={
        'course_id':'compiled-merge','topic':'二路归并排序','requires_lab':True,
        'lesson_plan':{'title':'二路归并排序','objectives':['理解归并'],'knowledge_points':['归并排序']},
        'common_mistakes':[],'lab':None,'problem':None})
    result=asyncio.run(LabAgent_Node(state))
    assert result['verified_lab_assets'] is True
    state.update(result)
    output=EvalAgent_Node(state)['final_output']
    final=FinalOutput.model_validate(output)
    public=to_public_course(final.model_dump(mode='json'))
    assert all(scene['problem']['answerCheck']=='json-value' for scene in public['scenes'])
    assert public['scenes'][1]['problem']['executionMode']=='stdio'
    assert '批量处理' in public['scenes'][1]['problem']['title']
    assert public['scenes'][1]['problem']['publicTestCases'][0]['inputs']['stdin']


def test_metadata_teacher_and_teaching_do_not_depend_on_model_answers(monkeypatch):
    from agent_workflow import create_initial_state,TeacherAgent_Node
    from executable_lessons import compiled_teaching
    from teaching_assets import ClassroomTeaching
    from lab_contracts import PublicCourse
    async def forbidden(*args,**kwargs):raise AssertionError('Known metadata should not call a model')
    monkeypatch.setattr('ollama_provider.OllamaProvider.generate',forbidden)
    state=create_initial_state('请讲解二路归并排序',executable_labs=True)
    decision=asyncio.run(TeacherAgent_Node(state))
    assert decision['requires_lab'] and '归并' in decision['current_topic']
    assert decision['course_kind']=='algorithm'
    # Teaching text is checked by its normal public contract as well.
    from lab_assembly import assemble_lab
    guide,_=compile_drafts(known_contract('merge'),LABELS)
    lab,problem=assemble_lab(guide,'metadata-test')
    output={**decision['final_output'],'course_id':'metadata-test','lab':lab.model_dump(mode='json'),
        'problem':problem.model_dump(mode='json'),'status':'ready'}
    course=PublicCourse.model_validate(to_public_course(output))
    teaching=ClassroomTeaching.model_validate(compiled_teaching(course))
    assert teaching.algorithm_trace is None and len(teaching.questions)==3


def test_unknown_named_algorithm_routes_original_request_to_verification_without_teacher_rewrite(monkeypatch):
    from agent_workflow import create_initial_state,TeacherAgent_Node
    async def forbidden(*args,**kwargs):raise AssertionError('Redundant teacher generation must not rename the algorithm')
    monkeypatch.setattr('ollama_provider.OllamaProvider.generate',forbidden)
    request='请为我讲解未预置的素性检验算法'
    state=create_initial_state(request,executable_labs=True)
    decision=asyncio.run(TeacherAgent_Node(state))
    assert decision['current_topic']==request and decision['teaching_requirement']==request
    assert decision['requires_lab'] and decision['course_kind']=='algorithm'
    assert decision['final_output']['lab'] is None and not decision.get('verified_lab_assets',False)


def test_programming_concepts_use_verified_task_contract_not_algorithm_whitelist(monkeypatch):
    from exam_simulator.generated import CACHE
    from executable_lessons import dynamic_contract
    from test_dynamic_simulator import program,ORACLE,pipeline_stage_response
    calls=[]
    async def generate(self,prompt,**kwargs):
        name=kwargs['schema'].__name__;calls.append(name)
        if name=='AlgorithmTopic':return json.dumps({'status':'ambiguous','title':'Programming loops and branches','reason':'这是编程知识点，需要设计具体教学计算任务。'})
        staged=pipeline_stage_response(name)
        if staged:return staged
        if name=='ApprovedAlgorithm':return program().model_dump_json()
        if name=='IndependentOracle':return json.dumps({'source':ORACLE,'validation_inputs':program().validation_inputs})
        if name=='AlgorithmReview':return json.dumps({'matches_topic':True,'algorithm_correct':True,
            'oracle_independent':True,'boundaries_covered':True,'reason':'任务与当前循环及条件分支知识点一致，独立校验器使用枚举。'})
        raise AssertionError(name)
    monkeypatch.setattr('ollama_provider.OllamaProvider.generate',generate)
    CACHE.clear()
    contract=asyncio.run(dynamic_contract('Python循环与条件分支','programming-concept-test',purpose='programming-task',requirement='整数列表筛选和求和'))
    assert 'AlgorithmTopic' in calls and 'AlgorithmIdentityReview' not in calls
    assert len(contract.examples)>=7
    guide,oj=compile_drafts(contract,LABELS)
    assert asyncio.run(verify_drafts(guide,oj))>=14
    CACHE.clear()


def test_original_teaching_requirement_reaches_program_generation_and_review(monkeypatch):
    from exam_simulator.generated import CACHE,dynamic_trace
    from test_dynamic_simulator import program,ORACLE,pipeline_stage_response
    prompts=[]
    async def generate(self,prompt,**kwargs):
        value=json.loads(prompt);name=kwargs['schema'].__name__
        if name=='CandidateReview':prompts.append(value)
        if name=='AlgorithmTopic':return json.dumps({'status':'ambiguous','title':'Programming loops and branches','reason':'这是编程知识点，需要设计具体教学计算任务。'})
        staged=pipeline_stage_response(name)
        if staged:return staged
        if name=='ApprovedAlgorithm':
            prompts.append(value);return program().model_dump_json()
        if name=='IndependentOracle':return json.dumps({'source':ORACLE,'validation_inputs':program().validation_inputs})
        if name=='AlgorithmReview':
            prompts.append(value);return json.dumps({'matches_topic':True,'algorithm_correct':True,
                'oracle_independent':True,'boundaries_covered':True,'reason':'原始教学要求与生成计算任务保持一致，校验使用独立枚举。'})
        raise AssertionError(name)
    monkeypatch.setattr('ollama_provider.OllamaProvider.generate',generate)
    CACHE.clear()
    asyncio.run(dynamic_trace('循环与分支',scope='original-request-test',purpose='programming-task',
        teaching_context='必须练习整数列表筛选与求和，不能换成别的计算目标'))
    assert len(prompts)==2
    assert all('整数列表筛选与求和' in p['original_requirement'] for p in prompts)
    CACHE.clear()


@pytest.mark.parametrize('error,code',[
    ('execution','REFERENCE_EXECUTION_FAILED'),('contract','ALGORITHM_CONTRACT_FAILED')])
def test_acceptance_errors_report_stage_without_exposing_private_outputs(error,code):
    from lesson_execution import LessonExecutionError
    from executable_lessons import AlgorithmContractError
    from agent_api import classify_failure
    exc=(LessonExecutionError if error=='execution' else AlgorithmContractError)('PRIVATE_REFERENCE_SOURCE')
    status,actual,message=classify_failure(exc)
    assert status==502 and actual==code
    assert 'PRIVATE' not in message


def test_accepted_execution_proof_replays_without_model_regeneration(monkeypatch):
    import hashlib
    from agent_workflow import create_initial_state
    from test_dynamic_simulator import program,ORACLE,source_digest
    p=program()
    proof={'kind':'independent-execution','program':p.model_dump(mode='json'),'oracle':ORACLE,
        'sourceHash':source_digest(p,ORACLE)}
    async def forbidden(*args,**kwargs):raise AssertionError('Accepted program must be replayed, not regenerated')
    async def labels(*args):return LABELS
    monkeypatch.setattr('exam_simulator.generated.dynamic_trace',forbidden)
    monkeypatch.setattr('executable_lessons.application_labels',labels)
    state=create_initial_state('重放已批准的计算契约',executable_labs=True)
    state.update(current_topic='已批准的计算契约',course_kind='algorithm',execution_proof=proof,
        final_output={'course_id':'execution-replay','topic':'已批准的计算契约','requires_lab':True,
            'lesson_plan':{'title':'计算契约','objectives':['理解运算'],'knowledge_points':['边界']},
            'common_mistakes':[],'lab':None,'problem':None})
    result=asyncio.run(build_executable_labs(state))
    assert result['verified_lab_assets']
    text=result['final_output']['problem']['guided_scene']['problem']['instructions']
    assert p.explanation in text and 'a: int' in text
    private=result['final_output']['problem']['pytest_source']
    assert '# executable-contract-verification:' in private and proof['sourceHash'] in private


def test_editor_topic_cannot_redirect_original_unknown_algorithm_or_poison_lesson_metadata(monkeypatch):
    from agent_workflow import create_initial_state
    from test_dynamic_simulator import program,ORACLE,source_digest
    from executable_lessons import verified_program_contract
    async def dynamic(topic,identity,*,purpose,requirement):
        assert topic=='请为我讲解未预置算法身份回归'
        assert requirement==topic and purpose=='algorithm'
        p=program()
        return await verified_program_contract(p,ORACLE,source_digest(p,ORACLE),'dynamic-identity-regression')
    async def labels(*args):return LABELS
    monkeypatch.setattr('executable_lessons.dynamic_contract',dynamic)
    monkeypatch.setattr('executable_lessons.application_labels',labels)
    state=create_initial_state('请为我讲解未预置算法身份回归',executable_labs=True)
    state.update(current_topic='A* 启发式搜索',course_kind='programming',
        teaching_requirement='原始教学需求：请为我讲解未预置算法身份回归。当前课程：A*。当前考点：硬币找零。',
        final_output={'course_id':'identity-anchored','topic':'硬币找零','requires_lab':True,
            'lesson_plan':{'title':'A*','objectives':['硬币找零'],'knowledge_points':['A*']},
            'common_mistakes':['无关任务的提示'],'lab':None,'problem':None})
    result=asyncio.run(build_executable_labs(state))
    assert result['verified_lab_assets'] and result['current_topic']=='未预置算法身份回归'
    output=result['final_output']
    assert output['topic']=='未预置算法身份回归'
    assert 'A*' not in json.dumps(output['lesson_plan']) and '硬币' not in json.dumps(output['lesson_plan'],ensure_ascii=False)
    assert output['common_mistakes']==[]


def test_compute_rules_are_not_lost_between_guide_and_independent_statement():
    contract=known_contract('merge')
    contract.rule_description='只保留满足指定条件的记录，再按题意计算结果。'
    guide,oj=compile_drafts(contract,LABELS)
    assert contract.rule_description in guide.instructions
    assert contract.rule_description in oj.instructions


def test_published_dynamic_contract_does_not_treat_missing_fields_as_valid(monkeypatch):
    from executable_lessons import verified_program_contract
    from test_dynamic_simulator import program, ORACLE, source_digest
    p = program()
    p = p.model_copy(update={'validation_inputs': [{}, p.default_input]})
    async def sandbox(_program, _oracle, data):
        return {'outcome': 0, 'checkedProbes': [{'input': {}, 'outcome': 0}]}
    async def localized(*_args):
        return {field: getattr(p, field) for field in ('title', 'explanation', 'input_description', 'output_description')}
    monkeypatch.setattr('exam_simulator.generated.sandbox', sandbox)
    monkeypatch.setattr('executable_lessons.localized_program_text', localized)
    contract = asyncio.run(verified_program_contract(p, ORACLE, source_digest(p, ORACLE), 'required-fields'))
    assert all(set(p.default_input) <= data.keys() for data, _ in contract.examples)
    assert '全部必填' in contract.input_description
    guide, oj = compile_drafts(contract, LABELS)
    assert '缺失字段不是合法测试输入' in guide.instructions
    assert '缺失字段不是合法测试输入' in oj.instructions


ENGLISH_PROGRAM=dict(valid_algorithm=True,title='Binary Tree Construction from Preorder and Inorder Traversal',
    explanation='This algorithm constructs a binary tree from given preorder and inorder traversal sequences.',
    input_description='The input consists of two sequences: preorder and inorder, of the same length.',
    output_description='The algorithm returns the root of the constructed binary tree, or None when empty.')


def _english_program(digest):
    from test_dynamic_simulator import program
    p=program().model_copy(update={**ENGLISH_PROGRAM,'default_input':{'preorder':[1],'inorder':[1]}})
    return p,digest


def test_english_program_prose_is_translated_for_the_chinese_lab(monkeypatch):
    from executable_lessons import localized_program_text
    calls=[]
    async def generate(self,prompt,**kwargs):
        calls.append(prompt)
        return json.dumps({'title':'由前序与中序序列构造二叉树','explanation':'根据前序与中序遍历序列递归构造二叉树。',
            'input_description':'输入包含 preorder 与 inorder 两个等长序列。','output_description':'返回构造出的二叉树根结点，输入为空时返回 None。'},ensure_ascii=False)
    monkeypatch.setattr('ollama_provider.OllamaProvider.generate',generate)
    p,digest=_english_program('digest-translate')
    text=asyncio.run(localized_program_text(p,digest))
    assert text['title']=='由前序与中序序列构造二叉树' and 'preorder' in text['input_description']
    assert len(calls)==1 and '简体中文' in calls[0]
    # Cached per verified program: no second model call.
    assert asyncio.run(localized_program_text(p,digest))==text and len(calls)==1


def test_unusable_translation_falls_back_to_neutral_chinese(monkeypatch):
    from executable_lessons import localized_program_text,is_chinese_text
    async def generate(self,prompt,**kwargs):
        # Still English, and the field names are lost.
        return json.dumps({'title':'Tree','explanation':'Builds a tree recursively from two lists.',
            'input_description':'Two lists of numbers.','output_description':'The root node of the tree.'})
    monkeypatch.setattr('ollama_provider.OllamaProvider.generate',generate)
    p,digest=_english_program('digest-fallback')
    text=asyncio.run(localized_program_text(p,digest))
    assert all(is_chinese_text(v) for v in text.values())
    async def offline(self,prompt,**kwargs):raise OSError('ollama is not running')
    monkeypatch.setattr('ollama_provider.OllamaProvider.generate',offline)
    p,digest=_english_program('digest-offline')
    assert all(is_chinese_text(v) for v in asyncio.run(localized_program_text(p,digest)).values())


def test_chinese_program_prose_needs_no_model_call(monkeypatch):
    from executable_lessons import localized_program_text
    from test_dynamic_simulator import program
    async def forbidden(*args,**kwargs):raise AssertionError('Chinese text must not be retranslated')
    monkeypatch.setattr('ollama_provider.OllamaProvider.generate',forbidden)
    p=program()
    assert asyncio.run(localized_program_text(p,'digest-zh'))['title']=='欧几里得算法'

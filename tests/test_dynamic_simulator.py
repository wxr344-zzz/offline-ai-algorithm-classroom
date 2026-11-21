import asyncio
from copy import deepcopy
import json
import pytest
from exam_simulator.generated import GeneratedAlgorithm,sandbox,render_trace,compute_trace,CACHE,source_digest
from exam_simulator.sandbox_driver import validate_source

SOURCE='''def solve(data):
    a = data['a']
    b = data['b']
    while b:
        a, b = b, a % b
    return a
'''
ORACLE='''def solve(data):
    a = data['a']
    b = data['b']
    result = 1
    for i in range(1, min(a,b)+1):
        if a % i == 0 and b % i == 0:
            result = i
    return result
'''

def program():
    return GeneratedAlgorithm(valid_algorithm=True,title='欧几里得算法',explanation='辗转相除计算最大公因数',
        input_description='a和b是两个正整数。',output_description='返回两个正整数的最大公因数整数。',default_input={'a':12,'b':8},source=SOURCE,
        validation_inputs=[{'a':12,'b':8},{'a':1,'b':1},{'a':7,'b':3},{'a':9,'b':3}],pointer_names=['i'],
        input_validator='def solve(data):\n    return isinstance(data,dict) and bool(data)\n')


def test_source_patch_aligns_only_a_doubled_indentation_margin():
    from exam_simulator.generated import apply_source_patch, SourcePatch
    source = "def solve(data):\n    result = data['a']\n    return result\n"
    fixed = apply_source_patch(source, SourcePatch(edits=[{'old': 'return result', 'new': "    return data['a']"}]))
    assert fixed == "def solve(data):\n    result = data['a']\n    return data['a']\n"
    validate_source(fixed)


def test_source_patch_does_not_invent_a_missing_block():
    from exam_simulator.generated import apply_source_patch, SourcePatch
    source = "def solve(data):\n    return data['a']\n"
    with pytest.raises(SyntaxError):
        apply_source_patch(source, SourcePatch(edits=[{'old': "return data['a']", 'new': 'if data:'}]))


def pipeline_stage_response(name):
    if name=='CounterexampleReview':return json.dumps({'repair_target':'candidate',
        'reason':'实际反例表明被测实现错误，独立校验结果遵循原始计算定义。'})
    if name=='OracleSemanticsReview':return json.dumps({'computes_required_result':True,
        'reason':'独立校验程序计算原始输出定义，没有替换为相邻算法的结果。'})
    if name=='AlgorithmIdentityReview':return json.dumps({'equivalent':True,'canonical_name':'Euclidean algorithm',
        'reason':'名称保留了原算法的确切含义与变体。'})
    if name=='AlgorithmDefinition':return json.dumps({
        'decision_rule':'辗转相除，最终返回最大公因数。','state_updates':'每次将余数作为下一轮除数。',
        'input_domain':'输入为含所需字段的非空JSON对象。','result_guarantees':'返回原任务定义的真实计算结果。',
        'boundary_rules':'保留题意允许的空列表，缺字段对象无效。'})
    if name=='CandidateReview':return json.dumps({'matches_topic':True,'implementation_correct':True,
        'domain_correct':True,'reason':'候选实现与原始算法主题和合法输入契约一致。'})


@pytest.mark.parametrize('source',[
    'import os\ndef solve(data):\n    return os.environ',
    'def solve(data):\n    return __import__("js").process',
    'def solve(data):\n    return solve.__globals__',
    'def solve(data):\n    return getattr(data,"__class__")',
    'def solve(data):\n    return open(".env.local").read()',
    'def solve(data):\n    return 1 << 1000000000',
    'def solve(data):\n    return "{0.__class__}".format(data)',
    'def solve(data):\n    a = data["array"]\n    a *= 1000000000\n    return a',
    "def solve(data):\n    return f\"{data['a']:1000000000}\"",
])
def test_host_capabilities_never_reach_generated_code(source):
    with pytest.raises(ValueError):validate_source(source)


def test_pure_lambda_key_runs_in_wasm_without_opening_runtime_access():
    candidate=program().model_copy(update={'source':"def solve(data):\n    return sorted([data['a'], data['b'], 0], key=lambda value: abs(value))\n"})
    oracle="def solve(data):\n    return [0,min(data['a'],data['b']),max(data['a'],data['b'])]\n"
    result=asyncio.run(sandbox(candidate,oracle,candidate.default_input))
    assert result['outcome']==[0,8,12]
    assert any(frame['function']=='<lambda>' for frame in result['snapshots'])
    for bad in ["def solve(data):\n    return sorted(data['a'],key=lambda x: x.__class__)\n",
                "def solve(data):\n    return sorted(data['a'],key=lambda x: __import__('os'))\n"]:
        with pytest.raises(ValueError):validate_source(bad)


@pytest.mark.parametrize('source',[
    'import heapq\ndef solve(data):\n    heap = [data["a"], data["b"]]\n    heapq.heapify(heap)\n    return heapq.heappop(heap)\n',
    'def solve(data):\n    import heapq as pq\n    heap = []\n    pq.heappush(heap,data["a"])\n    pq.heappush(heap,data["b"])\n    return pq.heappop(heap)\n',
    'from heapq import heappush as push, heappop as pop\ndef solve(data):\n    heap = []\n    push(heap,data["a"])\n    push(heap,data["b"])\n    return pop(heap)\n',
    'import math\nfrom bisect import bisect_left\ndef solve(data):\n    values = sorted([data["a"],data["b"]])\n    position = bisect_left(values,data["a"])\n    return math.floor(values[0]+position*0)\n',
])
def test_pure_standard_library_capabilities_run_inside_wasm_without_environment_access(source):
    p=program().model_copy(update={'source':source})
    result=asyncio.run(sandbox(p,'def solve(data):\n    return min(data["a"],data["b"])\n',p.default_input))
    assert result['outcome']==8 and result['snapshots']


@pytest.mark.parametrize('source',[
    'import os\ndef solve(data):\n    return data["a"]\n',
    'import heapq\ndef solve(data):\n    return heapq.__dict__\n',
    'from math import __loader__\ndef solve(data):\n    return data["a"]\n',
    'from math import *\ndef solve(data):\n    return data["a"]\n',
    'import importlib\ndef solve(data):\n    return data["a"]\n',
    'import math\ndef solve(data):\n    return math.factorial(data["a"])\n',
])
def test_pure_import_facades_do_not_allow_environment_or_unbounded_module_operations(source):
    with pytest.raises(ValueError):validate_source(source)


def test_rejected_syntax_identifies_the_node_line_and_source_for_repair():
    with pytest.raises(ValueError,match=r'第2行 Import.*import os'):
        validate_source('def solve(data):\n    import os\n    return data["a"]\n')


def test_throwaway_iteration_variable_is_not_a_runtime_capability():
    source='def solve(data):\n    result = 0\n    for _ in range(data["a"]):\n        result += data["b"]\n    return result\n'
    candidate=program().model_copy(update={'source':source})
    result=asyncio.run(sandbox(candidate,'def solve(data):\n    return data["a"]*data["b"]\n',candidate.default_input))
    assert result['outcome']==96
    with pytest.raises(ValueError,match=r'第2行.*_trace_mult'):
        validate_source('def solve(data):\n    return _trace_mult(data["a"],2)\n')


def test_helper_first_source_is_validated_by_ast_not_an_entry_line_regex():
    payload=program().model_dump(mode='json')
    payload['source']='def product(a,b):\n    return a*b\n\ndef solve(data):\n    return product(data["a"],data["b"])\n'
    candidate=GeneratedAlgorithm.model_validate(payload)
    validate_source(candidate.source)
    result=asyncio.run(sandbox(candidate,'def solve(data):\n    return sum([data["b"] for _ in range(data["a"])])\n',candidate.default_input))
    assert result['outcome']==96


def test_checker_runtime_feedback_contains_the_actual_failing_line():
    with pytest.raises(ValueError) as caught:
        asyncio.run(sandbox(program(),'def solve(data):\n    return data[:2]\n',program().default_input))
    message=str(caught.value)
    assert 'CHECKER_EXECUTION_ERROR:' in message
    assert '"line": 2' in message and 'return data[:2]' in message


def test_checker_failure_never_rewrites_candidate_source(monkeypatch):
    import exam_simulator.generated as module
    CACHE.clear();calls=[];checked=[]
    class Provider:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def generate(self,prompt,**kwargs):
            name=kwargs['schema'].__name__;calls.append(name)
            staged=pipeline_stage_response(name)
            if staged:return staged
            if name=='AlgorithmTopic':return json.dumps({'status':'named','title':'候选与校验分离测试','reason':'明确的算法执行回归测试主题。'})
            if name=='ApprovedAlgorithm':return program().model_dump_json()
            raise AssertionError('Checker failure must not invoke '+name)
    async def preflight(candidate,oracle,data):
        checked.append(candidate.source)
        assert oracle==candidate.source
        return {'outcome':4}
    async def broken_checker(*args,**kwargs):
        failure=ValueError('CHECKER_EXECUTION_ERROR: checker is broken')
        failure.checker_source='def solve(data):\n    return data[:2]\n'
        raise failure
    monkeypatch.setattr(module,'OllamaProvider',Provider)
    monkeypatch.setattr(module,'sandbox',preflight)
    monkeypatch.setattr(module,'generate_oracle',broken_checker)
    with pytest.raises(ValueError,match='CHECKER_EXECUTION_ERROR'):
        asyncio.run(module.dynamic_trace('候选与校验分离测试',scope='checker-isolation-regression'))
    assert calls.count('AlgorithmTopic')==1 and calls.count('ApprovedAlgorithm')==1
    assert calls.count('CandidateReview')==3 and 'SourceRepair' not in calls
    assert checked==[SOURCE,SOURCE,SOURCE]
    assert not CACHE


def test_reported_clustering_contract_executes_real_vector_means_and_replays():
    from pathlib import Path
    fixture=json.loads((Path(__file__).parent/'fixtures/kmeans-executable-regression.json').read_text(encoding='utf-8'))
    candidate=GeneratedAlgorithm.model_validate(fixture['program'])
    result=asyncio.run(sandbox(candidate,fixture['oracle'],candidate.default_input))
    assert result['outcome']==[[[2.5,1.0],[2.5,4.0]],[0,1,0,0,1,0]]
    simple=asyncio.run(sandbox(candidate,fixture['oracle'],{'data':[[0,0],[10,10],[0,2],[10,12]],'K':2}))
    assert simple['outcome']==[[[0.0,1.0],[10.0,11.0]],[0,1,0,1]]
    assert result['snapshots'] and len(result['snapshots'])<1200


def test_generator_expression_captures_loop_values_not_compiler_iterator():
    candidate=program().model_copy(update={'source':'def solve(data):\n    return sum(i*i for i in range(data["a"]))+data["b"]\n'})
    oracle='def solve(data):\n    total = data["b"]\n    for i in range(data["a"]):\n        total += i*i\n    return total\n'
    result=asyncio.run(sandbox(candidate,oracle,candidate.default_input))
    assert result['outcome']==514
    generator_frames=[frame for frame in result['snapshots'] if frame['function']=='<genexpr>']
    assert generator_frames and any('i' in frame['state'] for frame in generator_frames)
    assert all('.0' not in frame['state'] for frame in generator_frames)


def test_saved_execution_proof_replays_after_cache_loss_without_model(monkeypatch):
    import hashlib
    from pathlib import Path
    from exam_simulator.generated import replay_execution_proof
    fixture=json.loads((Path(__file__).parent/'fixtures/kmeans-executable-regression.json').read_text(encoding='utf-8'))
    proof={'kind':'independent-execution',**fixture,'sourceHash':hashlib.sha256((fixture['program']['source']+'\n'+fixture['oracle']).encode()).hexdigest()}
    async def forbidden(*args,**kwargs):raise AssertionError('Accepted course must not regenerate source')
    monkeypatch.setattr('ollama_provider.OllamaProvider.generate',forbidden)
    CACHE.clear()
    trace=asyncio.run(replay_execution_proof(proof,{'data':[[0,0],[10,10],[0,2],[10,12]],'K':2},scope='owner-a'))
    assert trace['verified'] and trace['outcome']==[[[0.0,1.0],[10.0,11.0]],[0,1,0,1]]
    proof['sourceHash']='tampered'
    with pytest.raises(ValueError,match='摘要'):
        asyncio.run(replay_execution_proof(proof))


def test_verified_dynamic_contract_survives_restart_and_is_owner_isolated(monkeypatch,tmp_path):
    import exam_simulator.generated as module
    CACHE.clear();monkeypatch.setattr(module,'ROOT',tmp_path)
    # Keep the real sandbox entry while locating the private cache in tmp_path.
    real_root=__import__('pathlib').Path(__file__).resolve().parents[1]
    real_sandbox=module.sandbox
    async def isolated_sandbox(*args):
        monkeypatch.setattr(module,'ROOT',real_root)
        try:return await real_sandbox(*args)
        finally:monkeypatch.setattr(module,'ROOT',tmp_path)
    monkeypatch.setattr(module,'sandbox',isolated_sandbox)
    topic='未预置缓存回归算法';owner='owner:'+'a'*64
    p=program();proof={'kind':'independent-execution','program':p.model_dump(),'oracle':ORACLE,'sourceHash':source_digest(p,ORACLE)}
    asyncio.run(module.remember_verified_contract(topic,owner,proof,teaching_context=topic))
    CACHE.clear()
    class Forbidden:
        def __init__(self,*args,**kwargs):raise AssertionError('model requested')
    monkeypatch.setattr(module,'OllamaProvider',Forbidden)
    trace=asyncio.run(module.dynamic_trace(topic,scope=owner,teaching_context=topic))
    assert trace['verified'] and trace['outcome']==4
    CACHE.clear()
    with pytest.raises(AssertionError,match='model requested'):
        asyncio.run(module.dynamic_trace(topic,scope='owner:'+'b'*64,teaching_context=topic))
    cached=module.verified_contract_path(module.dynamic_key(topic,owner,teaching_context=topic),owner)
    payload=json.loads(cached.read_text(encoding='utf-8'));payload['proof']['sourceHash']='tampered'
    cached.write_text(json.dumps(payload),encoding='utf-8')
    with pytest.raises(AssertionError,match='model requested'):
        asyncio.run(module.dynamic_trace(topic,scope=owner,teaching_context=topic))
    CACHE.clear()


def test_deduplicated_proof_replays_but_new_generation_still_requires_four_cases():
    from pydantic import ValidationError
    from exam_simulator.generated import ApprovedAlgorithm,replay_execution_proof
    p=program().model_copy(update={'validation_inputs':program().validation_inputs[:3]})
    with pytest.raises(ValidationError):ApprovedAlgorithm.model_validate(p.model_dump())
    proof={'kind':'independent-execution','program':p.model_dump(),'oracle':ORACLE,'sourceHash':source_digest(p,ORACLE)}
    trace=asyncio.run(replay_execution_proof(proof))
    assert trace['verified'] and trace['outcome']==4


def test_merged_independent_validation_inputs_survive_saved_contract_reload():
    import hashlib
    from exam_simulator.generated import replay_execution_proof,ApprovedAlgorithm
    p=program().model_copy(update={'validation_inputs':[{'a':i,'b':1} for i in range(1,25)]})
    proof={'kind':'independent-execution','program':p.model_dump(mode='json'),'oracle':ORACLE,
        'sourceHash':source_digest(p,ORACLE)}
    restored=GeneratedAlgorithm.model_validate(proof['program'],strict=True)
    assert len(restored.validation_inputs)==24
    trace=asyncio.run(replay_execution_proof(proof))
    assert trace['outcome']==4 and trace['verification']['checkedInputs']>=25
    # The generation request remains small; only executed merged contracts
    # may carry the larger set. No independently added tests are discarded.
    with pytest.raises(ValueError):ApprovedAlgorithm.model_validate(proof['program'],strict=True)
    excessive={**proof['program'],'validation_inputs':[{'a':i,'b':1} for i in range(1,34)]}
    with pytest.raises(ValueError):GeneratedAlgorithm.model_validate(excessive,strict=True)


def test_real_wasm_execution_and_replay_produce_immutable_actual_snapshots():
    p=program();data={'a':12,'b':8};before=deepcopy(data)
    result=asyncio.run(sandbox(p,ORACLE,data))
    assert data==before and result['outcome']==4
    assert any(s['state'].get('a')==8 and s['state'].get('b')==4 for s in result['snapshots'])
    trace=render_trace(p,result,data,'dynamic-test','hash')
    assert trace['engine']=='python-sandbox' and trace['verified']
    assert trace['verification']['checkedInputs']==5
    assert all(f['views'] for f in trace['frames'])


def test_wrong_result_fails_independent_wasm_check():
    p=program().model_copy(update={'source':'def solve(data):\n    return data["a"] + data["b"]'})
    with pytest.raises(ValueError,match='交叉校验失败'):
        asyncio.run(sandbox(p,ORACLE,p.default_input))


def test_json_numeric_equivalence_does_not_reject_valid_dynamic_algorithms():
    p=program().model_copy(update={'source':'def solve(data):\n    return data["a"] / 1\n'})
    result=asyncio.run(sandbox(p,'def solve(data):\n    return data["a"]\n',p.default_input))
    assert result['outcome']==12.0


def test_boolean_is_not_a_numeric_answer_in_independent_checks():
    p=program().model_copy(update={'source':'def solve(data):\n    return data["a"] > 0\n'})
    with pytest.raises(ValueError,match='交叉校验失败'):
        asyncio.run(sandbox(p,'def solve(data):\n    return int(data["a"] > 0)\n',p.default_input))


def test_model_cannot_omit_empty_collection_boundary_from_validation_inputs():
    p=program().model_copy(update={'source':'def solve(data):\n    return data["array"][0]\n',
        'default_input':{'array':[1]},'validation_inputs':[{'array':[i]} for i in range(1,5)]})
    oracle='def solve(data):\n    values=data["array"]\n    return values[0] if values else -1\n'
    with pytest.raises(ValueError,match='平台边界探测未通过'):
        asyncio.run(sandbox(p,oracle,p.default_input))
    fixed=p.model_copy(update={'source':oracle})
    result=asyncio.run(sandbox(fixed,oracle,p.default_input))
    assert {'input':{'array':[]},'outcome':-1} in result['checkedProbes']


def test_counterexample_repairs_source_without_replacing_task_or_deleting_tests(monkeypatch):
    from exam_simulator.generated import dynamic_trace,CACHE
    calls=[]
    original=program().model_copy(update={'title':'首元素查询','explanation':'返回数组首元素，空列表返回负一。',
        'source':'def solve(data):\n    return data["array"][0]\n',
        'input_description':'array是整数列表，允许空列表。','output_description':'非空时返回首元素，空列表返回-1。',
        'default_input':{'array':[1]},'validation_inputs':[{'array':[i]} for i in range(1,5)]})
    oracle='def solve(data):\n    values=data["array"]\n    return values[0] if values else -1\n'
    fixed='def solve(data):\n    values=data["array"]\n    if not values:\n        return -1\n    return values[0]\n'
    async def generate(self,prompt,**kwargs):
        name=kwargs['schema'].__name__;calls.append(name)
        staged=pipeline_stage_response(name)
        if staged:return staged
        if name=='AlgorithmTopic':return json.dumps({'status':'named','title':'首元素查询','reason':'这是有明确输入输出的查询操作。'})
        if name=='ApprovedAlgorithm':return original.model_dump_json()
        if name=='IndependentOracle':return json.dumps({'source':oracle,'validation_inputs':original.validation_inputs})
        if name=='SourceRepair':
            sent=json.loads(prompt)
            assert 'array' in sent['validation_failure'] and '[]' in sent['validation_failure']
            assert sent['approved_contract']['default_input']==original.default_input
            return json.dumps({'source':fixed})
        if name=='AlgorithmReview':return json.dumps({'matches_topic':True,'algorithm_correct':True,
            'oracle_independent':True,'boundaries_covered':True,'reason':'实现与契约一致，已经处理空数组的边界。'})
        raise AssertionError(name)
    monkeypatch.setattr('ollama_provider.OllamaProvider.generate',generate)
    CACHE.clear()
    trace=asyncio.run(dynamic_trace('首元素查询',scope='counterexample-repair-test'))
    assert trace['outcome']==1
    assert calls.count('ApprovedAlgorithm')==1 and calls.count('SourceRepair')==1
    assert calls.count('IndependentOracle')==2
    CACHE.clear()


def test_infinite_loop_is_stopped_by_instruction_budget():
    p=program().model_copy(update={'source':'def solve(data):\n    while data:\n        x = 1'})
    with pytest.raises(ValueError,match='指令|超时'):
        asyncio.run(sandbox(p,ORACLE,p.default_input))


def test_large_native_allocation_is_stopped_before_allocating():
    p=program().model_copy(update={'source':'def solve(data):\n    n = data["a"]\n    a = [0] * 1000000000\n    return a'})
    with pytest.raises(ValueError,match='分配超过'):
        asyncio.run(sandbox(p,ORACLE,p.default_input))


def test_registry_hit_never_calls_model(monkeypatch):
    def forbidden(*args,**kwargs):raise AssertionError('Registry must not generate code')
    monkeypatch.setattr('exam_simulator.generated.OllamaProvider',forbidden)
    trace=asyncio.run(compute_trace(topic='快速排序算法',data={'array':[3,1,2]}))
    assert trace['engine']=='python-deterministic' and trace['outcome']==[1,2,3]


def test_renaming_variables_is_not_an_independent_oracle():
    from exam_simulator.generated import ast_identity
    # Use an explicit alpha-renaming so quoted JSON input keys are retained.
    renamed="def solve(values):\n    x = values['a']\n    y = values['b']\n    while y:\n        x, y = y, x % y\n    return x\n"
    assert ast_identity(SOURCE)==ast_identity(renamed)
    assert ast_identity('def solve(data):\n    a, b = data["a"], data["b"]\n    return a - b') != ast_identity('def solve(data):\n    a, b = data["a"], data["b"]\n    return b - a')


def test_duplicate_checker_repairs_only_checker_with_specific_feedback():
    from exam_simulator.generated import generate_oracle
    prompts=[]
    class Provider:
        async def generate(self,prompt,**kwargs):
            prompts.append(json.loads(prompt))
            if len(prompts)>1:
                assert kwargs['schema'].__name__=='SourceRepair'
                return json.dumps({'source':ORACLE})
            return json.dumps({'source':SOURCE,'validation_inputs':program().validation_inputs})
    result=asyncio.run(generate_oracle(Provider(),program(),'欧几里得算法'))
    assert result.source==ORACLE and len(prompts)==2
    assert '结构相同' in prompts[1]['execution_error']
    assert prompts[1]['previous_source']==SOURCE
    assert 'return a' not in prompts[0]['instruction']


def test_checker_own_boundary_inputs_are_checked_and_repaired_before_candidate_review():
    from exam_simulator.generated import generate_oracle
    p=program();extra={'a':99,'b':99};prompts=[]
    broken=ORACLE.replace("    a = data['a']", "    if data['a'] == 99:\n        return data['data']['a']\n    a = data['a']")
    class Provider:
        async def generate(self,prompt,**kwargs):
            prompts.append((kwargs['schema'].__name__,json.loads(prompt)))
            if kwargs['schema'].__name__=='IndependentOracle':
                return json.dumps({'source':broken,'validation_inputs':p.validation_inputs+[extra]})
            assert kwargs['schema'].__name__=='SourceRepair'
            assert 'CHECKER_EXECUTION_ERROR' in prompt and '99' in prompt
            assert json.loads(prompt)['entry_argument']==p.default_input
            return json.dumps({'source':ORACLE})
    independent=asyncio.run(generate_oracle(Provider(),p,'独立校验回归'))
    assert independent.source==ORACLE and extra in independent.validation_inputs
    assert [name for name,_ in prompts]==['IndependentOracle','SourceRepair']
    assert p.source==SOURCE and extra not in p.validation_inputs


def test_candidate_counterexample_from_checker_is_retained_for_source_repair():
    from exam_simulator.generated import generate_oracle,CandidateExecutionError
    p=program().model_copy(update={'source':SOURCE.replace("    a = data['a']", "    if data['a'] == 99:\n        return -1\n    a = data['a']")})
    extra={'a':99,'b':99}
    class Provider:
        async def generate(self,prompt,**kwargs):
            return json.dumps({'source':ORACLE,'validation_inputs':p.validation_inputs+[extra]})
    with pytest.raises(CandidateExecutionError) as caught:
        asyncio.run(generate_oracle(Provider(),p,'保留真实反例'))
    assert extra in caught.value.validation_inputs
    assert '99' in str(caught.value)


def test_invalid_graph_endpoints_are_not_mistaken_for_algorithm_counterexamples():
    source='''def solve(data):
    start, end, graph = data['start'], data['end'], data['graph']
    if start == end:
        return [start]
    if end in graph[start]:
        return [start, end]
    return []
'''
    oracle='''def solve(data):
    start, end, graph = data['start'], data['end'], data['graph']
    routes = [[start]]
    while routes:
        path = routes.pop(0)
        if path[-1] == end:
            return path
        for node in graph.get(path[-1], []):
            if node not in path:
                routes.append(path + [node])
    return []
'''
    domain='''def solve(data):
    return isinstance(data, dict) and 'graph' in data and 'start' in data and 'end' in data and isinstance(data['graph'], dict) and data['start'] in data['graph'] and data['end'] in data['graph']
'''
    graph={'A':['B'],'B':[]}
    p=program().model_copy(update={'source':source,'input_validator':domain,
        'default_input':{'start':'A','end':'B','graph':graph},
        'validation_inputs':[{'start':a,'end':b,'graph':graph} for a,b in [('A','B'),('A','A'),('B','A'),('B','B')]]})
    result=asyncio.run(sandbox(p,oracle,p.default_input))
    assert result['outcome']==['A','B'] and len(result['rejectedProbes'])==4
    assert not result['checkedProbes']
    with pytest.raises(ValueError,match='INPUT_DOMAIN_ERROR'):
        asyncio.run(sandbox(p,oracle,{'start':'','end':'','graph':graph}))
    # A rejecting domain predicate cannot make an incorrect program pass.
    p=p.model_copy(update={'input_validator':'def solve(data):\n    return bool(data) and False\n'})
    with pytest.raises(ValueError,match='INPUT_DOMAIN_ERROR'):
        asyncio.run(sandbox(p,oracle,p.default_input))


def test_saved_proof_digest_includes_the_executable_domain_predicate():
    from exam_simulator.generated import replay_execution_proof
    p=program()
    proof={'kind':'independent-execution','program':p.model_dump(mode='json'),
        'oracle':ORACLE,'sourceHash':source_digest(p,ORACLE)}
    proof['program']['input_validator']='def solve(data):\n    return isinstance(data,dict)\n'
    with pytest.raises(ValueError,match='摘要'):
        asyncio.run(replay_execution_proof(proof))


def test_checker_must_replace_invalid_domain_cases_without_altering_candidate():
    from exam_simulator.generated import generate_oracle
    p=program().model_copy(update={'input_validator':"def solve(data):\n    return 'a' in data and 'b' in data\n"})
    calls=[]
    class Provider:
        async def generate(self,prompt,**kwargs):
            calls.append(kwargs['schema'].__name__)
            assert kwargs['schema'].__name__ in ('IndependentOracle','ValidationInputRepair')
            if len(calls)==1:inputs=p.validation_inputs+[{'x':1}]
            else:
                assert 'INPUT_DOMAIN_ERROR' in prompt
                inputs=p.validation_inputs+[{'a':99,'b':99}]
                return json.dumps({'validation_inputs':inputs})
            return json.dumps({'source':ORACLE,'validation_inputs':inputs})
    independent=asyncio.run(generate_oracle(Provider(),p,'输入域回归'))
    assert len(calls)==2 and {'a':99,'b':99} in independent.validation_inputs
    assert p.source==SOURCE and len(p.validation_inputs)==4


def test_checker_syntax_repair_preserves_valid_logic_and_uses_exact_indentation():
    from exam_simulator.generated import patch_checker,AlgorithmDefinition
    source="def solve(data):\n    result = data['a']\n        return result\n"
    class Provider:
        async def generate(self,prompt,**kwargs):
            assert kwargs['schema'].__name__=='SourcePatch'
            assert 'unexpected indent' in prompt and 'syntax_error' in prompt
            return json.dumps({'edits':[{'old':'        return result','new':'    return result'}]})
    definition=AlgorithmDefinition.model_validate_json(pipeline_stage_response('AlgorithmDefinition'))
    fixed=asyncio.run(patch_checker(Provider(),source,definition,'unexpected indent',program()))
    assert fixed=="def solve(data):\n    result = data['a']\n    return result\n"
    validate_source(fixed)


def test_failed_checker_syntax_patch_retains_original_source_for_the_next_round():
    from exam_simulator.generated import patch_checker,AlgorithmDefinition
    source="def solve(data):\n    result = data['a']\n        return result\n"
    class Provider:
        async def generate(self,*args,**kwargs):
            return json.dumps({'edits':[{'old':'missing statement','new':'    return result'}]})
    definition=AlgorithmDefinition.model_validate_json(pipeline_stage_response('AlgorithmDefinition'))
    with pytest.raises(ValueError) as caught:
        asyncio.run(patch_checker(Provider(),source,definition,'unexpected indent',program()))
    assert caught.value.checker_source==source


def test_multiple_valid_outputs_require_new_independent_execution_under_explicit_policy(monkeypatch):
    import exam_simulator.generated as module
    p=program();p.output_description='允许返回一种正确表示。'
    definition=module.AlgorithmDefinition.model_validate_json(pipeline_stage_response('AlgorithmDefinition'))
    calls=[];executed=[]
    class Provider:
        async def generate(self,prompt,**kwargs):
            name=kwargs['schema'].__name__;calls.append(name)
            if name=='IndependentOracle':
                return json.dumps({'source':ORACLE if calls.count(name)>1 else "def solve(data):\n    return [data['a'],data['b']]\n",'validation_inputs':p.validation_inputs})
            if name=='CounterexampleReview':return json.dumps({'repair_target':'checker','reason':'两个结果的表示均被旧契约允许，需固定表示形式。',
                'multiple_valid_outputs':True,'deterministic_output_policy':'返回最大公因数的整数表示，不使用分解列表。',
                'deterministic_boundary_rules':'按整数返回结果，单位输入的最大公因数为一。'})
            return pipeline_stage_response(name)
    async def execute(checked,oracle,data):
        executed.append(checked.output_description)
        if len(executed)==1:raise ValueError('独立实现交叉校验失败：{"actual":4,"expected":[12,8]}')
        assert checked.output_description=='返回最大公因数的整数表示，不使用分解列表。'
        return {'outcome':4}
    monkeypatch.setattr(module,'sandbox',execute)
    result=asyncio.run(module.generate_oracle(Provider(),p,'表示约定测试',definition=definition))
    assert result.source==ORACLE and len(executed)==2
    assert calls.count('IndependentOracle')==2


def test_owner_failure_checkpoint_is_untrusted_and_rechecked_before_publication(monkeypatch,tmp_path):
    import exam_simulator.generated as module
    CACHE.clear();monkeypatch.setattr(module,'ROOT',tmp_path)
    topic='未预置恢复测试';owner='owner:'+'c'*64
    key=module.dynamic_key(topic,owner,teaching_context=topic)
    (tmp_path/'logs').mkdir()
    (tmp_path/'logs'/f'{key}-verification-failure.json').write_text(json.dumps({
        'topic':topic,'program':program().model_dump(mode='json')}),encoding='utf-8')
    calls=[];executions=[]
    class Provider:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def generate(self,prompt,**kwargs):
            name=kwargs['schema'].__name__;calls.append(name)
            if name=='AlgorithmTopic':return json.dumps({'status':'named','title':'Recovery test algorithm','reason':'明确算法主题的恢复回归测试。'})
            if name=='CandidateReview':return json.dumps({'matches_topic':False,'implementation_correct':False,
                'domain_correct':True,'definition_correct':True,'violation_kind':'state_update','reason':'恢复的旧实现没有通过新的独立语义检查，不能发布。'})
            if name=='SemanticContractRepair':raise RuntimeError('checkpoint re-review reached')
            return pipeline_stage_response(name)
    async def forbidden(*args):
        executions.append(True)
        raise AssertionError('Rejected checkpoint must not execute or publish')
    monkeypatch.setattr(module,'OllamaProvider',Provider)
    monkeypatch.setattr(module,'sandbox',forbidden)
    with pytest.raises(RuntimeError,match='checkpoint re-review reached'):
        asyncio.run(module.dynamic_trace(topic,scope=owner,teaching_context=topic))
    assert 'ApprovedAlgorithm' not in calls and calls.count('CandidateReview')==2
    assert not executions and not CACHE


def test_semantically_wrong_algorithm_regenerates_the_contract_before_result_comparison(monkeypatch):
    import exam_simulator.generated as module
    CACHE.clear();calls=[];reviews=0
    class Provider:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def generate(self,prompt,**kwargs):
            nonlocal reviews
            name=kwargs['schema'].__name__;calls.append(name)
            if name=='AlgorithmTopic':return json.dumps({'status':'named','title':'未预置运算变体','reason':'明确指定的一种计算主题，不属于现有目录。'})
            if name in ('ApprovedAlgorithm','SemanticContractRepair'):return program().model_dump_json()
            if name=='CandidateReview':
                reviews+=1
                return json.dumps({'matches_topic':reviews>2,'implementation_correct':reviews>2,
                    'domain_correct':True,'definition_correct':reviews>2,'violation_kind':'state_update','canonical_name':'Verified algorithm identity',
                    'reason':'第一次实现采用了相邻算法的决策准则，必须纠正完整契约。'})
            staged=pipeline_stage_response(name)
            if staged:return staged
            if name=='IndependentOracle':return json.dumps({'source':ORACLE,'validation_inputs':program().validation_inputs})
            if name=='AlgorithmReview':return json.dumps({'matches_topic':True,'algorithm_correct':True,
                'oracle_independent':True,'boundaries_covered':True,'reason':'运算规则与输入域一致，独立检查使用枚举。'})
            raise AssertionError(name)
    monkeypatch.setattr(module,'OllamaProvider',Provider)
    result=asyncio.run(compute_trace(topic='未预置运算变体',scope='semantic-regression'))
    assert result['verified'] and result['outcome']==4
    assert calls.count('ApprovedAlgorithm')==1 and calls.count('SemanticContractRepair')==1 and calls.count('AlgorithmDefinition')==2
    assert calls.count('IndependentOracle')==1 and 'SourceRepair' not in calls
    CACHE.clear()


def test_review_challenge_uses_actual_decisions_instead_of_auxiliary_variable_names(monkeypatch):
    import exam_simulator.generated as module
    CACHE.clear();reviews=0;calls=[]
    p=program().model_copy(update={'source':SOURCE.replace("    a = data['a']","    g_score = 0\n    a = data['a']")})
    class Provider:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def generate(self,prompt,**kwargs):
            nonlocal reviews
            name=kwargs['schema'].__name__;calls.append(name)
            if name=='AlgorithmTopic':return json.dumps({'status':'named','title':'Uncatalogued auxiliary state test','reason':'明确指定的目录外算法测试主题。'})
            if name=='ApprovedAlgorithm':return p.model_dump_json()
            if name=='CandidateReview':
                reviews+=1
                if reviews==2:
                    sent=json.loads(prompt)
                    assert any(site['expression']=='b' for site in sent['selection_evidence'])
                    assert 'g_score' in sent['initial_critique']
                return json.dumps({'matches_topic':reviews>1,'implementation_correct':reviews>1,
                    'domain_correct':True,'reason':'g_score是辅助变量；实际循环使用余数更新，并非其他算法。'})
            staged=pipeline_stage_response(name)
            if staged:return staged
            if name=='IndependentOracle':return json.dumps({'source':ORACLE,'validation_inputs':p.validation_inputs})
            raise AssertionError(name)
    monkeypatch.setattr(module,'OllamaProvider',Provider)
    result=asyncio.run(module.dynamic_trace('目录外辅助状态测试',scope='review-evidence-test'))
    assert result['outcome']==4 and reviews==2
    assert 'SourceRepair' not in calls and 'SemanticContractRepair' not in calls
    CACHE.clear()


def test_checker_semantic_defect_repairs_checker_without_rewriting_candidate():
    from exam_simulator.generated import generate_oracle,AlgorithmDefinition
    calls=[];reviews=0
    definition=AlgorithmDefinition.model_validate_json(pipeline_stage_response('AlgorithmDefinition'))
    class Provider:
        async def generate(self,prompt,**kwargs):
            nonlocal reviews
            name=kwargs['schema'].__name__;calls.append(name)
            if name=='IndependentOracle':return json.dumps({'source':'def solve(data):\n    return data["a"] + data["b"]\n','validation_inputs':program().validation_inputs})
            if name=='OracleSemanticsReview':
                reviews+=1
                return json.dumps({'computes_required_result':reviews>1,'violation_kind':'state_update','reason':'首个校验器求和而非最大公因数，修复后按定义计算最大公因数。'})
            if name=='LinePatch':
                sent=json.loads(prompt)
                assert 'CHECKER_SEMANTICS_ERROR' in sent['execution_evidence']
                return json.dumps({'edits':[{'start_line':1,'end_line':len(sent['code_to_patch'].splitlines()),'replacement':ORACLE}]})
            raise AssertionError(name)
    p=program()
    result=asyncio.run(generate_oracle(Provider(),p,'Euclidean algorithm',definition=definition))
    assert result.source==ORACLE and p.source==SOURCE
    assert calls==['IndependentOracle','OracleSemanticsReview','LinePatch','OracleSemanticsReview']


def test_execution_disagreement_does_not_treat_checker_as_automatic_ground_truth():
    from exam_simulator.generated import generate_oracle,AlgorithmDefinition
    calls=[]
    definition=AlgorithmDefinition.model_validate_json(pipeline_stage_response('AlgorithmDefinition'))
    class Provider:
        async def generate(self,prompt,**kwargs):
            name=kwargs['schema'].__name__;calls.append(name)
            if name=='IndependentOracle':return json.dumps({'source':'def solve(data):\n    return data.get("missing")\n','validation_inputs':program().validation_inputs})
            if name=='OracleSemanticsReview':return json.dumps({'computes_required_result':True,'reason':'静态审查通过但必须继续执行交叉校验以捕捉具体反例。'})
            if name=='CounterexampleReview':return json.dumps({'repair_target':'checker','reason':'被测代码辗转相除正确，校验器固定返回None，因此修复校验器。'})
            if name=='LinePatch':
                sent=json.loads(prompt)
                assert sent['execution_evidence']['actual']==4
                assert sent['execution_evidence']['expected'] is None
                assert '固定返回None' not in json.dumps(sent['execution_evidence'])
                return json.dumps({'edits':[{'start_line':1,'end_line':len(sent['code_to_patch'].splitlines()),'replacement':ORACLE}]})
            raise AssertionError(name)
    p=program()
    result=asyncio.run(generate_oracle(Provider(),p,'Euclidean algorithm',definition=definition))
    assert result.source==ORACLE and p.source==SOURCE
    assert 'CounterexampleReview' in calls and calls.count('LinePatch')==1 and 'SourceRepair' not in calls


def test_unchanged_checker_repair_uses_a_concrete_patch_and_still_executes_checks():
    from exam_simulator.generated import generate_oracle,AlgorithmDefinition
    calls=[]
    bad=ORACLE.replace('return result','return missing')
    definition=AlgorithmDefinition.model_validate_json(pipeline_stage_response('AlgorithmDefinition'))
    class Provider:
        async def generate(self,prompt,**kwargs):
            name=kwargs['schema'].__name__;calls.append(name)
            if name=='IndependentOracle':return json.dumps({'source':bad,'validation_inputs':program().validation_inputs})
            if name=='OracleSemanticsReview':return json.dumps({'computes_required_result':True,'reason':'继续执行反例验证，不以模型审查代替实际检查。'})
            if name=='CounterexampleReview':return json.dumps({'repair_target':'checker','reason':'校验器最后一行返回求和而非计算出的最大公因数，应修复返回表达式。'})
            if name=='SourceRepair':return json.dumps({'source':bad})
            if name=='SourcePatch':return json.dumps({'edits':[{'old':'return missing','new':'return result'}]})
            raise AssertionError(name)
    result=asyncio.run(generate_oracle(Provider(),program(),'Euclidean algorithm'))
    assert result.source==ORACLE and calls.count('SourcePatch')==1


def test_grounded_key_proposal_preserves_independent_solver_and_rejects_mutable_scores():
    from exam_simulator.generated import grounded_input_key_repair
    candidate='def solve(data):\n    h = data["h"]\n    nodes = data["nodes"]\n    return min(nodes, key=lambda node: h[node])\n'
    checker='def solve(data):\n    h = data["h"]\n    nodes = data["nodes"]\n    costs = data["costs"]\n    selected = min(nodes, key=lambda vertex: costs[vertex] + h[vertex])\n    return selected\n'
    proposed=grounded_input_key_repair(candidate,checker)
    assert proposed is not None and 'key=lambda vertex: h[vertex]' in proposed
    assert 'costs = data["costs"]' in proposed and 'return selected' in proposed
    assert grounded_input_key_repair(candidate.replace('    return min','    h[0] = 9\n    return min'),checker) is None
    assert grounded_input_key_repair(candidate.replace('    return min','    h.update({0: 9})\n    return min'),checker) is None
    assert grounded_input_key_repair(candidate.replace('    return min','    alias = h\n    return min'),checker) is None
    assert grounded_input_key_repair(candidate,checker.replace('data["h"]','data["different"]')) is None


def test_line_patch_preserves_scope_and_rejects_overlapping_or_out_of_range_edits():
    from exam_simulator.generated import LinePatch,apply_line_patch
    source='def solve(data):\n    if data["a"]:\n        return missing\n    return 0\n'
    patch=LinePatch(edits=[{'start_line':3,'end_line':3,'replacement':'return data["a"]'}])
    assert apply_line_patch(source,patch)==source.replace('return missing','return data["a"]')
    for edits in [[{'start_line':8,'end_line':8,'replacement':'return 1'}],
        [{'start_line':2,'end_line':3,'replacement':'pass'},{'start_line':3,'end_line':3,'replacement':'pass'}]]:
        with pytest.raises(ValueError,match='越界或区间重叠'):
            apply_line_patch(source,LinePatch(edits=edits))


def test_selection_evidence_tracks_priority_dependencies_without_unrelated_costs():
    from exam_simulator.generated import selection_evidence
    source="""def solve(data):
    heuristic = data['h']
    g_score = data['cost']
    open_list = data['nodes']
    return min(open_list, key=lambda node: heuristic[node])
"""
    evidence=selection_evidence(source)
    bindings='\n'.join(item['expression'] for item in evidence['dependencies'])
    assert 'heuristic =' in bindings and 'g_score =' not in bindings
    source=source.replace("    return min", "    priority = {node: g_score[node] + heuristic[node] for node in open_list}\n    return min").replace('lambda node: heuristic[node]','lambda node: priority[node]')
    bindings='\n'.join(item['expression'] for item in selection_evidence(source)['dependencies'])
    assert 'g_score =' in bindings and 'priority =' in bindings


def test_pointers_only_attach_to_actual_subscripted_locals_not_input_copies():
    from exam_simulator.generated import views_from_snapshot
    views=views_from_snapshot({'data':{'array':[3,1]},'array':[1,3],'other':[8],'i':1},{'array':{'i'}})
    by_name={v['name']:v for v in views}
    assert by_name['局部变量.array']['pointers']=={'i':1}
    assert by_name['局部变量.data.array']['pointers']=={}
    assert by_name['局部变量.other']['pointers']=={}


def test_ragged_tables_preserve_actual_cells_and_views_are_never_silently_truncated():
    from exam_simulator.generated import views_from_snapshot
    views=views_from_snapshot({'triangle':[[1],[1,1],[1,2,1]]},{})
    matrix=next(v for v in views if v['kind']=='matrix')
    assert matrix['values']==[[1],[1,1],[1,2,1]]
    assert len(views_from_snapshot({f'array{i}':[i] for i in range(25)},{}))==25
    with pytest.raises(ValueError,match='不会省略'):
        views_from_snapshot({f'array{i}':[i] for i in range(65)},{})


def test_ambiguous_topic_does_not_silently_generate_another_algorithm(monkeypatch):
    import exam_simulator.generated as module
    CACHE.clear();calls=[]
    class Provider:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def generate(self,prompt,**kwargs):
            calls.append(kwargs['schema'].__name__)
            return json.dumps(dict(status='ambiguous',title='查找算法',reason='请补充具体算法名称及变体，不能自动替换。'))
    monkeypatch.setattr(module,'OllamaProvider',Provider)
    with pytest.raises(ValueError,match='补充具体算法'):
        asyncio.run(compute_trace(topic='一个非常含糊的大类主题'))
    assert calls==['AlgorithmTopic'] and not CACHE


def test_unknown_algorithm_generates_checks_and_caches_without_model_frames(monkeypatch):
    import exam_simulator.generated as module
    CACHE.clear();calls=[]
    class Provider:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def generate(self,prompt,**kwargs):
            calls.append(kwargs['schema'].__name__)
            staged=pipeline_stage_response(kwargs['schema'].__name__)
            if staged:return staged
            if kwargs['schema'].__name__=='AlgorithmTopic':
                return json.dumps(dict(status='named',title='测试算法变体',reason='这是一个明确命名的算法测试主题。'))
            if kwargs['schema'].__name__=='ApprovedAlgorithm':return program().model_dump_json()
            if kwargs['schema'].__name__=='IndependentOracle':
                assert SOURCE not in prompt
                return json.dumps({'source':ORACLE,'validation_inputs':program().validation_inputs})
            return json.dumps(dict(matches_topic=True,algorithm_correct=True,oracle_independent=True,
                boundaries_covered=True,reason='辗转相除与枚举公约数采用不同计算方式，边界样例已覆盖。'))
    monkeypatch.setattr(module,'OllamaProvider',Provider)
    topic='未预置的测试算法变体'
    a=asyncio.run(compute_trace(topic=topic))
    b=asyncio.run(compute_trace(a['algorithm'],topic,{'a':9,'b':3}))
    assert a['outcome']==4 and b['outcome']==3
    assert calls==['AlgorithmTopic','AlgorithmIdentityReview','AlgorithmDefinition','ApprovedAlgorithm','CandidateReview','IndependentOracle','OracleSemanticsReview']
    assert b['verification']['sourceHash']==a['verification']['sourceHash']
    CACHE.clear()


def test_model_renaming_unknown_topic_never_shortcuts_to_a_catalog_executor(monkeypatch):
    import exam_simulator.generated as module
    CACHE.clear();calls=[]
    class Provider:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def generate(self,prompt,**kwargs):
            name=kwargs['schema'].__name__;calls.append(name)
            if name=='AlgorithmTopic':return json.dumps({'status':'named','title':'A-star','reason':'模拟名称识别错误，将目录外主题误标成已有条目。'})
            staged=pipeline_stage_response(name)
            if staged:return staged
            if name=='ApprovedAlgorithm':return program().model_dump_json()
            if name=='IndependentOracle':return json.dumps({'source':ORACLE,'validation_inputs':program().validation_inputs})
            if name=='AlgorithmReview':return json.dumps({'matches_topic':True,'algorithm_correct':True,
                'oracle_independent':True,'boundaries_covered':True,'reason':'按照原始任务独立验证，没有静默替换算法。'})
            raise AssertionError(name)
    def forbidden(*args,**kwargs):raise AssertionError('Model must not substitute a catalog executor')
    monkeypatch.setattr(module,'OllamaProvider',Provider)
    monkeypatch.setattr(module,'run_trace',forbidden)
    result=asyncio.run(module.dynamic_trace('目录外算法身份保持测试',scope='no-model-reroute'))
    assert result['engine']=='python-sandbox' and 'ApprovedAlgorithm' in calls and 'CandidateReview' in calls
    CACHE.clear()

"""Algorithm-independent lesson compiler over an executable algorithm contract.

The model may label the application, but never invents its code, examples or
answers. Known executors and independently checked dynamic programs share the
same single-query -> batch aggregation compiler and WASM acceptance gate.
"""
import ast
from copy import deepcopy
from dataclasses import dataclass
import hashlib
import inspect
import json
import logging
from pathlib import Path
import random
import re
from textwrap import indent
from typing import Literal
from pydantic import Field
from lab_contracts import InternalModel, LabDraft, TestCase, TeachingStep, PrivateAssessment, OJLabScene
from lab_assembly import normalize_generated_draft, assemble_lab
from lesson_execution import verify_drafts
from ollama_provider import OllamaProvider, OllamaError, OllamaResponseError

logger=logging.getLogger(__name__)
ROOT=Path(__file__).resolve().parent


class AlgorithmContractError(ValueError):
    pass


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)


@dataclass
class AlgorithmContract:
    key: str
    title: str
    source: str
    examples: list  # (input dict, executed JSON outcome)
    input_description: str
    output_description: str
    teaching_steps: list
    verification: dict | None = None
    rule_description: str = ''


def registry_source(key,result_key=None):
    """Bundle the maintained core and defining module without host eval/imports.

    The resulting ordinary Python is portable to the browser's Pyodide runtime.
    Relative imports are linked statically; stdlib imports remain ordinary code.
    """
    from exam_simulator.core import REGISTRY
    module=Path(inspect.getsourcefile(REGISTRY[key]['run']))
    statements=[]
    for path in [ROOT/'exam_simulator'/'core.py',module]:
        tree=ast.parse(path.read_text(encoding='utf-8'))
        for node in tree.body:
            if isinstance(node,ast.ImportFrom) and (node.level or node.module=='__future__'):
                continue
            statements.append(node)
    # A local function scope links class methods and decorators using closures;
    # no exec/eval, server modules, filesystem or Node bridge is embedded.
    body=ast.unparse(ast.Module(body=statements,type_ignores=[]))
    projection=f'[{result_key!r}]' if result_key else ''
    return 'def algorithm_result(data):\n'+indent(body,'    ')+f'\n    return run_trace({key!r}, data=data)["outcome"]{projection}\n'


def mutations(data, budget=350):
    """Generate candidate boundary inputs; executors decide validity, never guesses."""
    yield deepcopy(data)
    def relabel(value,delta):
        if type(value)is int:return value+delta
        if isinstance(value,list):return [relabel(v,delta) for v in value]
        if isinstance(value,dict):return {k:relabel(v,delta) for k,v in value.items()}
        return value
    # Correlated fields (e.g. preorder + inorder) must sometimes change
    # together. Candidates still go through the real executor's input checks.
    for delta in (1,2,3,-1,10):yield relabel(data,delta)
    paths=[]
    def visit(value,path):
        paths.append((path,value))
        if isinstance(value,dict):
            for k,v in value.items(): visit(v,path+[k])
        elif isinstance(value,list):
            for i,v in enumerate(value[:12]): visit(v,path+[i])
    visit(data,[])
    count=0
    for path,value in paths:
        if not path: continue
        options=[]
        if type(value)is int: options=[0,1,-1,value+1,value-1,value+2]
        elif type(value)is bool: options=[not value]
        elif isinstance(value,str): options=['',value[:1],value[:-1],value+'()',value+'a',value.upper(),
            '('+value+')',value+' + 1',value+' + 2',value+' * 2']
        elif isinstance(value,list): options=[[],value[:1],value[:-1],list(reversed(value)),value+value[:1]]
        for replacement in options:
            if replacement==value: continue
            changed=deepcopy(data); cursor=changed
            for part in path[:-1]:cursor=cursor[part]
            cursor[path[-1]]=replacement
            yield changed
            count+=1
            if count>=budget:return


def maintained_input_constraints(profile):
    """Read only guards belonging to this executor's algorithm branch.

    Shared dispatch functions contain other algorithms and internal proof
    assertions. Those are not input restrictions. Specialize only literal
    comparisons of the registered key; unknown data-dependent branches stay
    conservative. No executor/source expression is evaluated here.
    """
    unknown=object()
    tree=ast.parse(inspect.getsource(profile['run']))
    function=next(n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)))
    trace_arg=function.args.args[0].arg
    result=[]
    def value(node, env):
        if isinstance(node,ast.Constant):return node.value
        if isinstance(node,ast.Name):return env.get(node.id,unknown)
        if isinstance(node,ast.Attribute) and isinstance(node.value,ast.Name) and node.value.id==trace_arg and node.attr=='key':return profile['id']
        if isinstance(node,(ast.Tuple,ast.List,ast.Set)):
            parts=[value(part,env) for part in node.elts]
            return unknown if any(part is unknown for part in parts) else parts
        if isinstance(node,ast.UnaryOp) and isinstance(node.op,ast.Not):
            item=value(node.operand,env)
            return unknown if item is unknown else not item
        if isinstance(node,ast.Compare) and len(node.ops)==1:
            left,right=value(node.left,env),value(node.comparators[0],env)
            if left is unknown or right is unknown:return unknown
            op=node.ops[0]
            if isinstance(op,ast.Eq):return left==right
            if isinstance(op,ast.NotEq):return left!=right
            if isinstance(op,ast.In) and isinstance(right,(str,list,tuple)):return left in right
            if isinstance(op,ast.NotIn) and isinstance(right,(str,list,tuple)):return left not in right
        return unknown
    def collect(node):
        for part in ast.walk(node):
            if isinstance(part,ast.Call) and isinstance(part.func,ast.Name) and part.func.id=='require' and len(part.args)>1 and isinstance(part.args[1],ast.Constant) and isinstance(part.args[1].value,str):
                message=part.args[1].value
                if not re.search(r'校验失败|核对失败|前驱链错误',message):result.append(message)
    def walk(statements,env):
        for node in statements:
            if isinstance(node,ast.If):
                decision=value(node.test,env)
                if decision is unknown:
                    walk(node.body,dict(env));walk(node.orelse,dict(env))
                else:walk(node.body if decision else node.orelse,env)
            elif isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)):
                walk(node.body,dict(env))
            elif isinstance(node,(ast.For,ast.While)):
                walk(node.body,dict(env));walk(node.orelse,dict(env))
            elif isinstance(node,ast.Try):
                for body in [node.body,node.orelse,node.finalbody,*[h.body for h in node.handlers]]:walk(body,dict(env))
            else:
                collect(node)
                if isinstance(node,ast.Assign):
                    for target in node.targets:
                        if isinstance(target,ast.Name):env[target.id]=value(node.value,env)
    walk(function.body,{})
    return list(dict.fromkeys(result))


def known_contract(key):
    from exam_simulator.core import REGISTRY,run_trace
    profile=REGISTRY[key]
    examples=[];seen=set();first=None
    for data in mutations(profile['default']):
        fingerprint=canonical(data)
        if fingerprint in seen:continue
        seen.add(fingerprint)
        try:
            trace=run_trace(key,data=data)
            canonical(trace['outcome'])
        except (ValueError,IndexError,KeyError,TypeError,ZeroDivisionError):continue
        first=first or trace
        examples.append((data,trace['outcome']))
        if len(examples)>=10:break
    if len(examples)<4: raise ValueError(f'{key} 缺少四组有效边界输入，未发布实验')
    # Saved exports require three hidden cases; reuse executed inputs if a
    # tightly constrained domain is smaller, without inventing new answers.
    original=deepcopy(examples)
    while len(examples)<7:examples.append(deepcopy(original[len(examples)%len(original)]))
    fields='；'.join(f'{name}：{type(value).__name__}，示例 {canonical(value)}' for name,value in profile['default'].items())
    constraints=maintained_input_constraints(profile)
    fields+='。有效输入约束：'+'；'.join(dict.fromkeys(constraints)) if constraints else '。输入规模使用教学级小数据，输入与公开样例保持同一结构。'
    outcome=first['outcome']
    # Prefer a uniquely defined semantic result to an arbitrary witness (LCS
    # choice, MST edges, Huffman codewords) or an implementation's scratch DP.
    # This is shape-driven, not another algorithm-name routing whitelist.
    names={'value':'最优值或计算值','length':'长度','distance':'距离','distances':'距离表',
        'wpl':'带权路径长度','total':'总量','cost':'成本','duration':'工期',
        'inorder':'中序键序列','keys':'键序列','order':'遍历序列'}
    result_key=next((k for k in names if isinstance(outcome,dict) and k in outcome
        and all(isinstance(v,dict) and k in v for _,v in examples)),None)
    if result_key:
        examples=[(d,v[result_key]) for d,v in examples]
        outcome=outcome[result_key]
    shape=('字段 '+', '.join(outcome) if isinstance(outcome,dict) else 'JSON列表' if isinstance(outcome,list) else 'JSON标量')
    frames=first['frames']
    selected=[frames[0],frames[len(frames)//2],frames[-1]]
    steps=[TeachingStep(step_id=f'execution-{i}',title=f['label'],instruction=f['explanation']) for i,f in enumerate(selected)]
    meaning=(f'只返回执行结果的 {result_key}（{names[result_key]}），不要求输出多解见证或内部工作表。' if result_key else '')
    rules='图的邻接点按编号升序处理，发现即标记；使用队列时先进先出，初始可用结点按编号升序入队，新发现项加入队尾。' if {'n','edges'}<=profile['default'].keys() else ''
    source=registry_source(key,result_key)
    return AlgorithmContract(key,profile['title'],source,examples,fields,
        meaning+f'结果类型：{shape}。下标、不可达哨兵与边界参照公开样例。对象字段顺序不影响判断。'+rules,steps,
        {'kind':'maintained-executor','algorithm':key,'sourceHash':hashlib.sha256(source.encode()).hexdigest()})


async def dynamic_contract(topic,identity,*,purpose='algorithm',requirement=None):
    from exam_simulator.generated import dynamic_trace,CACHE,sandbox
    from exam_simulator.core import REGISTRY
    trace=await dynamic_trace(topic,scope=identity,purpose=purpose,teaching_context=requirement)
    if trace['algorithm'] in REGISTRY:return known_contract(trace['algorithm'])
    program,oracle,digest=CACHE[trace['algorithm']]
    return await verified_program_contract(program,oracle,digest,trace['algorithm'])


def input_shape(value):
    if isinstance(value,list):return 'list['+'|'.join(sorted({input_shape(v) for v in value})) + ']' if value else 'list'
    if isinstance(value,dict):return 'object'
    return {int:'int',float:'number',str:'str',bool:'bool',type(None):'null'}[type(value)]


class LocalizedProgramText(InternalModel):
    title: str=Field(min_length=2,max_length=60,description='算法的简体中文名称')
    explanation: str=Field(min_length=4,max_length=500,description='计算规则的简体中文说明')
    input_description: str=Field(min_length=4,max_length=800,description='输入的简体中文说明，字段名保持原样')
    output_description: str=Field(min_length=4,max_length=800,description='输出的简体中文说明，字段名保持原样')


_LOCALIZED={}
_TEXT_FIELDS=('title','explanation','input_description','output_description')


def is_chinese_text(text):
    """Readable as Chinese: CJK characters, not a sentence of English words."""
    cjk=len(re.findall(r'[\u4e00-\u9fff]',text))
    words=len(re.findall(r'[A-Za-z]{3,}',text))
    return cjk>=2 and words<=max(6,cjk//2)


async def localized_program_text(program,digest):
    """The Lab is a Chinese course page: the verified program's prose may come
    back in English from the model, so translate it once (identifiers kept).
    Never fails: an unusable translation falls back to neutral Chinese wording."""
    original={f:getattr(program,f) for f in _TEXT_FIELDS}
    if all(is_chinese_text(v) for v in original.values()):return original
    if digest in _LOCALIZED:return _LOCALIZED[digest]
    names=list(program.default_input)
    try:
        async with OllamaProvider(timeout=90) as provider:
            raw=await provider.generate(json.dumps({'task':'把以下算法说明翻译成简体中文。字段名、变量名、数字和 JSON 写法保持原样，不增删规则。',
                'fields':original,'keep_identifiers':names},ensure_ascii=False),
                schema=LocalizedProgramText,json_mode=True,options={'temperature':0.1,'num_predict':900,'num_ctx':4096})
        text=LocalizedProgramText.model_validate_json(raw,strict=True).model_dump()
        for field in _TEXT_FIELDS:
            if not is_chinese_text(text[field]):raise ValueError(f'{field} 仍不是中文')
        for name in names:
            if name in original['input_description'] and name not in text['input_description']:
                raise ValueError(f'翻译丢失字段名 {name}')
    except Exception as exc:  # a wording step must never invalidate a verified program
        logger.warning('算法说明中文化未完成，使用中性中文措辞：%s',type(exc).__name__)
        text={'title':original['title'] if is_chinese_text(original['title']) else '本题算法',
            'explanation':original['explanation'] if is_chinese_text(original['explanation']) else '按本题算法对输入计算结果，规则与公开样例一致。',
            'input_description':original['input_description'] if is_chinese_text(original['input_description']) else '输入对象的字段与类型见字段约定和公开样例。',
            'output_description':original['output_description'] if is_chinese_text(original['output_description']) else '返回值的结构以公开样例为准；空输入的结果见样例。'}
    _LOCALIZED[digest]=text
    return text


async def verified_program_contract(program,oracle,digest,key):
    from exam_simulator.generated import sandbox,source_digest
    if source_digest(program,oracle)!=digest:
        raise ValueError('独立校验记录的源码摘要不一致')
    text=await localized_program_text(program,digest)
    # The published interface owns its required fields. A permissive generated
    # implementation (data.get('n', 0), for example) must not quietly introduce
    # missing-field examples into a task that tells learners the field is required.
    required = set(program.default_input)
    def in_domain(data):
        return isinstance(data, dict) and required <= data.keys()
    values={canonical(d):d for d in [program.default_input]+program.validation_inputs if in_domain(d)}
    examples=[]
    seen=set()
    for data in values.values():
        result=await sandbox(program,oracle,data)
        if canonical(data) not in seen:
            examples.append((deepcopy(data),result['outcome']));seen.add(canonical(data))
        for probe in result.get('checkedProbes',[]):
            if in_domain(probe['input']) and canonical(probe['input']) not in seen:
                examples.append((probe['input'],probe['outcome']));seen.add(canonical(probe['input']))
    original=deepcopy(examples)
    while len(examples)<7:examples.append(deepcopy(original[len(examples)%len(original)]))
    domain = (f'    if not isinstance(data, dict) or not set({sorted(required)!r}) <= data.keys():\n'
              '        raise ValueError("输入必须包含题面声明的全部字段")\n') if required else ''
    if program.input_validator is not None:
        domain+='    def input_is_valid(value):\n'+indent(program.input_validator,'        ')+'\n        return solve(value)\n    if not input_is_valid(data):\n        raise ValueError("输入不符合本题有效域")\n'
    source='def algorithm_result(data):\n'+domain+indent(program.source,'    ')+'\n    return solve(data)\n'
    steps=[TeachingStep(step_id='read',title='读取输入',instruction=text['input_description']),
           TeachingStep(step_id='compute',title='实现算法',instruction=text['explanation']),
           TeachingStep(step_id='return',title='返回结果',instruction=text['output_description'])]
    fields='；'.join(f'{name}: {input_shape(value)}' for name,value in program.default_input.items())
    return AlgorithmContract(key,text['title'],source,examples,
        'JSON对象的字段约定：'+(fields or '空对象')+'。上述字段全部必填，不提供缺省值；缺失字段不是合法测试输入。'+text['input_description'],text['output_description'],steps,
        {'kind':'independent-execution','program':program.model_dump(mode='json'),'oracle':oracle,'sourceHash':digest},text['explanation'])


class ApplicationLabels(InternalModel):
    location: str=Field(min_length=2,max_length=24,description='场景地点或部门名称，仅名词，不写计算规则')
    actor: str=Field(min_length=2,max_length=24,description='使用者职责名称，仅名词')
    record: str=Field(min_length=2,max_length=24,description='与当前算法对应的一份任务数据的名称，仅名词')
    summary: Literal['distinct','frequencies']


async def application_labels(contract,identity):
    try:
        async with OllamaProvider(timeout=90) as provider:
            raw=await provider.generate(json.dumps({'algorithm':contract.title,'input_contract':contract.input_description,
                'output_contract':contract.output_description,
                'task':'设计当前算法的批量任务处理场景，难度中等偏下。用户逐一计算每份任务，再稳定去重或统计相同结果出现次数。只命名地点、使用者、任务记录，选择summary，不写额外业务条件、代码或预期答案。'},ensure_ascii=False),
                schema=ApplicationLabels,json_mode=True,options={'temperature':0.3,'num_predict':350,'num_ctx':4096})
            return ApplicationLabels.model_validate_json(raw,strict=True)
    except (OllamaError,ValueError) as exc:
        # An optional editorial label must never invalidate a verified program.
        logger.warning('应用场景措辞生成未完成，保留执行契约：%s',type(exc).__name__)
        return ApplicationLabels(location='数据处理中心',actor='任务管理员',record=contract.title[:22]+'任务',
            summary='distinct' if hashlib.sha256(identity.encode()).digest()[0]%2 else 'frequencies')


def summarize(results,mode):
    values=[];keys=[];counts=[]
    for result in results:
        key=canonical(result)
        if key not in keys:keys.append(key);values.append(result);counts.append(0)
        counts[keys.index(key)]+=1
    return values if mode=='distinct' else [{'result':v,'count':n} for v,n in zip(values,counts)]


def compile_drafts(contract,labels):
    kernel=indent(contract.source,'        ')
    guide_source='class Solution:\n    def solve(self, data: str) -> str:\n        import json\n'+kernel+'''        value = algorithm_result(json.loads(data))
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
'''
    cases=[TestCase(case_id=f'contract-{i}',inputs={'data':canonical(d)},expected=canonical(v),
        description='输入由执行器检查有效；预期结果来自真实算法执行。') for i,(d,v) in enumerate(contract.examples)]
    instructions=(f'实现{contract.title}，对一份输入计算结果。参数 data 是编码一个输入对象的 JSON 字符串。\n'
        f'计算规则：{contract.rule_description or contract.title}\n输入对象：{contract.input_description}\n输出：{contract.output_description}\n'
        '返回值是结果的 JSON 字符串，不包含额外说明文字。请阅读公开样例确定完整返回结构。'
        '判题比较解析后的 JSON 值：对象字段顺序和排版空白不影响结果；数组顺序、数据类型、数值和字符串内容必须一致。')
    for i,c in enumerate(cases[:4]):instructions+=f'\n示例{i+1}：输入 data={c.inputs["data"]}；结果={c.expected}'
    guide=normalize_generated_draft(LabDraft(title=contract.title+'：单次计算',instructions=instructions,
        scaffold_code='class Solution:\n    def solve(self, data: str) -> str:\n        # TODO\n        raise NotImplementedError\n',
        reference_solution=guide_source,difficulty='Medium',constraints=['输入为有效的小规模教学数据，JSON字段及类型与公开样例一致。'],
        teaching_steps=contract.teaching_steps,public_test_cases=cases[:4],hidden_test_cases=cases[4:]))
    source='class Solution:\n    def solve(self, stdin: str) -> str:\n        import json\n'+kernel+'''        payload = json.loads(stdin)
        requests = payload['requests']
        results = []
        keys = []
        counts = []
        for request in requests:
            value = algorithm_result(request)
            key = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
            if key not in keys:
                keys.append(key)
                results.append(value)
                counts.append(0)
            counts[keys.index(key)] += 1
'''
    if labels.summary=='frequencies':source+="        results = [{'result':value, 'count':count} for value,count in zip(results,counts)]\n"
    source+="        return json.dumps(results, ensure_ascii=False, sort_keys=True, separators=(',', ':'))\n"
    ids=[[0,1,0],[],[2],[0,0],[3,1,3,2],[1,2,1,0,0],[4,5,6],[6,5,4,3,2,1,0]]
    rng=random.Random(identity_seed(contract.key+labels.location))
    ids += [[rng.randrange(len(contract.examples)) for _ in range(rng.randrange(1,7))] for _ in range(3)]
    batches=[]
    for i,indices in enumerate(ids):
        requests=[contract.examples[j][0] for j in indices]
        expected=summarize([contract.examples[j][1] for j in indices],labels.summary)
        batches.append(TestCase(case_id=f'batch-{i}',inputs={'stdin':canonical({'requests':requests})},
            expected=canonical(expected),description='逐项执行当前算法，按首次出现顺序归并相同结果；包含空批次、重复结果及不同任务。'))
    action='稳定去重，返回各个不同结果组成的列表' if labels.summary=='distinct' else '统计相同结果的次数，返回由 {"result":结果,"count":次数} 组成的列表'
    text=(f'{labels.location}的{labels.actor}需要批量处理{labels.record}。每份任务使用{contract.title}计算。\n'
          f'任务：按 requests 的输入顺序逐项计算，然后{action}。\n'
          '不同结果按首次出现的顺序输出；对象按字段和值判断相同，不受字段书写顺序影响；列表的元素顺序参与比较。空批次返回 []。'
          f'\n单份任务的计算规则：{contract.rule_description or contract.title}\n单份任务的输入定义：{contract.input_description}\n单份任务的结果定义：{contract.output_description}'
          '\n标准输入为一行 JSON 对象：{"requests":[输入对象,...]}。最多8份任务，各任务独立计算，不能沿用上一份任务的可变状态。'
          '\n输出为 JSON 列表，建议单行。判题比较解析后的 JSON 值：对象字段顺序和排版空白不影响结果；数组顺序、数据类型、数值和字符串内容必须一致。编写完整 Python 程序，使用标准输入输出，无需指定类或函数名。')
    oj=normalize_generated_draft(LabDraft(title=contract.title+'：'+labels.record+'批量处理',instructions=text,
        scaffold_code='class Solution:\n    def solve(self, stdin: str) -> str:\n        # TODO\n        raise NotImplementedError\n',
        reference_solution=source,difficulty='Medium',constraints=['0 <= len(requests) <= 8；每项输入满足单次算法的输入契约。'],
        teaching_steps=[TeachingStep(step_id='batch',title='独立处理与汇总',instruction='逐项计算当前算法的结果，用规范化结果作为归并依据，保持首次出现顺序。')],
        public_test_cases=batches[:4],hidden_test_cases=batches[4:]))
    return guide,oj


def identity_seed(value):return int.from_bytes(hashlib.sha256(value.encode()).digest()[:8],'big')


def _quiz_alternative(value):
    """Plausible wrong computational result, never a different wire format."""
    if type(value) is bool:return not value
    if type(value) in (int,float):return value+1
    if isinstance(value,str):
        if value in ('∞','−∞','-∞'):return 0
        if value.lstrip('-').isdigit():return str(int(value)+1)
        return value[::-1] if value[::-1]!=value else value[:-1] if value else 'a'
    if isinstance(value,list):
        return [_quiz_alternative(value[0]),*deepcopy(value[1:])] if value else [0]
    if isinstance(value,dict):
        result=deepcopy(value)
        for key,item in result.items():
            if item is not None:
                result[key]=_quiz_alternative(item);return result
        return {**result,'value':0}
    return 0


def _quiz_focus(value, path=''):
    # Large state objects are unsuitable as four answer options. Ask about a
    # concrete algorithm quantity within them, without changing its value.
    if len(canonical(value))<=180:return path,value
    if isinstance(value,dict):
        for key,item in value.items():
            if item is not None:return _quiz_focus(item,(path+' / ' if path else '')+key)
    if isinstance(value,list) and value:return _quiz_focus(value[0],path+' 第1项')
    raise ValueError('课堂结果过长，无法形成可读的计算题')


def compiled_teaching(course):
    """Algorithm exercises derived from executed examples and owned traces.

    Answers come from the accepted computation, not an LLM or serialization
    metadata. Two computations keep even boolean-valued algorithms capable of
    four distinct, same-type alternatives.
    """
    if not course.scenes or '参数 data 是编码一个输入对象的 JSON 字符串' not in course.scenes[0].problem.instructions:
        return None
    guide=course.scenes[0]
    cases=guide.problem.public_test_cases
    questions=[]
    for index in range(3):
        left,right=cases[index%len(cases)],cases[(index+1)%len(cases)]
        path_a,a=_quiz_focus(json.loads(left.expected));path_b,b=_quiz_focus(json.loads(right.expected))
        wrong_a,wrong_b=_quiz_alternative(a),_quiz_alternative(b)
        pairs=[(a,b),(wrong_a,b),(a,wrong_b),(wrong_a,wrong_b)]
        # Rotate the correct answer; option position must not teach guessing A.
        shift=index+1;pairs=pairs[shift:]+pairs[:shift]
        correct=(-shift)%4
        target_a='最终结果'+('中 '+path_a+' 的值' if path_a else '')
        target_b='最终结果'+('中 '+path_b+' 的值' if path_b else '')
        input_a=json.loads(left.inputs['data']);input_b=json.loads(right.inputs['data'])
        questions.append({'question':f'按照本课{course.topic}的计算规则，分别手算下面两份输入。输入一：{canonical(input_a)}；输入二：{canonical(input_b)}。两者的{target_a if path_a==path_b else target_a+"、"+target_b}依次是什么？',
            'options':[f'输入一：{canonical(x)}；输入二：{canonical(y)}' for x,y in pairs],
            'answer':'ABCD'[correct],
            'analysis':f'对输入一独立执行本课算法，{target_a}为 {canonical(a)}；对输入二执行，{target_b}为 {canonical(b)}。先按课程中的状态更新与终止条件推演，再核对这两个计算结果。'})
    from exam_simulator import resolve,run_trace
    key=resolve(course.topic)
    if key:
        sample=json.loads(cases[0].inputs['data'])
        trace=run_trace(key,data=sample)
        frames=trace['frames']
        # Prefer an actual decision/update in the middle, not initialization.
        pivot=max(0,len(frames)//2-1)
        for index in [*range(pivot,len(frames)-1),*range(pivot)]:
            correct=frames[index+1]['explanation']
            alternatives=list(dict.fromkeys(f['explanation'] for j,f in enumerate(frames) if j!=index+1 and f['explanation']!=correct and len(f['explanation'])<=480))[:3]
            if len(alternatives)==3 and len(correct)<=480:
                options=[*alternatives[:1],correct,*alternatives[1:]]
                questions[2]={'question':f'按本课{course.topic}的演示顺序，对输入 {canonical(sample)} 完成第 {index+1} 步“{frames[index]["label"]}”后，紧接着执行的操作是什么？',
                    'options':options,'answer':'B',
                    'analysis':f'当前步骤：{frames[index]["explanation"]}。下一步“{frames[index+1]["label"]}”：{correct}。这是该输入的确定性执行顺序。'}
                break
    if key:
        from exam_simulator.pedagogy import overview
        explanation=overview(key)
    else:
        # Preserve the approved task's rule, not unlabelled trace telemetry.
        rules=guide.problem.instructions.split('计算规则：',1)[-1].split('\n输入对象：',1)[0]
        explanation=course.topic+'：'+rules
    return {'overview':explanation[:5800],
        'demoExplanation':'结合当前输入逐步观察算法的状态更新、分支选择与终止条件；先手算中间状态和结果，再用模拟器核对。',
        'questions':questions,'algorithmTrace':None}


async def build_executable_labs(state):
    from exam_simulator import resolve
    topic=state['current_topic'];identity=state['final_output']['course_id']
    requirement=state.get('teaching_requirement',topic).split('。当前课程：',1)[0].removeprefix('原始教学需求：')
    # A teacher/editor label cannot rename an unknown algorithm into a known
    # but unrelated task (e.g. greedy best-first search -> coin change).
    key=resolve(requirement)
    try:
        proof=state.get('execution_proof')
        if proof and proof.get('kind')=='independent-execution':
            from exam_simulator.generated import GeneratedAlgorithm
            contract=await verified_program_contract(GeneratedAlgorithm.model_validate(proof['program']),
                proof['oracle'],proof['sourceHash'],'dynamic-verified-replay')
        elif key: contract=known_contract(key)
        else: contract=await dynamic_contract(requirement,state.get('execution_scope') or identity,
            purpose='algorithm' if state.get('course_kind')=='algorithm' or re.search(r'算法|algorithm',requirement,re.I) else 'programming-task',requirement=requirement)
    except (ValueError,SyntaxError,OllamaResponseError) as exc:
        logger.error('算法执行契约未建立 topic=%s cause=%s',topic,str(exc)[-1000:])
        raise AlgorithmContractError('算法执行契约未通过验证') from exc
    labels=await application_labels(contract,identity)
    guide,oj=compile_drafts(contract,labels)
    count=await verify_drafts(guide,oj)
    lab,problem=assemble_lab(guide,identity,answer_check='json-value')
    _,independent=assemble_lab(oj,identity,answer_check='json-value')
    # Preserve the independent checker with existing server/teacher-only test
    # assets. Public projection never includes pytest source or reference code.
    proof='\n# executable-contract-verification: '+canonical(contract.verification)+'\n'
    lab.files['test_solution.py']+=proof
    problem.pytest_source+=proof
    problem.oj_scene=OJLabScene(course_id=identity,scene_id=independent.oj_scene.scene_id,
        problem=independent.oj_scene.problem.model_copy(update={'execution_mode':'stdio'}),
        markdown_content=independent.oj_scene.markdown_content,
        interactive_code='# 请独立编写程序，从标准输入读取并将 JSON 结果打印到标准输出。\n')
    problem.oj_assessment=PrivateAssessment(hidden_test_cases=independent.hidden_test_cases,
        reference_solution=independent.reference_solution,pytest_source=independent.pytest_source+proof)
    output=deepcopy(state['final_output'])
    if contract.verification and contract.verification.get('kind')=='independent-execution':
        requested=re.sub(r'^(?:请为我讲解|为我讲解|请讲解|给我讲解|讲解|请介绍|介绍|please\s+explain\s+|explain\s+|teach\s+me\s+)', '',requirement.strip(),flags=re.I)
        requested=re.sub(r'\s*Python\s*编程实验\s*$', '',requested,flags=re.I).strip(' 。.!！')
        approved_topic=requested if 1<=len(requested)<=100 else contract.title
        output['topic']=approved_topic
        output['lesson_plan']={'title':approved_topic,
            'objectives':[f'理解{approved_topic}的核心决策与状态更新','能够手算代表性输入并核对终止条件','能够独立实现并处理合法边界'],
            'knowledge_points':[contract.rule_description or contract.title,'状态更新与终止条件','合法输入边界与独立执行验证']}
        output['common_mistakes']=[]
    output.update(lab=lab.model_dump(mode='json'),problem=problem.model_dump(mode='json'))
    logger.info('Executable lesson accepted algorithm=%s cases=%d',contract.key,count)
    return {'final_output':output,'verified_lab_assets':True,'current_topic':output['topic']}

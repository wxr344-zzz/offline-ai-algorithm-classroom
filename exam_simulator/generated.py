"""Unknown named algorithms: generate, isolate, execute, cross-check, then render.

Execution evidence is not a universal mathematical proof. Never publish model
authored frames, or turn a failed check into a successful animation.
"""
import asyncio
from collections import OrderedDict
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import shutil
from typing import Literal
from pydantic import Field
from lab_contracts import InternalModel, JsonValue
from ollama_provider import OllamaProvider
from ollama_provider import OllamaResponseError
from .core import REGISTRY, run_trace, resolve
from .sandbox_driver import validate_source, bounded, BUILTINS, METHODS, PURE_MODULES

ROOT=Path(__file__).resolve().parents[1]
CACHE=OrderedDict()
LOCK=asyncio.Lock()


class AlgorithmDefinition(InternalModel):
    decision_rule: str=Field(min_length=8,max_length=600)
    state_updates: str=Field(min_length=8,max_length=600)
    input_domain: str=Field(min_length=8,max_length=600)
    result_guarantees: str=Field(min_length=8,max_length=600)
    boundary_rules: str=Field(min_length=8,max_length=600)


class CandidateReview(InternalModel):
    matches_topic: bool
    implementation_correct: bool
    domain_correct: bool
    canonical_name: str=Field(default='',max_length=100,description='原始用户请求算法的准确英文名称；如规范化名称错误，必须给出纠正名称。')
    definition_correct: bool=True
    violation_kind: Literal['selection','state_update','domain','guarantee','identity']='selection'
    reason: str=Field(min_length=8,max_length=800)
    canonical_output_description: str=Field(default='',max_length=800,
        description='若原输出说明对多解、平局、坐标基数或顺序不明确，用原始需求语言补全候选代码实际遵循的确定性输出约定。必须保持原任务及一个解/全部解的要求；已经明确则可留空。')


class AlgorithmIdentityReview(InternalModel):
    equivalent: bool
    canonical_name: str=Field(min_length=2,max_length=100)
    reason: str=Field(min_length=8,max_length=600)


class DecisionRuleReview(InternalModel):
    same_rule: bool
    observed_rule: str=Field(min_length=3,max_length=600)
    reason: str=Field(min_length=8,max_length=600)


class OracleSemanticsReview(InternalModel):
    computes_required_result: bool
    violation_kind: Literal['selection','state_update','domain','guarantee','identity']='selection'
    reason: str=Field(min_length=8,max_length=800)


class CounterexampleReview(InternalModel):
    repair_target: Literal['candidate','checker','both']
    reason: str=Field(min_length=8,max_length=1000)
    multiple_valid_outputs: bool=False
    deterministic_output_policy: str=Field(default='',max_length=800)
    deterministic_boundary_rules: str=Field(default='',max_length=600)


class GeneratedAlgorithm(InternalModel):
    valid_algorithm: bool
    title: str=Field(min_length=2,max_length=100)
    explanation: str=Field(min_length=8,max_length=500)
    input_description: str=Field(min_length=8,max_length=800)
    output_description: str=Field(min_length=8,max_length=800,
        description='明确返回值结构、找不到或空输入的约定；多解时明确返回任意解还是第一解。')
    default_input: dict[str,JsonValue]
    source: str=Field(min_length=20,max_length=10000,
        description='完整Python源码，第一行必须是def solve(data):，随后用四个空格缩进实际算法，不能填写讲解、伪代码、Markdown或手写步骤。')
    # A verified contract contains the union of candidate and independent
    # inputs (including repair counterexamples), not just one model response.
    # Approved generation requires four declared cases below. Persisted proof
    # stores their deduplicated union, which can legitimately contain fewer.
    # Replaying it must not fail merely because identical inputs collapsed.
    validation_inputs: list[dict[str,JsonValue]]=Field(min_length=1,max_length=32)
    pointer_names: list[str]=Field(max_length=16)
    input_validator: str | None=Field(default=None,min_length=20,max_length=10000,
        description='独立的纯Python输入域判定源码def solve(data):，返回bool。检查字段、类型及算法必需约束；合法空集合不能随意拒绝，图算法需检查端点和关联字段。不要计算答案。')


class AlgorithmTopic(InternalModel):
    status: Literal['named','ambiguous','invalid']
    title: str=Field(min_length=2,max_length=100,description='该算法或数据结构操作的规范英文名称，保留具体变体；用于跨语言语义校验，不得改成相邻算法。')
    reason: str=Field(min_length=8,max_length=500)


class ApprovedAlgorithm(GeneratedAlgorithm):
    valid_algorithm: Literal[True]=True
    validation_inputs: list[dict[str,JsonValue]]=Field(min_length=4,max_length=8)
    input_validator: str=Field(min_length=20,max_length=10000,
        description='纯Python输入域判定函数def solve(data):，只返回bool，检查所有必需字段、类型和关联约束；允许题意合法的空集合，不得计算答案或拒绝所有输入。')


class IndependentOracle(InternalModel):
    source: str=Field(min_length=20,max_length=10000,
        description='独立计算标准结果的完整Python源码。solve(data)必须返回算法的结果本身，不是验证输入/答案是否正确的bool；只有题目结果本来就是bool时才返回bool。')
    validation_inputs: list[dict[str,JsonValue]]=Field(min_length=4,max_length=8)


class ValidationInputRepair(InternalModel):
    validation_inputs: list[dict[str,JsonValue]]=Field(min_length=4,max_length=8)


async def repair_validation_inputs(provider,program,inputs,failure):
    """A malformed generated test batch is not evidence of a solver defect."""
    raw=await provider.generate(json.dumps({
        'input_description':program.input_description,'default_input':program.default_input,
        'approved_input_validator':program.input_validator,'previous_inputs':inputs,
        'execution_failure':failure,
        'instruction':'Repair only the validation inputs rejected by the approved input validator. Return 4 to 8 small valid inputs, including the unchanged default_input. Preserve distinct valid existing cases. Invalid inputs are domain rejection tests, not answer comparison cases. Do not change source, validator or input domain. Avoid expensive input sizes.'},ensure_ascii=False),
        schema=ValidationInputRepair,json_mode=True,
        system='Correct a generated test batch from concrete sandbox input-domain evidence. Only JSON with validation_inputs. Never generate code or expected answers.',
        options={'temperature':0,'num_predict':1000,'num_ctx':8192})
    return ValidationInputRepair.model_validate_json(raw,strict=True).validation_inputs


class SemanticContractRepair(GeneratedAlgorithm):
    valid_algorithm: Literal[True]=True
    input_validator: str=Field(min_length=20,max_length=10000)
    validation_inputs: list[dict[str,JsonValue]]=Field(min_length=4,max_length=8)


class SourceRepair(InternalModel):
    source: str=Field(min_length=20,max_length=10000)


class SourceEdit(InternalModel):
    old: str=Field(min_length=1,max_length=3000)
    new: str=Field(max_length=3000)


class SourcePatch(InternalModel):
    edits: list[SourceEdit]=Field(min_length=1,max_length=8)


class LineEdit(InternalModel):
    start_line: int=Field(ge=1)
    end_line: int=Field(ge=1)
    replacement: str=Field(max_length=5000)


class LinePatch(InternalModel):
    edits: list[LineEdit]=Field(min_length=1,max_length=8)


def apply_line_patch(source,patch):
    import textwrap
    lines=source.splitlines(keepends=True)
    previous_end=0
    for edit in sorted(patch.edits,key=lambda item:item.start_line):
        if not previous_end<edit.start_line<=edit.end_line<=len(lines):
            raise ValueError('补丁行号越界或区间重叠')
        previous_end=edit.end_line
    for edit in sorted(patch.edits,key=lambda item:item.start_line,reverse=True):
        original=lines[edit.start_line-1]
        indent=original[:len(original)-len(original.lstrip())]
        replacement=textwrap.indent(textwrap.dedent(edit.replacement),indent)
        if replacement and not replacement.endswith('\n'):replacement+='\n'
        lines[edit.start_line-1:edit.end_line]=[replacement]
    patched=''.join(lines)
    if patched.strip()==source.strip():raise ValueError('补丁没有产生实际修改')
    validate_source(patched)
    return patched


def apply_source_patch(source,patch):
    import textwrap
    original=source
    for edit in patch.edits:
        if edit.old==edit.new or source.count(edit.old)!=1:
            raise ValueError('修复补丁必须唯一匹配原代码并产生实际修改')
        source=source.replace(edit.old,edit.new,1)
    try:
        validate_source(source)
    except IndentationError:
        # A local model often includes a block's absolute margin in a
        # replacement whose prefix is already indented. Align only those
        # replacements, never rewrite the algorithm or guess a missing block.
        source=original
        for edit in patch.edits:
            if source.count(edit.old)!=1:
                raise ValueError('修复补丁必须唯一匹配原代码并产生实际修改')
            position=source.index(edit.old)
            start=source.rfind('\n',0,position)+1
            prefix=source[start:position]
            if prefix.strip() or "'''" in edit.new or '\"\"\"' in edit.new:
                source=source.replace(edit.old,edit.new,1)
                continue
            first=edit.old.splitlines()[0]
            margin=prefix+first[:len(first)-len(first.lstrip())]
            replacement=textwrap.indent(textwrap.dedent(edit.new),margin)
            source=source[:start]+replacement+source[position+len(edit.old):]
    validate_source(source)
    return source


class CandidateExecutionError(ValueError):pass


def source_digest(program,oracle):
    source=program.source+'\n'+oracle
    if program.input_validator is not None:source+='\n# input-validator\n'+program.input_validator
    return hashlib.sha256(source.encode()).hexdigest()


def dynamic_key(topic,scope,purpose='algorithm',teaching_context=None):
    normalized=re.sub(r'\s+','',topic.lower())
    if purpose!='algorithm':normalized=purpose+'\0'+normalized
    if teaching_context:normalized+='\0'+hashlib.sha256(teaching_context.encode()).hexdigest()[:16]
    return 'dynamic-'+hashlib.sha256((scope+'\0'+normalized).encode()).hexdigest()[:20]


def verified_contract_path(key,scope):
    if not re.fullmatch(r'owner:[a-f0-9]{64}',scope):return None
    return ROOT/'logs'/'verified-dynamic-contracts'/f'{key}.json'


def persist_verified_contract(topic,scope,purpose,teaching_context,program,oracle):
    key=dynamic_key(topic,scope,purpose,teaching_context)
    path=verified_contract_path(key,scope)
    if path is None:return
    payload={'topic':topic,'purpose':purpose,'proof':{'kind':'independent-execution',
        'program':program.model_dump(mode='json'),'oracle':oracle,'sourceHash':source_digest(program,oracle)}}
    from uuid import uuid4
    temporary=path.with_suffix('.'+uuid4().hex+'.tmp')
    try:
        path.parent.mkdir(parents=True,exist_ok=True)
        temporary.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
        os.replace(temporary,path)
    except OSError:
        logging.getLogger(__name__).warning('Verified contract could not be persisted key=%s',key)
    finally:
        try:temporary.unlink(missing_ok=True)
        except OSError:pass


async def remember_verified_contract(topic,scope,proof,*,purpose='algorithm',teaching_context=None):
    # Maintenance/import must re-execute the proof, not trust a file's label.
    await replay_execution_proof(proof)
    program=GeneratedAlgorithm.model_validate(proof['program'],strict=True)
    persist_verified_contract(topic,scope,purpose,teaching_context,program,proof['oracle'])


async def replay_execution_proof(proof,data=None,topic='',scope='local'):
    """Re-execute the accepted private course implementation, never regenerate it."""
    if type(proof)is not dict or proof.get('kind')!='independent-execution':
        raise ValueError('课程执行契约类型无效')
    program=GeneratedAlgorithm.model_validate(proof.get('program'),strict=True)
    oracle=proof.get('oracle')
    if not program.valid_algorithm or type(oracle)is not str:raise ValueError('课程执行契约无效')
    digest=source_digest(program,oracle)
    if digest!=proof.get('sourceHash'):raise ValueError('课程执行契约摘要不一致')
    actual=program.default_input if data is None else data
    result=await sandbox(program,oracle,actual)
    key='dynamic-'+hashlib.sha256((scope+'\0'+digest).encode()).hexdigest()[:20]
    return render_trace(program,result,actual,key,digest)


async def sandbox(program,oracle,data):
    """No generated Python runs in this host interpreter or a host subprocess."""
    validate_source(program.source);validate_source(oracle)
    if program.input_validator is not None:validate_source(program.input_validator)
    bounded(data)
    payload=json.dumps({'source':program.source,'oracle':oracle,
        'validator':program.input_validator,
        'tests':program.validation_inputs,'input':data,'probes':boundary_probes(program.default_input)},ensure_ascii=False,allow_nan=False)
    if len(payload.encode())>100000: raise ValueError('动态推演资料超过限制')
    node=shutil.which('node')
    if not node: raise ValueError('动态推演的WASM运行时尚未安装')
    # Do not transmit .env secrets, service tokens or application credentials.
    env={key:value for key,value in os.environ.items() if key.upper() in ('SYSTEMROOT','WINDIR','TEMP','TMP')}
    proc=await asyncio.create_subprocess_exec(node,str(ROOT/'scripts/dynamic-trace-sandbox.mjs'),
        stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,
        cwd=ROOT,env=env)
    try:
        stdout,_stderr=await asyncio.wait_for(proc.communicate(payload.encode()),95)
        if len(stdout)>2600000: raise ValueError('动态轨迹超过大小限制')
        response=json.loads(stdout)
        if proc.returncode or 'error' in response:
            reason=response.get('error','动态推演沙箱运行失败').strip().splitlines()[-1]
            raise ValueError(reason)
        return response['result']
    except asyncio.TimeoutError as exc:
        raise ValueError('动态推演沙箱超时，请缩小输入规模') from exc
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()


def boundary_probes(default):
    """Platform-generated probes cannot be omitted by the question generator.

    New contracts execute a separately reviewed domain predicate first. Legacy
    saved contracts retain their original checker-defined probing behavior.
    """
    import copy
    candidates=[{}]
    cleared=copy.deepcopy(default)
    for key,value in default.items():
        if isinstance(value,(list,str)):
            empty=[] if isinstance(value,list) else ''
            candidates.append({**copy.deepcopy(default),key:empty})
            cleared[key]=empty
    candidates.append(cleared)
    if 'start' in default and 'goal' in default:
        candidates.append({**copy.deepcopy(default),'goal':copy.deepcopy(default['start'])})
    for key,value in default.items():
        if isinstance(value,dict) and isinstance(value.get('edges'),list):
            empty=copy.deepcopy(default);empty[key]['edges']=[];candidates.append(empty)
            edges=value['edges']
            if edges and all(isinstance(edge,dict) and 'from' in edge and 'to' in edge for edge in edges):
                reverse=copy.deepcopy(default)
                reverse[key]['edges']=[{**edge,'from':edge['to'],'to':edge['from']} for edge in edges]
                candidates.append(reverse)
    unique={json.dumps(v,sort_keys=True):v for v in candidates if v!=default}
    return list(unique.values())[:12]


def views_from_snapshot(state,pointers):
    views=[]
    def add(name,value):
        if len(views)>=64:raise ValueError('状态视图超过64个，请缩小教学输入；不会省略状态后继续播放')
        if isinstance(value,dict):
            scalars=[[k,v] for k,v in value.items() if not isinstance(v,(dict,list))]
            if scalars:views.append({'kind':'table','name':name,'columns':['变量','实际值'],'rows':scalars,'active':[]})
            for key,item in value.items():
                if isinstance(item,(dict,list)):add(name+'.'+key,item)
        elif isinstance(value,list):
            if value and all(isinstance(row,list) for row in value):
                width=max(map(len,value),default=0)
                views.append({'kind':'matrix','name':name,'values':value,
                    'rows':list(range(len(value))),'columns':list(range(width)),'active':[],'dependencies':[]})
            elif value and all(isinstance(row,dict) and 'id' in row for row in value):
                ids={str(row['id']) for row in value}
                nodes=[{'id':str(row['id']),'label':str(row.get('value',row.get('key',row['id'])))} for row in value]
                edges=[{'source':str(row['id']),'target':str(row[key]),'label':label} for row in value
                       for key,label in (('left','L'),('right','R')) if str(row.get(key)) in ids]
                views.append({'kind':'tree','name':name,'nodes':nodes,'edges':edges})
            elif any(isinstance(item,(dict,list)) for item in value):
                for i,item in enumerate(value):add(name+f'[{i}]',item)
            else:
                local_name=name.removeprefix('局部变量.')
                views.append({'kind':'sequence','name':name,'values':value,
                    'pointers':{p:state[p] for p in pointers.get(local_name,[]) if '.' not in local_name and type(state.get(p)) is int},'active':[]})
    add('局部变量',state)
    return views or [{'kind':'table','name':'状态','columns':['状态'],'rows':[['函数入口：尚未赋值']],'active':[]}]


def render_trace(program,result,data,key,digest):
    import ast
    # Link pointer variables to the containers actually subscripted in source;
    # model metadata cannot place an unrelated scalar on every sequence.
    links={}
    for function in [n for n in ast.walk(ast.parse(program.source)) if isinstance(n,ast.FunctionDef)]:
        pointers={}
        class Links(ast.NodeVisitor):
            def visit_FunctionDef(self,node):
                if node is function:self.generic_visit(node)
            def visit_Subscript(self,node):
                if isinstance(node.value,ast.Name) and isinstance(node.slice,ast.Name):
                    pointers.setdefault(node.value.id,set()).add(node.slice.id)
                self.generic_visit(node)
        Links().visit(function)
        links[function.name]=pointers
    frames=[]
    for item in result['snapshots']:
        state=item['state']
        views=views_from_snapshot(state,links.get(item['function'],{}))
        views.append({'kind':'table','name':'调用栈','columns':['函数','源码行'],
            'rows':[[f['function'],f['line']] for f in item['stack']],'active':[0]})
        returning=item['event']=='return'
        frames.append({'index':len(frames),'label':f"{item['function']} · 第{item['line']}行"+('返回' if returning else '执行前'),
            'explanation':('本次函数返回：'+json.dumps(item['returned'],ensure_ascii=False)) if returning else '即将执行：'+item['code'].strip(),
            'views':views,'state':state})
    if not frames:raise ValueError('代码没有产生真实执行快照')
    return {'version':1,'engine':'python-sandbox','algorithm':key,'title':program.title,'input':data,
        'inputDescription':program.input_description,'frames':frames,'outcome':result['outcome'],'verified':True,
        'verification':{'kind':'execution-crosscheck','sourceHash':digest,'checkedInputs':len(program.validation_inputs)+1+len(result.get('checkedProbes',[])),
                        'deterministicReplay':True,'snapshots':'python-line-trace'}}


POLICY=('定义solve(data)和必要的辅助纯函数，返回JSON值。data是输入JSON对象。只允许下述纯计算模块，禁止文件、网络、JS或反射，'
        '入口参数data始终是dict；即使数组字段也叫data，仍要先用data["data"]取出数组。不能直接对入口字典切片或按整数下标读取。'
        'JSON对象键始终是字符串；图节点标识和映射键必须类型一致，不要用整数索引读取JSON字符串键。'
        '不要覆盖入口变量data：先将所有输入字段读入独立局部变量，再执行计算。'
        '不写顶层运行语句、注解、装饰器、异常处理和默认参数。只使用常见纯Python内置函数、列表字典集合方法，'
        '不能调用emit或手写推演步骤，平台自动从真实执行的每一行抓取局部变量。矩阵保留二维结构，树用含id/value/left/right的节点字典列表。'
        '最多24个教学元素，所有输入以JSON字段明确约定，避免无穷浮点数，用有界整数哨兵。结果不能硬编码样例。'
        'input_validator是独立源码，仍定义solve(data)，只判定有效域，不计算答案。必须先用字段存在检测或get检查字段，再取值；对{}、缺字段或错误类型只返回False，不能抛异常。平台探测空集合与缺字段；合法空输入应接受并正确计算，缺失端点等无效输入应拒绝。'
        '纯lambda可用于min/max/sorted的key参数。禁止random/numpy/sklearn及未列出的模块；比较欧氏距离可直接比较平方和。'
        '循环占位符_允许；其他变量、参数和辅助函数不要使用下划线开头的名称。禁止type/print/Exception等未列出的内置能力。'
        '需要初始状态的算法必须用输入显式提供或明确约定的确定性初始化，不得使用随机初始化。'
        '小规模示例控制在2至8个元素，迭代次数必须有明确上限，不生成超大执行轨迹。'
        '浮点迭代或近似算法需在输出约定中明确舍入精度并用round输出；独立计算器遵守相同精度，不能把近似算法宣称为全局最优。'
        '多解与平局必须先定义唯一可复现的输出：明确一个解或全部解、实际搜索维度和候选访问顺序、零基或一基、结果元素及列表的排序。输出说明与源码完全一致，不能只写返回一个有效解。不得改变用户明确要求的解集、优化目标或平局规则。'
        '输出简洁完整的实现，不写注释或docstring；validation_inputs优先给4个小输入，输入说明与规则直接写清，不重复长篇讲解。'
        '可用内置函数仅为：'+','.join(sorted(BUILTINS))+'。可用容器方法仅为：'+','.join(sorted(METHODS))+'。'
        '可用纯模块及成员：'+'；'.join(name+':'+','.join(sorted(members)) for name,members in PURE_MODULES.items())+'。支持import及from导入这些成员，不能访问模块的其他属性。')


def input_contract(value):
    if isinstance(value,dict):return {key:input_contract(item) for key,item in value.items()}
    if isinstance(value,list):return {'arrayItems':input_contract(value[0]) if value else 'empty'}
    return type(value).__name__


def decision_sites(source):
    """Exact AST evidence; variable names alone do not identify an algorithm."""
    import ast
    sites=[]
    for node in ast.walk(ast.parse(source)):
        if isinstance(node,ast.Call) and (
            isinstance(node.func,ast.Name) and node.func.id in {'min','max','sorted'} or
            isinstance(node.func,ast.Attribute) and node.func.attr in {'sort','heappush','heappop','heapreplace'}):
            sites.append({'line':node.lineno,'kind':'selection','expression':ast.unparse(node)})
        elif isinstance(node,(ast.If,ast.While)):
            sites.append({'line':node.lineno,'kind':'condition','expression':ast.unparse(node.test)})
    return sorted(sites,key=lambda s:s['line'])[:48]


def selection_evidence(source):
    import ast
    tree=ast.parse(source)
    sites=[s for s in decision_sites(source) if s['kind']=='selection']
    needed={node.id for site in sites for node in ast.walk(ast.parse(site['expression'])) if isinstance(node,ast.Name)}
    bindings=[];seen=set()
    for _ in range(4):
        for node in ast.walk(tree):
            if not isinstance(node,(ast.Assign,ast.AnnAssign,ast.AugAssign)):continue
            targets=node.targets if isinstance(node,ast.Assign) else [node.target]
            roots=set()
            for target in targets:
                while isinstance(target,ast.Subscript):target=target.value
                if isinstance(target,ast.Name):roots.add(target.id)
            if not roots.intersection(needed) or node.lineno in seen:continue
            bindings.append({'line':node.lineno,'expression':ast.unparse(node)})
            seen.add(node.lineno)
            if node.value is not None:
                needed.update(n.id for n in ast.walk(node.value) if isinstance(n,ast.Name))
    return {'selectors':sites,'dependencies':sorted(bindings,key=lambda s:s['line'])[:32]}


async def patch_checker(provider,source,definition,feedback,program=None,_retried=False):
    import ast
    try:ast.parse(source)
    except SyntaxError as syntax:
        raw=await provider.generate(json.dumps({'source':source,
            'numbered_source':'\n'.join(f'{i}: {line}' for i,line in enumerate(source.splitlines(),1)),
            'syntax_error':{'line':syntax.lineno,'offset':syntax.offset,'message':syntax.msg,'text':syntax.text},
            'instruction':'Fix only the reported Python syntax/indentation defect using exact old/new text replacements. Preserve algorithm logic, input/output behavior and every valid surrounding statement. old includes original whitespace and must match exactly once; new includes corrected absolute indentation. Do not return a complete rewritten program.'},ensure_ascii=False),
            schema=SourcePatch,json_mode=True,
            system='Repair Python syntax with minimal exact text edits. Do not change the algorithm or regenerate tests. Only JSON.',
            options={'temperature':0,'num_predict':1600,'num_ctx':8192})
        try:return apply_source_patch(source,SourcePatch.model_validate_json(raw,strict=True))
        except (ValueError,SyntaxError) as exc:
            exc.checker_source=source
            raise
    evidence=feedback
    for marker in ('CHECKER_EXECUTION_ERROR:','独立实现交叉校验失败：'):
        if marker in feedback:
            try:evidence=json.loads(feedback.split(marker,1)[1])
            except ValueError:pass
            break
    runtime_fault=isinstance(evidence,dict) and evidence.get('error')=='NameError' and evidence.get('location',{}).get('line')
    raw=await provider.generate(json.dumps({'required_rule':None if runtime_fault else definition.decision_rule,
        'state_updates':None if runtime_fault else definition.state_updates,'code_to_patch':source,
        'termination_and_boundaries':definition.boundary_rules,
        'required_output':program.output_description if program else None,
        'input_contract':program.input_description if program else definition.input_domain,
        'numbered_source':'\n'.join(f'{i}: {line}' for i,line in enumerate(source.splitlines(),1)),
        'execution_evidence':evidence,'selector_dependencies':selection_evidence(source),
        'allowed_line':runtime_fault or None,
        'instruction':('Fix ONLY the undefined variable at allowed_line, using variables actually defined in this scope. Do not alter a loop, priority or any other line. ' if runtime_fault else 'Correct selector/update formulas to obey required_rule. ')+
            'Return minimal line replacements using supplied 1-based line numbers; start/end inclusive. replacement contains Python without line numbers, relative to the replaced first line indentation. A result mismatch is not a NameError. Preserve the input/output contract.'},ensure_ascii=False),
        schema=LinePatch,json_mode=True,
        system='Repair Python from an exact operational specification and actual execution evidence. Return small edits using exact supplied line numbers. Do not invent runtime errors or substitute another algorithm. Only JSON.',
        options={'temperature':0,'num_predict':1600,'num_ctx':8192})
    patch=LinePatch.model_validate_json(raw,strict=True)
    if runtime_fault and any(edit.start_line!=runtime_fault or edit.end_line!=runtime_fault for edit in patch.edits):
        error=ValueError('运行时局部修复不得修改故障行之外的算法逻辑')
        error.checker_source=source
        raise error
    try:return apply_line_patch(source,patch)
    except (ValueError,SyntaxError) as exc:
        (ROOT/'logs').mkdir(exist_ok=True)
        (ROOT/'logs'/'rejected-checker-line-patch.json').write_text(json.dumps({'source':source,'patch':patch.model_dump(mode='json')},ensure_ascii=False),encoding='utf-8')
        if not _retried:
            return await patch_checker(provider,source,definition,
                feedback+'\nREJECTED_PATCH (not applied): '+json.dumps(patch.model_dump(mode='json'))+
                '\nPATCH_ERROR: '+str(exc)+'\nUse the ORIGINAL numbered source. Correct the rejected edit; do not repeat its wrong line number or delete a loop body.',program,True)
        exc.checker_source=source
        raise


def grounded_input_key_repair(candidate,checker):
    """Propose the reviewed policy's pure input key; never copy its solver.

    Both programs must use the same selector and identically bound immutable
    inputs. The proposal still goes through semantic review and all WASM checks.
    """
    import ast,copy
    def analyze(source):
        module=ast.parse(source)
        solve=next(node for node in module.body if isinstance(node,ast.FunctionDef) and node.name=='solve')
        selectors=[node for node in ast.walk(solve) if isinstance(node,ast.Call) and isinstance(node.func,ast.Name)
            and node.func.id in {'min','max','sorted'} and any(k.arg=='key' and isinstance(k.value,ast.Lambda) for k in node.keywords)]
        if len(selectors)!=1:return None
        call=selectors[0];key=next(k.value for k in call.keywords if k.arg=='key')
        if len(key.args.args)!=1:return None
        bindings={};writes={}
        for node in ast.walk(solve):
            if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute):
                root=node.func.value
                while isinstance(root,ast.Subscript):root=root.value
                if isinstance(root,ast.Name):writes[root.id]=writes.get(root.id,0)+1
            if isinstance(node,(ast.Assign,ast.AnnAssign,ast.AugAssign)):
                if isinstance(node,ast.Assign) and isinstance(node.value,ast.Name):
                    writes[node.value.id]=writes.get(node.value.id,0)+1
                targets=node.targets if isinstance(node,ast.Assign) else [node.target]
                for target in targets:
                    root=target
                    while isinstance(root,ast.Subscript):root=root.value
                    if isinstance(root,ast.Name):writes[root.id]=writes.get(root.id,0)+1
                    if isinstance(target,ast.Name) and isinstance(node,ast.Assign):bindings[target.id]=ast.dump(node.value,include_attributes=False)
        return call,key,bindings,writes
    a=analyze(candidate);b=analyze(checker)
    if not a or not b or a[0].func.id!=b[0].func.id:return None
    key=a[1];parameter=key.args.args[0].arg
    # Do not borrow helper functions, mutable working-state scores or calls.
    if any(isinstance(n,(ast.Call,ast.Attribute,ast.NamedExpr)) for n in ast.walk(key.body)):return None
    free={n.id for n in ast.walk(key.body) if isinstance(n,ast.Name)}-{parameter}
    for name in free:
        if a[3].get(name)!=1 or b[3].get(name)!=1 or a[2].get(name)!=b[2].get(name):return None
        # Bindings must read solve's input, not another working-state name.
        root=next((n.value for n in ast.walk(ast.parse(candidate)) if isinstance(n,ast.Assign)
            and any(isinstance(t,ast.Name) and t.id==name for t in n.targets)),None)
        if not isinstance(root,ast.Subscript) or not isinstance(root.value,ast.Name) or root.value.id!='data':return None
    replacement=copy.deepcopy(key)
    target_parameter=b[1].args.args[0].arg
    class Rename(ast.NodeTransformer):
        def visit_Name(self,node):
            if node.id==parameter:node.id=target_parameter
            return node
    replacement=Rename().visit(replacement)
    replacement.args.args[0].arg=target_parameter
    if ast.dump(replacement,include_attributes=False)==ast.dump(b[1],include_attributes=False):return None
    encoded=checker.encode('utf-8');lines=encoded.splitlines(keepends=True);node=b[1]
    start=sum(len(line) for line in lines[:node.lineno-1])+node.col_offset
    end=sum(len(line) for line in lines[:node.end_lineno-1])+node.end_col_offset
    result=(encoded[:start]+ast.unparse(replacement).encode('utf-8')+encoded[end:]).decode('utf-8')
    validate_source(result)
    return result


async def generate_oracle(provider,program,topic,initial_feedback='',initial_source=None,result_shape=None,definition=None):
    """Repair only the checker on a checker error, retaining the candidate."""
    feedback=initial_feedback;previous=initial_source;independent=None;prepared=None
    for attempt in range(4):
        if prepared is not None:
            independent=prepared;prepared=None
        elif previous and feedback:
            # A broken checker is a source repair task, not another full
            # generation of the same contract. Keep the approved inputs and
            # show the concrete entry object without a synthetic data wrapper.
            if definition is not None:
                try:repaired=SourceRepair(source=await patch_checker(provider,previous,definition,feedback,program))
                except (ValueError,SyntaxError) as exc:
                    # A rejected edit never becomes the next source. Resample
                    # only this checker component from the concrete failure.
                    if attempt==3:
                        exc.checker_source=previous
                        raise
                    feedback=feedback+'\nChecker patch rejected without application: '+str(exc)
                    previous=None;independent=None
                    continue
            elif feedback.startswith('CHECKER_COUNTEREXAMPLE_ERROR:'):
                raw=await provider.generate(json.dumps({'required_definition':definition.model_dump(mode='json') if definition else program.explanation,
                    'execution_evidence':feedback,'source_to_repair':previous,
                    'selection_expressions':selection_evidence(previous),
                    'instruction':'Both implementations executed to completion but returned different results. Repair this checker using the definition and exact expressions. Do not invent undefined-variable errors: execution completed. Return minimal exact old/new replacements; old must occur exactly once. Correct the actual decision formula or state update, not cosmetic names.'},ensure_ascii=False),
                    schema=SourcePatch,json_mode=True,
                    system='Repair a concrete result mismatch with a minimal code patch. Only the executed mismatch and algorithm specification are evidence. Do not invent an exception that did not occur. Only JSON.',
                    options={'temperature':0,'num_predict':1600,'num_ctx':8192})
                repaired=SourceRepair(source=apply_source_patch(previous,SourcePatch.model_validate_json(raw,strict=True)))
            else:
                raw=await provider.generate(json.dumps({'topic':topic,
                'entry_argument':program.default_input,
                'input_description':program.input_description,
                'output_description':program.output_description,
                'input_validator':program.input_validator,
                'computation_rule':program.explanation,
                'algorithm_definition':definition.model_dump(mode='json') if definition else None,
                'previous_source':previous,'execution_error':feedback,
                'instruction':'修复校验器源码中的具体错误，只返回source。solve的参数就是entry_argument本身，不存在额外包装层。保留原计算目标、初始化、平局与终止约定；不得复制被测算法，不得返回固定样例答案。'},ensure_ascii=False),
                schema=SourceRepair,json_mode=True,
                system='Repair the concrete defect in this independent result calculator, following algorithm_definition exactly. Preserve its input/output contract, graph direction, heuristic priority and tie rules. A heuristic algorithm must not become a global optimizer. Fix the supplied previous_source using execution_error; do not repeat unchanged incorrect code. Return complete corrected Python source.'+POLICY,
                options={'temperature':0,'num_predict':3072,'num_ctx':8192})
                repaired=SourceRepair.model_validate_json(raw,strict=True)
            if ast_identity(repaired.source)==ast_identity(previous):
                raw=await provider.generate(json.dumps({'required_definition':definition.model_dump(mode='json') if definition else program.explanation,
                    'previous_source':previous,'actual_execution_error':feedback,
                    'selection_evidence':selection_evidence(previous),
                    'instruction':'The last repair repeated identical incorrect source. Return minimal exact text edits that correct the concrete defect. old must occur exactly once in previous_source; new is its corrected replacement. Fix decision expressions or updates at fault, not cosmetic names. Preserve input/output contract and independent implementation.'},ensure_ascii=False),
                    schema=SourcePatch,json_mode=True,
                    system='Repair a proven algorithm defect with a minimal precise code patch, using the stated definition and concrete failure. Do not reprint full source. Only JSON.',
                    options={'temperature':0,'num_predict':1600,'num_ctx':8192})
                repaired=SourceRepair(source=apply_source_patch(previous,SourcePatch.model_validate_json(raw,strict=True)))
            independent=IndependentOracle(source=repaired.source,
                validation_inputs=independent.validation_inputs if independent else program.validation_inputs[:8])
        else:
            raw=await provider.generate(json.dumps({'topic':topic,'input_description':program.input_description,
            'output_description':program.output_description,'default_input':program.default_input,
            'input_validator':program.input_validator,'computation_rule':program.explanation,
            'algorithm_definition':definition.model_dump(mode='json') if definition else None,
            'authoritative_input_shape':input_contract(program.default_input),
            'required_result_shape':result_shape,
            'validation_error':feedback,'previous_oracle':previous,
            'instruction':'Independently implement the exact result specification in algorithm_definition and output_description. Use a simple different method where result-equivalent (linear scan, exhaustive enumeration, builtin sorting). For outputs DEFINED BY AN ALGORITHM POLICY, independently replay that precise priority/transition policy using plain data structures; an optimized or shortest answer is NOT an equivalent replacement. Preserve graph direction, ties, initialization and termination. Generate 4 to 8 diverse valid inputs including boundaries and cases where commonly confused algorithms produce different answers. Do not supply expected answers or copy an implementation.'+POLICY},ensure_ascii=False),
            schema=IndependentOracle,json_mode=True,
            system='You implement an independent executable specification. The exact decision formula and required result are authoritative. solve(data) returns the result itself, never a validation boolean unless that is the required result type. Do not replace a heuristic procedure by a globally optimal solver. Use supplied input schema exactly. Only JSON.'+POLICY,
            options={'temperature':0 if attempt==0 else 0.25,'num_predict':3072,'num_ctx':16384})
            independent=IndependentOracle.model_validate_json(raw,strict=True)
        previous=independent.source
        try:
            validate_source(independent.source)
            if definition:
                raw=await provider.generate(json.dumps({'required_algorithm':topic,
                    'definition':definition.model_dump(mode='json'),
                    'input_description':program.input_description,'output_description':program.output_description,
                    'checker_source':independent.source,'selection_evidence':selection_evidence(independent.source),
                    'instruction':'Does this checker compute the REQUIRED RESULT for all valid inputs? It may use a different implementation, but must preserve required output semantics, graph direction, tie rules and algorithm-defined paths. A global optimum is not an interchangeable answer for a heuristic procedure. Follow the actual selector expression and its dependencies; auxiliary cost bookkeeping alone is harmless. Reject a concrete different priority formula when that can change the required path.'},ensure_ascii=False),
                    schema=OracleSemanticsReview,json_mode=True,
                    system='Independently examine result semantics of an oracle, using exact code evidence. Allow different methods that compute the same specified result. Reject a checker that silently solves a related but different problem. Only JSON.',
                    options={'temperature':0,'num_predict':900,'num_ctx':16384})
                review=OracleSemanticsReview.model_validate_json(raw,strict=True)
                evidence=selection_evidence(independent.source)
                if not review.computes_required_result and review.violation_kind=='selection' and evidence['selectors']:
                    raw=await provider.generate(json.dumps({'expected_decision_rule':definition.decision_rule,
                        'actual_selection_expressions':evidence,
                        'instruction':'Compare the required decision formula with the actual selector and its assignment dependencies. Derive the formula from expressions; names such as f_score do not imply any particular formula. same_rule is true only if the actual formula is equivalent.'},ensure_ascii=False),
                        schema=DecisionRuleReview,json_mode=True,
                        system='Compare exact mathematical decision formulas using AST expressions, not variable names. Only JSON.',
                        options={'temperature':0,'num_predict':700,'num_ctx':8192})
                    decision=DecisionRuleReview.model_validate_json(raw,strict=True)
                    if decision.same_rule:
                        review=review.model_copy(update={'computes_required_result':True,'reason':decision.reason})
                if not review.computes_required_result:
                    try:
                        (ROOT/'logs').mkdir(exist_ok=True)
                        diagnostic={'topic':topic,'definition':definition.model_dump(mode='json'),
                            'source':independent.source,'selectionEvidence':evidence,'critique':review.reason}
                        name=hashlib.sha256(topic.encode()).hexdigest()[:16]
                        (ROOT/'logs'/f'oracle-{name}-semantic-failure.json').write_text(json.dumps(diagnostic,ensure_ascii=False),encoding='utf-8')
                    except OSError:pass
                    raise ValueError('CHECKER_SEMANTICS_ERROR: '+review.reason)
            if ast_identity(program.source)==ast_identity(independent.source):
                raise ValueError('校验源码与推演源码结构相同，包括仅改变量名的复制；请改用结果定义的朴素计算，不能重复相同实现。')
            combined={json.dumps(d,sort_keys=True):d for d in program.validation_inputs+independent.validation_inputs}
            checked_program=program.model_copy(update={'validation_inputs':list(combined.values())})
            try:
                await sandbox(checked_program,independent.source,program.default_input)
            except ValueError as exc:
                if 'INPUT_DOMAIN_ERROR:' in str(exc):
                    # Candidate inputs already passed preflight. This new
                    # checker batch violates the approved domain; regenerate
                    # the checker batch, never redefine invalid inputs' answers.
                    if attempt==3:raise
                    repaired_inputs=await repair_validation_inputs(provider,program,independent.validation_inputs,str(exc))
                    prepared=independent.model_copy(update={'validation_inputs':repaired_inputs})
                    continue
                if 'CHECKER_EXECUTION_ERROR:' in str(exc):
                    feedback=str(exc)
                    if attempt==3:raise
                    continue
                if definition:
                    raw=await provider.generate(json.dumps({'algorithm':topic,
                        'definition':definition.model_dump(mode='json'),
                        'input_description':program.input_description,'output_description':program.output_description,
                        'candidate_source':program.source,'checker_source':independent.source,
                        'actual_execution_disagreement':str(exc),
                        'instruction':'Manually follow this concrete counterexample using the stated algorithm. Neither implementation is automatically authoritative. Determine which code must be repaired. Distinguish WRONG answers from DIFFERENT VALID solutions. If BOTH satisfy an underspecified multi-solution output contract, set multiple_valid_outputs=true and supply deterministic_output_policy and deterministic_boundary_rules in the original request language: explicitly describe the canonical tie/visit/output ordering already implemented by the candidate. Preserve original task meaning and cardinality (one solution vs all solutions), never change an explicit user tie rule or call a wrong result valid. This policy is not an expected answer: it must apply to every input and will be checked by a newly generated independent calculator. Otherwise leave these fields empty and explain the concrete defect.'},ensure_ascii=False),
                        schema=CounterexampleReview,json_mode=True,
                        system='Adjudicate a concrete execution disagreement from algorithm definitions and code. Never assume the oracle is correct. Only JSON.',
                        options={'temperature':0,'num_predict':1200,'num_ctx':16384})
                    adjudication=CounterexampleReview.model_validate_json(raw,strict=True)
                    if (adjudication.multiple_valid_outputs and adjudication.deterministic_output_policy
                            and adjudication.deterministic_boundary_rules and attempt<3):
                        program.output_description=adjudication.deterministic_output_policy
                        definition.boundary_rules=adjudication.deterministic_boundary_rules
                        feedback='Output contract now specifies deterministic ordering; independently compute this policy: '+program.output_description
                        previous=None;independent=None
                        continue
                    if adjudication.repair_target=='checker':
                        # A reviewer's prose can hallucinate a nonexistent
                        # NameError even when both programs returned results.
                        # Repair from executed evidence, never that speculation.
                        feedback='CHECKER_COUNTEREXAMPLE_ERROR: '+str(exc)
                        proposal=grounded_input_key_repair(program.source,independent.source)
                        if proposal is not None and attempt<3:
                            prepared=independent.model_copy(update={'source':proposal})
                            continue
                        if attempt==3:raise ValueError(feedback) from exc
                        continue
                # The checker can calculate a concrete counterexample; repair
                # the candidate implementation without changing its task/tests.
                error=CandidateExecutionError(str(exc))
                error.validation_inputs=checked_program.validation_inputs
                raise error from exc
            return independent
        except CandidateExecutionError:raise
        except (ValueError,SyntaxError) as exc:
            feedback=str(exc)
            if attempt==3:
                exc.checker_source=previous
                raise


async def dynamic_trace(topic,data=None,algorithm=None,scope='local',*,purpose='algorithm',teaching_context=None):
    if not isinstance(topic,str) or not 1<=len(topic.strip())<=2000:
        raise ValueError('请填写明确的算法名称')
    if purpose not in ('algorithm','programming-task'):raise ValueError('执行契约用途无效')
    key=dynamic_key(topic,scope,purpose,teaching_context)
    if algorithm and algorithm!=key:raise ValueError('动态算法标识与主题不一致，请按当前主题重新生成')
    async with LOCK:
        cached=CACHE.get(key)
        path=verified_contract_path(key,scope)
        if cached is None and path is not None and path.exists():
            try:
                if path.stat().st_size>150000:raise ValueError('契约文件超过上限')
                payload=json.loads(path.read_text(encoding='utf-8'))
                if payload['topic']!=topic or payload['purpose']!=purpose:raise ValueError('契约主题不一致')
                proof=payload['proof']
                await replay_execution_proof(proof)
                program=GeneratedAlgorithm.model_validate(proof['program'],strict=True)
                cached=(program,proof['oracle'],proof['sourceHash'])
                CACHE[key]=cached
            except (OSError,ValueError,KeyError,TypeError):
                logging.getLogger(__name__).warning('Saved dynamic contract failed replay; regenerating key=%s',key)
        if cached:
            program,oracle,digest=cached
            result=await sandbox(program,oracle,data if data is not None else program.default_input)
            CACHE.move_to_end(key)
            return render_trace(program,result,data if data is not None else program.default_input,key,digest)
        feedback=''
        previous_source=None
        previous_program=None
        repair_candidate=True
        previous_checker=None
        definition=None
        semantic_repair=False
        # Owner-scoped failure checkpoints are untrusted recovery input, never
        # accepted assets. Every resumed candidate is reviewed/executed again.
        failure_path=ROOT/'logs'/f'{key}-verification-failure.json'
        if path is not None and failure_path.exists() and failure_path.stat().st_size<=150000:
            try:
                saved=json.loads(failure_path.read_text(encoding='utf-8'))
                if saved.get('topic')==topic:
                    resumed=GeneratedAlgorithm.model_validate(saved['program'],strict=True)
                    validate_source(resumed.source)
                    if resumed.input_validator is not None:validate_source(resumed.input_validator)
                    previous_program=resumed;previous_source=resumed.source;repair_candidate=False
            except (OSError,ValueError,SyntaxError,KeyError,TypeError):pass
        async with OllamaProvider(timeout=180,prefer_streaming=True) as provider:
            raw=await provider.generate(json.dumps({'topic':topic,
                    'instruction':'Identify the exact named algorithm or data-structure operation. Return its standard ENGLISH name in title, preserving the variant. Do not substitute a related algorithm. Being absent from a preset catalog does not make it invalid. Only genuinely ambiguous families are ambiguous. No implementation.'},ensure_ascii=False),
                    schema=AlgorithmTopic,json_mode=True,system='You are an algorithm terminology translator. Identify the precise English technical name from the original topic. Do not invent a new algorithm or broaden the request.',options={'temperature':0,'num_predict':450,'num_ctx':4096})
            identity=AlgorithmTopic.model_validate_json(raw,strict=True)
            named_algorithm=identity.status=='named'
            if not named_algorithm:
                if purpose!='programming-task':raise InvalidAlgorithm(identity.reason)
                identity=AlgorithmTopic(status='named',title=topic[:100],reason='按原始编程知识点设计明确的教学计算任务。')
            if named_algorithm:
                raw=await provider.generate(json.dumps({'original_topic':topic,'proposed_english_name':identity.title,
                    'instruction':'Independently verify exact terminology equivalence, preserving every variant qualifier. Related algorithms in the same family are NOT equivalent. Return the correct standard English name for the ORIGINAL request in canonical_name, and mark equivalent=false if the proposed name refers to a different algorithm.'},ensure_ascii=False),
                    schema=AlgorithmIdentityReview,json_mode=True,
                    system='You are an independent algorithm terminology examiner. Anchor to the original request, not the suggested name. Preserve distinctions in search priorities, optimization guarantees and variants.',
                    options={'temperature':0,'num_predict':600,'num_ctx':8192})
                terminology=AlgorithmIdentityReview.model_validate_json(raw,strict=True)
                if not terminology.equivalent:
                    identity=identity.model_copy(update={'title':terminology.canonical_name,'reason':terminology.reason})
            # The original request already missed the registry. A model's
            # renamed topic is never authority to substitute a catalog entry
            # and skip generation/semantic review (e.g. greedy search -> A*).
            for attempt in range(3):
                phase='candidate'
                try:
                    if definition is None:
                        raw=await provider.generate(json.dumps({'topic':identity.title,'original_topic':topic,'canonical_name':identity.title,
                            'original_requirement':teaching_context,'previous_error':feedback,
                            'instruction':'Define the exact ENGLISH algorithm independently, without code. State the priority/comparison formula and all required input data, state transitions, termination, deterministic tie rules, valid domain and boundaries. Distinguish actual guarantees from properties it does NOT guarantee. Heuristic/approximate/randomized algorithms must not silently become exact optimizers. Distinguish similar algorithm names. For a programming concept, define one task following the original requirement.'},ensure_ascii=False),
                            schema=AlgorithmDefinition,json_mode=True,
                            system='You are an algorithm theory examiner. Define the standard algorithm from its precise English name. Give the exact decision formula, not vague phrases like current best. Do not confuse a heuristic priority with accumulated path cost or assume optimality without proof. Only JSON.',
                            options={'temperature':0,'num_predict':1200,'num_ctx':8192})
                        definition=AlgorithmDefinition.model_validate_json(raw,strict=True)
                    task_rule=('围绕原始编程知识点设计一个目标明确、难度中等偏下的综合计算练习，不能沿用编辑阶段给出的其他主题。' if not named_algorithm else '主题已确认为明确算法。生成原始请求算法的真实实现，不得改成另一算法。')+'元数据title/explanation/input_description/output_description使用原始需求的语言，源码使用Python。'
                    if previous_program is not None and semantic_repair:
                        raw=await provider.generate(json.dumps({'original_topic':topic,'canonical_english_name':identity.title,
                            'independent_definition':definition.model_dump(mode='json'),
                            'previous_contract':previous_program.model_dump(mode='json'),'specific_semantic_defect':feedback,
                            'instruction':'Repair this concrete defect, do not start an unrelated example. Return the complete corrected contract, fixing BOTH decision code and any wrong guarantees/descriptions named by the review. Preserve valid input fields, initialization and tests. If the old contract omitted necessary algorithm inputs, consistently fix the input definition, validator and test inputs. Do not reprint the criticized decision formula.'},ensure_ascii=False),
                            schema=SemanticContractRepair,json_mode=True,
                            system='You repair a specific algorithm semantics defect. The ORIGINAL request and independently verified decision rule are authoritative. Make a targeted correction to the supplied contract. Keep metadata in the original request language. Only JSON.'+POLICY,
                            options={'temperature':0,'num_predict':4096,'num_ctx':16384})
                        program=SemanticContractRepair.model_validate_json(raw,strict=True)
                        semantic_repair=False
                    elif previous_program is not None and repair_candidate:
                        raw=await provider.generate(json.dumps({'topic':topic,'original_requirement':teaching_context,
                            'approved_contract':previous_program.model_dump(mode='json',exclude={'validation_inputs','pointer_names'}),'validation_failure':feedback,
                            'authoritative_input_shape':input_contract(previous_program.default_input),
                            'instruction':'只修复 source，不得修改任务、输入输出含义、默认输入或验证输入。错误中给出了实际失败输入，必须修正该边界的实现，不得删除用例或改成其他任务。'+POLICY},ensure_ascii=False),
                            schema=SourceRepair,json_mode=True,system='Fix the concrete execution counterexample. The error includes actual, expected and the exact return location/source. Correct the logic at fault; do not reprint the same wrong source, hardcode an answer, or change the algorithm. Preserve the stated input/output contract. source must contain the complete corrected Python.'+POLICY,options={'temperature':0,'num_predict':4096,'num_ctx':16384})
                        program=previous_program.model_copy(update={'source':SourceRepair.model_validate_json(raw,strict=True).source})
                    elif previous_program is not None:
                        program=previous_program
                    else:
                        raw=await provider.generate(json.dumps({'topic':identity.title,'original_topic':topic,'algorithm_definition':definition.model_dump(mode='json'),'original_requirement':teaching_context,'identified_algorithm':identity.title,'input':data,'previous_validation_error':feedback,'previous_source':previous_source,
                            'instruction':task_rule+'生成输入说明和4至8个小规模边界校验输入。valid_algorithm必须true。'+POLICY},ensure_ascii=False),
                            schema=ApprovedAlgorithm,json_mode=True,
                            system='You are a Python algorithm implementation engineer. Implement the EXACT algorithm specified by its English name and algorithm_definition, preserving its decision formula and guarantees. Never substitute a related algorithm. Correct prior semantic errors instead of copying the previous wrong source. Write metadata in the original request language. Only Schema JSON; source contains executable Python, not prose.'+POLICY,
                            options={'temperature':0,'num_predict':4096,'num_ctx':8192})
                        program=ApprovedAlgorithm.model_validate_json(raw,strict=True)
                    previous_program=program
                    previous_source=program.source
                    validate_source(program.source)
                    try:validate_source(program.input_validator)
                    except (ValueError,SyntaxError):
                        semantic_repair=True
                        raise
                    phase='semantic'
                    raw=await provider.generate(json.dumps({'topic':topic,'original_requirement':teaching_context,
                        'canonical_english_algorithm':identity.title,
                        'independent_definition':definition.model_dump(mode='json'),'candidate':program.model_dump(mode='json'),
                        'instruction':'独立检查原始算法、英文规范名称、定义与代码的决策准则、状态更新、终止、输出保证是否一致；输入域判定是否准确且接受合法空输入。canonical_name必须填写原始用户算法的正确英文名称。definition_correct单独说明定义本身是否正确。若实现了相邻算法、缺少必要输入或错误承诺最优，返回false，并说明应纠正的契约与公式。'},ensure_ascii=False),
                        schema=CandidateReview,json_mode=True,
                        system='You are an independent algorithm theory and implementation examiner. The ORIGINAL user topic is authoritative; the proposed English name and definition may be wrong. Verify exact identity and the actual decision formula. Extra bookkeeping, visited sets and path reconstruction are allowed; do not mistake their presence for a different algorithm. Do not impose global optimality on algorithms that do not guarantee it. Reject actual rule substitutions, missing required inputs, false guarantees or a domain predicate that crashes on missing fields or excludes valid boundaries.',
                        options={'temperature':0,'num_predict':900,'num_ctx':16384})
                    candidate_review=CandidateReview.model_validate_json(raw,strict=True)
                    if not candidate_review.matches_topic or not candidate_review.implementation_correct:
                        # Challenge a claimed algorithm substitution against
                        # actual selection expressions. Reviewers otherwise
                        # often infer A* merely from an auxiliary g_score name.
                        raw=await provider.generate(json.dumps({'original_topic':topic,'canonical_english_algorithm':identity.title,
                            'definition':definition.model_dump(mode='json'),'selection_evidence':decision_sites(program.source),
                            'source':program.source,'input_validator':program.input_validator,
                            'initial_critique':candidate_review.reason,
                            'instruction':'Independently verify whether the critique is factually supported by the ACTUAL selection expressions. An auxiliary cost variable, path reconstruction or bookkeeping does not by itself change an algorithm. Check which expression really determines selection and state updates. Judge against the original algorithm definition and its actual guarantees. Return the corrected review, keeping false if a concrete formula or update violates the definition.'},ensure_ascii=False),
                            schema=CandidateReview,json_mode=True,
                            system='You resolve an algorithm review disagreement using exact AST evidence, not variable-name associations or assumed optimality. Identify actual decision semantics. Only JSON.',
                            options={'temperature':0,'num_predict':900,'num_ctx':16384})
                        candidate_review=CandidateReview.model_validate_json(raw,strict=True)
                    evidence=selection_evidence(program.source)
                    if (not candidate_review.matches_topic or not candidate_review.implementation_correct) and candidate_review.definition_correct and candidate_review.domain_correct and candidate_review.violation_kind in ('selection','identity') and evidence['selectors']:
                        raw=await provider.generate(json.dumps({'expected_decision_rule':definition.decision_rule,
                            'actual_selection_expressions':evidence,
                            'instruction':'Compare the mathematical/operational rule to the exact selector expressions and their variable dependencies. Decide whether they implement the same selection rule. Analyze the expression actually passed as key/priority, not unrelated variable names. No algorithm-name classification or optimality assumptions.'},ensure_ascii=False),
                            schema=DecisionRuleReview,json_mode=True,
                            system='You compare a specified decision formula with exact Python AST expressions. Report the observed formula and whether it matches. Do not infer formulas from names of unused bookkeeping variables.',
                            options={'temperature':0,'num_predict':700,'num_ctx':8192})
                        selection_review=DecisionRuleReview.model_validate_json(raw,strict=True)
                        if selection_review.same_rule:
                            candidate_review=candidate_review.model_copy(update={'matches_topic':True,'implementation_correct':True,
                                'reason':selection_review.reason})
                    if not all((candidate_review.matches_topic,candidate_review.implementation_correct,candidate_review.domain_correct,candidate_review.definition_correct)):
                        semantic_repair=True
                        if not candidate_review.definition_correct:definition=None
                        raise ValueError('算法定义或实现语义不符：'+candidate_review.reason)
                    if candidate_review.canonical_output_description:
                        program.output_description=candidate_review.canonical_output_description
                    phase='candidate'
                    # This is only a runtime/determinism preflight, never
                    # independent evidence and never published or cached.
                    try:
                        candidate_run=await sandbox(program,program.source,program.default_input)
                    except ValueError as exc:
                        if 'INPUT_DOMAIN_ERROR:' in str(exc) or 'INPUT_VALIDATOR_ERROR:' in str(exc):
                            if '声明的校验用例不属于有效输入域' in str(exc):
                                if attempt==2:raise
                                repaired_inputs=await repair_validation_inputs(provider,program,program.validation_inputs,str(exc))
                                previous_program=program.model_copy(update={'validation_inputs':repaired_inputs})
                                repair_candidate=False
                                semantic_repair=False
                                continue
                            semantic_repair=True
                            raise
                        raise CandidateExecutionError('候选实现预运行失败：'+str(exc)) from exc
                    phase='checker'
                    independent=await generate_oracle(provider,program,identity.title,
                        feedback if not repair_candidate else '',previous_checker,
                        input_contract(candidate_run['outcome']),definition)
                    oracle=independent.source
                    combined={json.dumps(d,sort_keys=True):d for d in program.validation_inputs+independent.validation_inputs}
                    program=program.model_copy(update={'validation_inputs':list(combined.values())})
                    validate_source(oracle)
                    if ast_identity(program.source)==ast_identity(oracle):raise ValueError('独立校验实现不能复制被校验实现')
                    # Identity/definition/source were reviewed before execution.
                    # Publication is decided by independent WASM results and
                    # deterministic replay, not a second model vote that may
                    # invent requirements such as optimality for greedy search.
                    actual=data if data is not None else program.default_input
                    phase='verification'
                    result=await sandbox(program,oracle,actual)
                    # Keep valid independently executed platform boundaries in
                    # the published contract, not just in transient diagnostics.
                    verified_inputs={json.dumps(item,sort_keys=True):item for item in program.validation_inputs}
                    for checked in result.get('checkedProbes',[]):
                        verified_inputs.setdefault(json.dumps(checked['input'],sort_keys=True),checked['input'])
                    program=program.model_copy(update={'validation_inputs':list(verified_inputs.values())[:32]})
                    digest=source_digest(program,oracle)
                    persist_verified_contract(topic,scope,purpose,teaching_context,program,oracle)
                    CACHE[key]=(program,oracle,digest)
                    while len(CACHE)>32:CACHE.popitem(last=False)
                    return render_trace(program,result,actual,key,digest)
                except InvalidAlgorithm:raise
                except (ValueError,SyntaxError,OllamaResponseError) as exc:
                    feedback=str(exc)[-1600:]
                    repair_candidate=isinstance(exc,CandidateExecutionError) or phase in ('candidate','verification')
                    if previous_program is not None and hasattr(exc,'validation_inputs'):
                        previous_program=previous_program.model_copy(update={'validation_inputs':exc.validation_inputs})
                    previous_checker=getattr(exc,'checker_source',None)
                    logging.getLogger(__name__).warning('Dynamic verification topic=%s attempt=%s cause=%s',topic,attempt+1,feedback)
                    if attempt==2:
                        # Keep reproducible private diagnostics, never expose
                        # reference code through a public failure response.
                        audit={'topic':topic,'definition':definition.model_dump(mode='json') if definition else None,
                               'program':previous_program.model_dump(mode='json') if previous_program else None,
                               'checkerSource':getattr(exc,'checker_source',None),'failure':feedback}
                        try:
                            (ROOT/'logs').mkdir(exist_ok=True)
                            (ROOT/'logs'/f'{key}-verification-failure.json').write_text(json.dumps(audit,ensure_ascii=False),encoding='utf-8')
                        except OSError:
                            logging.getLogger(__name__).warning('Dynamic failure diagnostic could not be saved')
                        raise ValueError('动态算法经隔离执行或交叉校验未通过：'+feedback) from exc


def ast_identity(source):
    import ast
    from .sandbox_driver import BUILTINS
    tree=ast.parse(source)
    names={}
    def renamed(name):
        if name in BUILTINS:return name
        if name not in names:names[name]='name'+str(len(names))
        return names[name]
    class CanonicalNames(ast.NodeTransformer):
        def visit_Name(self,node):
            node.id=renamed(node.id)
            return node
        def visit_arg(self,node):
            node.arg=renamed(node.arg)
            return node
        def visit_FunctionDef(self,node):
            node.name=renamed(node.name)
            return self.generic_visit(node)
    return ast.dump(CanonicalNames().visit(tree),include_attributes=False)


class InvalidAlgorithm(ValueError):pass


async def compute_trace(algorithm=None,topic='',data=None,scope='local'):
    matched=algorithm if algorithm in REGISTRY else resolve(topic) if not algorithm else None
    if matched:return await asyncio.to_thread(run_trace,matched,topic,data)
    return await dynamic_trace(topic,data,algorithm,scope)

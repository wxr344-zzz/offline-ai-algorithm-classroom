"""Trusted driver, loaded INSIDE Pyodide WASM only by the Node sandbox.

Generated code only imports selected pure math/heap/bisection operations through
capability facades. No filesystem, network, Python/JS bridge or reflection.
sys tracing supplies snapshots; code cannot emit them.
"""
import ast
import builtins
import copy
import json
import sys
import math
import heapq
import bisect
from types import SimpleNamespace

PURE_MODULES = {
    'math': {name:getattr(math,name) for name in ('sqrt','hypot','floor','ceil','log','log2','log10','exp','sin','cos','tan','gcd','isfinite','pi','e','tau')},
    'heapq': {name:getattr(heapq,name) for name in ('heappush','heappop','heapify','heappushpop','heapreplace','nlargest','nsmallest')},
    'bisect': {name:getattr(bisect,name) for name in ('bisect','bisect_left','bisect_right','insort','insort_left','insort_right')},
}

METHODS = {'append','pop','insert','remove','get','keys','values','items','copy',
           'sort','reverse','count','index','add','discard','union','intersection',
           'difference','update','clear','extend','split','join','strip','lower','upper'}
BUILTINS = {'len','range','enumerate','zip','min','max','sum','abs','all','any','sorted',
            'list','dict','set','tuple','int','str','bool','float','reversed','round',
            'isinstance','ord','chr','divmod'}


def validate_source(source):
    if not isinstance(source,str) or len(source)>10000:
        raise ValueError('算法源码超过限制')
    tree=ast.parse(source,filename='algorithm.py')
    if not tree.body or any(not isinstance(n,(ast.FunctionDef,ast.Import,ast.ImportFrom)) for n in tree.body):
        raise ValueError('只允许定义纯函数及受限纯计算模块导入，不允许顶层执行语句')
    functions=[n for n in tree.body if isinstance(n,ast.FunctionDef)]
    if not any(n.name=='solve' and len(n.args.args)==1 for n in functions):
        raise ValueError('必须定义 solve(data)，只接收一个JSON对象')
    if len({n.name for n in functions})!=len(functions):
        raise ValueError('不能重复声明入口函数')
    entry=next(n for n in functions if n.name=='solve')
    if not any(isinstance(n,ast.Name) and n.id==entry.args.args[0].arg and isinstance(n.ctx,ast.Load) for n in ast.walk(entry)):
        raise ValueError('算法必须读取实际输入，不能只返回固定样例答案')
    names={n.name for n in ast.walk(tree) if isinstance(n,ast.FunctionDef)}
    def rejected(node, reason):
        line=getattr(node,'lineno',1)
        excerpt=source.splitlines()[line-1].strip()[:180]
        raise ValueError(f'第{line}行 {type(node).__name__}: {reason}；源码：{excerpt}')
    modules={}
    for n in ast.walk(tree):
        if isinstance(n,ast.Import):
            for alias in n.names:
                if alias.name not in PURE_MODULES:rejected(n,'仅允许math、heapq、bisect的受限纯计算能力')
                modules[alias.asname or alias.name]=alias.name
        elif isinstance(n,ast.ImportFrom):
            if n.level or n.module not in PURE_MODULES:rejected(n,'仅允许受限纯计算模块')
            for alias in n.names:
                if alias.name not in PURE_MODULES[n.module]:rejected(n,'该模块成员未开放')
                names.add(alias.asname or alias.name)
        if isinstance(n,(ast.Import,ast.ImportFrom)):
            for alias in n.names:
                if (alias.asname or alias.name).startswith('_'):rejected(n,'导入不能使用保留名称')
    for n in ast.walk(tree):
        if isinstance(n,(ast.ClassDef,ast.With,ast.AsyncWith,
                         ast.AsyncFunctionDef,ast.Await,ast.Yield,ast.YieldFrom,
                         ast.Global,ast.Nonlocal,ast.Delete,ast.Raise,ast.Try,ast.LShift,ast.RShift)):
            rejected(n,'只允许有界纯算法语句，不允许异常控制或运行环境访问')
        if isinstance(n,ast.Name) and ((n.id.startswith('_') and n.id!='_') or n.id in
            {'open','eval','exec','compile','globals','locals','vars','getattr','setattr',
             'delattr','type','object','super','help','input','print','breakpoint','memoryview'}):
            rejected(n,f'名称{n.id!r}未开放；循环占位符_允许，其他下划线开头的名称保留给运行时')
        if isinstance(n,ast.arg) and n.arg.startswith('_') and n.arg!='_':
            rejected(n,'不允许保留参数名称')
        if isinstance(n,ast.FunctionDef):
            if n.name.startswith('_') or n.decorator_list or n.args.defaults or n.args.kw_defaults:
                rejected(n,'函数不能包含装饰器、默认参数或保留名称')
            if n.returns is not None or any(arg.annotation is not None for arg in n.args.args+n.args.kwonlyargs):
                raise ValueError('纯算法函数不需要运行时类型注解')
        if isinstance(n,ast.Attribute):
            module=modules.get(n.value.id) if isinstance(n.value,ast.Name) else None
            if (module and n.attr not in PURE_MODULES[module]) or (not module and n.attr not in METHODS):
                rejected(n,'只允许受限容器方法与已开放的纯计算模块成员')
        if isinstance(n,ast.AugAssign) and isinstance(n.op,(ast.Mult,ast.Pow)):
            raise ValueError('请把乘方或乘法复合赋值改为普通赋值，以便检查分配限额')
        if isinstance(n,ast.FormattedValue) and n.format_spec is not None:
            raise ValueError('算法输出不允许动态格式宽度，请返回原始JSON值')
        if isinstance(n,ast.Call):
            if isinstance(n.func,ast.Name) and n.func.id not in BUILTINS|names:
                rejected(n,'调用了未声明的函数，请定义辅助纯函数或使用开放内置函数')
            if not isinstance(n.func,(ast.Name,ast.Attribute)):
                raise ValueError('禁止间接调用')
        if isinstance(n,ast.Constant):
            if not isinstance(n.value,(str,int,float,bool,type(None))) or len(str(n.value))>4000:
                raise ValueError('常量超过限制')
    return tree


def bounded(value,depth=0,budget=None):
    budget=[0] if budget is None else budget
    budget[0]+=1
    if depth>12 or budget[0]>5000: raise ValueError('状态规模超过教学限制')
    if value is None or type(value) in (bool,str,int,float):
        if len(str(value))>4000: raise ValueError('数值或文本超过限制')
        return value
    if type(value) in (list,tuple,set):
        if len(value)>256: raise ValueError('容器长度超过256')
        items=sorted(value,key=str) if type(value)is set else value
        return [bounded(v,depth+1,budget) for v in items]
    if type(value)is dict:
        if len(value)>256: raise ValueError('映射长度超过256')
        return {str(k):bounded(v,depth+1,budget) for k,v in value.items()}
    raise ValueError('状态必须是JSON数据，不能包含运行环境对象')


def safe_mult(a,b):
    if isinstance(a,(list,tuple,str)) and isinstance(b,int) and len(a)*max(0,b)>4096:
        raise ValueError('分配超过教学限制')
    if isinstance(b,(list,tuple,str)) and isinstance(a,int) and len(b)*max(0,a)>4096:
        raise ValueError('分配超过教学限制')
    if isinstance(a,int) and isinstance(b,int) and a.bit_length()+b.bit_length()>512:
        raise ValueError('整数规模超过限制')
    return a*b


def safe_power(a,b):
    if not (type(b) in (int,float) and abs(b)<=16 and type(a) in (int,float) and abs(a)<=10000): raise ValueError('幂运算超过限制')
    return a**b


class GuardAllocations(ast.NodeTransformer):
    def visit_BinOp(self,node):
        self.generic_visit(node)
        name='_trace_mult' if isinstance(node.op,ast.Mult) else '_trace_power' if isinstance(node.op,ast.Pow) else None
        return ast.copy_location(ast.Call(func=ast.Name(id=name,ctx=ast.Load()),args=[node.left,node.right],keywords=[]),node) if name else node


def execute(source,data,capture):
    tree=validate_source(source)
    tree=ast.fix_missing_locations(GuardAllocations().visit(tree))
    safe={name:getattr(builtins,name) for name in BUILTINS}
    facades={name:SimpleNamespace(**members) for name,members in PURE_MODULES.items()}
    def pure_import(name,globals=None,locals=None,fromlist=(),level=0):
        if level or name not in facades:raise ValueError('不能导入运行环境模块')
        return facades[name]
    safe['__import__']=pure_import
    def limited_range(*args):
        result=range(*args)
        if len(result)>4096: raise ValueError('循环范围超过4096')
        return result
    safe['range']=limited_range
    scope={'__builtins__':safe,'_trace_mult':safe_mult,'_trace_power':safe_power}
    exec(compile(tree,'algorithm.py','exec'),scope)
    frames=[];ticks=0;return_location={}
    lines=source.splitlines()
    def observe(frame,event,arg):
        nonlocal ticks,return_location
        if frame.f_code.co_filename!='algorithm.py': return observe
        frame.f_trace_opcodes=True
        ticks+=1
        if ticks>150000: raise ValueError('执行超过150000次教学指令，请缩小输入')
        if event not in ('line','return'): return observe
        if event=='return':
            return_location={'function':frame.f_code.co_name,'line':frame.f_lineno,
                'source':lines[frame.f_lineno-1] if frame.f_lineno<=len(lines) else ''}
        state={}
        for name,value in frame.f_locals.items():
            # Generator frames contain a compiler-created '.0' iterator. It
            # is not an algorithm variable or a runtime capability requested
            # by the program. Capture the actual loop variables, not this
            # Python implementation detail (and never consume the iterator).
            if name.isidentifier() and (not name.startswith('_') or name=='_') and not callable(value) and not any(value is module for module in facades.values()): state[name]=bounded(value)
        if capture:
            if len(frames)>=1200: raise ValueError('推演超过1200步，请缩小输入')
            stack=[];parent=frame
            while parent is not None and parent.f_code.co_filename=='algorithm.py':
                stack.append({'function':parent.f_code.co_name,'line':parent.f_lineno})
                parent=parent.f_back
                if len(stack)>32: raise ValueError('递归深度超过32')
            frames.append({'line':frame.f_lineno,'function':frame.f_code.co_name,'event':event,
                'code':lines[frame.f_lineno-1] if frame.f_lineno<=len(lines) else '',
                'state':state,'stack':stack,'returned':bounded(arg) if event=='return' else None})
        return observe
    sys.settrace(observe)
    try: result=bounded(scope['solve'](copy.deepcopy(data)))
    finally: sys.settrace(None)
    return {'outcome':result,'snapshots':frames,'returnLocation':return_location}


def json_equal(actual, expected):
    # JSON has one numeric domain. Preserve booleans as a separate type while
    # accepting 2 and 2.0; serialized source text is not a structural assertion.
    if type(actual) in (int,float) and type(expected) in (int,float):
        return actual == expected
    if type(actual) is not type(expected):return False
    if isinstance(actual,list):
        return len(actual)==len(expected) and all(json_equal(a,b) for a,b in zip(actual,expected))
    if isinstance(actual,dict):
        return actual.keys()==expected.keys() and all(json_equal(actual[k],expected[k]) for k in actual)
    return actual==expected


def run_job(payload):
    source,oracle=payload['source'],payload['oracle']
    inputs=payload['tests']
    # Candidate inputs plus independently introduced counterexamples survive
    # all three repair rounds. Match the persisted contract's 32-input bound.
    if not 1<=len(inputs)<=32: raise ValueError('校验输入数量无效')
    def checked_execute(code,data,label,trace=False):
        try:return execute(code,data,trace)
        except Exception as exc:
            location={}
            current=exc.__traceback__
            while current:
                if current.tb_frame.f_code.co_filename=='algorithm.py':
                    line=current.tb_lineno
                    location={'function':current.tb_frame.f_code.co_name,'line':line,
                              'source':code.splitlines()[line-1][:180]}
                current=current.tb_next
            raise ValueError(label+json.dumps({'location':location,'input':data,'error':type(exc).__name__,'detail':str(exc)[:300]},ensure_ascii=False)[:1200]) from exc
    validator=payload.get('validator')
    def valid_input(data):
        if validator is None:return True
        value=checked_execute(validator,data,'INPUT_VALIDATOR_ERROR:')['outcome']
        if type(value)is not bool:raise ValueError('INPUT_VALIDATOR_ERROR: 输入域判定必须返回bool')
        return value
    for data in inputs:
        bounded(data)
        if not valid_input(data):raise ValueError('INPUT_DOMAIN_ERROR: 声明的校验用例不属于有效输入域：'+json.dumps(data,ensure_ascii=False)[:800])
        expected=checked_execute(oracle,data,'CHECKER_EXECUTION_ERROR:')['outcome']
        execution=checked_execute(source,data,'候选实现执行失败：')
        actual=execution['outcome']
        if not json_equal(actual,expected):
            raise ValueError('独立实现交叉校验失败：'+json.dumps({'actual':actual,'expected':expected,'location':execution['returnLocation'],'input':data},ensure_ascii=False)[:1400])
    checked=[];rejected=[]
    probes=payload.get('probes',[])
    if len(probes)>12:raise ValueError('边界探测数量无效')
    for data in probes:
        bounded(data)
        if not valid_input(data):
            rejected.append(data)
            continue
        try:
            expected=execute(oracle,data,False)['outcome']
        except (KeyError,IndexError,TypeError,ZeroDivisionError,ValueError):
            continue
        try:
            actual=execute(source,data,False)['outcome']
        except Exception as exc:
            raise ValueError('平台边界探测未通过：'+json.dumps({'input':data,'expected':expected,'error':type(exc).__name__},ensure_ascii=False)[:800]) from exc
        if not json_equal(actual,expected):
            raise ValueError('平台边界探测结果不一致：'+json.dumps({'input':data,'actual':actual,'expected':expected},ensure_ascii=False)[:800])
        checked.append({'input':data,'outcome':expected})
    if not valid_input(payload['input']):raise ValueError('INPUT_DOMAIN_ERROR: 当前输入不符合算法声明的有效域')
    expected=checked_execute(oracle,payload['input'],'CHECKER_EXECUTION_ERROR:')['outcome']
    first=checked_execute(source,payload['input'],'候选实现执行失败：',True)
    second=checked_execute(source,payload['input'],'候选实现执行失败：',True)
    if first!=second: raise ValueError('相同输入的执行轨迹不确定')
    if not json_equal(first['outcome'],expected):
        raise ValueError('当前输入的独立结果校验失败')
    json.dumps(first,allow_nan=False)
    first['checkedProbes']=checked
    first['rejectedProbes']=rejected
    return first

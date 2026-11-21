"""Reviewed capped substring-search task, used for the inspected classroom repair.

The reference uses KMP; expected values use Python's independent substring search.
No model-authored implementation is executed.
"""
import ast
import json
from textwrap import indent
from uuid import uuid4
from lab_contracts import FinalOutput, LabDraft, TestCase, PrivateAssessment, to_public_course

BODY = '''import json
data = json.loads(stdin)
text, pattern, limit = data['text'], data['pattern'], data['scenario_limit']
result = []
if not pattern or limit == 0:
    return '[]'
prefix = [0] * len(pattern)
j = 0
for i in range(1, len(pattern)):
    while j and pattern[i] != pattern[j]:
        j = prefix[j-1]
    if pattern[i] == pattern[j]:
        j += 1
    prefix[i] = j
j = 0
for i, char in enumerate(text):
    while j and char != pattern[j]:
        j = prefix[j-1]
    if char == pattern[j]:
        j += 1
    if j == len(pattern):
        result.append(i-len(pattern)+1)
        if len(result) == limit:
            break
        j = prefix[j-1]
return json.dumps(result, ensure_ascii=False)
'''
REFERENCE='class Solution:\n    def solve(self, stdin: str) -> str:\n'+indent(BODY,'        ')

FIRST_BODY='''if not pattern:
    return 0
prefix = [0] * len(pattern)
j = 0
for i in range(1, len(pattern)):
    while j and pattern[i] != pattern[j]:
        j = prefix[j-1]
    if pattern[i] == pattern[j]:
        j += 1
    prefix[i] = j
j = 0
for i, char in enumerate(text):
    while j and char != pattern[j]:
        j = prefix[j-1]
    if char == pattern[j]:
        j += 1
    if j == len(pattern):
        return i-len(pattern)+1
return -1
'''
FIRST_REFERENCE='class Solution:\n    def solve(self, text: str, pattern: str) -> int:\n'+indent(FIRST_BODY,'        ')


def repair_search_lesson(value):
    """Explicit audited classroom replacement; never a production topic router."""
    from lab_assembly import assemble_lab,normalize_generated_draft
    output=FinalOutput.model_validate(value).model_copy(deep=True)
    old=output.problem
    if [(p.name,p.type) for p in old.guided_scene.problem.entry_point.parameters]!=[('text','str'),('pattern','str')]:
        raise ValueError('This reviewed search lesson requires the inspected text/pattern interface')
    samples=[('hello','ll'),('abc','x'),('aaaa','aa'),('',''),('abc',''),('','a'),('ababac','abac')]
    cases=[TestCase(case_id=f'first-{i}',inputs={'text':text,'pattern':pattern},expected=text.find(pattern),
                   description='返回首次匹配起始下标；下标从零开始，找不到时返回 -1。') for i,(text,pattern) in enumerate(samples)]
    draft=LabDraft(title='KMP：查找首次匹配位置',
        instructions='使用 KMP 在 text 中查找 pattern，返回首次完整匹配的起始下标。下标从 0 开始；找不到返回 -1；空模式返回 0。'
        '例如 hello 中的 ll 从下标 2 开始。返回一个整数，不返回所有匹配位置。',
        scaffold_code='class Solution:\n    def solve(self, text: str, pattern: str) -> int:\n        # TODO\n        raise NotImplementedError\n',
        reference_solution=FIRST_REFERENCE,difficulty='Easy',constraints=['text、pattern 各含 0 到 2000 个 Unicode 字符'],
        teaching_steps=[{'step_id':'prefix','title':'计算前缀表','instruction':'计算模式每个前缀的最长相同真前后缀长度。'},
                        {'step_id':'match','title':'逐字符匹配','instruction':'失配时沿 LPS 回退模式位置；完整匹配后返回起始下标。'}],
        public_test_cases=cases[:4],hidden_test_cases=cases[4:])
    lab,rebuilt=assemble_lab(normalize_generated_draft(draft),output.course_id)
    output.lab=lab;output.problem=rebuilt
    return repair(output.model_dump(mode='json'))


def expected(data):
    if (type(data) is not dict or set(data)!={'text','pattern','scenario_limit'}
        or any(type(data[name]) is not str or len(data[name])>2000 for name in ('text','pattern'))
        or type(data['scenario_limit']) is not int or not 0<=data['scenario_limit']<=2000):
        raise ValueError('限定匹配输入格式错误')
    text,pattern,limit=data['text'],data['pattern'],data['scenario_limit']
    result=[];start=0
    while pattern and len(result)<limit:
        found=text.find(pattern,start)
        if found<0:break
        result.append(found);start=found+1
    return result


def checker_for_draft(draft):
    if ast.dump(ast.parse(draft.reference_solution))!=ast.dump(ast.parse(REFERENCE)):return None
    for case in draft.public_test_cases+draft.hidden_test_cases:
        proposed=json.loads(case.expected)
        if type(proposed) is not list or any(type(x) is not int for x in proposed) or proposed!=expected(json.loads(case.inputs['stdin'])):
            raise ValueError('限定匹配用例不符合独立计算的匹配位置')
    return 'capped-matches'


def reviewed_teaching(course):
    if len(course.scenes)!=2 or course.scenes[1].problem.answer_check!='capped-matches':return None
    case=course.scenes[0].problem.public_test_cases[0]
    if set(case.inputs)!={'text','pattern'}:return None
    text,pattern=case.inputs['text'],case.inputs['pattern']
    if not pattern or len(text)>8 or len(pattern)>6:return None
    prefix=[0]*len(pattern);j=0
    for i in range(1,len(pattern)):
        while j and pattern[i]!=pattern[j]:j=prefix[j-1]
        if pattern[i]==pattern[j]:j+=1
        prefix[i]=j
    def frame(label,explanation,i,j):
        return {'label':label,'explanation':explanation,'values':[f'文本: {text}',f'模式: {pattern}',f'LPS: {prefix}',f'文本下标 i={i}',f'已匹配长度 j={j}'],'activeIndices':[3,4]}
    steps=[frame('预处理模式串并初始化',f'LPS 表记录模式前缀与后缀的最长相同长度：{prefix}。从文本下标 0、已匹配长度 0 开始。',0,0)]
    j=0;answer=-1;last_i=0
    for i,char in enumerate(text):
        last_i=i
        while j and char!=pattern[j]:
            old=j;j=prefix[j-1]
            steps.append(frame(f'下标 {i} 失配，回退 j={j}',f'文本字符 {char} 与模式下标 {old} 不同。按 LPS 回退已匹配长度，文本下标保持 {i}。',i,j))
        if char==pattern[j]:
            j+=1
            steps.append(frame(f'下标 {i} 匹配，已匹配 {j} 个字符',f'文本字符 {char} 匹配模式下标 {j-1}，已匹配长度增加到 {j}。',i,j))
        else:
            steps.append(frame(f'跳过文本下标 {i}',f'当前字符 {char} 与模式首字符 {pattern[0]} 不同，且没有已匹配前缀，继续读下一字符。',i,0))
        if j==len(pattern):answer=i-len(pattern)+1;break
    steps.append(frame(f'返回首次匹配位置 {answer}',(f'首次完整匹配的起始下标为 {answer}。' if answer>=0 else '未找到完整匹配，返回 -1。')+'引导题在此结束；自主题还需继续匹配并检查数量上限。',last_i,j))
    if answer!=case.expected or len(steps)>16:return None
    return {'overview':'KMP 先计算模式串的前缀表 LPS。匹配失配时根据 LPS 回退模式位置，保留已经知道的匹配信息，避免文本重复回扫。',
        'demoExplanation':'i 是文本下标，j 是已经匹配的模式前缀长度。每一步显示实际比较和 LPS 回退；首次完整匹配返回 i-j+1。',
        'algorithmTrace':{'exampleCaseId':case.case_id,'steps':steps,'outcome':answer},
        'questions':[{'question':'KMP 失配时利用什么信息减少重复比较？','options':['模式串的 LPS 前缀表','文本的排序结果','随机下标','文本字符总数'],'answer':'A','analysis':'LPS 指出已经匹配前缀的可复用部分。'},
            {'question':'在文本 hello 中，模式 ll 的首次匹配起始下标是多少？','options':['2','3','1','4'],'answer':'A','analysis':'下标从 0 开始，两个 l 位于 2 和 3。'},
            {'question':'在 aaaaa 中查找 aa，最多展示三条，应该返回什么？','options':['[0, 1, 2]','[0, 2, 4]','[0]','[1, 2, 3]'],'answer':'A','analysis':'匹配允许重叠，从 0、1、2、3 均可开始，但只显示前三条。'}]}


def repair(value):
    from lab_assembly import assemble_lab,normalize_generated_draft
    output=FinalOutput.model_validate(value).model_copy(deep=True)
    guide=output.problem.guided_scene
    entry=guide.problem.entry_point
    if [(p.name,p.type) for p in entry.parameters]!=[('text','str'),('pattern','str')] or entry.return_type!='int':
        raise ValueError('Only the inspected first-match interface may use this repair')
    if any(c.expected!=c.inputs['text'].find(c.inputs['pattern']) for c in guide.problem.public_test_cases):
        raise ValueError('Guided examples do not describe first substring occurrence')
    samples=[('hello world','o',1),('hello world','o',2),('aaaaa','aa',3),('abc','x',2),
             ('aaaa','a',0),('abc','',3),('🙂甲🙂','🙂',5)]
    cases=[]
    for i,(text,pattern,limit) in enumerate(samples):
        data={'text':text,'pattern':pattern,'scenario_limit':limit}
        cases.append(TestCase(case_id=f'case-{i}',inputs={'stdin':json.dumps(data,ensure_ascii=False)},
            expected=json.dumps(expected(data),ensure_ascii=False),description=f'最多返回前 {limit} 个匹配位置，匹配允许重叠。'))
    draft=LabDraft(title='文本编辑器：限定数量的搜索结果',
        instructions='文本编辑器的搜索面板一次最多展示 scenario_limit 条结果。给定文档 text 和要查找的 pattern，返回按出现顺序排列的前若干个匹配起始下标。'
        '下标从 0 开始，按 Unicode 字符计数；区分大小写，允许重叠匹配。例如 aaaaa 中的 aa 可从 0、1、2、3 开始。'
        '达到数量上限后停止，没有匹配时返回空列表；上限为 0、文档为空或模式为空时也返回空列表。\n\n'
        '输入一行 JSON 对象，包含字符串 text、字符串 pattern、整数 scenario_limit。输出一行 JSON 整数数组。'
        '例如 hello world 中查找 o，上限为 1 返回 [4]，上限为 2 返回 [4, 7]。'
        '与引导题只返回第一次出现的位置不同，本题需要继续匹配、保留重叠结果，并处理面板数量上限。',
        scaffold_code='class Solution:\n    def solve(self, stdin: str) -> str:\n        # TODO\n        raise NotImplementedError\n',
        reference_solution=REFERENCE,difficulty='Medium',
        constraints=['text、pattern 各含 0 到 2000 个字符','0 <= scenario_limit <= 2000'],
        teaching_steps=guide.teaching_steps,public_test_cases=cases[:4],hidden_test_cases=cases[4:])
    output.course_id=str(uuid4())
    # Reassemble the unchanged guide under a new immutable course identity.
    old=output.problem
    original=LabDraft(title=guide.problem.title,instructions=guide.problem.instructions,
        scaffold_code=guide.interactive_code,reference_solution=old.reference_solution,
        difficulty=guide.problem.difficulty,constraints=guide.problem.constraints,
        teaching_steps=guide.teaching_steps,public_test_cases=guide.problem.public_test_cases,
        hidden_test_cases=old.hidden_test_cases)
    lab,rebuilt=assemble_lab(normalize_generated_draft(original),output.course_id)
    _,independent=assemble_lab(normalize_generated_draft(draft),output.course_id)
    scene=independent.oj_scene
    scene.problem.execution_mode='stdio'
    scene.interactive_code='# 请独立编写完整程序，从标准输入读取，并将结果打印到标准输出。\n'
    rebuilt.oj_scene=scene
    rebuilt.oj_assessment=PrivateAssessment(reference_solution=independent.reference_solution,
        hidden_test_cases=independent.hidden_test_cases,pytest_source=independent.pytest_source)
    output.lab=lab;output.problem=rebuilt
    data=FinalOutput.model_validate(output.model_dump()).model_dump(mode='json',by_alias=True)
    return {'publicCourse':to_public_course(data),'privateOutput':data}

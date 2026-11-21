"""Audited LCS contracts. Only developer-owned code runs here, never generated source."""
import ast
import json
import re
from uuid import uuid4

from lab_contracts import LabDraft, TestCase, TeachingStep, FinalOutput, PrivateAssessment, to_public_course


def is_lcs(text):
    return bool(re.search(r'最长公共子序列|\bLCS\b|longest common subsequence', text, re.I))


def lcs_length(a, b):
    """Linear-memory prefix DP oracle; reference implementation uses suffix DP."""
    row = [0] * (len(b) + 1)
    for x in a:
        previous = row[:]
        for j, y in enumerate(b, 1):
            row[j] = previous[j-1] + 1 if x == y else max(previous[j], row[j-1])
    return row[-1]


def witness(a, b):
    # Kept separate from the length oracle and checked against it below.
    table = [[0] * (len(b)+1) for _ in range(len(a)+1)]
    for i in range(len(a)-1, -1, -1):
        for j in range(len(b)-1, -1, -1):
            table[i][j] = 1 + table[i+1][j+1] if a[i] == b[j] else max(table[i+1][j], table[i][j+1])
    result = []; i = j = 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]: result.append(a[i]); i += 1; j += 1
        elif table[i+1][j] >= table[i][j+1]: i += 1
        else: j += 1
    assert len(result) == lcs_length(a, b)
    return result


GUIDE_SOURCE = '''class Solution:
    def solve(self, str1: str, str2: str) -> str:
        n, m = len(str1), len(str2)
        dp = [[0] * (m + 1) for _ in range(n + 1)]
        for i in range(n - 1, -1, -1):
            for j in range(m - 1, -1, -1):
                dp[i][j] = 1 + dp[i+1][j+1] if str1[i] == str2[j] else max(dp[i+1][j], dp[i][j+1])
        result = []
        i = j = 0
        while i < n and j < m:
            if str1[i] == str2[j]:
                result.append(str1[i]); i += 1; j += 1
            elif dp[i+1][j] >= dp[i][j+1]:
                i += 1
            else:
                j += 1
        return ''.join(result)
'''

EDIT_BODY = '''import json
data = json.loads(stdin)
a, b, budget = data['planA'], data['planB'], data['budget']
dp = [[0] * (len(b)+1) for _ in range(len(a)+1)]
for i in range(len(a)-1, -1, -1):
    for j in range(len(b)-1, -1, -1):
        dp[i][j] = dp[i+1][j+1] + 1 if a[i] == b[j] else max(dp[i+1][j], dp[i][j+1])
cost = len(a) + len(b) - 2 * dp[0][0]
return ('YES' if cost <= budget else 'NO') + ' ' + str(cost)
'''


def edit_answer(data):
    if type(data) is not dict or set(data) != {'planA','planB','budget'}:
        raise ValueError('培训计划输入必须包含 planA、planB、budget')
    a, b, budget = data['planA'], data['planB'], data['budget']
    if (type(budget) is not int or not 0 <= budget <= 400
        or any(type(seq) is not list or len(seq)>200 or any(type(x) is not str or len(x)>100 for x in seq) for seq in (a,b))):
        raise ValueError('培训计划输入不符合题目协议')
    cost = len(a) + len(b) - 2 * lcs_length(a,b)
    return f'{"YES" if cost <= budget else "NO"} {cost}'


def lcs_guide(requirement):
    if not is_lcs(requirement): return None
    pairs = [('ABCBDAB','BDCABC'),('AGGTAB','GXTXAYB'),('ABC','AC'),('AXYT','AYZX'),
             ('','abc'),('aaaa','aa'),('甲🙂乙','🙂甲乙')]
    cases = [TestCase(case_id=f'lcs-{i}', inputs={'str1':a,'str2':b}, expected=''.join(witness(a,b)),
        description='返回任意最长公共子序列；示例输出仅为一种合法答案。') for i,(a,b) in enumerate(pairs)]
    return LabDraft(title='最长公共子序列：保持相对顺序的匹配',
        instructions='输入两个字符串 str1、str2，返回任意一个最长公共子序列。子序列允许跳过字符，但必须保持原来的相对顺序；不要求连续。按 Unicode 字符比较，区分大小写。无公共字符或任一字符串为空时返回空字符串。多个最优答案均算正确。示例 AXYT 与 AYZX 的最优长度为 2，可返回 AY 或 AX，不能返回含 Z 的 AYZ。',
        scaffold_code='class Solution:\n    def solve(self, str1: str, str2: str) -> str:\n        # TODO\n        raise NotImplementedError\n',
        reference_solution=GUIDE_SOURCE, difficulty='Medium', constraints=['两个字符串各不超过 1000 个 Unicode 字符'],
        teaching_steps=[TeachingStep(step_id='dp',title='计算最优长度',instruction='比较当前字符；相同则延伸匹配，不同则比较跳过任一字符的两种选择。'),
            TeachingStep(step_id='trace',title='恢复公共子序列',instruction='沿动态规划表回溯，保证每个字符都来自两个输入且顺序不变；并列时任选一条最优路径。')],
        public_test_cases=cases[:4],hidden_test_cases=cases[4:])


def lcs_transfer(base, requirement):
    if not is_lcs(requirement): return None
    from autonomous_tasks import _stdio_draft
    samples = [(['面向对象','动态类型','解释型'],['静态类型','编译型','面向对象'],4),
               (['面向对象','动态类型','解释型'],['静态类型','编译型','面向对象'],3),
               (['安全','实操','安全'],['实操','安全'],1),([],[],0),
               ([],['安全'],0),(['甲','乙'],['乙','甲'],2),(['🙂','安全'],['🙂','安全'],0)]
    data = [dict(planA=a,planB=b,budget=k) for a,b,k in samples]
    return _stdio_draft(base,'培训计划同步：有限修改次数下的安排',
        '两家校区要统一新员工培训顺序。教务员拿到原计划 planA 和目标计划 planB，每个元素是一节培训模块的名称，允许同名模块重复出现。'
        '每次只能删除原计划中的一节模块，或在任意位置插入一节模块，均花费 1 次修改；不能直接替换模块，也不能免费交换顺序。'
        '求把 planA 改成 planB 的最少修改次数，并判断是否不超过本周修改额度 budget。\n\n'
        '输入一行 JSON 对象，planA、planB 为字符串数组（不是数组外面再套字符串），budget 为非负整数。'
        '输出 YES d 或 NO d，以一个空格分隔；d 为最少修改次数，额度刚好足够也输出 YES。空计划允许，保留模块必须保持顺序。'
        '例如 ["安全","实操"] 改成 ["实操","安全"] 至少需要 2 次修改，budget=1 输出 NO 2，budget=2 输出 YES 2。'
        '本题需要综合有序匹配、重复元素、最小修改代价与额度判断；不要求输出某个公共子序列。',
        ['planA、planB 各含 0 到 200 节模块，每个名称不超过 100 字符','0 <= budget <= 400，严格区分字符和大小写'],
        [(json.dumps(x,ensure_ascii=False),edit_answer(x)) for x in data],EDIT_BODY)


def draft_check(draft):
    """Identity is based on audited code, never an LLM's title or verification claim."""
    from textwrap import indent
    source = ast.dump(ast.parse(draft.reference_solution), include_attributes=False)
    if source == ast.dump(ast.parse(GUIDE_SOURCE), include_attributes=False):
        for c in draft.public_test_cases + draft.hidden_test_cases:
            a,b = c.inputs['str1'],c.inputs['str2']
            # Independently check both membership/order and optimal length.
            def subseq(s,t):
                it=iter(t)
                return all(any(x==y for y in it) for x in s)
            if not (subseq(c.expected,a) and subseq(c.expected,b) and len(c.expected)==lcs_length(a,b)):
                raise ValueError('LCS 用例答案不满足公共性、顺序或最优长度')
        return 'lcs-string'
    stdio_source='class Solution:\n    def solve(self, stdin: str) -> str:\n'+indent(EDIT_BODY,'        ')
    if source == ast.dump(ast.parse(stdio_source), include_attributes=False):
        for c in draft.public_test_cases + draft.hidden_test_cases:
            if c.expected != edit_answer(json.loads(c.inputs['stdin'])):
                raise ValueError('培训计划样例与独立最小修改次数不一致')
        return 'lcs-edit-budget'
    return None


def repair_lcs(value):
    from lab_assembly import assemble_lab, normalize_generated_draft
    output=FinalOutput.model_validate(value).model_copy(deep=True)
    if not is_lcs(output.topic): raise ValueError('只修复已检查的 LCS 课程')
    output.course_id=str(uuid4())
    draft=normalize_generated_draft(lcs_guide(output.topic))
    lab,problem=assemble_lab(draft,output.course_id)
    _,independent=assemble_lab(lcs_transfer(draft,output.topic),output.course_id)
    problem.oj_scene=independent.oj_scene
    problem.oj_scene.problem.execution_mode='stdio'
    problem.oj_scene.interactive_code='# 请独立编写完整程序，从标准输入读取，并将结果打印到标准输出。\n'
    problem.oj_assessment=PrivateAssessment(reference_solution=independent.reference_solution,
        hidden_test_cases=independent.hidden_test_cases,pytest_source=independent.pytest_source)
    output.lab=lab;output.problem=problem
    validated=FinalOutput.model_validate(output.model_dump()).model_dump(mode='json',by_alias=True)
    return {'publicCourse':to_public_course(validated),'privateOutput':validated}


def reviewed_lcs_teaching(course):
    if not course.scenes or course.scenes[0].problem.answer_check != 'lcs-string': return None
    case=course.scenes[0].problem.public_test_cases[0]
    a,b=case.inputs['str1'],case.inputs['str2']
    if len(a)>10 or len(b)>10: return None
    row=[0]*(len(b)+1)
    steps=[{'label':'空前缀初始化','explanation':f'列依次对应空前缀与 {b} 的各字符。没有读入第一个字符串时，匹配长度全为 0。',
            'values':['列: ∅ '+' '.join(b),'∅: '+' '.join(map(str,row))], 'activeIndices':[]}]
    for i,x in enumerate(a,1):
        old=row[:]
        for j,y in enumerate(b,1): row[j]=old[j-1]+1 if x==y else max(old[j],row[j-1])
        steps.append({'label':f'读入第 {i} 个字符 {x}',
            'explanation':f'当前前缀为 {a[:i]}。字符相同取左上角加 1，不同取上方与左方较大值。右端 {row[-1]} 为当前两个前缀的最优长度。',
            'values':['列: ∅ '+' '.join(b),f'{a[:i]}: '+' '.join(map(str,row))], 'activeIndices':[1]})
    answer=''.join(witness(a,b))
    steps.append({'label':f'恢复一种最优解 {answer}',
        'explanation':f'最优长度为 {row[-1]}。回溯时只保留两个输入中顺序一致的字符；有多个最长序列时均接受。',
        'values':['一种最优解: '+answer,'最优长度: '+str(row[-1])], 'activeIndices':[0]})
    return {'overview':'最长公共子序列保留两个序列中相对顺序一致的元素，可以跳过元素，不要求连续。用动态规划比较匹配当前字符与跳过字符的选择。',
        'demoExplanation':'按第一个字符串的前缀逐行观察动态规划表；列为第二个字符串的前缀。表中数字是最优长度，最后再回溯恢复一个实际序列。',
        'algorithmTrace':{'exampleCaseId':case.case_id,'steps':steps,'outcome':answer},
        'questions':[{'question':'公共子序列必须满足什么条件？','options':['在两个输入中保持原相对顺序','必须在两个输入中连续出现','可以任意重新排序','必须包含所有不同字符'],'answer':'A','analysis':'允许跳过元素，但不能改变顺序。'},
            {'question':'两个输入存在多个同样长的最优公共子序列时，如何判定？','options':['满足公共性、顺序和最优长度的答案都正确','只接受示例中的固定答案','只接受字典序最大的答案','一律认为输入有误'],'answer':'A','analysis':'本题允许任意最优解，不能用单一字符串相等替代合法性判定。'},
            {'question':'计划长度为 m、n，最长公共子序列长度为 L，只允许插入或删除，最少修改次数是多少？','options':['m+n-2L','m+n-L','L','m*n'],'answer':'A','analysis':'保留 L 个顺序一致的模块，删除 m-L 个旧模块，再插入 n-L 个新模块。'}]}

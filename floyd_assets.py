"""Reviewed all-pairs shortest-path assets; does not control classroom routing."""
import re
from uuid import uuid4
from lab_contracts import LabDraft,TestCase,TeachingStep,FinalOutput,PrivateAssessment,to_public_course
from lab_assembly import normalize_generated_draft,assemble_lab


def is_floyd(text):
    return bool(re.search(r'(?<![A-Za-z])floyd(?:[ -]warshall)?(?![A-Za-z])|弗洛伊德|佛洛伊德',text,re.I))


def distances(matrix):
    """Independent repeated Bellman-Ford oracle, never generated source."""
    n=len(matrix);result=[]
    edges=[(i,j,w) for i,row in enumerate(matrix) for j,w in enumerate(row) if i!=j and w>=0]
    for source in range(n):
        d=[float('inf')]*n;d[source]=0
        for _ in range(n-1):
            previous=d[:]
            for u,v,w in edges:d[v]=min(d[v],previous[u]+w)
        result.append([-1 if x==float('inf') else x for x in d])
    return result


REFERENCE='''class Solution:
    def solve(self, graph: list[str]) -> list[str]:
        matrix = [list(map(int, row.split())) for row in graph]
        n = len(matrix)
        dist = [[float('inf') if x == -1 else x for x in row] for row in matrix]
        for i in range(n):
            dist[i][i] = 0
        for k in range(n):
            for i in range(n):
                for j in range(n):
                    dist[i][j] = min(dist[i][j], dist[i][k] + dist[k][j])
        return [' '.join(str(-1 if x == float('inf') else x) for x in row) for row in dist]
'''


def floyd_guide(requirement):
    if not is_floyd(requirement):return None
    matrices=[[[0,3,-1,7],[8,0,2,-1],[5,-1,0,1],[2,-1,6,0]],
        [[0]],[[0,-1],[-1,0]],[[0,0,9],[-1,0,2],[-1,-1,0]],
        [[0,4],[-1,0]],[[0,2,8],[2,0,3],[8,3,0]],[[0,1,4],[1,0,1],[4,1,0]]]
    rows=lambda matrix:[' '.join(map(str,row)) for row in matrix]
    cases=[TestCase(case_id=f'floyd-{i+1}',inputs={'graph':rows(m)},expected=rows(distances(m)),
        description=['经中转缩短多组距离','只有一个顶点','两点互不可达','零权边仍可通行','单向道路','最短路不等于直接边','多个候选中转点'][i]) for i,m in enumerate(matrices)]
    return LabDraft(title='Floyd：所有顶点对的最短距离',
        instructions='实现 Floyd 算法。graph 为 n 行字符串，每行有 n 个空格分隔的整数，表示有向图邻接矩阵。编号为 0 到 n-1；对角线为 0，-1 表示无直接边，其他非负整数表示边权，零权边有效。返回所有顶点对的最短距离矩阵，仍为 n 行空格分隔的字符串；不可达位置为 -1。不能直接返回原邻接矩阵，必须考虑经过其他顶点的路径。',
        scaffold_code='class Solution:\n    def solve(self, graph: list[str]) -> list[str]:\n        # TODO\n        raise NotImplementedError\n',reference_solution=REFERENCE,difficulty='Easy',
        constraints=['1 <= n <= 50，输入为合法方阵，边权为 -1 或 0 到 10000 的整数','本题不含负权边；-1 只是无边标记'],
        teaching_steps=[TeachingStep(step_id='init',title='初始化距离矩阵',instruction='将 -1 转为无穷距离，对角线设为 0。',hint='零权边不是无边。'),
            TeachingStep(step_id='relax',title='逐个允许中转点',instruction='最外层遍历 k，再遍历 i、j，用 dist[i][k]+dist[k][j] 尝试缩短 dist[i][j]。',hint='第 k 轮后只允许编号不大于 k 的顶点作为中转点。'),
            TeachingStep(step_id='output',title='转换输出',instruction='不可达改回 -1，每行用一个空格连接。',hint='输出是最短距离矩阵，不是原始边权矩阵。')],public_test_cases=cases[:4],hidden_test_cases=cases[4:])


DEPOT_BODY='''lines = stdin.strip().splitlines()
n, limit = map(int, lines[0].split())
matrix = [list(map(int, row.split())) for row in lines[1:n+1]]
dist = [[float('inf') if x == -1 else x for x in row] for row in matrix]
for i in range(n):
    dist[i][i] = 0
for k in range(n):
    for i in range(n):
        for j in range(n):
            dist[i][j] = min(dist[i][j], dist[i][k] + dist[k][j])
candidates = [(sum(row), i, max(row)) for i, row in enumerate(dist) if max(row) <= limit]
if not candidates:
    return 'IMPOSSIBLE'
total, index, worst = min(candidates)
return f'{index} {total} {worst}'
'''


def depot_examples():
    matrices=[([[0,2,10],[2,0,3],[10,3,0]],3),([[0,2,10],[2,0,3],[10,3,0]],2),
        ([[0]],0),([[0,-1],[-1,0]],9),([[0,0],[0,0]],0),([[0,1],[1,0]],1),([[0,4],[-1,0]],4)]
    samples=[]
    for m,limit in matrices:
        d=distances(m)
        candidates=[(sum(row),i,max(row)) for i,row in enumerate(d) if -1 not in row and max(row)<=limit]
        if candidates:
            total,i,worst=min(candidates);answer=f'{i} {total} {worst}'
        else:answer='IMPOSSIBLE'
        samples.append((f'{len(m)} {limit}\n'+'\n'.join(' '.join(map(str,row)) for row in m),answer))
    return samples


def reviewed_floyd_teaching(course):
    if not is_floyd(course.topic) or not course.scenes:return None
    case=course.scenes[0].problem.public_test_cases[0]
    if case.inputs!=floyd_guide('Floyd').public_test_cases[0].inputs:return None
    matrix=[list(map(int,row.split())) for row in case.inputs['graph']]
    n=len(matrix);d=[[float('inf') if x<0 else x for x in row] for row in matrix]
    frame=lambda:[str(i)+': '+' '.join('∞' if x==float('inf') else str(x) for x in row) for i,row in enumerate(d)]
    steps=[{'label':'初始化距离矩阵','explanation':'每行前缀是起点编号，列依次为终点 0、1、2、3。∞ 表示不可达，0 权边可以通行。','values':frame(),'activeIndices':[]}]
    for k in range(n):
        changes=[]
        for i in range(n):
            for j in range(n):
                candidate=d[i][k]+d[k][j]
                if candidate<d[i][j]:changes.append(f'{i}→{j}: {d[i][j]}→{candidate}');d[i][j]=candidate
        steps.append({'label':f'允许经过中转点 {k}','explanation':f'对所有 i,j 比较原距离与 dist[i][{k}]+dist[{k}][j]。变化：'+('；'.join(changes) or '本轮没有更短路径。'),'values':frame(),'activeIndices':list(range(n))})
    expected=[' '.join(str(-1 if x==float('inf') else x) for x in row) for row in d]
    if expected!=case.expected:raise ValueError('Floyd 公开答案与计算推演不一致')
    return {'overview':'Floyd 逐个放开允许使用的中转顶点，计算所有起点到所有终点的最短距离。','demoExplanation':'矩阵的行是起点、列是终点。每一轮固定中转点 k，比较直达当前最优距离与经过 k 的两段距离之和，保留较小值。',
        'algorithmTrace':{'exampleCaseId':case.case_id,'steps':steps,'outcome':expected},
        'questions':[{'question':'Floyd 的最外层循环应该遍历什么？','options':['中转点 k','起点 i','终点 j','边权从大到小'],'answer':'A','analysis':'按中转点分阶段，维持每一轮只使用已允许中转点的含义。'},
            {'question':'本题中 -1 和 0 分别表示什么？','options':['无边标记和有效零权距离','二者都表示无边','二者都表示负权边','-1 表示最短路已经算完'],'answer':'A','analysis':'-1 转换为无穷距离；零权边必须保留。'},
            {'question':'诊所配送选址题中，为什么不能只计算从固定起点出发的距离？','options':['每个站点都可能作为配送中心，需要比较所有候选','因为必须把全部道路建一遍','因为只需选择最贵道路','因为忽略不可达站点即可'],'answer':'A','analysis':'需要比较各候选中心到所有站点的最短距离、最远耗时和总和。'}]}


def repair_floyd(value):
    from autonomous_tasks import contextual_task
    output=FinalOutput.model_validate(value).model_copy(deep=True)
    if not is_floyd(output.topic):raise ValueError('Only an inspected Floyd classroom may use this repair')
    output.course_id=str(uuid4())
    draft=normalize_generated_draft(floyd_guide(output.topic))
    lab,problem=assemble_lab(draft,output.course_id)
    transfer=contextual_task(draft,output.topic)
    _,independent=assemble_lab(transfer,output.course_id)
    scene=independent.oj_scene
    scene.problem=scene.problem.model_copy(update={'execution_mode':'stdio','standard_io_profile':None})
    scene.interactive_code='# 请独立编写完整程序，从标准输入读取，并将结果打印到标准输出。\n'
    problem.oj_scene=scene
    problem.oj_assessment=PrivateAssessment(reference_solution=independent.reference_solution,
        hidden_test_cases=independent.hidden_test_cases,pytest_source=independent.pytest_source)
    output.lab=lab;output.problem=problem
    validated=FinalOutput.model_validate(output.model_dump(mode='json')).model_dump(mode='json',by_alias=True)
    return {'publicCourse':to_public_course(validated),'privateOutput':validated}

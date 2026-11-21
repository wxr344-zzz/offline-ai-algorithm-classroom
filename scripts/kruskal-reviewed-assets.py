"""Audited correction of the reported classroom, never executes generated code."""
from uuid import uuid4
from itertools import combinations
from lab_contracts import FinalOutput, LabDraft, TestCase, TeachingStep, PrivateAssessment, to_public_course
from lab_assembly import normalize_generated_draft, assemble_lab
from autonomous_tasks import function_task_to_stdio
from applied_task import AppliedTask, InputRole, apply_task

REFERENCE = '''class Solution:
    def solve(self, edges: list[str], vertices: list[str]) -> int:
        parent = {v: v for v in vertices}
        def find(v):
            while parent[v] != v:
                parent[v] = parent[parent[v]]
                v = parent[v]
            return v
        total, count = 0, 0
        parsed = [(int(w), u, v) for u, v, w in (e.split(',') for e in edges)]
        for w, u, v in sorted(parsed):
            a, b = find(u), find(v)
            if a != b:
                parent[a] = b
                total += w
                count += 1
        return total if count == max(0, len(vertices)-1) else -1
'''

def exhaustive_cost(edges, vertices, existing=()):
    """Independent tiny-fixture oracle: enumerate subsets rather than run Kruskal."""
    best = None
    for size in range(len(edges)+1):
        for chosen in combinations(edges, size):
            connected = {vertices[0]} if vertices else set()
            links = [(u,v) for u,v in existing] + [(u,v) for u,v,w in chosen]
            for _ in vertices:
                for u,v in links:
                    if u in connected or v in connected: connected.update((u,v))
            if len(connected) == len(vertices):
                cost = sum(w for u,v,w in chosen)
                best = cost if best is None else min(cost,best)
    return -1 if best is None else best

def repair_kruskal(value):
    output = FinalOutput.model_validate(value).model_copy(deep=True)
    samples = [(['A,B,1','B,C,2','A,C,3'],['A','B','C']),
               (['A,B,5','B,C,1','A,C,2','C,D,4'],list('ABCD')),
               (['A,B,1'],list('ABC')), ([],['A']),
               (['A,A,0','A,B,2','A,B,1'],list('AB')),
               (['A,B,0','B,C,0','A,C,3'],list('ABC')),
               (['A,B,2','B,C,2','A,C,2'],list('ABC'))]
    cases = []
    for i,(edges,vertices) in enumerate(samples):
        parsed = [(u,v,int(w)) for u,v,w in (e.split(',') for e in edges)]
        cases.append(TestCase(case_id=f'case-{i+1}',inputs={'edges':edges,'vertices':vertices},
            expected=exhaustive_cost(parsed,vertices),description=['基本三角形','需要跳过成环边','图不连通','单个顶点','自环与平行边','零权边','相同权重'][i]))
    draft = LabDraft(title='Kruskal：最小连通总权重',
        instructions='实现 Kruskal 算法，返回连接所有顶点所需的最小边权总和；无法连接时返回 -1，单个顶点返回 0。edges 每项为 u,v,weight，表示无向边；vertices 列出全部顶点。按权重排序，用并查集判断是否成环。',
        scaffold_code='class Solution:\n    def solve(self, edges: list[str], vertices: list[str]) -> int:\n        # TODO\n        raise NotImplementedError\n',
        reference_solution=REFERENCE,difficulty='Easy',constraints=['1 到 20 个不同顶点；边端点均存在，权重非负','允许自环、平行边、相同权重和不连通图'],
        teaching_steps=[TeachingStep(step_id='sort',title='整理候选边',instruction='解析边并按权重升序排列。',hint='不要将字符串权重按字典序比较。'),
            TeachingStep(step_id='union',title='选边与合并',instruction='端点不在同一集合时选择该边并合并集合。',hint='连接相同集合的边会形成环。'),
            TeachingStep(step_id='finish',title='判断连通',instruction='选出 n-1 条边时返回总权重，否则返回 -1。',hint='单个顶点不需要任何边。')],
        public_test_cases=cases[:4],hidden_test_cases=cases[4:])
    draft=normalize_generated_draft(draft)
    output.course_id=str(uuid4())
    lab, problem=assemble_lab(draft,output.course_id)
    oj_source=REFERENCE.replace('edges: list[str], vertices: list[str]', 'edges: list[str], vertices: list[str], existing: list[str], budget: int').replace('-> int:', '-> bool:')
    oj_source=oj_source.replace('        total, count = 0, 0', '''        total, count = 0, 0
        for link in existing:
            u, v = link.split(',')
            a, b = find(u), find(v)
            if a != b:
                parent[a] = b
                count += 1''').replace('return total if count == max(0, len(vertices)-1) else -1','return count == max(0, len(vertices)-1) and total <= budget')
    oj_cases=[]
    extras=[([],3),([],6),([],100),([],0),(['A,B'],0),([],0),([],3)]
    for i,((edges,vertices),(existing,budget)) in enumerate(zip(samples,extras)):
        parsed=[(u,v,int(w)) for u,v,w in (e.split(',') for e in edges)]
        cost=exhaustive_cost(parsed,vertices,[e.split(',') for e in existing])
        oj_cases.append(TestCase(case_id=f'oj-{i+1}',inputs={'edges':edges,'vertices':vertices,'existing':existing,'budget':budget},
            expected=cost>=0 and cost<=budget,description='检查已有线路、最小追加费用与预算限制。'))
    oj=draft.model_copy(update={'reference_solution':oj_source,'scaffold_code':oj_source[:oj_source.index('        parent')]+'        # TODO\n        raise NotImplementedError\n',
        'public_test_cases':oj_cases[:4],'hidden_test_cases':oj_cases[4:]})
    oj=apply_task(oj,AppliedTask(title='校园光纤升级：有限预算内连通所有教学楼',
        setting='学校计划将全部教学楼接入校园网。部分楼之间已有可用光纤，其余候选线路有不同施工报价。',
        actor='你负责为学校审核网络升级方案，需要判断现有预算能否让所有教学楼互相通信。',
        objective='判断是否存在追加施工方案，使全部教学楼连通且追加总费用不超过 budget。',
        input_roles=[InputRole(parameter='edges',meaning='候选双向光纤报价，每项 u,v,weight 表示连接两栋楼的施工费用。'),InputRole(parameter='vertices',meaning='全部教学楼的不同编号，包括孤立楼。'),InputRole(parameter='existing',meaning='已有免费光纤，每项 u,v，不占用施工预算。'),InputRole(parameter='budget',meaning='本次网络升级允许支出的非负预算。')],
        decision_rules=['先利用所有已有光纤，已有线路成环也可以继续使用。','只能按候选报价新增线路；需要连接全部楼，同时追加费用不得超过预算。'],
        output_meaning='输出 JSON 布尔值 true 或 false，表示预算内是否能完成连通升级。',
        boundary_rules=['只有一栋楼或已有网络全部连通时无需追加费用。','无论预算多大，候选线路无法连通全部楼时均输出 false。'],
        transfer_difference='引导题计算裸图的最小连通总权重；本题还要合并已有免费线路，再结合预算作可行性决策。'))
    oj=function_task_to_stdio(normalize_generated_draft(oj))
    _, separate=assemble_lab(oj,output.course_id)
    problem.oj_scene=separate.oj_scene
    problem.oj_scene.problem.execution_mode='stdio'
    problem.oj_scene.interactive_code='# 请独立编写完整程序，从标准输入读取，并将结果打印到标准输出。\n'
    problem.oj_assessment=PrivateAssessment(hidden_test_cases=separate.hidden_test_cases,reference_solution=separate.reference_solution,pytest_source=separate.pytest_source)
    output.lab,output.problem=lab,problem
    validated=FinalOutput.model_validate(output.model_dump()).model_dump(mode='json',by_alias=True)
    return {'publicCourse':to_public_course(validated),'privateOutput':validated}

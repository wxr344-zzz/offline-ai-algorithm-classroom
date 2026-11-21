"""Reviewed weighted-graph contracts; does not decide whether a course gets Labs."""
import ast
import re
from lab_contracts import LabDraft,TestCase,TeachingStep


def is_spanning_tree_topic(text: str) -> bool:
    return bool(re.search(r'普里姆|普利姆|(?<![A-Za-z])prim(?![A-Za-z])|克鲁斯卡尔|克鲁斯凯尔|(?<![A-Za-z])kruskal(?![A-Za-z])|最小生成树',text,re.I))


def connection_cost(n,edges,existing=()):
    """Independent union-based oracle for small public graphs."""
    parent=list(range(n))
    def find(x):
        while parent[x]!=x:
            x=parent[x]
        return x
    groups=n
    for u,v in existing:
        a,b=find(u),find(v)
        if a!=b: parent[a]=b;groups-=1
    total=0
    for u,v,w in sorted(edges,key=lambda e:e[2]):
        a,b=find(u),find(v)
        if a!=b: parent[a]=b;groups-=1;total+=w
    return total if groups<=1 else -1


PRIM_REFERENCE='''class Solution:
    def solve(self, n: int, edges: list[str]) -> int:
        import heapq
        graph = [[] for _ in range(n)]
        for row in edges:
            u, v, w = map(int, row.split())
            graph[u].append((w, v))
            graph[v].append((w, u))
        visited = [False] * n
        queue = [(0, 0)]
        total = 0
        count = 0
        while queue:
            weight, node = heapq.heappop(queue)
            if visited[node]:
                continue
            visited[node] = True
            total += weight
            count += 1
            for cost, neighbor in graph[node]:
                if not visited[neighbor]:
                    heapq.heappush(queue, (cost, neighbor))
        return total if count == n else -1
'''


def spanning_tree_guide(requirement):
    if not is_spanning_tree_topic(requirement): return None
    # This contract teaches Prim. Kruskal courses keep their existing generation
    # path until their own reviewed guide contract is selected explicitly.
    if not re.search(r'普里姆|普利姆|(?<![A-Za-z])prim(?![A-Za-z])',requirement,re.I): return None
    samples=[(4,[(0,1,1),(0,2,4),(1,2,2),(1,3,5),(2,3,3)]),
        (3,[(0,1,4)]),(1,[]),(3,[(0,1,0),(1,2,2),(0,2,5)]),
        (3,[(0,0,0),(0,1,5),(0,1,1),(1,2,2)]),
        (4,[(0,1,1),(1,2,1),(2,3,1),(0,3,1)]),(2,[])]
    cases=[TestCase(case_id=f'mst-{i+1}',inputs={'n':n,'edges':[f'{u} {v} {w}' for u,v,w in edges]},
        expected=connection_cost(n,edges),description=['跨越多个候选边','图不连通','只有一个顶点','允许零权边','自环和平行边','边权相同','孤立顶点'][i]) for i,(n,edges) in enumerate(samples)]
    return LabDraft(title='Prim：连接全部顶点的最小总权重',
        instructions='给定 n 个编号为 0 到 n-1 的顶点，以及无向带权边。edges 每项为字符串 u v w，表示连接 u 和 v 的边权为 w。用 Prim 算法计算最小生成树总权重；图不连通返回 -1，只有一个顶点返回 0。零权边有效，自环不能帮助连接新顶点。',
        scaffold_code='class Solution:\n    def solve(self, n: int, edges: list[str]) -> int:\n        # TODO\n        raise NotImplementedError\n',
        reference_solution=PRIM_REFERENCE,difficulty='Easy',
        constraints=['1 <= n <= 100，0 <= u,v < n，边权为 0 到 1000000 的整数','允许自环、平行边、相同权重和不连通图'],
        teaching_steps=[TeachingStep(step_id='graph',title='建立邻接表',instruction='将每条无向边加入两端点的邻接表。',hint='零权边也是有效边。'),
            TeachingStep(step_id='grow',title='从一个顶点扩张',instruction='维护已访问集合及跨越集合边界的候选边，取最小边权并加入一个新顶点。',hint='弹出已经访问的顶点时跳过，不能重复计费。'),
            TeachingStep(step_id='check',title='核对覆盖范围',instruction='所有 n 个顶点都访问过才返回总权重，否则返回 -1。',hint='单顶点从费用 0 开始，不需要选边。')],
        public_test_cases=cases[:4],hidden_test_cases=cases[4:])


def is_reviewed_guide(scene,reference):
    try:
        from queue_assets import REFERENCE as QUEUE_REFERENCE
        from floyd_assets import REFERENCE as FLOYD_REFERENCE
        return any(ast.dump(ast.parse(reference))==ast.dump(ast.parse(known)) for known in (PRIM_REFERENCE,QUEUE_REFERENCE,FLOYD_REFERENCE))
    except SyntaxError:
        return False


NETWORK_BODY='''parts = stdin.split()
n, m, k, budget = map(int, parts[:4])
parent = list(range(n))
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x
groups = n
position = 4
for _ in range(k):
    u, v = map(int, parts[position:position+2])
    position += 2
    a, b = find(u), find(v)
    if a != b:
        parent[a] = b
        groups -= 1
edges = []
for _ in range(m):
    u, v, w = map(int, parts[position:position+3])
    position += 3
    edges.append((w, u, v))
total = 0
for weight, u, v in sorted(edges):
    a, b = find(u), find(v)
    if a != b:
        parent[a] = b
        groups -= 1
        total += weight
if groups > 1:
    return 'IMPOSSIBLE'
return ('YES ' if total <= budget else 'NO ') + str(total)
'''


def network_examples():
    samples=[(4,[(0,1,8),(1,2,2),(2,3,3),(0,3,20)],[(0,1)],5),
        (4,[(0,1,8),(1,2,2),(2,3,3),(0,3,20)],[(0,1)],4),
        (3,[(0,1,1)],[],100),(1,[],[],0),
        (3,[(0,1,7),(1,2,8)],[(0,1),(1,2)],0),
        (3,[(0,1,0),(1,2,0)],[],0),(3,[(0,1,9),(0,1,2),(1,2,3)],[],5)]
    result=[]
    for n,edges,existing,budget in samples:
        cost=connection_cost(n,edges,existing)
        answer='IMPOSSIBLE' if cost<0 else ('YES ' if cost<=budget else 'NO ')+str(cost)
        text=f'{n} {len(edges)} {len(existing)} {budget}\n'+''.join(f'{u} {v}\n' for u,v in existing)+''.join(f'{u} {v} {w}\n' for u,v,w in edges)
        result.append((text,answer))
    return result


def reviewed_prim_teaching(course):
    if not course.requires_lab or not course.scenes or not re.search(r'普里姆|普利姆|(?<![A-Za-z])prim(?![A-Za-z])',course.topic,re.I):
        return None
    entry=course.scenes[0].problem.entry_point
    if [(p.name,p.type) for p in entry.parameters]!=[('n','int'),('edges','list[str]')] or entry.return_type!='int':
        return None
    import heapq
    case=course.scenes[0].problem.public_test_cases[0]
    n,rows=case.inputs['n'],case.inputs['edges']
    edges=[tuple(map(int,row.split())) for row in rows]
    if connection_cost(n,edges)!=case.expected:
        raise ValueError('最小生成树公开答案与独立校验不一致')
    graph=[[] for _ in range(n)]
    for u,v,w in edges: graph[u].append((w,v));graph[v].append((w,u))
    queue=[(0,0,-1)];visited=set();selected=[];total=0
    steps=[{'label':'初始化起点 0','explanation':'从顶点 0 开始，已连接集合为空；初始费用 0 不代表一条实际施工边。',
            'values':['已连接：空集','累计权重：0','候选起点：0'],'activeIndices':[]}]
    while queue:
        w,node,previous=heapq.heappop(queue)
        if node in visited: continue
        visited.add(node);total+=w
        if previous>=0: selected.append(f'{previous}—{node}（{w}）')
        for cost,v in graph[node]:
            if v not in visited: heapq.heappush(queue,(cost,v,node))
        candidate=[f'{u}→{v}：{cost}' for cost,v,u in sorted(queue) if v not in visited]
        steps.append({'label':f'加入顶点 {node}'+(f'，选边 {previous}—{node}，权重 {w}' if previous>=0 else '，费用 0'),
            'explanation':('从起点开始扩张。' if previous<0 else f'候选跨集合边中，{previous}—{node} 的权重 {w} 最小，加入尚未连接的顶点 {node}。')+'更新候选边；指向已连接顶点的旧候选稍后跳过。',
            'values':[f'已连接：{sorted(visited)}',f'累计权重：{total}',('已选：'+('、'.join(selected) or '无'))[:80],('候选边：'+('、'.join(candidate) or '无'))[:80]],'activeIndices':[0,1]})
    result=total if len(visited)==n else -1
    steps.append({'label':'检查全部顶点是否连通','explanation':f'已连接 {len(visited)}/{n} 个顶点，按题意返回 {result}。',
        'values':[f'返回值：{result}'],'activeIndices':[0]})
    return {'overview':'Prim 每次选择连接已访问集合与未访问顶点的最小权重边，逐步扩张生成树。它比较的是跨集合候选边的权重，不是从起点出发的路径距离。',
        'demoExplanation':'观察“已连接集合、已选边、候选边、累计权重”：每一步从候选边中选出最便宜且能连接新顶点的边。',
        'algorithmTrace':{'exampleCaseId':case.case_id,'outcome':result,'steps':steps[:15]+steps[-1:] if len(steps)>16 else steps},
        'questions':[
            {'question':'Prim 每轮应选择哪条边？','options':['连接已访问集合和未访问顶点的最小权重候选边','图中任意最小边','从起点累计路径最长的边','编号最大的顶点对应边'],'answer':'A','analysis':'Prim 维护一个连通集合，选择跨越集合边界的最小权重边扩张。'},
            {'question':'图不连通时，按当前引导题约定返回什么？','options':['-1','已访问部分的总权重','0','顶点总数'],'answer':'A','analysis':'无法覆盖全部顶点时不能构成整张图的生成树，返回 -1。'},
            {'question':'只有一个顶点、没有边时，最小生成树总权重是多少？','options':['0','-1','1','无穷大'],'answer':'A','analysis':'单个顶点已经连通，不需要选择边，总权重为 0。'}]}

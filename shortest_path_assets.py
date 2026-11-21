"""Trusted shortest-path data checks. This adapter does not choose classroom routes."""
import json
import re
from lab_contracts import LabDraft, TeachingStep
from lab_assembly import entry_point_from_source, normalize_generated_draft


def is_shortest_path_topic(text: str) -> bool:
    return bool(re.search(r'dijkstra|[迪狄]杰?斯?特?拉|迪杰斯特拉|狄克斯特拉', text, re.I))


def parse_adjacency(rows: list[str], start: int) -> list[list[tuple[int, int]]]:
    edges, largest = [], start
    if type(start) is not int or start < 0 or start > 99:
        raise ValueError('起点编号必须为 0 到 99 的整数')
    for row in rows:
        parts = list(map(int, row.split()))
        if not parts or len(parts) % 2 != 1:
            raise ValueError('邻接行必须是 u v1 w1 v2 w2 ...，孤立点只写 u')
        u = parts[0]
        if not 0 <= u <= 99:
            raise ValueError('节点编号范围为 0 到 99')
        largest = max(largest, u)
        for v, weight in zip(parts[1::2], parts[2::2]):
            if not 0 <= v <= 99 or not 0 <= weight <= 1000000:
                raise ValueError('节点越界或边权不是非负整数')
            largest = max(largest, v)
            edges.append((u, v, weight))
    graph = [[] for _ in range(largest + 1)]
    for u, v, w in edges:
        graph[u].append((v, w))
    return graph


def shortest_distances(rows: list[str], start: int) -> list[int]:
    # Bellman-Ford is independent of the heap-based implementation supplied below.
    graph = parse_adjacency(rows, start)
    distances = [float('inf')] * len(graph)
    distances[start] = 0
    for _ in range(len(graph) - 1):
        changed = False
        for u, adjacent in enumerate(graph):
            for v, w in adjacent:
                if distances[u] + w < distances[v]:
                    distances[v] = distances[u] + w
                    changed = True
        if not changed:
            break
    return [-1 if d == float('inf') else d for d in distances]


ADJACENCY_REFERENCE = '''class Solution:
    def solve(self, graph: list[str], start: int) -> list[int]:
        import heapq
        adjacent = {}
        largest = start
        for row in graph:
            parts = list(map(int, row.split()))
            u = parts[0]
            largest = max(largest, u)
            for v, weight in zip(parts[1::2], parts[2::2]):
                largest = max(largest, v)
                adjacent.setdefault(u, []).append((v, weight))
        distances = [float('inf')] * (largest + 1)
        distances[start] = 0
        queue = [(0, start)]
        while queue:
            distance, node = heapq.heappop(queue)
            if distance != distances[node]:
                continue
            for target, weight in adjacent.get(node, []):
                candidate = distance + weight
                if candidate < distances[target]:
                    distances[target] = candidate
                    heapq.heappush(queue, (candidate, target))
        return [-1 if d == float('inf') else d for d in distances]
'''


def review_shortest_path_draft(draft: LabDraft, requirement: str) -> LabDraft:
    entry = entry_point_from_source(draft.reference_solution)
    if not is_shortest_path_topic(requirement) or [(p.name, p.type) for p in entry.parameters] != [('graph', 'list[str]'), ('start', 'int')] or entry.return_type != 'list[int]':
        return draft
    draft = draft.model_copy(deep=True)
    for case in draft.public_test_cases + draft.hidden_test_cases:
        case.expected = shortest_distances(case.inputs['graph'], case.inputs['start'])
        case.description = '按节点编号排列最短距离；源点距离为 0，不可达为 -1。'
    draft.reference_solution = ADJACENCY_REFERENCE
    draft.instructions = ('计算有向非负权图从 start 出发的最短距离。graph 每行格式为 u v1 w1 v2 w2 ...，'
        '表示从 u 到 v1 权重 w1、到 v2 权重 w2；孤立点只写 u。节点为从 0 到最大出现编号的连续整数，'
        'start 也计入节点集合。允许 0 权边、重复边和孤立点。返回按编号排列的距离列表，起点为 0，不可达为 -1。')
    draft.constraints = ['0 <= 节点编号 <= 99，0 <= 边权 <= 1000000', '有向图；每行均为合法邻接行']
    draft.teaching_steps = [
        TeachingStep(step_id='parse-graph',title='解析有向邻接行',instruction='逐行读取 u 及后面的 (v,w) 对，建立邻接表；统计最大节点编号，保留孤立节点。',hint='边的方向是 u→v；零权重也是合法道路。'),
        TeachingStep(step_id='minimum-queue',title='初始化距离并弹出最小候选',instruction='起点距离设为 0，其余设为无穷；把起点入最小堆。每轮弹出距离最小的节点，跳过已过期的候选。',hint='堆条目使用 (距离, 节点)，比较时先看距离。'),
        TeachingStep(step_id='relax-edges',title='松弛相邻边并汇总结果',instruction='比较 当前距离+实际边权 与邻居旧距离；更小时更新并重新入队。堆空后按节点编号返回距离，将无穷转换为 -1。',hint='边权不一定是 1，不能把经过的边数当作路径距离。'),
    ]
    return normalize_generated_draft(draft)

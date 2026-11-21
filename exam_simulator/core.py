"""Bounded, immutable, data-only traces. No model code, eval, or student code."""
from __future__ import annotations
from copy import deepcopy
from dataclasses import dataclass
import math
import re
import unicodedata

REGISTRY = {}

def algorithm(key, title, aliases, default, section):
    def register(fn):
        if key in REGISTRY:
            raise RuntimeError('Duplicate simulator id')
        REGISTRY[key] = dict(id=key, title=title, aliases=aliases, default=default, section=section, run=fn)
        return fn
    return register

def require(ok, message):
    if not ok: raise ValueError(message)

def ints(a, limit=24, minimum=-10000, maximum=10000):
    require(isinstance(a, list) and len(a) <= limit and all(type(x) is int and minimum <= x <= maximum for x in a), f'需要至多 {limit} 个整数，范围 {minimum}…{maximum}')
    return list(a)

def number(x):
    return '∞' if x == math.inf else '−∞' if x == -math.inf else x

def clean(value):
    if isinstance(value, float) and not math.isfinite(value): return number(value)
    if isinstance(value, dict): return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [clean(v) for v in value]
    if isinstance(value, set): return [clean(v) for v in sorted(value)]
    return value

def seq(name, values, pointers=None, active=None):
    return dict(kind='sequence', name=name, values=list(values), pointers=pointers or {}, active=active or [])

def grid(name, values, rows=None, columns=None, active=None, dependencies=None):
    return dict(kind='matrix', name=name, values=values, rows=rows or list(range(len(values))), columns=columns or list(range(len(values[0]) if values else 0)), active=active or [], dependencies=dependencies or [])

def boxes(name, groups):
    return dict(kind='containers', name=name, groups=[dict(name=k, values=list(v)) for k, v in groups.items()])

def table(name, columns, rows, active=None):
    return dict(kind='table', name=name, columns=columns, rows=rows, active=active or [])

def tree(name, nodes, edges, roots=None):
    return dict(kind='tree', name=name, nodes=nodes, edges=edges, roots=roots or [])

def graph(name, n, edges, directed=True, current=None, selected=None, marked=None):
    return dict(kind='graph', name=name, nodes=[dict(id=str(i), label=str(i), mark='active' if i == current else 'done' if i in (marked or []) else '') for i in range(n)], edges=[dict(source=str(e[0]), target=str(e[1]), label='/'.join(map(str,e[2:])), mark='selected' if j in (selected or []) else '', directed=directed) for j,e in enumerate(edges)])

class Trace:
    def __init__(self, key, data):
        self.key, self.input, self.frames = key, deepcopy(data), []

    def emit(self, label, explanation, *views, **state):
        require(len(self.frames) < 3000, '教学输入超过 3000 步，请缩小输入规模')
        require(bool(views), 'A trace frame must contain structured views')
        self.frames.append(deepcopy(clean(dict(index=len(self.frames), label=label, explanation=explanation, views=list(views), state=state))))

    def finish(self, result, verified=True):
        require(self.frames, '没有计算快照')
        return dict(version=1, algorithm=self.key, title=REGISTRY[self.key]['title'], input=clean(self.input), frames=self.frames, outcome=clean(result), verified=verified, engine='python-deterministic')

def catalog():
    return [deepcopy({k:v for k,v in p.items() if k != 'run'}) for p in REGISTRY.values()]

# Textbook synonyms and typography describe the same operation. Keep
# algorithm/variant qualifiers so a base algorithm cannot absorb a variant.
# 搜素 is a common typing slip for 搜索 (search); 广度优先搜索 is 广度搜索.
# Exported with FRAMING and VARIANTS to lib/eduplus/exam-topic-routing.json:
# the app routes topics with exactly these rules (lib/eduplus/exam-topic.ts).
SYNONYMS = (('字符串模式匹配', '字符串匹配'), ('模式匹配', '字符串匹配'), ('并查集带权', '带权并查集'),
            ('搜素', '搜索'), ('宽度优先', '广度'), ('广度优先', '广度'), ('深度优先', '深度'))

# Request framing, teaching aspects and supported operations: never a qualifier
# that names a different algorithm (bidirectional, weighted, Fibonacci, ...).
FRAMING = ('请为我讲解', '请给我讲解', '请讲解', '请介绍', '讲解', '并提供编程实验',
           '并提供代码', '的基本原理', '的原理', '原理与实现', '基本原理', '详细过程',
           '算法', '动态推演', '动态规划', '分裂与合并', '路径压缩', '最短路径', '最短路',
           '插入', '删除', '查找', '旋转', '分裂', '合并', '操作', '实现', '演示', '树', '与',
           'algorithm', 'explanation', 'overview', 'pleaseexplain', 'explain',
           # Natural phrasing of the same request (detail, aspect, practice).
           '请你', '请', '帮我', '给我', '为我', '向我', '我想学习', '我想了解', '我想学', '想学习',
           '想了解', '学习', '了解', '详细讲解', '详细介绍', '详细', '简单', '一下', '讲讲', '讲一讲',
           '说说', '介绍', '什么是', '是什么', '怎么', '如何', '工作原理', '原理', '核心思想',
           '基本思想', '思想', '执行过程', '过程', '步骤', '代码实现', '代码', '编程练习',
           '编程实验', '编程', '并安排', '安排', '练习', '实验', '时间复杂度', '空间复杂度',
           '复杂度分析', '复杂度', '分析', '应用场景', '应用', '例子', '示例', '例题', '入门',
           '基础', '课程', '问题', '搜索', '方法', '最坏情况', '最好情况', '平均情况', '情况',
           '稳定性', '性能', '使用', '用', '纯理论讲解', '纯理论', '只讲理论', '理论', '不涉及编程',
           '不需要编程', '不要编程', '无需编程', '不写代码', '不需要实验', '不要实验', '并且',
           '以及', '和', '及', '并', '的', '一个', '一节课',
           # Context of a tree operation ("二叉树的中序遍历" is 中序遍历) and its
           # verb: the operation's own name must still match first.
           '二叉树', '遍历', 'binary tree', 'of a', 'of',
           # "队列的主要算法，包括结点的插入和删除": scope words of a request.
           '主要', '包括', '包含', '常见', '基本', '结点', '节点', '元素',
           'python', 'please', 'teach', 'me', 'the', 'how', 'works', 'introduction', 'to',
           'for me', 'could you', 'would you', 'can you',
           'basic operations', 'operations', 'including', 'node', 'insertion', 'deletion', 'and',
           # The page that shows it (an outline title such as "Bubble Sort
           # Simulator" or "冒泡排序交互模拟器") names presentation, not a variant.
           'interactive', 'simulator', 'simulation', 'visualization', 'visualizer',
           'animation', 'demonstration', 'demo', 'stepbystep', 'sorting', 'sort',
           '交互式', '交互', '模拟器', '模拟', '可视化', '动画', '互动', '推演')

# Explicit variants outrank a longer English base name appearing nearby.
# E.g. "Dijkstra 双权值" must not silently become single-weight Dijkstra.
VARIANTS = (('dual-dijkstra', ('双权', '距离与费用', '距离和费用')),
            ('weighted-dsu', ('带权并查集', '并查集带权', '势差并查集')),
            ('b-plus-tree', ('b+树', 'b＋树', 'b+tree')),
            ('kmp-period', ('nextval', '周期判定', '最小循环节', 'kmp扩展')))

PUNCTUATION = r'[\s，,。.:：;；、/&()（）?？!！"“”‘’\'-]'

def normalized_topic(topic, compact=True):
    value = unicodedata.normalize('NFKC', topic).lower()
    if compact:value = re.sub(r'\s+', '', value)
    for old, new in SYNONYMS:value = value.replace(old, new)
    return value


def resolve(topic):
    normalized = normalized_topic(topic)
    def exact_identity(profile):
        remainder=normalized
        names=profile['aliases']+[profile['title'],profile['id']]+re.findall(r'[A-Za-z][A-Za-z0-9+*-]*',profile['title'])
        for name in sorted(names,key=len,reverse=True):
            token=normalized_topic(name)
            if token:remainder=remainder.replace(token,'')
        # Strip request framing and supported operations only. An unknown
        # qualifier (bidirectional, weighted, Fibonacci, etc.) must reach the
        # dynamic generator rather than silently becoming a base algorithm.
        for token in sorted((normalized_topic(t) for t in FRAMING), key=len, reverse=True):
            if token:remainder=remainder.replace(token,'')
        return not re.sub(PUNCTUATION,'',remainder)
    for key,aliases in VARIANTS:
        if key in REGISTRY and any(normalized_topic(a) in normalized for a in aliases) and exact_identity(REGISTRY[key]):return key
    matches = []
    for profile in REGISTRY.values():
        for alias in profile['aliases'] + [profile['title'], profile['id']]:
            spaced=normalized_topic(alias,compact=False)
            alias = normalized_topic(alias)
            if not alias:continue
            if re.fullmatch(r'[a-z0-9_+*/ .-]+',spaced):
                # "prim" inside "primality" or "lis" inside "list" is
                # not an algorithm identity. Preserve English word boundaries.
                pattern=r'(?<![a-z0-9_])'+r'\s*'.join(map(re.escape,spaced.split()))+r'(?![a-z0-9_])'
                matched=re.search(pattern,normalized_topic(topic,compact=False)) is not None
            else:matched=alias in normalized
            if matched and exact_identity(profile): matches.append((len(alias), profile['id']))
    if not matches: return None
    matches.sort(reverse=True)
    return matches[0][1]

def run_trace(key=None, topic='', data=None):
    require(type(topic) is str and len(topic) <= 2000, '主题过长')
    key = key or resolve(topic)
    require(key in REGISTRY, '请选择目录中的具体算法')
    profile = REGISTRY[key]
    data = deepcopy(profile['default'] if data is None else data)
    require(type(data) is dict, '教学输入必须是 JSON 对象')
    return profile['run'](Trace(key, data), data)

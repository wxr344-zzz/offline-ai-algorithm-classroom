"""Export routing metadata only; algorithm execution remains Python-only."""
import json
from pathlib import Path
from . import catalog
from .core import FRAMING, PUNCTUATION, SYNONYMS, VARIANTS, resolve

ROOT = Path(__file__).resolve().parents[1]

# Requests whose routing both sides must agree on (natural phrasings, variants
# that must not collapse into a base algorithm, unlisted algorithms).
ROUTING_SAMPLES = (
    '请为我讲解快速排序', '请为我讲解快速排序的时间复杂度', '讲解快速排序算法的原理和实现',
    '详细讲解一下冒泡排序', '请讲解Dijkstra最短路径算法', '我想学习二叉搜索树的插入和删除',
    '帮我讲讲KMP算法', '讲解堆排序，并安排编程练习', '快速排序和归并排序的比较',
    '请为我讲解贪婪最佳优先搜素', '讲解A*搜索算法', '请为我讲解动态规划', '请为我讲解0-1背包问题',
    'Explain quicksort', '请为我讲解广度优先搜索', '讲解深度优先搜索算法', '双向BFS',
    '请讲解斐波那契堆', '带权并查集', '讲解Dijkstra双权值最短路', '请为我讲解红黑树的插入',
    '请为我讲解二叉搜索树', '请为我讲解梯度下降算法', '我想学习哈希表', '讲解B+树的分裂与合并',
    '用Python实现冒泡排序', '请为我讲解快速排序的最坏情况', 'primality test', 'list comprehension',
    '请为我讲解光合作用', '讲解 Prim 最小生成树', '纯理论讲解快速排序，不涉及编程',
    '请为我讲解双向Dijkstra', '请为我讲解二叉树的中序遍历算法', '二叉树的前序遍历', '讲解二叉树的后序遍历',
    '二叉树的层次遍历', '请为我讲解二叉树遍历', '二叉树的先序、中序和后序遍历', '由先序中序重建二叉树',
    '二叉树的中序遍历的非递归实现', '图的遍历', 'Explain binary tree inorder traversal',
    '请为我讲解队列的主要算法 包括结点的插入和删除', '讲解栈的基本操作',
    'Bubble Sort', 'Bubble Sort Simulator', '冒泡排序交互模拟器', 'Topological Sort',
    'Sorting Algorithms Simulator', 'Bucket Sort', 'Quick Sort vs Bubble Sort',
    'Please explain binary tree traversal for me.',
    'Could you explain quicksort for me?', 'Would you explain stack for me?',
    'Please explain bidirectional Dijkstra for me.',
    'Please explain the Fibonacci sequence algorithm for me.',
    'Fibonacci numbers', 'Fibonacci heap',
    'Please explain the basic operations of linked lists, including node insertion and deletion.',
    'Please explain linked list for me.', 'singly linked lists',
    'doubly linked lists', 'circular linked list', 'persistent linked list',
    'Please explain the Breadth-First Search (BFS) algorithm for me.',
    'Please explain the Depth-First Search (DFS) algorithm for me.',
    'breadth first search', 'depth first search', 'bidirectional breadth-first search',
)

def snapshot():
    return [{k:p[k] for k in ('id','title','aliases','section')} for p in catalog()]

def routing():
    return {'synonyms': [list(pair) for pair in SYNONYMS], 'framing': list(FRAMING),
            'variants': [[key, list(aliases)] for key, aliases in VARIANTS],
            'punctuation': PUNCTUATION}

def resolutions():
    return {topic: resolve(topic) for topic in ROUTING_SAMPLES}

if __name__=='__main__':
    for name, value in (('lib/eduplus/exam-simulator-catalog.json', snapshot()),
                        ('lib/eduplus/exam-topic-routing.json', routing()),
                        ('tests/fixtures/exam-topic-resolutions.json', resolutions())):
        (ROOT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

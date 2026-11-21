import { computeReviewedAlgorithm } from './reviewed-algorithm-engine.js';

/** An allowlist of maintained implementations, never an LLM-generated program. */
export const REVIEWED_ALGORITHMS = [
  {
    id: 'insertion',
    name: '插入排序',
    match: /插入排序|\binsertion\s*sort\b/i,
    input: { array: [5, 2, 4, 2, 1] },
  },
  {
    id: 'selection',
    name: '选择排序',
    match: /选择排序|\bselection\s*sort\b/i,
    input: { array: [5, 2, 4, 2, 1] },
  },
  {
    id: 'bubble',
    name: '冒泡排序',
    match: /冒泡排序|\bbubble\s*sort\b/i,
    input: { array: [5, 2, 4, 2, 1] },
  },
  {
    id: 'merge',
    name: '归并排序',
    match: /归并排序|\bmerge\s*sort\b/i,
    input: { array: [5, 2, 4, 2, 1] },
  },
  {
    id: 'quick',
    name: '快速排序',
    match: /快速排序|\bquick\s*sort\b/i,
    input: { array: [5, 2, 4, 2, 1] },
  },
  {
    id: 'heap',
    name: '堆排序',
    match: /堆排序|\bheap\s*sort\b/i,
    input: { array: [5, 2, 4, 2, 1] },
  },
  {
    id: 'binary',
    name: '二分查找',
    match: /二分(?:查找|搜索)|\bbinary\s*search\b/i,
    input: { array: [1, 3, 3, 5, 8, 12], target: 8 },
  },
  {
    id: 'two-sum',
    name: '两数之和',
    match: /两数之和|\btwo[ -]*sum\b/i,
    input: { array: [3, 2, 4, 3], target: 6 },
  },
  { id: 'fibonacci', name: '斐波那契数列', match: /斐波那契|\bfibonacci\b/i, input: { n: 7 } },
  {
    id: 'stack',
    name: '栈',
    match: /栈(?:的|相关基础|相关基本|基础|基本|操作|算法|$)|\bstack\b/i,
    input: { operations: ['push 3', 'push 7', 'peek', 'pop', 'peek', 'pop', 'empty'] },
  },
  {
    id: 'queue',
    name: '队列',
    match: /(?:^|链式|循环)队列|队列(?:的|基础|基本|操作|算法|$)|\bqueue\b/i,
    input: {
      operations: ['enqueue 3', 'enqueue 7', 'peek', 'dequeue', 'peek', 'dequeue', 'empty'],
    },
  },
  {
    id: 'bfs',
    name: '广度优先搜索',
    match: /广度(?:优先)?(?:搜索|遍历)|宽度优先|\bbfs\b|\bbreadth[ -]*first\b/i,
    input: {
      n: 6,
      edges: [
        [0, 1, 1],
        [0, 2, 1],
        [1, 3, 1],
        [2, 3, 1],
        [3, 4, 1],
        [4, 0, 1],
      ],
      directed: true,
      start: 0,
    },
  },
  {
    id: 'dfs',
    name: '深度优先搜索',
    match: /深度(?:优先)?(?:搜索|遍历)|\bdfs\b|\bdepth[ -]*first\b/i,
    input: {
      n: 6,
      edges: [
        [0, 1, 1],
        [0, 2, 1],
        [1, 3, 1],
        [2, 3, 1],
        [3, 4, 1],
        [4, 0, 1],
      ],
      directed: true,
      start: 0,
    },
  },
  {
    id: 'dijkstra',
    name: 'Dijkstra 最短路',
    match: /\bdijkstra\b|[迪狄]杰?斯?特?拉|狄克斯特拉/i,
    input: {
      n: 6,
      edges: [
        [0, 1, 8],
        [0, 2, 2],
        [2, 1, 1],
        [1, 3, 3],
        [2, 3, 9],
        [3, 4, 1],
      ],
      directed: true,
      start: 0,
    },
  },
  {
    id: 'floyd',
    name: 'Floyd-Warshall 全源最短路',
    match: /\bfloyd\b|弗洛伊德|佛洛伊德/i,
    input: {
      n: 4,
      edges: [
        [0, 1, 4],
        [0, 2, 10],
        [1, 2, 2],
        [2, 3, 1],
      ],
      directed: true,
      start: 0,
    },
  },
  {
    id: 'astar',
    name: 'A* 搜索',
    match: /(?:^|[^a-z])a\s*\*|\ba[ -]?star\b|A星/i,
    input: {
      n: 6,
      edges: [
        [0, 1, 8],
        [0, 2, 2],
        [2, 1, 1],
        [1, 3, 3],
        [2, 3, 9],
        [3, 4, 1],
      ],
      directed: true,
      start: 0,
      goal: 4,
      heuristic: [6, 3, 4, 1, 0, 0],
    },
  },
  {
    id: 'kruskal',
    name: 'Kruskal 最小生成树',
    match: /\bkruskal\b|克鲁斯卡[尔兒]?/i,
    input: {
      n: 5,
      edges: [
        [0, 1, 1],
        [1, 2, 2],
        [0, 2, 3],
        [2, 3, 4],
        [1, 3, 6],
        [3, 4, 2],
      ],
      directed: false,
      start: 0,
    },
  },
  {
    id: 'prim',
    name: 'Prim 最小生成树',
    match: /\bprim\b|普里姆|普利姆/i,
    input: {
      n: 5,
      edges: [
        [0, 1, 1],
        [1, 2, 2],
        [0, 2, 3],
        [2, 3, 4],
        [1, 3, 6],
        [3, 4, 2],
      ],
      directed: false,
      start: 0,
    },
  },
  {
    id: 'topological',
    name: '拓扑排序',
    match: /拓扑排序|\btopological\b/i,
    input: {
      n: 5,
      edges: [
        [0, 2, 1],
        [1, 2, 1],
        [2, 3, 1],
        [2, 4, 1],
      ],
      directed: true,
      start: 0,
    },
  },
  {
    id: 'lcs',
    name: '最长公共子序列',
    match: /最长公共子序列|\blcs\b|\blongest\s+common\s+subsequence\b/i,
    input: { a: 'ABCBDAB', b: 'BDCABA' },
  },
  {
    id: 'kmp',
    name: 'KMP 字符串匹配',
    match: /\bkmp\b|knuth.*morris.*pratt/i,
    input: { a: 'ABABABCABAB', b: 'ABABC' },
  },
  {
    id: 'knapsack',
    name: '0/1 背包',
    match: /(?:0\s*[/／-]\s*1|零一)\s*背包|\b0[/-]1\s*knapsack\b/i,
    input: { weights: [2, 3, 4], values: [4, 5, 7], capacity: 5 },
  },
] as const;
export function resolveReviewedAlgorithm(topic: string) {
  const matches = REVIEWED_ALGORITHMS.filter((item) => item.match.test(topic));
  // No guess when a title mixes algorithms or names an unimplemented variant.
  if (matches.length !== 1 || hasUnreviewedVariant(topic)) return null;
  return matches[0];
}
export function hasUnreviewedVariant(topic: string) {
  return (
    /双向|双端|循环队列|变种|变体|不一致启发式|递归斐波那契|记忆化|滚动数组|空间优化|双指针.*两数之和|单调栈|优先队列|priority\s*queue|完全背包|多重背包|longest\s+common\s+substring|最长公共子串|negascout|\bpvs\b|\bmtd\b/i.test(
      topic,
    ) ||
    (/启发式/i.test(topic) && !/(?:^|[^a-z])a\s*\*|\ba[ -]?star\b|A星/i.test(topic))
  );
}
export { computeReviewedAlgorithm };

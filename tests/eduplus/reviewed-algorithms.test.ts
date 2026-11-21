import { describe, expect, it } from 'vitest';
import {
  computeReviewedAlgorithm as run,
  REVIEWED_ALGORITHMS,
  resolveReviewedAlgorithm,
} from '@/lib/eduplus/reviewed-algorithms';

describe('independently computed teaching algorithms', () => {
  it.each(REVIEWED_ALGORITHMS)(
    '$name has a deterministic executable default and immutable snapshots',
    (descriptor) => {
      const before = JSON.stringify(descriptor.input);
      const a = run(descriptor.id, descriptor.input),
        b = run(descriptor.id, descriptor.input);
      expect(a).toEqual(b);
      expect(JSON.stringify(descriptor.input)).toBe(before);
      expect(a.steps.length).toBeGreaterThan(0);
      expect(a.steps.every((s: { explanation: string }) => s.explanation.length > 0)).toBe(true);
    },
  );
  it.each(['insertion', 'selection', 'bubble', 'merge', 'quick', 'heap'])(
    '%s preserves duplicates and matches an independent sort across adversarial arrays',
    (kind) => {
      const arrays = [[], [1], [2, 2, 2], [4, 3, 2, 1], [-3, 0, -3, 2], [1, 2, 3, 4]];
      for (let i = 0; i < 30; i++)
        arrays.push(Array.from({ length: i % 12 }, (_, j) => ((i * 7 + j * 3) % 9) - 4));
      for (const array of arrays)
        expect(run(kind, { array }).outcome).toEqual([...array].sort((a, b) => a - b));
    },
  );
  it('handles Fibonacci base cases and validates precision bounds', () => {
    expect(run('fibonacci', { n: 0 }).outcome).toBe(0);
    expect(run('fibonacci', { n: 1 }).outcome).toBe(1);
    expect(run('fibonacci', { n: 50 }).outcome).toBe(12586269025);
    for (const n of [-1, 1.5, 51, true]) expect(() => run('fibonacci', { n })).toThrow();
  });
  it('distinguishes LIFO from FIFO, including empty removal without mutation', () => {
    expect(
      run('stack', { operations: ['pop', 'push 1', 'push 2', 'pop', 'peek'] }).outcome,
    ).toEqual({ data: [1], outputs: ['空容器错误', 2, 1] });
    expect(
      run('queue', { operations: ['dequeue', 'enqueue 1', 'enqueue 2', 'dequeue', 'peek'] })
        .outcome,
    ).toEqual({ data: [2], outputs: ['空容器错误', 1, 2] });
  });
  it('binary search requires sorted input and terminates on empty and duplicate inputs', () => {
    expect(run('binary', { array: [], target: 0 }).outcome).toBe(-1);
    expect(run('binary', { array: [1, 1], target: 1 }).outcome).toBe(0);
    expect(run('binary', { array: [1, 3], target: 2 }).outcome).toBe(-1);
    expect(() => run('binary', { array: [3, 1], target: 1 })).toThrow('升序');
  });
  it('two-sum never reuses an index, but accepts equal values at different positions', () => {
    expect(run('two-sum', { array: [3], target: 6 }).outcome).toEqual([]);
    expect(run('two-sum', { array: [3, 3], target: 6 }).outcome).toEqual([0, 1]);
  });
  it('LCS rejects a character absent from either input and handles multiple optimal subsequences', () => {
    expect(run('lcs', { a: 'ABC', b: 'BCA' }).outcome).toEqual({ length: 2, subsequence: 'BC' });
    expect(run('lcs', { a: 'AB', b: 'BA' }).outcome.length).toBe(1);
    expect(run('lcs', { a: '', b: 'BA' }).outcome).toEqual({ length: 0, subsequence: '' });
    expect(run('lcs', { a: '甲乙丙', b: '丁甲' }).outcome).toEqual({
      length: 1,
      subsequence: '甲',
    });
  });
  it('KMP handles overlapping prefixes, empty pattern, absent match and Unicode character indexes', () => {
    for (const [a, b, expected] of [
      ['AAAAAB', 'AAAB', 2],
      ['ABABABC', 'ABABC', 2],
      ['ABC', '', 0],
      ['ABC', 'Z', -1],
      ['😀甲😀乙', '😀乙', 2],
    ] as const)
      expect(run('kmp', { a, b }).outcome).toBe(expected);
  });
  it('0/1 knapsack does not turn into unbounded knapsack', () => {
    expect(run('knapsack', { weights: [2], values: [3], capacity: 4 }).outcome).toBe(3);
    expect(run('knapsack', { weights: [], values: [], capacity: 5 }).outcome).toBe(0);
    expect(() => run('knapsack', { weights: [0], values: [3], capacity: 4 })).toThrow();
  });
  const graph = {
    n: 6,
    edges: [
      [0, 1, 1],
      [0, 2, 1],
      [1, 3, 1],
      [2, 4, 1],
      [3, 0, 1],
      [4, 3, 1],
    ],
    directed: true,
    start: 0,
  };
  it('BFS and DFS produce different correct orders on branches, cycles and disconnected graphs', () => {
    expect(run('bfs', graph).outcome).toEqual([0, 1, 2, 3, 4]);
    expect(run('dfs', graph).outcome).toEqual([0, 1, 3, 2, 4]);
    for (const kind of ['bfs', 'dfs'])
      expect(run(kind, { n: 2, edges: [], directed: false, start: 1 }).outcome).toEqual([1]);
  });
  it('Dijkstra handles stale queue entries, zero and parallel edges, and rejects negative weights', () => {
    const input = {
      n: 5,
      edges: [
        [0, 1, 10],
        [0, 2, 2],
        [2, 1, 1],
        [1, 3, 0],
        [0, 2, 5],
      ],
      directed: true,
      start: 0,
    };
    const trace = run('dijkstra', input);
    expect(trace.outcome).toEqual([0, 3, 2, 3, '∞']);
    expect(trace.steps.some((s: { label: string }) => s.label === '跳过过期候选')).toBe(true);
    expect(() => run('dijkstra', { ...input, edges: [[0, 1, -1]] })).toThrow('非负权');
    expect(run('floyd', input).outcome[0]).toEqual(trace.outcome);
  });
  it.each(['kruskal', 'prim'])(
    '%s rejects cycles, supports negative weights and names disconnected output a forest',
    (kind) => {
      const input = {
        n: 5,
        edges: [
          [0, 1, -2],
          [0, 1, 4],
          [1, 2, 1],
          [0, 2, 5],
          [3, 4, 3],
          [3, 3, -10],
        ],
        directed: false,
      };
      const trace = run(kind, input);
      expect(trace.outcome.total).toBe(2);
      expect(trace.outcome.components).toBe(2);
      expect(trace.outcome.edges).toHaveLength(3);
      expect(trace.steps.at(-1)!.explanation).toContain('图不连通');
      expect(() => run(kind, { ...input, directed: true })).toThrow('无向图');
    },
  );
  it('topological sorting detects cycles rather than presenting a partial order as complete', () => {
    expect(
      run('topological', {
        n: 3,
        edges: [
          [0, 1, 1],
          [1, 2, 1],
        ],
        directed: true,
      }).outcome,
    ).toEqual([0, 1, 2]);
    expect(
      run('topological', {
        n: 3,
        edges: [
          [0, 1, 1],
          [1, 0, 1],
        ],
        directed: true,
      }).outcome,
    ).toBeNull();
  });
  it('A* uses g+h with a consistent heuristic, and independently verifies the resulting shortest path', () => {
    const input = {
      n: 5,
      edges: [
        [0, 1, 8],
        [0, 2, 2],
        [2, 1, 1],
        [1, 3, 3],
      ],
      directed: true,
      start: 0,
      goal: 3,
      heuristic: [6, 3, 4, 0, 0],
    };
    expect(run('astar', input).outcome).toEqual({ distance: 6, path: [0, 2, 1, 3] });
    expect(run('astar', { ...input, heuristic: [0, 0, 0, 0, 0] }).outcome.distance).toBe(
      run('dijkstra', input).outcome[3],
    );
    expect(run('astar', { ...input, goal: 4, heuristic: [0, 0, 0, 0, 0] }).outcome).toEqual({
      distance: '∞',
      path: [],
    });
    expect(() => run('astar', { ...input, heuristic: [100, 0, 0, 0, 0] })).toThrow('一致启发式');
    expect(() => run('astar', { ...input, edges: [[0, 1, -1]] })).toThrow('非负权');
  });
  it('Floyd supports negative edges but reports negative cycles instead of false finite paths', () => {
    const graph = {
      n: 3,
      edges: [
        [0, 1, -2],
        [1, 2, 1],
        [0, 2, 4],
      ],
      directed: true,
    };
    expect(run('floyd', graph).outcome[0]).toEqual([0, -2, -1]);
    const cyclic = run('floyd', {
      ...graph,
      edges: [
        [0, 1, -2],
        [1, 0, 1],
      ],
    });
    expect(cyclic.outcome).toEqual({ negativeCycle: true });
    expect(cyclic.steps.at(-1)!.label).toBe('检测到负权环');
    expect(run('floyd', { n: 1, edges: [[0, 0, -1]], directed: true }).outcome).toEqual({
      negativeCycle: true,
    });
  });
  it('cross-checks graph families across disconnected, parallel-edge and cyclic graphs', () => {
    for (let seed = 0; seed < 18; seed++) {
      const n = 2 + (seed % 5),
        edges: number[][] = [];
      for (let u = 0; u < n; u++)
        for (let v = 0; v < n; v++)
          if ((u * 7 + v * 11 + seed) % 4 === 0) edges.push([u, v, (u + v + seed) % 9]);
      const graph = { n, edges, directed: true, start: seed % n };
      const dist = run('dijkstra', graph).outcome;
      expect(run('floyd', graph).outcome[graph.start]).toEqual(dist);
      expect(new Set(run('dfs', graph).outcome)).toEqual(new Set(run('bfs', graph).outcome));
      const undirected = {
        ...graph,
        directed: false,
        edges: edges.map(([u, v, w]) => [u, v, w - 3]),
      };
      expect(run('prim', undirected).outcome.total).toBe(run('kruskal', undirected).outcome.total);
    }
  });
  it('does not guess unsupported algorithms or mixed titles', () => {
    expect(resolveReviewedAlgorithm('深度遍历算法')?.id).toBe('dfs');
    expect(resolveReviewedAlgorithm('队列基本操作')?.id).toBe('queue');
    for (const topic of [
      '未知算法',
      '快速排序与归并排序',
      '最长公共子串',
      '完全背包',
      '单调栈',
      '优先队列',
      '二分搜索的双向变体',
    ])
      expect(resolveReviewedAlgorithm(topic)).toBeNull();
    expect(() => run('unknown', {})).toThrow('可信执行器');
  });
});

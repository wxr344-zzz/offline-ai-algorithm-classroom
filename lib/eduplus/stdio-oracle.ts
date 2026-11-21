import type { PublicProblem } from '@/lib/types/eduplus.generated';

/** Developer-owned public practice oracles. No private reference code or hidden cases. */
export function stdioExpected(
  profile: PublicProblem['standardIoProfile'],
  input: string,
): string | null {
  if (!profile) return null;
  const tokens = input.trim() ? input.trim().split(/\s+/) : [];
  const integer = (token: string | undefined, min: number, max: number) => {
    if (!token || !/^-?\d+$/.test(token)) throw new Error('输入格式错误：请按题面填写整数。');
    const value = Number(token);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`输入超出范围：应为 ${min} 到 ${max} 的整数。`);
    return value;
  };
  if (profile === 'budget-pair') {
    const n = integer(tokens[0], 0, 10000),
      budget = integer(tokens[1], 0, 1e9);
    if (tokens.length !== n + 2) throw new Error('输入格式错误：物品价格数量必须恰好为 n。');
    const prices = tokens
      .slice(2)
      .map((token) => integer(token, 0, 1e9))
      .sort((a, b) => a - b);
    let answer = 0;
    for (const price of prices) if (price <= budget) answer = Math.max(answer, price);
    let left = 0,
      right = n - 1;
    while (left < right) {
      const total = prices[left] + prices[right];
      if (total <= budget) {
        answer = Math.max(answer, total);
        left++;
      } else right--;
    }
    return String(answer);
  }
  if (profile === 'delivery-deadline') {
    const n = integer(tokens[0], 1, 100),
      m = integer(tokens[1], 0, 1000);
    const start = integer(tokens[2], 0, n - 1),
      limit = integer(tokens[3], 0, 1000000);
    if (tokens.length !== 4 + 3 * m) throw new Error('输入格式错误：需要恰好 m 行道路。');
    const edges: number[][] = [];
    for (let i = 0; i < m; i++)
      edges.push([
        integer(tokens[4 + 3 * i], 0, n - 1),
        integer(tokens[5 + 3 * i], 0, n - 1),
        integer(tokens[6 + 3 * i], 0, 1000000),
      ]);
    // Bellman-Ford public oracle, independent of a student's heap implementation.
    const dist = new Array<number>(n).fill(Infinity);
    dist[start] = 0;
    for (let step = 0; step < n - 1; step++) {
      let changed = false;
      for (const [u, v, w] of edges)
        if (dist[u] + w < dist[v]) {
          dist[v] = dist[u] + w;
          changed = true;
        }
      if (!changed) break;
    }
    return String(dist.filter((d, i) => i !== start && d <= limit).length);
  }
  if (profile === 'knapsack') {
    const n = integer(tokens[0], 0, 100),
      capacity = integer(tokens[1], 0, 1000);
    if (tokens.length !== 2 + n * 2) throw new Error('输入格式错误：需要 n 组重量和价值。');
    const dp = new Array<number>(capacity + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const weight = integer(tokens[2 + i * 2], 1, 1000),
        value = integer(tokens[3 + i * 2], 0, 10000);
      for (let room = capacity; room >= weight; room--)
        dp[room] = Math.max(dp[room], dp[room - weight] + value);
    }
    return String(dp[capacity]);
  }
  if (profile === 'knapsack-minweight') {
    const n = integer(tokens[0], 0, 100),
      required = integer(tokens[1], 0, 10000);
    if (tokens.length !== 2 + n * 2) throw new Error('输入格式错误：需要 n 组重量和价值。');
    const dp = new Array<number>(required + 1).fill(Infinity);
    dp[0] = 0;
    for (let i = 0; i < n; i++) {
      const weight = integer(tokens[2 + i * 2], 1, 1000),
        value = integer(tokens[3 + i * 2], 0, 100);
      const previous = dp.slice();
      for (let reached = 0; reached <= required; reached++) {
        const target = Math.min(required, reached + value);
        dp[target] = Math.min(dp[target], previous[reached] + weight);
      }
    }
    return Number.isFinite(dp[required]) ? String(dp[required]) : '-1';
  }
  const n = integer(tokens[0], 0, 1000);
  if (tokens.length !== n + 1) throw new Error('输入格式错误：树的层序槽位数量必须为 n。');
  const nodes = tokens.slice(1);
  for (let i = 0; i < n; i++) {
    if (nodes[i] !== 'null') integer(nodes[i], -1e9, 1e9);
    if (i > 0 && nodes[Math.floor((i - 1) / 2)] === 'null' && nodes[i] !== 'null')
      throw new Error('输入格式错误：空节点下面不能出现非空节点。');
  }
  const orders: string[][] = [[], [], []];
  const visit = (i: number) => {
    if (i >= n || nodes[i] === 'null') return;
    orders[0].push(String(Number(nodes[i])));
    visit(i * 2 + 1);
    orders[1].push(String(Number(nodes[i])));
    visit(i * 2 + 2);
    orders[2].push(String(Number(nodes[i])));
  };
  visit(0);
  return orders.map((order) => order.join(' ')).join('\n');
}

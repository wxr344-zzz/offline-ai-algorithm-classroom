/** Reviewed executable teaching code. All helpers are local so this function can
 * also be embedded verbatim in the sandbox widget; model source is never run. */
export function computeReviewedAlgorithm(kind, input) {
  const steps = [];
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const emit = (label, explanation, state, activeIndices = [], matrix, graph) => {
    if (steps.length >= 1600) throw new Error('输入产生的步骤过多，请缩小教学输入。');
    steps.push({
      label,
      explanation,
      values: Object.entries(state).map(([k, v]) => k + ' = ' + JSON.stringify(v)),
      activeIndices,
      ...(matrix ? { matrix: copy(matrix) } : {}),
      ...(graph ? { graph: copy(graph) } : {}),
    });
  };
  const ensure = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const numbers = (value, max = 16) =>
    Array.isArray(value) && value.length <= max && value.every((v) => integer(v, -100000, 100000));
  const verify = (condition) => ensure(condition, '独立校验未通过，已停止展示此推演。');
  ensure(input && typeof input === 'object' && !Array.isArray(input), '输入必须是 JSON 对象。');
  let outcome;
  const sorting = ['insertion', 'selection', 'bubble', 'merge', 'quick', 'heap'];
  if (sorting.includes(kind)) {
    ensure(numbers(input.array), 'array 必须为最多 16 个整数，每项在 −100000 到 100000 之间。');
    const a = [...input.array];
    const snap = (label, explanation, state = {}) =>
      emit(label, explanation, { array: [...a], ...state });
    const swap = (i, j) => {
      [a[i], a[j]] = [a[j], a[i]];
    };
    snap('初始化', '保留原数组；以下状态由排序程序逐步计算。');
    if (kind === 'insertion') {
      for (let i = 1; i < a.length; i++) {
        let j = i;
        while (j > 0) {
          snap(
            '比较相邻元素',
            `比较下标 ${j - 1} 的 ${a[j - 1]} 与下标 ${j} 的 ${a[j]}；左侧前缀已有序。`,
            { i, j },
          );
          if (a[j - 1] <= a[j]) break;
          swap(j - 1, j);
          j--;
          snap('向左插入', '左邻较大，交换相邻元素，将当前元素向有序前缀内移动。', { i, j });
        }
        snap('有序前缀扩张', `下标 0 到 ${i} 已有序。`, { sortedThrough: i });
      }
    } else if (kind === 'selection') {
      for (let i = 0; i < a.length; i++) {
        let min = i;
        for (let j = i + 1; j < a.length; j++) {
          const old = min;
          if (a[j] < a[min]) min = j;
          snap('寻找未排序区最小值', `比较 ${a[j]} 与候选 ${a[old]}，当前最小值位于 ${min}。`, {
            i,
            j,
            min,
          });
        }
        swap(i, min);
        snap('确定本轮位置', `将未排序区最小值放到下标 ${i}。`, { sortedThrough: i });
      }
    } else if (kind === 'bubble') {
      for (let end = a.length - 1; end > 0; end--) {
        let changed = false;
        for (let j = 0; j < end; j++) {
          const left = a[j],
            right = a[j + 1];
          if (left > right) {
            swap(j, j + 1);
            changed = true;
          }
          snap(
            '比较并冒泡',
            `${left} ${left > right ? '>' : '≤'} ${right}，${left > right ? '交换' : '保持'}；本轮最大值向右移动。`,
            { j, end },
          );
        }
        snap(
          '本轮结束',
          `下标 ${end} 到末尾已经有序。${changed ? '' : '本轮没有交换，提前结束。'}`,
          { end },
        );
        if (!changed) break;
      }
    } else if (kind === 'merge') {
      const merge = (l, r) => {
        if (r - l <= 1) return;
        const m = Math.floor((l + r) / 2);
        snap('分解区间', `区间 [${l},${r}) 分成 [${l},${m}) 和 [${m},${r})。`, { l, m, r });
        merge(l, m);
        merge(m, r);
        const left = a.slice(l, m),
          right = a.slice(m, r),
          buffer = [];
        let i = 0,
          j = 0;
        while (i < left.length || j < right.length) {
          if (j === right.length || (i < left.length && left[i] <= right[j]))
            buffer.push(left[i++]);
          else buffer.push(right[j++]);
          snap(
            '合并到临时区',
            '取两个有序段尚未使用的较小首元素；一段耗尽后取另一段。原数组在写回前不变。',
            { l, r, left, right, i, j, buffer: [...buffer] },
          );
        }
        a.splice(l, r - l, ...buffer);
        snap('写回合并区间', `区间 [${l},${r}) 已排序。`, { l, r });
      };
      merge(0, a.length);
    } else if (kind === 'quick') {
      const quick = (l, r) => {
        if (l >= r) return;
        const pivot = a[r];
        let i = l;
        snap('选择基准', `采用 Lomuto 划分，基准为末项 ${pivot}。`, { l, r, pivot });
        for (let j = l; j < r; j++) {
          const value = a[j];
          if (value <= pivot) {
            swap(i, j);
            i++;
          }
          snap(
            '划分扫描',
            `${value} ${value <= pivot ? '≤' : '>'} ${pivot}；[${l},${i}) 内元素均不大于基准。`,
            { l, r, pivot, i, j },
          );
        }
        swap(i, r);
        snap('基准归位', `基准放在 ${i}，再分别排序两侧，不重复处理基准。`, { pivotIndex: i });
        quick(l, i - 1);
        quick(i + 1, r);
      };
      quick(0, a.length - 1);
    } else {
      const sift = (root, size) => {
        while (root * 2 + 1 < size) {
          let child = root * 2 + 1;
          if (child + 1 < size && a[child + 1] > a[child]) child++;
          snap(
            '选择较大子节点',
            `堆范围 [0,${size})，父节点 ${root} 与较大子节点 ${child} 比较。`,
            { root, child, size },
          );
          if (a[root] >= a[child]) break;
          swap(root, child);
          root = child;
          snap('下沉维护大根堆', '父节点较小，交换后继续向下维护堆。', { root, size });
        }
      };
      for (let root = Math.floor(a.length / 2) - 1; root >= 0; root--) sift(root, a.length);
      snap('建堆完成', '大根堆的根是当前范围最大值。');
      for (let end = a.length - 1; end > 0; end--) {
        swap(0, end);
        snap('取出最大值', `将堆顶最大值移到 ${end}，后缀已排序。`, { heapSize: end });
        sift(0, end);
      }
    }
    outcome = a;
    verify(JSON.stringify(a) === JSON.stringify([...input.array].sort((a, b) => a - b)));
    snap('排序完成', '已独立检查非递减顺序及原始元素、重复次数均保持一致。');
  } else if (kind === 'fibonacci') {
    ensure(integer(input.n, 0, 50), 'n 必须是 0 到 50 的整数。');
    let a = 0,
      b = 1;
    emit('初始化', 'F(0)=0，F(1)=1。', { n: input.n, a, b });
    for (let i = 2; i <= input.n; i++) {
      const value = a + b;
      emit('递推 F(' + i + ')', `${a} + ${b} = ${value}；之后滚动保存最近两项。`, {
        i,
        previous: a,
        current: b,
        next: value,
      });
      a = b;
      b = value;
    }
    outcome = input.n === 0 ? 0 : b;
    const doubling = (n) => {
      if (!n) return [0, 1];
      const [x, y] = doubling(Math.floor(n / 2)),
        c = x * (2 * y - x),
        d = x * x + y * y;
      return n % 2 ? [d, c + d] : [c, d];
    };
    verify(outcome === doubling(input.n)[0]);
    emit('递推完成', '结果通过独立的快速倍增公式校验。', { result: outcome });
  } else if (kind === 'stack' || kind === 'queue') {
    ensure(
      Array.isArray(input.operations) &&
        input.operations.length <= 40 &&
        input.operations.every((op) => typeof op === 'string' && op.length <= 40),
      'operations 必须是最多 40 条操作字符串。',
    );
    const data = [],
      outputs = [];
    emit(
      '初始化',
      kind === 'stack' ? '栈：右端为栈顶，后进先出。' : '队列：左端为队首，右端为队尾，先进先出。',
      { data, outputs },
    );
    for (const line of input.operations) {
      const [op, arg, extra] = line.trim().split(/\s+/);
      const insert = kind === 'stack' ? 'push' : 'enqueue',
        remove = kind === 'stack' ? 'pop' : 'dequeue';
      let explanation;
      if (
        op === insert &&
        extra === undefined &&
        arg !== undefined &&
        /^-?\d+$/.test(arg) &&
        integer(Number(arg), -100000, 100000)
      ) {
        data.push(Number(arg));
        explanation = `将 ${arg} 放入右端。`;
      } else if (arg === undefined && (op === remove || op === 'peek' || op === 'empty')) {
        if (op === 'empty') {
          outputs.push(!data.length);
          explanation = '检查容器是否为空，不改变内容。';
        } else if (!data.length) {
          outputs.push('空容器错误');
          explanation = '容器为空，不能读取或移除元素，内容不变。';
        } else {
          const value = kind === 'stack' ? data[data.length - 1] : data[0];
          outputs.push(value);
          if (op === remove) {
            if (kind === 'stack') data.pop();
            else data.shift();
          }
          explanation = `${op === 'peek' ? '读取但不移除' : '移除'}${kind === 'stack' ? '栈顶' : '队首'} ${value}。`;
        }
      } else throw new Error(`无效操作 ${line}。支持 ${insert} 整数、${remove}、peek、empty。`);
      emit(line, explanation, { data: [...data], outputs: [...outputs] });
    }
    outcome = { data, outputs };
  } else if (kind === 'binary') {
    ensure(
      numbers(input.array, 24) &&
        input.array.every((v, i, a) => !i || a[i - 1] <= v) &&
        integer(input.target, -100000, 100000),
      'array 必须升序，最多 24 个整数；target 必须是整数。',
    );
    let l = 0,
      r = input.array.length - 1;
    outcome = -1;
    emit('初始化闭区间', '搜索范围为 [left,right]，空区间表示不存在。', {
      array: input.array,
      target: input.target,
      left: l,
      right: r,
    });
    while (l <= r) {
      const m = Math.floor((l + r) / 2),
        value = input.array[m];
      emit('比较中点', `下标 ${m} 的值为 ${value}，与目标 ${input.target} 比较。`, {
        left: l,
        right: r,
        mid: m,
        value,
      });
      if (value === input.target) {
        outcome = m;
        break;
      }
      if (value < input.target) l = m + 1;
      else r = m - 1;
      emit(
        '缩小范围',
        value < input.target ? '中点及左侧均较小，left=mid+1。' : '中点及右侧均较大，right=mid−1。',
        { left: l, right: r },
      );
    }
    verify(
      outcome === -1 ? !input.array.includes(input.target) : input.array[outcome] === input.target,
    );
    emit('搜索完成', '返回一个匹配下标；不存在时返回 −1。', { result: outcome });
  } else if (kind === 'two-sum') {
    ensure(
      numbers(input.array, 24) && integer(input.target, -200000, 200000),
      'array 最多 24 个整数，target 为整数。',
    );
    const seen = new Map();
    outcome = [];
    emit('初始化哈希表', '先查找差值，再记录当前元素，避免同一下标被使用两次。', {
      array: input.array,
      target: input.target,
      seen: [],
    });
    for (let i = 0; i < input.array.length; i++) {
      const need = input.target - input.array[i];
      emit('查找差值', `当前 ${input.array[i]}，需要 ${need}。`, { i, need, seen: [...seen] });
      if (seen.has(need)) {
        outcome = [seen.get(need), i];
        break;
      }
      seen.set(input.array[i], i);
      emit('记录当前元素', '差值不在表中，记录值与下标后继续。', { seen: [...seen] });
    }
    let exists = false;
    for (let i = 0; i < input.array.length; i++)
      for (let j = i + 1; j < input.array.length; j++)
        if (input.array[i] + input.array[j] === input.target) exists = true;
    verify(
      outcome.length
        ? outcome[0] !== outcome[1] &&
            input.array[outcome[0]] + input.array[outcome[1]] === input.target
        : !exists,
    );
    emit('完成', '返回两个不同下标；无解返回空数组。多解时返回扫描中先找到的一对。', {
      result: outcome,
    });
  } else if (kind === 'lcs' || kind === 'kmp') {
    ensure(
      typeof input.a === 'string' &&
        typeof input.b === 'string' &&
        [...input.a].length <= (kind === 'lcs' ? 12 : 30) &&
        [...input.b].length <= (kind === 'lcs' ? 12 : 30),
      'a、b 必须为短字符串（LCS 最多 12 个字符，KMP 最多 30 个字符）。',
    );
    const a = [...input.a],
      b = [...input.b];
    if (kind === 'lcs') {
      const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
      const table = () => [
        ['前缀', '∅', ...b],
        ...dp.map((row, i) => [i ? a[i - 1] : '∅', ...row]),
      ];
      emit(
        '初始化 DP 表',
        'dp[i][j] 表示 a 前 i 个字符与 b 前 j 个字符的 LCS 长度；空前缀为 0。',
        { a: input.a, b: input.b },
        [],
        table(),
      );
      for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++) {
          dp[i][j] =
            a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
          emit(
            `计算 dp[${i}][${j}]`,
            a[i - 1] === b[j - 1]
              ? `字符 ${a[i - 1]} 相等，左上角 + 1 = ${dp[i][j]}。`
              : `字符不同，取上方与左方较大值 ${dp[i][j]}。`,
            { i, j, length: dp[i][j] },
            [],
            table(),
          );
        }
      let i = a.length,
        j = b.length;
      const result = [];
      while (i && j) {
        if (a[i - 1] === b[j - 1]) {
          result.unshift(a[--i]);
          j--;
        } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
        else j--;
        emit(
          '回溯一个最优子序列',
          '相等时收录并移向左上；否则沿较大值方向回溯，相等时优先向上。',
          { i, j, subsequence: result.join('') },
          [],
          table(),
        );
      }
      const subsequence = (x, y) => {
        let k = 0;
        for (const c of y) if (c === x[k]) k++;
        return k === x.length;
      };
      let best = 0;
      for (let mask = 0; mask < 2 ** a.length; mask++) {
        const sub = a.filter((_, k) => mask & (1 << k));
        if (sub.length > best && subsequence(sub, b)) best = sub.length;
      }
      verify(best === result.length && subsequence(result, a) && subsequence(result, b));
      outcome = { length: result.length, subsequence: result.join('') };
      emit('完成', '子序列必须在两串中保持相对顺序；结果通过独立枚举校验。', outcome, [], table());
    } else {
      const lps = Array(b.length).fill(0);
      for (let i = 1, j = 0; i < b.length; ) {
        if (b[i] === b[j]) {
          lps[i++] = ++j;
        } else if (j) {
          j = lps[j - 1];
        } else {
          lps[i++] = 0;
        }
        emit('构建前缀函数', '相等则扩张相同前后缀；失配时沿前缀函数回退，直到可扩张或长度归零。', {
          pattern: input.b,
          i,
          matched: j,
          lps: [...lps],
        });
      }
      outcome = b.length ? -1 : 0;
      for (let i = 0, j = 0; b.length && i < a.length; ) {
        const ii = i,
          jj = j;
        if (a[i] === b[j]) {
          i++;
          j++;
        } else if (j) j = lps[j - 1];
        else i++;
        emit('扫描文本', `比较文本字符 ${ii} 与模式字符 ${jj}；失配只回退模式，不倒退文本指针。`, {
          text: input.a,
          pattern: input.b,
          i,
          matched: j,
          lps,
        });
        if (j === b.length) {
          outcome = i - j;
          break;
        }
      }
      let expected = -1;
      for (let i = 0; i <= a.length - b.length; i++)
        if (b.every((v, j) => a[i + j] === v)) {
          expected = i;
          break;
        }
      verify(outcome === expected);
      emit('匹配完成', '返回首次匹配的字符下标；无匹配为 −1，空模式返回 0。', { result: outcome });
    }
  } else if (kind === 'knapsack') {
    ensure(
      numbers(input.weights, 12) &&
        numbers(input.values, 12) &&
        input.weights.length === input.values.length &&
        input.weights.every((v) => v > 0 && v <= 30) &&
        input.values.every((v) => v >= 0) &&
        integer(input.capacity, 0, 30),
      'weights、values 等长，最多 12 件；重量 1–30，价值非负；capacity 为 0–30。',
    );
    const dp = Array(input.capacity + 1).fill(0);
    emit('初始化容量表', '0/1 背包：每件物品至多一次。容量从大到小更新，以免同一物品重复使用。', {
      dp,
    });
    for (let i = 0; i < input.weights.length; i++)
      for (let c = input.capacity; c >= input.weights[i]; c--) {
        const candidate = dp[c - input.weights[i]] + input.values[i],
          old = dp[c];
        dp[c] = Math.max(old, candidate);
        emit(
          '倒序更新容量',
          `物品 ${i}，容量 ${c}：不选 ${old}，选择 ${candidate}，取 ${dp[c]}。`,
          { item: i, capacity: c, dp: [...dp] },
        );
      }
    let best = 0;
    for (let mask = 0; mask < 2 ** input.weights.length; mask++) {
      let w = 0,
        v = 0;
      input.weights.forEach((weight, i) => {
        if (mask & (1 << i)) {
          w += weight;
          v += input.values[i];
        }
      });
      if (w <= input.capacity) best = Math.max(best, v);
    }
    outcome = dp[input.capacity];
    verify(best === outcome);
    emit('完成', '最优价值已通过独立物品子集枚举校验。', { result: outcome, dp });
  } else if (
    ['bfs', 'dfs', 'dijkstra', 'astar', 'floyd', 'kruskal', 'prim', 'topological'].includes(kind)
  ) {
    const mst = kind === 'prim' || kind === 'kruskal';
    const n = input.n,
      edges = input.edges;
    ensure(
      integer(n, 1, 8) &&
        Array.isArray(edges) &&
        edges.length <= 24 &&
        edges.every(
          (e) =>
            Array.isArray(e) &&
            e.length === 3 &&
            integer(e[0], 0, n - 1) &&
            integer(e[1], 0, n - 1) &&
            integer(e[2], kind === 'dijkstra' || kind === 'astar' ? 0 : -100, 100),
        ),
      'n 为 1–8；edges 最多 24 条 [起点,终点,权重]，权重范围 −100 到 100；Dijkstra 和 A* 要求非负权。',
    );
    ensure(
      typeof input.directed === 'boolean' && (!mst || !input.directed),
      'directed 必须为布尔值；最小生成树只接受无向图。',
    );
    const start = input.start ?? 0;
    ensure(integer(start, 0, n - 1), 'start 必须是有效节点编号。');
    const arcs = input.directed
      ? edges.map((e) => [...e])
      : edges.flatMap(([u, v, w]) => [
          [u, v, w],
          [v, u, w],
        ]);
    const adj = Array.from({ length: n }, (_, u) =>
      arcs
        .filter((e) => e[0] === u)
        .map((e) => [e[1], e[2]])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    );
    const visited = new Set(),
      chosen = [];
    const graph = (current = null, edge = null) => ({
      n,
      edges,
      directed: input.directed,
      current,
      edge,
      visited: [...visited],
      chosen: copy(chosen),
    });
    const record = (label, explanation, state, current = null, edge = null, matrix) =>
      emit(label, explanation, state, [], matrix, graph(current, edge));
    const printable = (values) => values.map((v) => (Number.isFinite(v) ? v : '∞'));
    const bellman = (source) => {
      const dist = Array(n).fill(Infinity);
      dist[source] = 0;
      for (let i = 1; i < n; i++)
        for (const [u, v, w] of arcs) if (dist[u] + w < dist[v]) dist[v] = dist[u] + w;
      return dist;
    };
    if (kind === 'dfs' || kind === 'bfs') {
      const order = [],
        frontier = [start];
      visited.add(start);
      record(
        '初始化',
        `${kind.toUpperCase()} 从节点 ${start} 开始，邻居按编号升序检查；只遍历起点可达部分，边权不参与遍历。`,
        { frontier, order },
        start,
      );
      if (kind === 'bfs') {
        while (frontier.length) {
          const u = frontier.shift();
          order.push(u);
          record(
            '队首出队',
            `移除队首 ${u}，依次检查邻居。`,
            { queue: [...frontier], order: [...order] },
            u,
          );
          for (const [v] of adj[u]) {
            const fresh = !visited.has(v);
            if (fresh) {
              visited.add(v);
              frontier.push(v);
            }
            record(
              '检查邻居',
              fresh
                ? `节点 ${v} 未发现，立即标记并入队，避免重复入队。`
                : `节点 ${v} 已发现，不重复入队。`,
              { queue: [...frontier], order: [...order] },
              u,
              [u, v],
            );
          }
        }
      } else {
        const stack = [{ u: start, next: 0 }];
        order.push(start);
        while (stack.length) {
          const frame = stack[stack.length - 1];
          if (frame.next === adj[frame.u].length) {
            stack.pop();
            record(
              '回溯',
              `节点 ${frame.u} 的邻居已检查完毕，退出这一层。`,
              { stack: stack.map((f) => f.u), order: [...order] },
              frame.u,
            );
            continue;
          }
          const [v] = adj[frame.u][frame.next++];
          if (!visited.has(v)) {
            visited.add(v);
            order.push(v);
            stack.push({ u: v, next: 0 });
            record(
              '深入未访问邻居',
              `从 ${frame.u} 深入 ${v}；保留父节点下次检查的位置。`,
              { stack: stack.map((f) => f.u), order: [...order] },
              v,
              [frame.u, v],
            );
          } else
            record(
              '跳过已发现节点',
              `节点 ${v} 已发现，避免环引起重复搜索。`,
              { stack: stack.map((f) => f.u), order: [...order] },
              frame.u,
              [frame.u, v],
            );
        }
      }
      const reachable = new Set([start]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const [u, v] of arcs)
          if (reachable.has(u) && !reachable.has(v)) {
            reachable.add(v);
            changed = true;
          }
      }
      verify(
        order.length === reachable.size &&
          new Set(order).size === order.length &&
          order.every((v) => reachable.has(v)),
      );
      outcome = order;
      record('遍历完成', '工作队列或调用栈已空；已校验可达节点完整且无重复。', { result: outcome });
    } else if (kind === 'dijkstra') {
      const dist = Array(n).fill(Infinity),
        previous = Array(n).fill(null),
        queue = [[0, start]];
      dist[start] = 0;
      const state = () => ({
        distances: printable(dist),
        previous: [...previous],
        queue: queue.map((e) => [...e]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      });
      record('初始化最短路', '起点距离为 0，其余为 ∞；优先队列保存 [候选距离,节点]。', state());
      while (queue.length) {
        queue.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const before = queue.map((e) => [...e]),
          [d, u] = queue.shift();
        if (d !== dist[u] || visited.has(u)) {
          record(
            '跳过过期候选',
            `候选 (${d},${u}) 不是当前有效最短距离，不扩展。`,
            { ...state(), queueBeforePop: before },
            u,
          );
          continue;
        }
        visited.add(u);
        record(
          '弹出距离最小候选',
          `队列按距离排序，取 (${d},${u})。非负权保证此时距离可确定。`,
          { ...state(), queueBeforePop: before },
          u,
        );
        for (const [v, w] of adj[u]) {
          const old = dist[v],
            candidate = d + w;
          if (candidate < old) {
            dist[v] = candidate;
            previous[v] = u;
            queue.push([candidate, v]);
          }
          record(
            '检查并松弛边',
            `${d} + ${w} = ${candidate} ${candidate < old ? '<' : '≥'} ${Number.isFinite(old) ? old : '∞'}，${candidate < old ? '更新距离并入队' : '保持原距离'}。`,
            state(),
            u,
            [u, v, w],
          );
        }
      }
      verify(dist.every((d, i) => d === bellman(start)[i]));
      outcome = printable(dist);
      record('最短路完成', '队列为空；所有距离通过独立 Bellman-Ford 计算交叉校验，∞ 表示不可达。', {
        result: outcome,
      });
    } else if (kind === 'astar') {
      const goal = input.goal,
        h = input.heuristic;
      ensure(
        integer(goal, 0, n - 1) &&
          Array.isArray(h) &&
          h.length === n &&
          h.every((v) => integer(v, 0, 1000)),
        'goal 为有效节点编号；heuristic 必须有 n 个非负整数。',
      );
      ensure(
        h[goal] === 0 && arcs.every(([u, v, w]) => h[u] <= w + h[v]),
        '本演示采用一致启发式：h(goal)=0，且每条边满足 h(u)≤w+h(v)；不满足时不能将关闭节点视为最优。',
      );
      const g = Array(n).fill(Infinity),
        previous = Array(n).fill(null),
        open = [[h[start], 0, start]];
      g[start] = 0;
      const state = () => ({
        g: printable(g),
        h: [...h],
        f: printable(g.map((d, i) => d + h[i])),
        open: open.map((e) => [...e]).sort((a, b) => a[0] - b[0] || a[2] - b[2]),
        closed: [...visited],
      });
      record(
        '初始化 A*',
        'g 是已知起点代价，h 是到目标的估价，f=g+h；开放集条目为 [f,g,节点]。先验证启发式一致性。',
        state(),
        start,
      );
      while (open.length) {
        open.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
        const before = open.map((e) => [...e]),
          [f, d, u] = open.shift();
        if (d !== g[u] || visited.has(u)) {
          record('跳过过期开放项', `条目 (${f},${d},${u}) 已过期，不扩展。`, state(), u);
          continue;
        }
        visited.add(u);
        record(
          '取 f 最小的开放节点',
          `取节点 ${u}：g=${d}，h=${h[u]}，f=${f}。一致启发式下可以关闭该节点。`,
          { ...state(), openBeforePop: before },
          u,
        );
        if (u === goal) break;
        for (const [v, w] of adj[u]) {
          const old = g[v],
            candidate = d + w;
          if (candidate < old) {
            g[v] = candidate;
            previous[v] = u;
            open.push([candidate + h[v], candidate, v]);
          }
          record(
            '更新邻居的 g 与 f',
            `${d}+${w}=${candidate} ${candidate < old ? '<' : '≥'} ${Number.isFinite(old) ? old : '∞'}，${candidate < old ? '更新 g、前驱和开放集' : '不更新'}。`,
            state(),
            u,
            [u, v, w],
          );
        }
      }
      const path = [];
      if (Number.isFinite(g[goal]))
        for (let u = goal; u !== null && path.length <= n; u = previous[u]) path.unshift(u);
      verify(
        g[goal] === bellman(start)[goal] &&
          (!path.length ||
            (path.length <= n && path[0] === start && path[path.length - 1] === goal)),
      );
      outcome = { distance: Number.isFinite(g[goal]) ? g[goal] : '∞', path };
      record(
        'A* 搜索完成',
        path.length
          ? '目标从开放集中取出，路径最优；距离通过独立 Bellman-Ford 校验。'
          : '开放集为空，目标不可达，返回空路径。',
        outcome,
        path.length ? goal : null,
      );
    } else if (kind === 'floyd') {
      const dp = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)),
      );
      for (const [u, v, w] of arcs) dp[u][v] = Math.min(dp[u][v], w);
      const table = () => [
        ['起点/终点', ...Array.from({ length: n }, (_, i) => i)],
        ...dp.map((row, i) => [i, ...printable(row)]),
      ];
      record('初始化距离矩阵', '对角线为 0，平行边取最小权重，无边为 ∞。', {}, null, null, table());
      // Super-source Bellman-Ford detects a negative cycle anywhere in the graph.
      const referenceDistances = Array(n).fill(0);
      let negativeCycle = false;
      for (let round = 0; round < n; round++) {
        let changed = false;
        for (const [u, v, w] of arcs)
          if (referenceDistances[u] + w < referenceDistances[v]) {
            referenceDistances[v] = referenceDistances[u] + w;
            changed = true;
          }
        if (!changed) break;
        if (round === n - 1) negativeCycle = true;
      }
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const candidate = dp[i][k] + dp[k][j],
              old = dp[i][j];
            if (candidate < old) {
              dp[i][j] = candidate;
              record(
                '经中间点改进距离',
                `允许中间点 0..${k}：d[${i}][${k}] + d[${k}][${j}] = ${candidate}，小于原值 ${Number.isFinite(old) ? old : '∞'}。`,
                { k, i, j },
                k,
                [i, j],
                table(),
              );
            }
          }
        if (dp.some((row, i) => row[i] < 0)) {
          verify(negativeCycle);
          outcome = { negativeCycle: true };
          record(
            '检测到负权环',
            '存在 d[i][i] < 0，受影响节点间不存在有限最短路，停止输出有限距离。已通过独立 Bellman-Ford 环检测校验。',
            outcome,
            k,
            null,
            table(),
          );
          return { steps, outcome };
        }
        record(
          '完成一轮中间点',
          `中间点 0..${k} 已纳入，矩阵中的路径只使用这些中间点。`,
          { k },
          k,
          null,
          table(),
        );
      }
      verify(!negativeCycle && dp.every((row, i) => row.every((d, j) => d === bellman(i)[j])));
      outcome = dp.map(printable);
      record(
        '全源最短路完成',
        '每个起点均通过独立 Bellman-Ford 交叉校验。',
        { result: outcome },
        null,
        null,
        table(),
      );
    } else if (mst) {
      let total = 0;
      if (kind === 'kruskal') {
        const parent = Array.from({ length: n }, (_, i) => i),
          find = (u) => {
            while (parent[u] !== u) u = parent[u];
            return u;
          };
        const sorted = edges
          .map((e) => [...e])
          .sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
        record('按边权排序', '无向图：按权重升序检查边，并查集判断是否成环。', {
          sortedEdges: sorted,
          parent,
        });
        for (const [u, v, w] of sorted) {
          const ru = find(u),
            rv = find(v),
            accepted = ru !== rv;
          if (accepted) {
            parent[ru] = rv;
            chosen.push([u, v, w]);
            total += w;
          }
          record(
            accepted ? '接纳连接不同分量的边' : '拒绝成环边',
            `find(${u})=${ru}，find(${v})=${rv}，${accepted ? '合并两个不同分量' : '已在同一分量，添加此边会成环'}。`,
            { parent: [...parent], selectedEdges: copy(chosen), total },
            u,
            [u, v, w],
          );
        }
      } else {
        for (let root = 0; root < n; root++) {
          if (visited.has(root)) continue;
          visited.add(root);
          record(
            '开始一个连通分量',
            `从节点 ${root} 开始；断连图分别构造最小生成森林。`,
            { selectedEdges: copy(chosen), total },
            root,
          );
          while (true) {
            const candidates = arcs
              .filter(([u, v]) => visited.has(u) && !visited.has(v))
              .sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
            if (!candidates.length) break;
            const [u, v, w] = candidates[0];
            visited.add(v);
            chosen.push([u, v, w]);
            total += w;
            record(
              '选取跨割最小边',
              `候选边连接已选与未选节点；权重最小的是 ${u}—${v}（${w}），接纳并扩张集合。`,
              { candidates, selectedEdges: copy(chosen), total },
              v,
              [u, v, w],
            );
          }
        }
      }
      // Independent reference: Boruvka's cheapest outgoing edge per component.
      const parent = Array.from({ length: n }, (_, i) => i),
        find = (u) => (parent[u] === u ? u : find(parent[u]));
      let reference = 0;
      while (true) {
        const cheapest = new Map();
        for (const e of edges) {
          const a = find(e[0]),
            b = find(e[1]);
          if (a === b) continue;
          for (const r of [a, b])
            if (!cheapest.has(r) || e[2] < cheapest.get(r)[2]) cheapest.set(r, e);
        }
        let merges = 0;
        for (const [u, v, w] of cheapest.values()) {
          const a = find(u),
            b = find(v);
          if (a !== b) {
            parent[a] = b;
            reference += w;
            merges++;
          }
        }
        if (!merges) break;
      }
      verify(total === reference);
      const components = n - chosen.length;
      outcome = { edges: copy(chosen), total, components };
      record(
        '生成森林完成',
        `${components === 1 ? '图连通，得到最小生成树' : '图不连通，得到最小生成森林，不能声称所有节点已连通'}。总权重通过独立 Borůvka 计算校验。`,
        outcome,
      );
    } else {
      ensure(input.directed, '拓扑排序要求有向图。');
      const indegree = Array(n).fill(0),
        queue = [],
        order = [];
      for (const [, v] of arcs) indegree[v]++;
      indegree.forEach((d, i) => {
        if (!d) queue.push(i);
      });
      record('初始化入度', '只有入度为 0 的节点可以先执行。', {
        indegree: [...indegree],
        queue: [...queue],
      });
      while (queue.length) {
        const u = queue.shift();
        order.push(u);
        visited.add(u);
        for (const [v] of adj[u]) {
          indegree[v]--;
          if (!indegree[v]) queue.push(v);
        }
        record(
          '移除零入度节点',
          `输出 ${u}，删除其所有出边；新出现的零入度节点加入队列。`,
          { order: [...order], indegree: [...indegree], queue: [...queue] },
          u,
        );
      }
      const cycleState = Array(n).fill(0);
      const cycle = (u) => {
        if (cycleState[u] === 1) return true;
        if (cycleState[u] === 2) return false;
        cycleState[u] = 1;
        for (const [v] of adj[u]) if (cycle(v)) return true;
        cycleState[u] = 2;
        return false;
      };
      const cyclic = Array.from({ length: n }, (_, i) => i).some(cycle);
      verify(cyclic === (order.length !== n));
      if (!cyclic) verify(arcs.every(([u, v]) => order.indexOf(u) < order.indexOf(v)));
      outcome = cyclic ? null : order;
      record(
        cyclic ? '检测到环' : '拓扑排序完成',
        cyclic
          ? '输出不足 n 个节点，存在有向环，不能给出拓扑序；已用独立 DFS 环检测校验。'
          : '所有节点已输出，每条边的起点都排在终点之前。',
        { result: outcome },
      );
    }
  } else throw new Error('该算法尚未接入可信执行器，不能播放未经验证的步骤。');
  return { steps, outcome };
}

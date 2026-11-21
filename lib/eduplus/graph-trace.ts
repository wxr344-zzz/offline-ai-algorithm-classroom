import type { PublicCourse } from '@/lib/types/eduplus.generated';

export interface GraphFrame {
  nodes: number;
  edges: number[][];
  distances: string[];
  previous: Array<number | null>;
  settled: number[];
  current: number | null;
  edge: number[] | null;
  queue: number[][];
  queueTitle: string;
}
export interface GraphStep {
  label: string;
  explanation: string;
  values: string[];
  activeIndices: number[];
  graphState: GraphFrame;
}

/** Concrete graph data adapter, independent of classroom intent routing. */
export function shortestPathTrace(course: PublicCourse, inputs: Record<string, unknown>) {
  if (!/dijkstra|[迪狄]杰?斯?特?拉|狄克斯特拉/i.test(course.topic)) return null;
  const parameters = course.scenes[0].problem.entryPoint.parameters;
  const graphName = parameters.find((p) => p.name === 'graph')?.name;
  const sourceName = parameters.find((p) => p.name === 'start' || p.name === 'source')?.name;
  if (!graphName || !sourceName) return null;
  const source = inputs[sourceName];
  if (!Number.isInteger(source) || (source as number) < 0) return null;
  let n = (source as number) + 1;
  const edges: number[][] = [];
  const value = inputs[graphName];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    for (const row of value as string[]) {
      const parts = row.trim().split(/\s+/).map(Number);
      if (parts.length % 2 !== 1 || parts.some((v) => !Number.isSafeInteger(v) || v < 0))
        return null;
      n = Math.max(n, parts[0] + 1);
      for (let i = 1; i < parts.length; i += 2) {
        edges.push([parts[0], parts[i], parts[i + 1]]);
        n = Math.max(n, parts[i] + 1);
      }
    }
  } else if (typeof value === 'string') {
    let matrix: unknown;
    try {
      matrix = JSON.parse(value);
    } catch {
      return null;
    }
    if (
      !Array.isArray(matrix) ||
      !matrix.length ||
      !matrix.every(
        (row) =>
          Array.isArray(row) &&
          row.length === matrix.length &&
          row.every((w) => Number.isSafeInteger(w) && w >= 0),
      )
    )
      return null;
    n = matrix.length;
    matrix.forEach((row: number[], u: number) =>
      row.forEach((w, v) => {
        if (w > 0) edges.push([u, v, w]);
      }),
    );
  } else return null;
  if (n > 12 || (source as number) >= n || edges.length > 60) return null;
  const distances = new Array<number>(n).fill(Infinity),
    previous = new Array<number | null>(n).fill(null);
  const settled = new Set<number>(),
    queue: number[][] = [[0, source as number]],
    steps: GraphStep[] = [];
  distances[source as number] = 0;
  const sort = () => queue.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const record = (
    label: string,
    explanation: string,
    current: number | null,
    edge: number[] | null = null,
    before?: number[][],
  ) => {
    sort();
    steps.push({
      label,
      explanation,
      values: distances.map((d, i) => `节点 ${i}：${Number.isFinite(d) ? d : '∞'}`),
      activeIndices: current === null ? [] : [current],
      graphState: {
        nodes: n,
        edges,
        distances: distances.map((d) => (Number.isFinite(d) ? String(d) : '∞')),
        previous: [...previous],
        settled: [...settled],
        current,
        edge,
        queue: (before ?? queue).map((pair) => [...pair]),
        queueTitle: before ? '本次弹出前的优先队列（按距离排序）' : '候选优先队列（按距离排序）',
      },
    });
  };
  record(`初始化：起点 ${source}`, `起点 ${source} 的距离为 0，其余为 ∞。队列中只有起点。`, null);
  while (queue.length) {
    sort();
    const before = queue.map((pair) => [...pair]);
    const [distance, u] = queue.shift()!;
    if (distance !== distances[u] || settled.has(u)) {
      record(
        `丢弃节点 ${u} 的旧距离 ${distance}`,
        `队列条目 ${distance} 已过期，当前最短距离为 ${distances[u]}，不再扩展。`,
        u,
        null,
        before,
      );
      continue;
    }
    settled.add(u);
    record(
      `确定节点 ${u}：最短距离 ${distance}`,
      `弹出前队列按距离升序排列，(${distance}, 节点 ${u}) 最小。非负边权保证此时可以确定节点 ${u} 的最短距离。`,
      u,
      null,
      before,
    );
    for (const [from, v, w] of edges) {
      if (from !== u) continue;
      const old = distances[v],
        candidate = distance + w;
      if (candidate < old) {
        distances[v] = candidate;
        previous[v] = u;
        queue.push([candidate, v]);
        record(
          `松弛 ${u}→${v}：${old === Infinity ? '∞' : old} 改为 ${candidate}`,
          `比较 dist[${u}] + ${w} = ${candidate} 与旧距离 ${old === Infinity ? '∞' : old}；更小，更新节点 ${v} 并将 (${candidate}, 节点 ${v}) 入队。`,
          u,
          [u, v],
        );
      } else
        record(
          `检查 ${u}→${v}：保持 ${old === Infinity ? '∞' : old}`,
          `候选距离 ${distance} + ${w} = ${candidate}，不小于当前距离 ${old === Infinity ? '∞' : old}，无需更新。`,
          u,
          [u, v],
        );
    }
  }
  const outcome = distances.map((d) => (Number.isFinite(d) ? d : -1));
  record(
    '完成：队列为空',
    `没有待处理候选。按节点编号得到距离 ${JSON.stringify(outcome)}；-1 表示不可达。`,
    null,
  );
  return { steps, outcome };
}

/** All DOM writes use textContent; no generated scripts or HTML interpolation. */
export const GRAPH_TRACE_RUNTIME = String.raw`
function drawGraph(frame){
 const panel=el('graph-panel');if(!frame.graphState){panel.hidden=true;return;}panel.hidden=false;
 const g=frame.graphState, ns='http://www.w3.org/2000/svg';
 const svg=el('graph-svg');svg.replaceChildren();
 const add=(name,attrs,text)=>{const node=document.createElementNS(ns,name);Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,String(v)));if(text!==undefined)node.textContent=text;svg.append(node);return node;};
 const positions=Array.from({length:g.nodes},(_,i)=>{const a=2*Math.PI*i/g.nodes-Math.PI/2;return [250+180*Math.cos(a),170+125*Math.sin(a)];});
 const defs=add('defs',{}), marker=document.createElementNS(ns,'marker');marker.setAttribute('id','arrow');marker.setAttribute('viewBox','0 0 10 10');marker.setAttribute('refX','9');marker.setAttribute('refY','5');marker.setAttribute('markerWidth','6');marker.setAttribute('markerHeight','6');marker.setAttribute('orient','auto-start-reverse');const arrow=document.createElementNS(ns,'path');arrow.setAttribute('d','M 0 0 L 10 5 L 0 10 z');arrow.setAttribute('fill','#64748b');marker.append(arrow);defs.append(marker);
 g.edges.forEach(([u,v,w])=>{const [x,y]=positions[u],[xx,yy]=positions[v],length=Math.hypot(xx-x,yy-y)||1;const active=g.edge&&g.edge[0]===u&&g.edge[1]===v;
 add('line',{x1:x+23*(xx-x)/length,y1:y+23*(yy-y)/length,x2:xx-25*(xx-x)/length,y2:yy-25*(yy-y)/length,stroke:active?'#7c3aed':'#94a3b8','stroke-width':active?4:2,'marker-end':'url(#arrow)'});
 const lx=(x+xx)/2+10*(yy-y)/length,ly=(y+yy)/2-10*(xx-x)/length;add('rect',{x:lx-14,y:ly-13,width:28,height:22,fill:'#fff',rx:5});add('text',{x:lx,y:ly+3,'text-anchor':'middle',fill:'#334155','font-size':14},w);});
 positions.forEach(([x,y],i)=>{add('circle',{cx:x,cy:y,r:22,fill:i===g.current?'#ddd6fe':g.settled.includes(i)?'#dcfce7':'#fff',stroke:i===g.current?'#7c3aed':'#64748b','stroke-width':2});add('text',{x,y:y+5,'text-anchor':'middle',fill:'#172033','font-size':17},i);});
 el('queue-title').textContent=g.queueTitle;el('queue-values').textContent=g.queue.length?g.queue.map(([d,u],i)=>(i===0?'最小 → ':'')+'(距离 '+d+', 节点 '+u+')').join('  |  '):'空队列';
 const table=el('distance-rows');table.replaceChildren();g.distances.forEach((d,i)=>{const tr=document.createElement('tr');[i,d,g.previous[i]===null?'—':g.previous[i],g.settled.includes(i)?'已确定':'候选/未到达'].forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td);});table.append(tr);});
}
`;

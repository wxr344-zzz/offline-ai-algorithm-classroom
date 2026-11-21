/** Maintained minimax search: a cutoff is emitted only after alpha >= beta. */
export type SearchTree = number | SearchTree[];
interface SearchNode {
  id: string;
  parent: string | null;
  role: 'MAX' | 'MIN' | '叶子';
  children: string[];
  leaf?: number;
}
export interface SearchFrame {
  label: string;
  explanation: string;
  current: string;
  alpha: number;
  beta: number;
  visited: string[];
  pruned: string[];
  scores: Record<string, number>;
}
export function alphaBetaTrace(tree: SearchTree, maximizing = true) {
  const nodes: SearchNode[] = [];
  function build(value: SearchTree, parent: string | null, max: boolean): string {
    if (nodes.length >= 100) throw new Error('教学树不能超过 100 个节点。');
    const id = String(nodes.length);
    const node: SearchNode = {
      id,
      parent,
      role: Array.isArray(value) ? (max ? 'MAX' : 'MIN') : '叶子',
      children: [],
    };
    nodes.push(node);
    if (Array.isArray(value)) {
      if (!value.length) throw new Error('内部节点至少需要一个子节点。');
      node.children = value.map((child) => build(child, id, !max));
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error('叶子必须是有限数值。');
      node.leaf = value;
    }
    return id;
  }
  build(tree, null, maximizing);
  const frames: SearchFrame[] = [],
    visited = new Set<string>(),
    pruned = new Set<string>();
  const scores: Record<string, number> = {};
  const bound = (n: number) => (n === Infinity ? '+∞' : n === -Infinity ? '−∞' : String(n));
  function emit(label: string, explanation: string, current: string, alpha: number, beta: number) {
    frames.push({
      label,
      explanation,
      current,
      alpha,
      beta,
      visited: [...visited],
      pruned: [...pruned],
      scores: { ...scores },
    });
  }
  function prune(id: string) {
    pruned.add(id);
    nodes[Number(id)].children.forEach(prune);
  }
  function search(id: string, alpha: number, beta: number): number {
    const node = nodes[Number(id)];
    visited.add(id);
    emit(
      '进入节点 ' + id,
      `节点 ${id}（${node.role}）继承 α=${bound(alpha)}，β=${bound(beta)}。从左到右搜索。`,
      id,
      alpha,
      beta,
    );
    if (node.leaf !== undefined) {
      scores[id] = node.leaf;
      emit('叶子求值', `叶子 ${id} 的收益为 ${node.leaf}，返回父节点。`, id, alpha, beta);
      return node.leaf;
    }
    let best = node.role === 'MAX' ? -Infinity : Infinity;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const value = search(child, alpha, beta);
      best = node.role === 'MAX' ? Math.max(best, value) : Math.min(best, value);
      if (node.role === 'MAX') alpha = Math.max(alpha, best);
      else beta = Math.min(beta, best);
      scores[id] = best;
      const remaining = node.children.slice(i + 1);
      emit(
        '回传并更新边界',
        `子节点 ${child} 返回 ${value}；${node.role} 取${node.role === 'MAX' ? '最大' : '最小'}值 ${best}，更新 ${node.role === 'MAX' ? 'α' : 'β'}。当前 α=${bound(alpha)}，β=${bound(beta)}。`,
        id,
        alpha,
        beta,
      );
      if (alpha >= beta && remaining.length) {
        remaining.forEach(prune);
        emit(
          '剪枝',
          `α=${bound(alpha)} ≥ β=${bound(beta)}：满足剪枝条件。节点 ${id} 的剩余分支 ${remaining.join('、')} 不会影响祖先的选择，跳过这些分支。`,
          id,
          alpha,
          beta,
        );
        break;
      }
      if (remaining.length)
        emit(
          '继续搜索',
          `α=${bound(alpha)} < β=${bound(beta)}，不满足剪枝条件，继续访问下一个子节点 ${remaining[0]}。`,
          id,
          alpha,
          beta,
        );
    }
    emit(
      '返回节点值',
      `节点 ${id} 返回当前${node.role === 'MAX' ? '最大' : '最小'}值 ${best}。被剪枝节点未被求值；剪枝分支内的返回值可能只是边界。`,
      id,
      alpha,
      beta,
    );
    return best;
  }
  const outcome = search('0', -Infinity, Infinity);
  emit(
    '搜索完成',
    `根节点的 Minimax 值为 ${outcome}。灰色虚线节点未被访问；只有 α ≥ β 时才剪枝。`,
    '0',
    frames.at(-1)!.alpha,
    frames.at(-1)!.beta,
  );
  return { nodes, frames, outcome };
}

/** A real game tree, explicitly separate from any generated programming exercise. */
export function alphaBetaSimulation(topic: string): string {
  const tree: SearchTree = [
    [3, 5],
    [2, 9],
    [4, 6],
  ];
  const trace = alphaBetaTrace(tree);
  // JSON cannot represent infinities; serialize bounds explicitly for display.
  const payload = JSON.stringify({ topic, tree, ...trace }, (_key, value) =>
    value === Infinity ? '+∞' : value === -Infinity ? '−∞' : value,
  )
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;padding:12px;color:#172033;background:#f8fafc;font:15px system-ui}main{max-width:1000px;margin:auto}h1{font-size:22px;margin:0 0 8px}h2{font-size:20px;margin:4px 0 8px}p{line-height:1.5;margin:8px 0}button{font:inherit;padding:7px 12px;margin:4px;border:1px solid #94a3b8;border-radius:9px;background:white;cursor:pointer}button:disabled{opacity:.4}.panel{padding:12px;border:1px solid #cbd5e1;border-radius:12px;margin:10px 0;background:white}#position{width:100%}#tree{overflow-x:auto;padding:4px 0}ul{display:flex;justify-content:center;list-style:none;padding:0;margin:12px 0 0;gap:10px}li{text-align:center;flex:1;min-width:80px;position:relative}li:before{content:'';position:absolute;left:50%;top:-12px;height:12px;border-left:1px solid #94a3b8}#tree>ul>li:before{display:none}.node{display:inline-block;padding:6px;border:1px solid #94a3b8;border-radius:9px;white-space:pre-line;background:white;font-size:14px}.visited{background:#dcfce7}.current{background:#ddd6fe;border:2px solid #7c3aed}.pruned{background:#e2e8f0;border-style:dashed;color:#475569}#feedback,pre{background:#e2e8f0;padding:10px;border-radius:10px}pre{white-space:pre-wrap}</style><main id="experiment">
<h1 id="title"></h1><p>从左到右搜索这棵教学博弈树：MAX 取子节点最大值，MIN 取最小值。α 是 MAX 已知的下界，β 是 MIN 已知的上界；每次回传后更新边界，只有 α ≥ β 才跳过当前节点的剩余分支。</p>
<details><summary>教学搜索树与结果（独立于编程题输入）</summary><pre id="example"></pre></details>
<div><button id="back">上一步</button><button id="next">下一步</button><button id="auto">自动演示</button><button id="pause">暂停</button><button id="reset">重新开始</button></div>
<input id="position" type="range" min="0" value="0" aria-label="推演进度"><section class="panel"><h2 id="step-title"></h2><p id="explanation"></p><p id="bounds"></p><p>紫色：当前节点；绿色：已访问；灰色虚线：已剪枝、未求值。节点数字为编号，叶子收益单独标注。</p><div id="tree" aria-label="MAX MIN 博弈树"></div></section><div id="feedback" role="status" aria-live="polite"></div>
<script>(()=>{'use strict';const data=${payload},el=id=>document.getElementById(id);let index=0,timer=null;
el('title').textContent=data.topic+'：状态变化推演';el('example').textContent='教学树（根为 MAX，下一层为 MIN）：'+JSON.stringify(data.tree)+'\\nMinimax 值：'+data.outcome;el('position').max=String(data.frames.length-1);
function stop(){if(timer!==null){clearInterval(timer);timer=null;}}
function draw(id,frame){const node=data.nodes[Number(id)],li=document.createElement('li'),box=document.createElement('div');box.className='node'+(frame.pruned.includes(id)?' pruned':frame.current===id?' current':frame.visited.includes(id)?' visited':'');box.dataset.node=id;box.textContent='节点 '+id+' · '+node.role+'\\n'+(frame.pruned.includes(id)?'已剪枝（未求值）':node.role==='叶子'?'收益 '+node.leaf:frame.scores[id]!==undefined?'当前值 '+frame.scores[id]:'未求值');li.append(box);if(node.children.length){const ul=document.createElement('ul');node.children.forEach(child=>ul.append(draw(child,frame)));li.append(ul);}return li;}
function show(){const f=data.frames[index];el('step-title').textContent=(index+1)+' / '+data.frames.length+' · '+f.label;el('explanation').textContent=f.explanation;el('bounds').textContent='当前节点 '+f.current+'：α = '+f.alpha+'，β = '+f.beta;const ul=document.createElement('ul');ul.append(draw('0',f));el('tree').replaceChildren(ul);el('back').disabled=index===0;el('next').disabled=index===data.frames.length-1;el('position').value=String(index);el('feedback').textContent=index===data.frames.length-1?'推演结束，结果：'+data.outcome:'当前步骤：'+f.label;if(typeof window.publishState==='function')window.publishState({topic:data.topic,mode:'simulation',step:index,total:data.frames.length,summary:f.explanation});}
el('back').onclick=()=>{stop();if(index>0)index--;show();};el('next').onclick=()=>{if(index<data.frames.length-1)index++;if(index===data.frames.length-1)stop();show();};el('position').oninput=e=>{stop();index=Number(e.target.value);show();};el('auto').onclick=()=>{if(timer===null&&index<data.frames.length-1)timer=setInterval(()=>el('next').click(),1000);};el('pause').onclick=stop;el('reset').onclick=()=>{stop();index=0;show();};window.addEventListener('pagehide',stop);show();})();</script></main></html>`;
}

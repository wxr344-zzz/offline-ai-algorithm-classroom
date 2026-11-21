import type { PublicCourse } from '@/lib/types/eduplus.generated';
import type { ClassroomTeaching } from '@/lib/types/eduplus-teaching.generated';
import { alphaBetaSimulation, alphaBetaTrace } from './alpha-beta-simulation';
import { simulationPreview } from './simulation-preview';
import {
  computeReviewedAlgorithm,
  resolveReviewedAlgorithm,
  hasUnreviewedVariant,
} from './reviewed-algorithms';

const escapeJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
const alphaTopic = /alpha[\s_‐‑–—-]*beta|α[\s-]*β|阿尔[法弗].*贝塔/i;

/** Legacy export compatibility only. Classroom generation/playback now uses
 * simulation-preview + ExamSimulator and the maintained Python registry. */
export function algorithmWidget(
  course: PublicCourse,
  _teaching: ClassroomTeaching,
  kind: 'simulation' | 'game',
): string {
  return algorithmWidgetForTopic(course.topic, kind);
}

export function algorithmWidgetForTopic(topic: string, kind: 'simulation' | 'game'): string {
  const course = { topic };
  if (hasUnreviewedVariant(topic)) return unavailable(topic);
  const alpha = alphaTopic.test(course.topic);
  const descriptor = resolveReviewedAlgorithm(course.topic);
  if (alpha && descriptor) return unavailable(course.topic);
  if (alpha && kind === 'simulation') return alphaBetaSimulation(course.topic);
  if (!alpha && !descriptor) return unavailable(course.topic);
  const id = alpha ? 'alpha-beta' : descriptor!.id;
  const alphaInput = {
    tree: [
      [3, 5],
      [2, 9],
      [4, 6],
    ],
  };
  const input = alpha ? alphaInput : descriptor!.input;
  // Fail closed before saving HTML if a reviewed default itself cannot execute.
  if (alpha) alphaBetaTrace(alphaInput.tree);
  else computeReviewedAlgorithm(id, input);
  const data = escapeJson({
    topic: course.topic,
    id,
    input,
    game: kind === 'game',
    name: alpha ? 'Alpha-Beta 剪枝' : descriptor!.name,
  });
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;padding:14px;color:#172033;background:#f8fafc;font:15px system-ui}main{max-width:1100px;margin:auto}h1{font-size:23px;margin:0 0 8px}h2{font-size:19px;margin:6px 0}p{line-height:1.5;margin:8px 0}button{font:inherit;padding:7px 12px;margin:4px;border:1px solid #94a3b8;border-radius:8px;background:white;cursor:pointer}button:disabled{opacity:.4}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#e2e8f0;border-radius:8px;padding:10px}textarea{width:100%;font:14px monospace;padding:8px;min-height:75px}.panel{padding:12px;border:1px solid #cbd5e1;border-radius:10px;margin:10px 0;background:white}#position{width:100%}.cells{display:flex;gap:8px;flex-wrap:wrap}.cell{padding:8px;border:1px solid #cbd5e1;border-radius:8px;overflow-wrap:anywhere;max-width:100%;white-space:pre-wrap}table{border-collapse:collapse;margin:10px 0}th,td{border:1px solid #cbd5e1;padding:5px;text-align:center}#matrix{overflow:auto}#graph-svg{width:100%;max-height:230px}#feedback{padding:10px;background:#e2e8f0;border-radius:8px}#sequence{min-height:65px;border:2px dashed #94a3b8;padding:10px}#cards button{text-align:left}#graph[hidden],#challenge[hidden],#controls[hidden],#position[hidden]{display:none}</style></head><body><main id="experiment">
<h1 id="title"></h1><p id="intro"></p><details><summary>修改教学输入（与编程题独立）</summary><p>使用下面的 JSON 参数；输入不满足算法前提时会明确拒绝，不会继续播放旧步骤。</p><textarea id="reviewed-input" aria-label="教学输入"></textarea><button id="apply-input">应用输入并重新推演</button></details>
<details><summary>当前教学输入与计算结果</summary><pre id="example"></pre></details><div id="controls"><button id="back">上一步</button><button id="next">下一步</button><button id="auto">自动演示</button><button id="pause">暂停</button><button id="reset">重新开始</button></div><input id="position" type="range" min="0" value="0" aria-label="推演进度">
<section id="trace-panel" class="panel"><h2 id="step-title"></h2><p id="explanation"></p><section id="graph" hidden><svg id="graph-svg" viewBox="0 0 520 300" role="img" aria-label="算法图结构"></svg><p>紫色：当前节点／边；绿色：已发现或已选节点。生成树选边用粗线标记；有向边带箭头。</p></section><div id="values" class="cells"></div><div id="matrix"></div></section>
<section id="challenge" class="panel" hidden><h2>将算法步骤按执行顺序排列</h2><p>卡片包含具体状态和操作。相同的可见步骤可互换；点击已选区最后一张卡可撤回。</p><div id="cards"></div><div id="sequence" aria-label="已排列步骤"></div><button id="check">检查步骤顺序</button><button id="undo">撤回一步</button></section><div id="feedback" role="status" aria-live="polite"></div>
</main><script>(()=>{'use strict';const data=${data};const computeReviewedAlgorithm=${computeReviewedAlgorithm.toString()};const alphaBetaTrace=${alphaBetaTrace.toString()};
const el=id=>document.getElementById(id);let frames=[],outcome,index=0,timer=null,selected=[],valid=false;
function compute(input){if(data.id!=='alpha-beta')return computeReviewedAlgorithm(data.id,input);const trace=alphaBetaTrace(input.tree);const bound=v=>v===Infinity?'+∞':v===-Infinity?'−∞':String(v);return {outcome:trace.outcome,steps:trace.frames.map(f=>({label:f.label,explanation:f.explanation,values:['当前节点 '+f.current,'α = '+bound(f.alpha),'β = '+bound(f.beta),'已访问 '+JSON.stringify(f.visited),'已剪枝 '+JSON.stringify(f.pruned),'已求值 '+JSON.stringify(f.scores)],activeIndices:[]}))};}
function stop(){if(timer!==null){clearInterval(timer);timer=null;}}
function drawGraph(g){el('graph').hidden=!g;const svg=el('graph-svg');svg.replaceChildren();if(!g)return;const ns='http://www.w3.org/2000/svg',add=(tag,attrs,text)=>{const node=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,String(v)));if(text!==undefined)node.textContent=String(text);svg.append(node);return node;};const positions=Array.from({length:g.n},(_,i)=>{const a=2*Math.PI*i/g.n-Math.PI/2;return [260+185*Math.cos(a),150+115*Math.sin(a)];});const defs=add('defs',{}),marker=document.createElementNS(ns,'marker');Object.entries({id:'arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'}).forEach(([k,v])=>marker.setAttribute(k,String(v)));const arrow=document.createElementNS(ns,'path');arrow.setAttribute('d','M 0 0 L 10 5 L 0 10 z');arrow.setAttribute('fill','#64748b');marker.append(arrow);defs.append(marker);g.edges.forEach(([u,v,w])=>{const [x,y]=positions[u],[xx,yy]=positions[v],len=Math.hypot(xx-x,yy-y)||1,active=g.edge&&g.edge[0]===u&&g.edge[1]===v&&(g.edge.length<3||g.edge[2]===w),chosen=g.chosen.some(e=>e[2]===w&&((e[0]===u&&e[1]===v)||(!g.directed&&e[1]===u&&e[0]===v)));if(u===v){add('circle',{cx:x+20,cy:y-15,r:15,fill:'none',stroke:active?'#7c3aed':'#94a3b8'});}else add('line',{x1:x+20*(xx-x)/len,y1:y+20*(yy-y)/len,x2:xx-24*(xx-x)/len,y2:yy-24*(yy-y)/len,stroke:active?'#7c3aed':chosen?'#16a34a':'#94a3b8','stroke-width':active||chosen?4:1.5,...(g.directed?{'marker-end':'url(#arrow)'}:{})});add('text',{x:(x+xx)/2+10,y:(y+yy)/2-7,'font-size':13,fill:'#334155'},w);});positions.forEach(([x,y],i)=>{add('circle',{cx:x,cy:y,r:20,fill:i===g.current?'#ddd6fe':g.visited.includes(i)?'#dcfce7':'white',stroke:'#64748b'});add('text',{x,y:y+5,'text-anchor':'middle'},i);});}
function show(){if(!valid)return;const f=frames[index];el('step-title').textContent=(index+1)+' / '+frames.length+' · '+f.label;el('explanation').textContent=f.explanation;el('values').replaceChildren();f.values.forEach(value=>{const node=document.createElement('div');node.className='cell';node.textContent=value;el('values').append(node);});drawGraph(f.graph);el('matrix').replaceChildren();if(f.matrix){const table=document.createElement('table');f.matrix.forEach((row,i)=>{const tr=document.createElement('tr');row.forEach(value=>{const cell=document.createElement(i?'td':'th');cell.textContent=String(value);tr.append(cell);});table.append(tr);});el('matrix').append(table);}el('position').max=String(frames.length-1);el('position').value=String(index);el('back').disabled=index===0;el('next').disabled=index===frames.length-1;el('feedback').textContent=index===frames.length-1?'推演结束，结果：'+JSON.stringify(outcome):'当前步骤：'+f.label;if(typeof window.publishState==='function')window.publishState({topic:data.topic,mode:data.game?'game':'simulation',step:index,total:frames.length,values:f.values,summary:f.explanation});}
function add(i){if(!valid||!Number.isInteger(i)||i<0||i>=frames.length||selected.includes(i))return;selected.push(i);index=i;drawGame();show();}
function drawGame(){el('cards').replaceChildren();el('sequence').replaceChildren();if(!valid||!data.game)return;[...frames.keys()].reverse().forEach(i=>{if(selected.includes(i))return;const card=document.createElement('button');card.textContent=frames[i].label+' — '+frames[i].explanation+' ['+frames[i].values.join('，')+']';card.draggable=true;card.onclick=()=>add(i);card.ondragstart=e=>e.dataTransfer.setData('text/plain',String(i));el('cards').append(card);});selected.forEach((i,p)=>{const card=document.createElement('button');card.textContent=(p+1)+'. '+frames[i].label+' ['+frames[i].values.join('，')+']';card.onclick=()=>{if(p===selected.length-1){selected.pop();drawGame();}};el('sequence').append(card);});}
function apply(){stop();valid=false;frames=[];selected=[];el('values').replaceChildren();el('matrix').replaceChildren();drawGraph(null);el('step-title').textContent='';el('explanation').textContent='';el('example').textContent='';try{const text=el('reviewed-input').value;if(text.length>12000)throw new Error('教学输入过长。');const input=JSON.parse(text),result=compute(input);frames=result.steps;outcome=result.outcome;if(!frames.length)throw new Error('没有可展示的计算步骤。');valid=true;index=0;el('reviewed-input').setAttribute('aria-invalid','false');el('trace-panel').hidden=false;el('example').textContent='教学输入：'+JSON.stringify(input,null,2)+'\\n独立计算结果：'+JSON.stringify(outcome);drawGame();show();}catch(error){el('trace-panel').hidden=true;el('reviewed-input').setAttribute('aria-invalid','true');el('feedback').textContent='输入错误，已停止推演：'+error.message;drawGame();}el('back').disabled=!valid||index===0;el('next').disabled=!valid||index===frames.length-1;el('auto').disabled=!valid;el('check').disabled=!valid;el('position').disabled=!valid;}
el('title').textContent=data.topic+(data.game?'：算法步骤挑战':'：状态变化推演');el('intro').textContent='本页演示 '+data.name+' 的标准版本。按步骤观察条件判断与状态变化；展开修改教学输入后，可重新计算完整过程。教学输入与编程题独立。';el('reviewed-input').value=JSON.stringify(data.input,null,2);el('apply-input').onclick=apply;el('back').onclick=()=>{stop();if(index>0)index--;show();};el('next').onclick=()=>{if(valid&&index<frames.length-1)index++;if(index===frames.length-1)stop();show();};el('position').oninput=e=>{stop();index=Number(e.target.value);show();};el('auto').onclick=()=>{if(valid&&timer===null&&index<frames.length-1)timer=setInterval(()=>el('next').click(),1000);};el('pause').onclick=stop;el('reset').onclick=()=>{stop();if(!valid)return;index=0;selected=[];drawGame();show();};el('sequence').ondragover=e=>e.preventDefault();el('sequence').ondrop=e=>{e.preventDefault();add(Number(e.dataTransfer.getData('text/plain')));};el('undo').onclick=()=>{selected.pop();drawGame();};el('check').onclick=()=>{stop();if(selected.length!==frames.length)el('feedback').textContent='请先排列全部 '+frames.length+' 个步骤。';else{const same=f=>JSON.stringify([f.label,f.explanation,f.values,f.matrix,f.graph]);const wrong=selected.findIndex((i,p)=>same(frames[i])!==same(frames[p]));el('feedback').textContent=wrong<0?'挑战完成！步骤顺序正确，请解释每一次状态变化。':'第 '+(wrong+1)+' 步顺序不一致，请根据算法逻辑重新排列。';}};el('challenge').hidden=!data.game;el('controls').hidden=data.game;el('position').hidden=data.game;window.addEventListener('pagehide',stop);apply();})();</script></body></html>`;
}

function unavailable(topic: string): string {
  return simulationPreview(topic);
}

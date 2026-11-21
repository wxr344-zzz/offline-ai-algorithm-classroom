import type { PublicCourse } from '@/lib/types/eduplus.generated';

/** Rendering adapters are independent of course routing. Unknown topics still use validated traces. */
export function liveSimulationKind(course: PublicCourse): 'fibonacci' | 'stack' | null {
  const parameters = course.scenes[0]?.problem.entryPoint.parameters;
  if (
    /斐波那契|fibonacci/i.test(course.topic) &&
    parameters?.length === 1 &&
    parameters[0].type === 'int'
  )
    return 'fibonacci';
  if (/\bstack\b|栈/i.test(course.topic) && !/调用栈|堆栈溢出/.test(course.topic)) return 'stack';
  return null;
}

/** Maintained, bounded browser code; no eval, model scripts or private reference solutions. */
export const LIVE_SIMULATION_RUNTIME = String.raw`
function computeLive(kind,input){
  const steps=[];
  if(kind==='fibonacci'){
    if(!Number.isInteger(input)||input<0||input>50)throw new Error('n 必须是 0 到 50 之间的整数。');
    if(input===0)return {steps:[{label:'基例 F(0)',explanation:'n=0，直接返回 0。',values:['n=0','F(0)=0'],activeIndices:[1]}],outcome:0};
    let a=0,b=1;
    steps.push({label:'初始化 F(0) 与 F(1)',explanation:'保存两个初始状态：F(0)=0，F(1)=1。',values:['F(0)=0','F(1)=1'],activeIndices:[0,1]});
    for(let i=2;i<=input;i++){
      const c=a+b;
      steps.push({label:'计算 F('+i+')',explanation:'F('+i+') = F('+(i-1)+') + F('+(i-2)+') = '+b+' + '+a+' = '+c,values:['F('+(i-2)+')='+a,'F('+(i-1)+')='+b,'F('+i+')='+c],activeIndices:[2]});
      a=b;b=c;
    }
    return {steps,outcome:b};
  }
  const lines=input.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length||lines.length>100)throw new Error('请输入 1 到 100 条栈操作。');
  const stack=[],outputs=[];
  steps.push({label:'初始化空栈',explanation:'栈采用后进先出规则，右侧为栈顶。',values:['空栈'],activeIndices:[]});
  for(const [i,line] of lines.entries()){
    const parts=line.split(/\s+/),op=parts[0].toLowerCase();let message;
    if(op==='push'&&parts.length===2&&/^-?\d+$/.test(parts[1])){
      const value=Number(parts[1]);if(!Number.isSafeInteger(value)||Math.abs(value)>1000000)throw new Error('push 的整数范围为 -1000000 到 1000000。');
      stack.push(value);message='将 '+value+' 压入栈顶。';
    }else if(op==='pop'&&parts.length===1){
      if(stack.length){const value=stack.pop();outputs.push(value);message='弹出栈顶 '+value+'。';}
      else{outputs.push('空栈错误');message='栈为空，不能弹出元素；必须先检查空栈。';}
    }else if(op==='peek'&&parts.length===1){
      const value=stack.length?stack[stack.length-1]:'空栈错误';outputs.push(value);message='查看栈顶：'+value+'，不移除元素。';
    }else if((op==='empty'||op==='isempty')&&parts.length===1){const value=stack.length===0;outputs.push(value);message='栈是否为空：'+value+'。';}
    else throw new Error('第 '+(i+1)+' 行无效。支持 push 整数、pop、peek、empty。');
    steps.push({label:'操作 '+(i+1)+'：'+line,explanation:message,values:stack.length?stack.map((v,j)=>(j===stack.length-1?'栈顶 ':'')+v):['空栈'],activeIndices:stack.length?[stack.length-1]:[]});
  }
  return {steps,outcome:{stack,outputs}};
}
`;

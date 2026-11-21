// Fixed runtime; generated Python never executes in Node or host Python.
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
if(isMainThread) {
  let raw='';
  for await(const part of process.stdin) { raw+=part; if(raw.length>2000000) throw new Error('Payload too large'); }
  const worker=new Worker(new URL(import.meta.url),{workerData:JSON.parse(raw),env:{},
    resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
  const timeout=setTimeout(()=>{void worker.terminate();process.stdout.write(JSON.stringify({error:'执行超时（35秒）'}));},35000);
  worker.once('message',result=>{clearTimeout(timeout);process.stdout.write(JSON.stringify(result));void worker.terminate();});
  worker.once('error',()=>{clearTimeout(timeout);process.stdout.write(JSON.stringify({error:'WASM执行器异常',kind:'runtime'}));});
} else {
  let initialized=false;
  try {
    const {loadPyodide}=await import('../public/vendor/eduplus/pyodide/pyodide.mjs');
    const py=await loadPyodide({indexURL:fileURLToPath(new URL('../public/vendor/eduplus/pyodide/',import.meta.url)),
      stdout:()=>{},stderr:()=>{},jsglobals:{}});
    initialized=true;
    const source=await readFile(new URL('../public/eduplus-runtime/worker.js',import.meta.url),'utf8');
    const jobs=[];
    for(const job of workerData) {
      let response, failure;
      const self={loadPyodide:async()=>py,postMessage:msg=>{if(msg.type==='result')response=msg.result;if(msg.type==='error')failure=msg.message;}};
      vm.runInNewContext(source,{self,importScripts:()=>{}},{timeout:1000});
      await self.onmessage({data:{type:'init',assetBase:'local/'}});
      await self.onmessage({data:{type:'run',payload:{...job,mode:'function',limit:100000}}});
      if(!response) throw new Error(failure||'缺少执行结果');
      jobs.push(response.cases);
    }
    parentPort.postMessage({jobs});
  } catch(error) {parentPort.postMessage({error:String(error.message??error).slice(-1600),kind:initialized?'execution':'runtime'});}
}

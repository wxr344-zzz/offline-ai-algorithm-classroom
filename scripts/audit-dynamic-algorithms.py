"""Exercise genuinely uncatalogued algorithms through live generation and WASM.

No supplied implementation, expected answers, or registry mutation is accepted.
Private accepted proofs stay in workspace logs; stdout contains only metrics.
"""
import asyncio
import hashlib
import json
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from exam_simulator import resolve
from exam_simulator.generated import dynamic_trace,CACHE,source_digest
from executable_lessons import verified_program_contract,compile_drafts,ApplicationLabels
from lesson_execution import verify_drafts

async def audit(topic):
    if resolve(topic):raise ValueError('Audit requires an algorithm outside the registry: '+topic)
    started=time.monotonic()
    trace=await asyncio.wait_for(dynamic_trace(topic,scope='dynamic-pipeline-audit'),600)
    assert trace['engine']=='python-sandbox' and trace['verified']
    program,oracle,digest=CACHE[trace['algorithm']]
    assert digest==source_digest(program,oracle)
    contract=await verified_program_contract(program,oracle,digest,trace['algorithm'])
    labels=ApplicationLabels(location='算法实验室',actor='学习者',record='算法任务',summary='frequencies')
    drafts=compile_drafts(contract,labels)
    cases=await verify_drafts(*drafts)
    proof={'kind':'independent-execution','program':program.model_dump(mode='json'),'oracle':oracle,'sourceHash':digest}
    key=hashlib.sha256(topic.encode()).hexdigest()[:12]
    Path(f'logs/dynamic-audit-{key}-proof.json').write_text(json.dumps(proof,ensure_ascii=False),encoding='utf-8')
    report={'topic':topic,'catalogued':False,'engine':trace['engine'],'verified':True,
        'title':trace['title'],'elapsedSeconds':round(time.monotonic()-started,2),
        'frames':len(trace['frames']),'independentInputs':len(program.validation_inputs),
        'labCasesPassed':cases,'sourceHash':digest,'input':trace['input'],'outcome':trace['outcome']}
    Path(f'logs/dynamic-audit-{key}-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report

async def main():
    for topic in sys.argv[1:]:
        try:print(json.dumps(await audit(topic),ensure_ascii=False),flush=True)
        except Exception as exc:
            print(json.dumps({'topic':topic,'accepted':False,'error':str(exc)[-1400:]},ensure_ascii=False),flush=True)
            raise

if __name__=='__main__':asyncio.run(main())

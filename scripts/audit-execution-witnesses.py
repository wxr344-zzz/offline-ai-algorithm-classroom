"""Replay saved course proofs against separately reviewed acceptance witnesses."""
import asyncio
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from exam_simulator.generated import replay_execution_proof
from lesson_execution import equivalent

async def main():
    assets=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    if assets.get('kind')=='independent-execution':
        proof=assets
    else:
        lines=assets['privateOutput']['problem']['pytest_source'].splitlines()
        proof=json.loads(next(line.split(': ',1)[1] for line in lines if line.startswith('# executable-contract-verification: ')))
    cases=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
    report=[]
    for case in cases:
        trace=await replay_execution_proof(proof,case['input'])
        assert equivalent(trace['outcome'],case['expected']),case['name']
        report.append({'name':case['name'],'outcome':trace['outcome'],'frames':len(trace['frames']),'verified':trace['verified']})
    Path('logs/execution-witness-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':asyncio.run(main())

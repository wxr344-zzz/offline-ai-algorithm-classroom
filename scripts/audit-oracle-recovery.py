"""Replay a private generation diagnostic through the real checker repair path."""
import asyncio,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from exam_simulator.generated import GeneratedAlgorithm,AlgorithmDefinition,generate_oracle,sandbox,source_digest
from ollama_provider import OllamaProvider

async def main():
    diagnostic=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    program=GeneratedAlgorithm.model_validate(diagnostic['program'])
    definition=AlgorithmDefinition.model_validate(diagnostic['definition'])
    async with OllamaProvider(timeout=180,prefer_streaming=True) as provider:
        oracle=await generate_oracle(provider,program,diagnostic['topic'],
            diagnostic['failure'],diagnostic['checkerSource'],definition=definition)
    inputs={json.dumps(x,sort_keys=True):x for x in program.validation_inputs+oracle.validation_inputs}
    program=program.model_copy(update={'validation_inputs':list(inputs.values())})
    result=await sandbox(program,oracle.source,program.default_input)
    proof={'kind':'independent-execution','program':program.model_dump(mode='json'),
        'oracle':oracle.source,'sourceHash':source_digest(program,oracle.source)}
    destination=Path(sys.argv[1]).with_name('recovered-execution-proof.json')
    destination.write_text(json.dumps(proof,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'verified':True,'independentInputs':len(inputs),'outcome':result['outcome'],
        'frames':len(result['snapshots']),'proof':str(destination)},ensure_ascii=False))

if __name__=='__main__':asyncio.run(main())

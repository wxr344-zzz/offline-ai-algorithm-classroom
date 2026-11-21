"""Re-check saved public/private assets using the real WASM execution runtime."""
import asyncio
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lab_contracts import FinalOutput,PublicCourse,LabDraft
from lesson_execution import verify_drafts


async def audit(path):
    data=json.loads(Path(path).read_text(encoding='utf-8'))
    public=PublicCourse.model_validate(data['publicCourse'])
    private=FinalOutput.model_validate(data['privateOutput'])
    assert public.course_id==private.course_id
    p=private.problem
    drafts=[]
    for scene,reference,hidden in [(p.guided_scene,p.reference_solution,p.hidden_test_cases),
        (p.oj_scene,p.oj_assessment.reference_solution,p.oj_assessment.hidden_test_cases)]:
        drafts.append(LabDraft(title=scene.problem.title,instructions=scene.problem.instructions,
            scaffold_code=scene.interactive_code,reference_solution=reference,
            difficulty=scene.problem.difficulty,constraints=scene.problem.constraints,
            teaching_steps=p.guided_scene.teaching_steps,public_test_cases=scene.problem.public_test_cases,
            hidden_test_cases=hidden))
    count=await verify_drafts(*drafts)
    proof_lines=[line.removeprefix('# executable-contract-verification: ') for line in p.pytest_source.splitlines()
        if line.startswith('# executable-contract-verification: ')]
    independent_checks=0
    if proof_lines:
        proof=json.loads(proof_lines[-1])
        if proof['kind']=='independent-execution':
            from exam_simulator.generated import GeneratedAlgorithm,sandbox
            from lesson_execution import equivalent
            program=GeneratedAlgorithm.model_validate(proof['program'])
            for case in p.guided_scene.problem.public_test_cases+p.hidden_test_cases:
                result=await sandbox(program,proof['oracle'],json.loads(case.inputs['data']))
                assert equivalent(result['outcome'],json.loads(case.expected))
                independent_checks+=1
    return {'courseId':public.course_id,'topic':public.topic,'casesPassed':count,
        'independentChecks':independent_checks,'sandbox':'local-pyodide-wasm'}


async def main():
    report=[]
    for path in sys.argv[1:]:report.append(await audit(path))
    Path('logs/executable-saved-asset-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=True))


if __name__=='__main__':asyncio.run(main())

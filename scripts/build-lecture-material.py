"""Subject-matter prose and accepted examples, without changing exercise assets."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from exam_simulator import resolve
from exam_simulator.pedagogy import lesson_plan,overview
from lab_contracts import PublicCourse
from executable_lessons import compiled_teaching

materials={}
for identity,payload in json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')).items():
    course=PublicCourse.model_validate(payload)
    key=resolve(course.topic)
    plan=lesson_plan(key,course.topic) if key else course.lesson_plan.model_dump(mode='json',by_alias=True)
    points=plan.get('knowledge_points',plan.get('knowledgePoints',[]))
    compiled=compiled_teaching(course) if not key else None
    explanation=overview(key) if key else compiled['overview'] if compiled else '。'.join(points)
    if not key and compiled:points=[explanation,*points]
    example=None
    if course.scenes and course.scenes[0].problem.public_test_cases:
        case=course.scenes[0].problem.public_test_cases[0]
        inputs=case.inputs
        if set(inputs)=={'data'} and isinstance(inputs['data'],str):
            inputs=json.loads(inputs['data'])
        expected=case.expected
        if isinstance(expected,str):
            try:expected=json.loads(expected)
            except ValueError:pass
        example={'input':inputs,'expected':expected}
    materials[identity]={'facts':points,'overview':explanation,'example':example}
Path(sys.argv[2]).write_text(json.dumps(materials,ensure_ascii=False),encoding='utf-8')

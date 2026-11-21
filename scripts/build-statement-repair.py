"""Rewrite only public statements; preserve implementation, examples and assessments."""
import asyncio
import json
from pathlib import Path
import sys
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lab_contracts import FinalOutput, to_public_course
from problem_statements import review_problem_statements


async def main():
    value = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    reviewed = FinalOutput.model_validate(await review_problem_statements(value))
    reviewed.course_id = str(uuid4())
    for scene in (reviewed.problem.guided_scene, reviewed.problem.oj_scene):
        scene.course_id = reviewed.course_id
        scene.scene_id = str(uuid4())
        scene.problem.problem_id = str(uuid4())
    private = FinalOutput.model_validate(reviewed.model_dump()).model_dump(mode='json', by_alias=True)
    Path(sys.argv[2]).write_text(json.dumps({'publicCourse': to_public_course(private), 'privateOutput': private}, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    asyncio.run(main())

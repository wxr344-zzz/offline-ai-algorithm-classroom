"""Compile corrected quizzes from public, already executed course examples."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lab_contracts import PublicCourse
from executable_lessons import compiled_teaching
from teaching_assets import ClassroomTeaching

courses=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
result={}
for course_id,course in courses.items():
    teaching=compiled_teaching(PublicCourse.model_validate(course))
    if teaching:
        result[course_id]=ClassroomTeaching.model_validate(teaching).model_dump(mode='json',by_alias=True)
Path(sys.argv[2]).write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')

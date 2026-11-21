"""Reviewed replacement for one saved stack classroom; never used for course routing."""
import json
from pathlib import Path
import sys
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from autonomous_tasks import _stdio_draft
from agent_workflow import validate_lab_assets
from lab_assembly import assemble_lab
from lab_contracts import FinalOutput, LabDraft, PrivateAssessment, to_public_course


def build(value: dict) -> dict:
    original = FinalOutput.model_validate(value)
    guided = original.problem.guided_scene
    base = LabDraft(title=guided.problem.title, instructions=guided.problem.instructions,
        scaffold_code=guided.interactive_code, reference_solution=original.problem.reference_solution,
        difficulty=guided.problem.difficulty, constraints=guided.problem.constraints,
        teaching_steps=guided.teaching_steps, public_test_cases=guided.problem.public_test_cases,
        hidden_test_cases=original.problem.hidden_test_cases)
    samples = [
        ('5\nWRITE a\nWRITE b\nUNDO\nWRITE c\nUNDO\n', '2 1'),
        ('3\nUNDO\nUNDO\nUNDO\n', '0 0'),
        ('0\n', '0 0'),
        ('4\nWRITE x\nWRITE y\nWRITE z\nUNDO\n', '3 2'),
        ('2\nWRITE same\nWRITE same\n', '2 2'),
        ('4\nWRITE x\nUNDO\nUNDO\nWRITE y\n', '1 1'),
        ('6\nWRITE a\nWRITE b\nWRITE c\nUNDO\nUNDO\nUNDO\n', '3 0'),
    ]
    draft = _stdio_draft(base, '校园编辑器：撤销记录的峰值与剩余记录',
        '应用场景：学校为活动报名表开发文本编辑器，用栈记录可撤销的编辑动作。'
        'WRITE text 将一条编辑记录压入栈，UNDO 撤销最近的一条记录；空栈上的 UNDO 被忽略。'
        '相同 text 的两条 WRITE 仍是两次不同操作。请统计整个过程中记录数的最大值，以及全部操作结束后的剩余记录数。'
        '\n\n本题与引导题判空不同，需要连续处理多次操作、空栈分支和峰值统计。'
        '\n输入：第一行操作数 n，接着 n 行，每行为 WRITE text 或 UNDO。text 为不含空格的非空字符串。'
        '\n输出：一行两个整数，用空格分隔，依次为最大记录数和最终记录数。n=0 时输出 0 0。'
        '\n示例输入：\n5\nWRITE a\nWRITE b\nUNDO\nWRITE c\nUNDO\n示例输出：\n2 1\n'
        '请从空白作答区独立编写完整程序，读取标准输入并打印结果。',
        ['0 <= n <= 1000', '每条 WRITE 的文本长度为 1 到 50', '空栈撤销不报错，不产生负数记录'],
        samples,
        "lines = stdin.splitlines()\nn = int(lines[0])\nstack = []\npeak = 0\nfor line in lines[1:n + 1]:\n    if line.startswith('WRITE '):\n        stack.append(line[6:])\n        peak = max(peak, len(stack))\n    elif stack:\n        stack.pop()\nreturn str(peak) + ' ' + str(len(stack))\n")
    new_id = str(uuid4())
    lab, generated = assemble_lab(draft, new_id)
    validate_lab_assets(lab)
    updated = original.model_copy(deep=True)
    updated.course_id = new_id
    updated.problem.guided_scene.course_id = new_id
    updated.problem.guided_scene.scene_id = str(uuid4())
    updated.problem.guided_scene.problem.problem_id = str(uuid4())
    updated.problem.oj_scene = generated.oj_scene.model_copy(update={
        'interactive_code': '# 请独立编写完整程序，读取标准输入并打印结果。\n',
        'problem': generated.oj_scene.problem.model_copy(update={'execution_mode': 'stdio', 'standard_io_profile': None})})
    updated.problem.oj_assessment = PrivateAssessment(hidden_test_cases=generated.hidden_test_cases,
        reference_solution=generated.reference_solution, pytest_source=generated.pytest_source)
    private = FinalOutput.model_validate(updated.model_dump()).model_dump(mode='json', by_alias=True)
    return {'publicCourse': to_public_course(private), 'privateOutput': private}


if __name__ == '__main__':
    Path(sys.argv[2]).write_text(json.dumps(build(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))), ensure_ascii=False), encoding='utf-8')

"""One saved classroom's reviewed replacement asset. This is not algorithm routing logic."""
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
    data = [(5, [2]), (5, []), (0, []), (3, [1, 2]), (4, [4]), (6, [2, 4]), (4, [1])]
    # Trusted handwritten enumerator, independent of the private DP reference implementation.
    def routes(position: int, n: int, blocked: set[int]) -> int:
        if position in blocked or position > n: return 0
        if position == n: return 1
        return routes(position + 1, n, blocked) + routes(position + 2, n, blocked)
    samples = [(f'{n} {len(blocked)}\n' + ' '.join(map(str, blocked)) + '\n', str(routes(0, n, set(blocked)))) for n, blocked in data]
    draft = _stdio_draft(base, '校园通道维护：避开封闭台阶的路线规划',
        '应用场景：学校维修一段共有 n 级台阶的通道，部分台阶已封闭。你从第 0 级出发，每次向上走 1 级或 2 级，不能落在封闭台阶上。请计算恰好到达第 n 级的不同路线数。跳过封闭台阶是允许的，只要没有落在它上面。\n\n'
        '与引导题不同：本题不能直接返回斐波那契第 n 项，需要处理封闭位置、不可达状态以及起点边界。n=0 时不移动也是一种路线；终点被封闭时输出 0。\n\n'
        '输入格式：第一行 n k，第二行 k 个互不相同的封闭台阶编号；k=0 时第二行可为空。\n输出格式：一行一个整数，表示合法路线数。\n\n'
        '示例输入：\n5 1\n2\n示例输出：\n2\n解释：两条路线为 0→1→3→4→5 和 0→1→3→5。请编写完整 Python 程序，读取标准输入并打印结果，不提供类或函数骨架。',
        ['0 <= n <= 45', '0 <= k <= n；封闭编号互不相同且在 1..n 内', '0 级起点永不封闭，每次只向上走 1 或 2 级'], samples,
        "parts = list(map(int, stdin.split()))\nn, count = parts[:2]\nblocked = set(parts[2:2 + count])\nways = [0] * (n + 1)\nways[0] = 1\nfor step in range(1, n + 1):\n    if step in blocked:\n        continue\n    ways[step] = ways[step - 1]\n    if step >= 2:\n        ways[step] += ways[step - 2]\nreturn str(ways[n])\n")
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

"""验证系统题目答案、完整程序 I/O、错误反馈与旧课程兼容性。"""
import ast
import json
from pathlib import Path

import pytest

from autonomous_tasks import contextual_task, is_two_sum
from lab_assembly import assemble_lab
from lab_contracts import LabDraft
from autonomous_tasks import task_profile


def base():
    private = json.loads(Path('tests/fixtures/eduplus-generated.json').read_text(encoding='utf-8'))['privateOutput']
    lab = private['lab']
    problem = private['problem']
    return LabDraft(title=lab['title'], instructions=lab['instructions'], scaffold_code=lab['files']['solution.py'],
                    reference_solution=lab['reference_solution'], difficulty='Easy', constraints=['整数输入'],
                    teaching_steps=problem['guided_scene']['teachingSteps'],
                    public_test_cases=problem['guided_scene']['problem']['publicTestCases'],
                    hidden_test_cases=problem['hidden_test_cases'])


@pytest.mark.parametrize('topic', ['两数之和', '两数加和算法', '二叉树遍历', '01背包', 'Dijkstra', '迪杰斯特拉算法'])
def test_contextual_recipes_have_verified_outputs_and_distinct_task(topic):
    draft = contextual_task(base(), topic)
    assert draft is not None
    _, private = assemble_lab(draft, 'recipe-test')
    assert len(draft.public_test_cases) == 4
    assert len(draft.hidden_test_cases) >= 3
    namespace = {}
    # Only developer-owned recipes, never model-generated source, execute in this test.
    exec(draft.reference_solution, namespace)
    for case in draft.public_test_cases + draft.hidden_test_cases:
        assert namespace['Solution']().solve(**case.inputs) == case.expected
    assert private.oj_scene.problem.entry_point.return_type == 'str'
    public = private.oj_scene.problem.model_copy(update={'execution_mode':'stdio', 'standard_io_profile':task_profile(topic)})
    public = type(public).model_validate(public.model_dump())
    assert public.model_dump(by_alias=True)['standardIoProfile'] is not None


def test_scalar_addition_not_misclassified():
    assert is_two_sum('讲解两数加和算法')
    assert not is_two_sum('两个整数相加，a+b 标量运算')


def run_worker_python(code, stdin, expected):
    source = Path('public/eduplus-runtime/worker.js').read_text(encoding='utf-8').split('pyodide.runPython(`', 1)[1].split('`);', 1)[0].replace('\\\\', '\\')
    tree = ast.parse(source)
    tree.body[-1] = ast.Assign(targets=[ast.Name(id='result', ctx=ast.Store())], value=tree.body[-1].value)
    payload = {'code': code, 'mode': 'stdio', 'limit': 1000,
               'cases': [{'caseId': 'sample', 'inputs': {'stdin': stdin}, 'expected': expected}]}
    namespace = {'__practice_payload': json.dumps(payload)}
    exec(compile(ast.fix_missing_locations(tree), '<worker-runtime>', 'exec'), namespace)
    return json.loads(namespace['result'])['cases'][0]


def test_actual_worker_runtime_stdin_stdout_and_main_guard():
    result = run_worker_python("if __name__ == '__main__':\n    a, b = map(int, input().split())\n    print(a + b)", '2 7\n', '9')
    # The worker only executes; the parent page owns the verdict (see worker.js),
    # so a worker can never report its own case as passed.
    assert 'error' not in result and result['actual'] == '9\n' and result['passed'] is False
    assert run_worker_python("print(0)", '', '9')['actual'] == '0\n'


@pytest.mark.parametrize('code, message', [("x =", 'SyntaxError'), ("print(1/0)", 'ZeroDivisionError'), ("input()", 'EOFError'), ('raise SystemExit(2)', 'SystemExit')])
def test_actual_worker_runtime_reports_errors(code, message):
    result = run_worker_python(code, '', '9')
    assert not result['passed'] and message in result['error']


def test_actual_worker_runtime_accepts_clean_system_exit_and_preserves_multiline_output():
    clean = run_worker_python("print('a\\nb'); raise SystemExit(0)", '', 'a\nb')
    assert 'error' not in clean and clean['actual'] == 'a\nb\n'
    assert run_worker_python("print('a b')", '', 'a\nb')['actual'] == 'a b\n'

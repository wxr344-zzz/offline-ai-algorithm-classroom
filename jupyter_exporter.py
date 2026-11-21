"""将教案导出为三个单元格的 Notebook；导出阶段不执行任何代码。"""
from __future__ import annotations

import ast
import os
import tempfile
from pathlib import Path
from textwrap import dedent, indent
from typing import Any

import nbformat

from lab_contracts import PublicCourse, FinalOutput, to_public_course
from lab_assembly import build_pytest_source, entry_point_from_source, validate_test_cases


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} 必须是非空字符串")
    return value


def _bullet_list(value: Any, field: str) -> str:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field} 必须是非空字符串列表")
    return "\n".join("- " + _text(item, field).replace("\n", "\n  ") for item in value)


def _assessment_cell(test_source: str) -> str:
    """桥接当前内核实现，并让 pytest 收集临时文件中的测试。

    临时文件仅承载测试；solution 模块指向当前内核变量，不写入参考答案。
    环境变量、模块映射和 sys.path 在评测结束后恢复。
    """
    prelude = dedent('''\
        print("这是评测区：测试当前内核中的学生实现，请先运行学生编程区。")
        import os as _eduplus_os
        import sys as _eduplus_sys
        import shlex as _eduplus_shlex
        import tempfile as _eduplus_tempfile
        import types as _eduplus_types
        import uuid as _eduplus_uuid
        from pathlib import Path as _eduplus_Path
        from contextlib import contextmanager as _eduplus_contextmanager

        @_eduplus_contextmanager
        def _eduplus_grading_context():
            _namespace = dict(globals())
            _old_solution = _eduplus_sys.modules.get("solution")
            _old_path = list(_eduplus_sys.path)
            _keys = ("PYTEST_ADDOPTS", "PYTEST_DISABLE_PLUGIN_AUTOLOAD", "PYTEST_PLUGINS")
            _old_env = {key: _eduplus_os.environ.get(key) for key in _keys}
            with _eduplus_tempfile.TemporaryDirectory(prefix="eduplus-grading-") as _tmp:
                _root = _eduplus_Path(_tmp)
                _name = "test_eduplus_" + _eduplus_uuid.uuid4().hex
                _test_file = _root / (_name + ".py")
                _test_file.write_text(_eduplus_test_source, encoding="utf-8")
                _ini = _root / "pytest.ini"
                _ini.write_text("[pytest]\\n", encoding="utf-8")
                _solution = _eduplus_types.ModuleType("solution")
                _solution.__dict__.update({
                    key: value for key, value in _namespace.items()
                    if not key.startswith("__")
                })
                try:
                    _eduplus_sys.modules["solution"] = _solution
                    # 指定本次实验文件，防止扫描 Notebook 所在项目的其他测试。
                    _args = ["-c", str(_ini), "--rootdir", str(_root),
                             "--confcutdir", str(_root), str(_test_file)]
                    _eduplus_os.environ["PYTEST_ADDOPTS"] = " ".join(
                        _eduplus_shlex.quote(arg) for arg in _args
                    )
                    _eduplus_os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
                    _eduplus_os.environ.pop("PYTEST_PLUGINS", None)
                    yield
                finally:
                    if _old_solution is None:
                        _eduplus_sys.modules.pop("solution", None)
                    else:
                        _eduplus_sys.modules["solution"] = _old_solution
                    _eduplus_sys.modules.pop(_name, None)
                    _eduplus_sys.path[:] = _old_path
                    for _key, _value in _old_env.items():
                        if _value is None:
                            _eduplus_os.environ.pop(_key, None)
                        else:
                            _eduplus_os.environ[_key] = _value
        ''')
    # repr 将源码安全编码为 Python 字符串字面量，保留换行和引号。
    return (
        prelude
        + f"\n_eduplus_test_source = {test_source!r}\n"
        + "\nwith _eduplus_grading_context():\n"
        + indent(test_source.rstrip(), "    ")
        + '\n\n    pytest.main(["-q", "--disable-warnings"])\n'
    )


def build_student_notebook(course_data: dict[str, Any], scene_type: str = "guided-lab") -> nbformat.NotebookNode:
    """仅接受公开契约；Notebook 中所有测试都公开，不伪装成保密评测。"""
    course = PublicCourse.model_validate(course_data)
    if scene_type not in {"guided-lab", "oj-lab"}:
        raise ValueError("scene_type 必须为 guided-lab 或 oj-lab")
    lesson = course.lesson_plan
    markdown = (
        f"# {lesson.title}\n\n**教学主题：** {course.topic}\n\n"
        f"## 教学目标\n\n{_bullet_list(lesson.objectives, 'objectives')}\n\n"
        f"## 知识点\n\n{_bullet_list(lesson.knowledge_points, 'knowledgePoints')}\n"
    )
    metadata = {"audience": "student", "schemaVersion": "1.0", "courseId": course.course_id}
    cells = [nbformat.v4.new_markdown_cell(markdown)]
    if course.requires_lab:
        scene = next(scene for scene in course.scenes if scene.scene_type == scene_type)
        entry = scene.problem.entry_point
        if scene.scene_type == "guided-lab" and entry_point_from_source(scene.interactive_code) != entry:
            raise ValueError("学生代码入口与题目契约不一致")
        validate_test_cases(scene.problem.public_test_cases, entry, allow_alternatives=scene.problem.answer_check == 'lcs-string')
        tests = build_pytest_source(scene.problem.public_test_cases, scene.problem.answer_check).replace("# 服务端/教师评测资产", "# 公开练习用例")
        student_code = "# 请在此处补全代码实现\n" + scene.interactive_code
        if scene.problem.execution_mode == "stdio":
            # 完整程序保存在字符串中，避免运行学生单元格时 input() 阻塞内核。
            student_code = "# 将完整程序写入下面的字符串；随后运行公开测试单元格。\n_student_program = " + repr(scene.interactive_code)
            tests = "import pytest\nfrom solution import _student_program\nimport io, sys\nfrom contextlib import redirect_stdout\n\ndef _run(stdin):\n    old = sys.stdin\n    stream = io.StringIO()\n    try:\n        sys.stdin = io.StringIO(stdin)\n        with redirect_stdout(stream):\n            try:\n                exec(compile(_student_program, 'solution.py', 'exec'), {'__name__': '__main__'})\n            except SystemExit as exc:\n                if exc.code not in (None, 0):\n                    raise\n        return stream.getvalue().rstrip('\\r\\n')\n    finally:\n        sys.stdin = old\n\n"
            tests += build_pytest_source(scene.problem.public_test_cases, scene.problem.answer_check, stdio_runner=True).replace("# 服务端/教师评测资产", "# 公开练习用例")
        cells[0].source += "\n## 实验任务\n\n" + scene.markdown_content + "\n\n公开用例通过不等于正式判题通过。"
        cells.extend([
            nbformat.v4.new_code_cell(student_code, metadata={"tags": ["student-code"]}),
            nbformat.v4.new_code_cell(_assessment_cell(tests), metadata={"tags": ["public-tests"]}),
        ])
        metadata.update(sceneId=scene.scene_id, sceneType=scene_type, problemId=scene.problem.problem_id, problemVersion=scene.problem.problem_version)
    notebook = nbformat.v4.new_notebook(cells=cells, metadata={
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "file_extension": ".py", "pygments_lexer": "ipython3"},
        "eduplus": metadata,
    })
    nbformat.validate(notebook)
    return notebook


def build_teacher_notebook(internal_data: dict[str, Any]) -> nbformat.NotebookNode:
    """私有教师产物。调用方必须先校验教师权限；不在导出阶段执行参考实现。"""
    internal = FinalOutput.model_validate(internal_data)
    notebook = build_student_notebook(to_public_course(internal.model_dump(mode="json")))
    notebook.metadata.eduplus.audience = "teacher"
    notebook.cells[0].source = "# 教师专用：参考实现与完整评测\n\n" + notebook.cells[0].source
    if internal.problem:
        notebook.cells[1].source = "# 教师参考实现（仅静态校验，导出时未执行）\n" + internal.problem.reference_solution
        notebook.cells[1].metadata.tags = ["teacher-reference"]
        notebook.cells[2].source = _assessment_cell(internal.problem.pytest_source)
        notebook.cells[2].metadata.tags = ["teacher-private-tests"]
    nbformat.validate(notebook)
    return notebook


def export_to_ipynb(lab_data: dict[str, Any], output_path: str) -> Path:
    """导出标准 nbformat v4 文件，返回绝对路径；支持自动创建父目录。"""
    if not isinstance(lab_data, dict):
        raise TypeError("lab_data 必须是字典")
    topic = _text(lab_data.get("topic"), "topic")
    lesson = lab_data.get("lesson_plan")
    lab = lab_data.get("lab")
    if not isinstance(lesson, dict) or not isinstance(lab, dict):
        raise ValueError("lesson_plan、lab 必须是字典；非实验教案不支持此导出")
    title = _text(lesson.get("title"), "lesson_plan.title")
    objectives = _bullet_list(lesson.get("objectives"), "lesson_plan.objectives")
    points = _bullet_list(lesson.get("knowledge_points"), "lesson_plan.knowledge_points")
    instructions = _text(lab.get("instructions"), "lab.instructions")
    files = lab.get("files")
    if not isinstance(files, dict):
        raise ValueError("lab.files 必须是字典")
    solution = _text(files.get("solution.py"), "lab.files.solution.py")
    tests = _text(files.get("test_solution.py"), "lab.files.test_solution.py")
    _text(lab.get("reference_solution"), "lab.reference_solution")
    if not isinstance(lab.get("grading"), dict):
        raise ValueError("lab.grading 必须是字典")
    ast.parse(solution, filename="solution.py")
    test_tree = ast.parse(tests, filename="test_solution.py")
    if not any(isinstance(node, ast.Import) and any(alias.name == "pytest" for alias in node.names)
               for node in test_tree.body):
        raise ValueError("test_solution.py 必须包含 import pytest")

    markdown = (
        f"# {title}\n\n**教学主题：** {topic}\n\n"
        f"## 教学目标\n\n{objectives}\n\n"
        f"## 知识点\n\n{points}\n\n"
        f"## 实验说明\n\n{instructions}\n"
    )
    notebook = nbformat.v4.new_notebook(
        cells=[
            nbformat.v4.new_markdown_cell(markdown),
            nbformat.v4.new_code_cell("# 请在此处补全代码实现\n" + solution),
            nbformat.v4.new_code_cell(
                _assessment_cell(tests),
                metadata={
                    "tags": ["hide-input", "assessment"],
                    "jupyter": {"source_hidden": True},
                    "editable": False,
                    "deletable": False,
                },
            ),
        ],
        metadata={
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "file_extension": ".py", "pygments_lexer": "ipython3"},
        },
    )
    nbformat.validate(notebook)
    destination = Path(output_path).expanduser().resolve()
    if destination.suffix.lower() != ".ipynb":
        raise ValueError("output_path 必须以 .ipynb 结尾")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # 同目录临时文件 + 原子替换，避免接口下载到只写了一半的 Notebook。
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".tmp", dir=destination.parent, delete=False,
        ) as stream:
            temporary = Path(stream.name)
            nbformat.write(notebook, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return destination


if __name__ == "__main__":
    mock_lab_data: dict[str, Any] = {
        "topic": "Python 列表求和",
        "lesson_plan": {
            "title": "Python 列表求和实验课",
            "objectives": ["掌握列表遍历", "编写可测试的列表求和方法"],
            "knowledge_points": ["列表与整数", "累加算法", "空输入和负数边界"],
        },
        "lab": {
            "title": "列表求和",
            "instructions": "实现 Solution.solve(nums)，返回整数列表之和；空列表返回 0。",
            "files": {
                "solution.py": dedent('''\
                    class Solution:
                        def solve(self, nums: list[int]) -> int:
                            # TODO: 在这里实现列表求和
                            raise NotImplementedError("请完成实现")
                    '''),
                "test_solution.py": dedent('''\
                    import pytest
                    from solution import Solution

                    def test_normal():
                        assert Solution().solve([1, 2, 3]) == 6

                    def test_empty():
                        assert Solution().solve([]) == 0

                    def test_negative():
                        assert Solution().solve([-1, -2, -3]) == -6

                    def test_mixed():
                        assert Solution().solve([1, -1, 0]) == 0
                    '''),
            },
            "reference_solution": "class Solution:\n    def solve(self, nums: list[int]) -> int:\n        return sum(nums)\n",
            "grading": {
                "command": ["python", "-m", "pytest", "-q", "test_solution.py"],
                "criteria": ["正常输入", "空列表", "负数", "混合正负数和零"],
                "working_directory": "实验文件所在目录",
                "pass_condition": "四个用例全部通过，退出码为 0",
            },
        },
    }
    print(f"Notebook 已导出：{export_to_ipynb(mock_lab_data, 'test_output.ipynb')}")

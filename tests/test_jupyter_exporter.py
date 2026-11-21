"""文件结构、原子写入和真实 Jupyter 内核评测验证。"""
from copy import deepcopy
import json
from pathlib import Path
import runpy
import sys

import nbformat
from nbclient import NotebookClient
from jupyter_client import KernelManager
from jupyter_client.kernelspec import KernelSpecManager
import pytest

from jupyter_exporter import export_to_ipynb


@pytest.fixture
def lab_data():
    return {
        "topic": "列表求和",
        "lesson_plan": {
            "title": "列表求和课", "objectives": ["列表遍历"], "knowledge_points": ["累加与边界"],
        },
        "lab": {
            "instructions": "整数列表求和，空列表返回 0。",
            "files": {
                "solution.py": "class Solution:\n    def solve(self, nums: list[int]) -> int:\n        # TODO\n        raise NotImplementedError\n",
                "test_solution.py": "import pytest\nfrom solution import Solution\n\ndef test_normal():\n    assert Solution().solve([1, 2, 3]) == 6\n\ndef test_empty():\n    assert Solution().solve([]) == 0\n\ndef test_negative():\n    assert Solution().solve([-1, -2]) == -3\n\ndef test_mixed():\n    assert Solution().solve([1, -1, 0]) == 0\n",
            },
            "reference_solution": "class Solution:\n    def solve(self, nums: list[int]) -> int:\n        return sum(nums)  # SECRET_REFERENCE_MARKER\n",
            "grading": {"criteria": ["正常", "空", "负数", "混合"]},
        },
    }


def test_three_cells_and_no_answer_leak(tmp_path, lab_data):
    before = deepcopy(lab_data)
    output = export_to_ipynb(lab_data, str(tmp_path / "sub" / "lab.ipynb"))
    notebook = nbformat.read(output, as_version=4)
    nbformat.validate(notebook)
    assert [cell.cell_type for cell in notebook.cells] == ["markdown", "code", "code"]
    assert notebook.cells[1].source.startswith("# 请在此处补全代码实现\n")
    assert notebook.cells[2].source.rstrip().endswith('pytest.main(["-q", "--disable-warnings"])')
    assert notebook.cells[2].metadata.jupyter.source_hidden is True
    assert "SECRET_REFERENCE_MARKER" not in output.read_text(encoding="utf-8")
    assert all(not cell.get("outputs") for cell in notebook.cells)
    assert lab_data == before


@pytest.mark.parametrize("field", ["topic", "lesson_plan", "lab"])
def test_missing_data_does_not_overwrite(tmp_path, lab_data, field):
    destination = tmp_path / "lab.ipynb"
    destination.write_text("existing-file", encoding="utf-8")
    del lab_data[field]
    with pytest.raises((ValueError, TypeError)):
        export_to_ipynb(lab_data, str(destination))
    assert destination.read_text(encoding="utf-8") == "existing-file"


def test_invalid_python_and_extension_rejected(tmp_path, lab_data):
    with pytest.raises(ValueError):
        export_to_ipynb(lab_data, str(tmp_path / "lab.json"))
    lab_data["lab"]["files"]["solution.py"] = "class :"
    with pytest.raises(SyntaxError):
        export_to_ipynb(lab_data, str(tmp_path / "lab.ipynb"))


def test_entrypoint_generates_demo(tmp_path, monkeypatch):
    source = Path(__file__).resolve().parents[1] / "jupyter_exporter.py"
    monkeypatch.chdir(tmp_path)
    runpy.run_path(str(source), run_name="__main__")
    assert len(nbformat.read(tmp_path / "test_output.ipynb", as_version=4).cells) == 3


def test_real_kernel_stub_then_updated_solution(tmp_path, lab_data):
    destination = export_to_ipynb(lab_data, str(tmp_path / "lab.ipynb"))
    notebook = nbformat.read(destination, as_version=4)
    # 初次运行学生占位实现，随后在同一内核重写 Solution 并再次评测。
    notebook.cells.extend([
        nbformat.v4.new_code_cell(lab_data["lab"]["reference_solution"]),
        deepcopy(notebook.cells[2]),
        nbformat.v4.new_code_cell(
            "import os, sys\nassert 'solution' not in sys.modules\n"
            "assert os.environ['PYTEST_ADDOPTS'] == 'original-options'\n"
        ),
    ])
    setup = nbformat.v4.new_code_cell(
        "import os\nos.environ['PYTEST_ADDOPTS'] = 'original-options'\n"
    )
    notebook.cells.insert(0, setup)

    # 使用项目 .venv 内核；只写临时 kernelspec，不安装系统级内核。
    kernel_dir = tmp_path / "kernels" / "eduplus-test"
    kernel_dir.mkdir(parents=True)
    (kernel_dir / "kernel.json").write_text(json.dumps({
        "argv": [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
        "display_name": "EduPlus Test", "language": "python",
    }), encoding="utf-8")
    manager = KernelManager(
        kernel_name="eduplus-test",
        kernel_spec_manager=KernelSpecManager(kernel_dirs=[str(kernel_dir.parent)]),
    )
    client = NotebookClient(notebook, km=manager, timeout=60)
    try:
        executed = client.execute(cwd=str(tmp_path))
    finally:
        if manager.has_kernel:
            manager.shutdown_kernel(now=True)
    def text_of(cell):
        return "".join(output.get("text", "") for output in cell.outputs)
    assert "4 failed" in text_of(executed.cells[3])
    assert "4 passed" in text_of(executed.cells[5])

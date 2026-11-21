"""公共契约保密性、共享题目、类型一致性与生成产物回归。"""
from copy import deepcopy
import ast
import json
from pathlib import Path
import subprocess
import sys

from jsonschema import Draft202012Validator
import pytest
from pydantic import ValidationError

from lab_assembly import assemble_lab, build_pytest_source, entry_point_from_source
from lab_contracts import FinalOutput, GenerateRequest, LabDraft, PublicCourse, TestCase as Case, to_public_course


@pytest.fixture
def draft_data():
    cases = [
        {"caseId": name, "inputs": {"nums": values}, "expected": expected, "description": description}
        for name, values, expected, description in [
            ("public-normal", [1, 2, 3], 6, "公开示例"),
            ("HIDDEN_CASE_SENTINEL", [], 0, "HIDDEN_DESCRIPTION_SENTINEL"),
            ("hidden-negative", [-1, -2], -3, "负数"),
            ("hidden-mixed", [-1, 1], 0, "混合"),
        ]
    ]
    return {
        "title": "列表求和", "instructions": "返回整数列表之和，允许空列表与负数。",
        "scaffold_code": "class Solution:\n    def solve(self, nums: list[int]) -> int:\n        # TODO\n        raise NotImplementedError\n",
        "reference_solution": "class Solution:\n    def solve(self, nums: list[int]) -> int:\n        return sum(nums)  # REFERENCE_SENTINEL\n",
        "difficulty": "Easy", "constraints": ["参数为整数列表"],
        "teaching_steps": [{"stepId": "step-1", "title": "累加", "instruction": "逐项累加", "hint": "从 0 开始"}],
        "public_test_cases": cases[:1], "hidden_test_cases": cases[1:],
    }


def final_data(draft_data):
    legacy, private = assemble_lab(LabDraft.model_validate(draft_data), "course-1")
    return FinalOutput(
        course_id="course-1", topic="列表求和", requires_lab=True,
        lesson_plan={"title": "列表求和", "objectives": ["实现累加"], "knowledge_points": ["边界"]},
        common_mistakes=[], lab=legacy, problem=private, status="ready",
    ).model_dump(mode="json")


def test_public_projection_and_schema(draft_data):
    data = final_data(draft_data)
    before = deepcopy(data)
    public = to_public_course(data)
    assert data == before
    assert to_public_course(data) == public
    Draft202012Validator(PublicCourse.model_json_schema(mode="serialization")).validate(public)
    assert public["schemaVersion"] == "1.0"
    assert public["qualityStatus"] == "static-validated"
    assert [scene["sceneType"] for scene in public["scenes"]] == ["guided-lab", "oj-lab"]
    guided, oj = public["scenes"]
    assert guided["sceneId"] != oj["sceneId"]
    assert guided["problem"] == oj["problem"]
    assert guided["problem"]["problemVersion"] == 1
    assert guided["template"] == "guided-lab-v1"
    assert oj["template"] == "oj-lab-v1"
    assert "# TODO" in guided["interactiveCode"]
    assert "TODO" not in oj["interactiveCode"]
    assert "pass" in oj["interactiveCode"]
    assert entry_point_from_source(guided["interactiveCode"]) == entry_point_from_source(oj["interactiveCode"])
    serialized = json.dumps(public)
    for secret in ("HIDDEN_CASE_SENTINEL", "HIDDEN_DESCRIPTION_SENTINEL", "REFERENCE_SENTINEL", "reference_solution", "hidden_test_cases", "pytest_source"):
        assert secret not in serialized
    assert len(guided["problem"]["publicTestCases"]) == 1
    # 浏览器契约禁止加入私有字段。
    guided["referenceSolution"] = "leak"
    with pytest.raises(ValidationError):
        PublicCourse.model_validate(public)


@pytest.mark.parametrize("change", ["names", "bool_as_int", "expected", "signature", "duplicate_case", "duplicate_step", "float"])
def test_invalid_draft_rejected(draft_data, change):
    if change == "names":
        draft_data["public_test_cases"][0]["inputs"] = {"values": [1, 2, 3]}
    elif change == "bool_as_int":
        draft_data["public_test_cases"][0]["inputs"]["nums"] = [True]
    elif change == "expected":
        draft_data["public_test_cases"][0]["expected"] = "6"
    elif change == "signature":
        draft_data["reference_solution"] = draft_data["reference_solution"].replace("nums:", "values:")
    elif change == "duplicate_case":
        draft_data["hidden_test_cases"][0]["caseId"] = "public-normal"
    elif change == "duplicate_step":
        draft_data["teaching_steps"] *= 2
    else:
        draft_data["scaffold_code"] = draft_data["scaffold_code"].replace("list[int]", "list[float]")
    with pytest.raises((ValueError, ValidationError)):
        assemble_lab(LabDraft.model_validate(draft_data), "course-1")


def test_theory_has_no_lab_scenes():
    data = FinalOutput(
        course_id="course-theory", topic="理论", requires_lab=False,
        lesson_plan={"title": "理论", "objectives": ["理解概念"], "knowledge_points": ["定义"]},
        common_mistakes=["概念混淆"], lab=None, problem=None, status="ready",
    ).model_dump(mode="json")
    public = to_public_course(data)
    assert public["scenes"] == []
    assert public["lessonPlan"]["knowledgePoints"] == ["定义"]
    Draft202012Validator(PublicCourse.model_json_schema(mode="serialization")).validate(public)


@pytest.mark.parametrize("bad_prompt", ["", "  ", True, 1, None])
def test_request_validation(bad_prompt):
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate({"prompt": bad_prompt})


def test_case_strings_are_data_not_python_statements():
    value = "'); raise RuntimeError('injected'); #"
    source = build_pytest_source([Case(case_id="case", inputs={"text": value}, expected=value, description="字符串")])
    tree = ast.parse(source)
    assert not any(isinstance(node, ast.Raise) for node in ast.walk(tree))


def test_contract_artifacts_are_current():
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run([sys.executable, "scripts/export_lab_contracts.py", "--check"], cwd=root, capture_output=True, encoding="utf-8", timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr

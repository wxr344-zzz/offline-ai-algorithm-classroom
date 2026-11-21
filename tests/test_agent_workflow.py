"""验证真实图的分支、状态隔离和生成的 pytest 评测模板。"""
import asyncio
import os
import json
from copy import deepcopy
import subprocess
import sys

import pytest
from langchain_core.messages import HumanMessage
from pydantic import ValidationError

from agent_workflow import (
    EvalAgent_Node, LabAgent_Node, TeacherAgent_Node,
    app, create_initial_state, route_after_teacher,
    OllamaProvider, TEACHER_SYSTEM_PROMPT, WorkflowGenerationError, validate_lab_assets, LabSpec,
)


def invoke(state):
    return asyncio.run(app.ainvoke(state))


def stream(state):
    async def collect():
        return [event async for event in app.astream(state, stream_mode="updates")]
    return asyncio.run(collect())


def lab_payload():
    stub = "class Solution:\n    def solve(self, numbers: list[int]) -> int:\n        # TODO\n        raise NotImplementedError\n"
    reference = "class Solution:\n    def solve(self, numbers: list[int]) -> int:\n        return sum(numbers)\n"
    tests = "import pytest\nfrom solution import Solution\n"
    for i, (values, expected) in enumerate([([], 0), ([1,2,3], 6), ([-2,2], 0), ([-1,-2], -3)]):
        tests += f"def test_case_{i}():\n    assert Solution().solve({values!r}) == {expected}\n"
    return {
        "title": "列表求和", "instructions": "返回整数列表之和，空列表返回 0。",
        "files": {"solution.py": stub, "test_solution.py": tests},
        "reference_solution": reference,
        "grading": {"criteria": ["正常", "空输入", "混合", "负数"]},
    }


def lab_draft_payload():
    legacy = lab_payload()
    cases = [
        {"caseId": f"case-{i}", "inputs": {"numbers": values}, "expected": expected,
         "description": description}
        for i, (values, expected, description) in enumerate([
            ([1, 2, 3], 6, "正常"), ([], 0, "空输入"), ([-2, 2], 0, "混合"), ([-1, -2], -3, "负数"),
            ([4], 4, "隐藏单数"), ([0,0], 0, "隐藏零"), ([9,-4], 5, "隐藏混合"),
        ])
    ]
    return {
        "title": legacy["title"], "instructions": legacy["instructions"],
        "scaffold_code": legacy["files"]["solution.py"],
        "reference_solution": legacy["reference_solution"],
        "difficulty": "Easy", "constraints": ["输入为整数列表，允许空列表及负数"],
        "teaching_steps": [{"stepId": "step-1", "title": "遍历", "instruction": "逐项累加", "hint": "从 0 开始"}],
        "public_test_cases": cases[:4], "hidden_test_cases": cases[4:],
    }


def independent_payload():
    payload = lab_draft_payload()
    payload["title"] = "独立练习：筛选正数物资编号"
    payload["instructions"] = "应用场景：校园物资清点任务。按原顺序返回所有正数编号，空列表返回空列表。"
    payload["reference_solution"] = payload["reference_solution"].replace("-> int", "-> list[int]").replace("sum(numbers)", "[v for v in numbers if v > 0]")
    payload["scaffold_code"] = payload["scaffold_code"].replace("-> int", "-> list[int]")
    for case in payload["public_test_cases"] + payload["hidden_test_cases"]:
        case["expected"] = [v for v in case["inputs"]["numbers"] if v > 0]
    return payload


def test_transfer_validation_rejects_changed_background_and_renamed_parameters():
    from agent_workflow import validate_transfer_examples
    from lab_contracts import LabDraft
    guided = lab_draft_payload()
    duplicate = deepcopy(guided)
    duplicate['title'] = '校园物资编号求和'
    duplicate['instructions'] = '应用场景：求物资编号总和。'
    duplicate['scaffold_code'] = duplicate['scaffold_code'].replace('numbers', 'items')
    for case in duplicate['public_test_cases'] + duplicate['hidden_test_cases']:
        case['inputs'] = {'items': case['inputs']['numbers']}
    with pytest.raises(ValueError, match='不能只换背景'):
        validate_transfer_examples(LabDraft.model_validate(guided), LabDraft.model_validate(duplicate))
    validate_transfer_examples(LabDraft.model_validate(guided), LabDraft.model_validate(independent_payload()))


@pytest.fixture(autouse=True)
def fake_llm(monkeypatch):
    # 网络层替身；真实节点的 JSON 解析、验证及状态更新仍然运行。
    async def generate(self, prompt, **kwargs):
        assert kwargs["json_mode"] is True
        data = json.loads(prompt)
        assert "output_schema" in data
        if kwargs['schema'].__name__ == 'TaskAlignmentReview':
            return json.dumps(dict(core_algorithm_matches=True, inputs_sufficient=True,
                difficulty_appropriate=True, has_meaningful_application=True,
                reason='当前算法直接用于题目核心运算，输入类型充分且难度适中。'))
        if kwargs["system"] == TEACHER_SYSTEM_PROMPT:
            question = data["user_question"]
            return json.dumps({
                "topic": question, "requires_lab": "只讲理论" not in question,
                "lesson_plan": {"title": question, "objectives": ["理解概念"], "knowledge_points": ["边界"]},
            }, ensure_ascii=False)
        return json.dumps(independent_payload() if "guided_problem" in data else lab_draft_payload(), ensure_ascii=False)
    monkeypatch.setattr(OllamaProvider, "generate", generate)


@pytest.mark.parametrize("prompt, branch", [
    ("Python 编程实验", "LabAgent_Node"),
    ("操作系统基础，只讲理论，不需要实验", "TAAgent_Node"),
])
def test_graph_routes_and_message_history(prompt, branch):
    initial = create_initial_state(prompt)
    before = deepcopy(initial)
    events = stream(initial)
    assert [next(iter(event)) for event in events] == ["TeacherAgent_Node", branch, "EvalAgent_Node"]
    assert initial == before
    result = invoke(initial)
    assert len(result["messages"]) == 4  # 人类 + Teacher + 分支节点 + Eval
    assert result["final_output"]["status"] == "ready"
    assert result["requires_lab"] == (branch == "LabAgent_Node")
    assert (result["final_output"]["lab"] is not None) == result["requires_lab"]
    if branch == "TAAgent_Node":
        assert result["final_output"]["common_mistakes"]


def test_latest_human_message_and_stale_output_reset():
    state = invoke(create_initial_state("Python 编程实验"))
    state["messages"].append(HumanMessage(content="操作系统，只讲理论"))
    result = invoke(state)
    assert result["current_topic"] == "操作系统，只讲理论"
    assert result["final_output"]["lab"] is None
    assert len(result["messages"]) == 8


@pytest.mark.parametrize('question', ['讲解斐波那契数列', '介绍归并排序', '解释 Dijkstra 最短路径', '讲解二叉树遍历'])
def test_semantic_algorithm_decision_requires_full_lab_without_name_whitelist(monkeypatch, question):
    async def generate(self, prompt, **kwargs):
        return json.dumps({'topic': question, 'course_kind': 'algorithm', 'requires_lab': False,
                           'lesson_plan': {'title': question, 'objectives': ['理解状态转移'], 'knowledge_points': ['边界条件']}})
    monkeypatch.setattr(OllamaProvider, 'generate', generate)
    result = asyncio.run(TeacherAgent_Node(create_initial_state(question)))
    assert result['requires_lab'] is True
    theory = asyncio.run(TeacherAgent_Node(create_initial_state(question + '，只讲理论，不写代码')))
    assert theory['requires_lab'] is False


@pytest.mark.parametrize('question, expected', [
    ('讲解算法，不需要编程基础，安排编程练习', True),
    ('无需编程经验也能学习的 Python 课程', True),
    ('Teach algorithms with no coding experience required', True),
    ('Explain algorithms without coding', False),
    ('Explain algorithms with no programming', False),
    ('只講理論，無需編程', False),
    ('讲解算法，不要编程', False),
    ('Explain algorithms with no code', False),
])
def test_practice_intent_distinguishes_theory_from_prerequisites(monkeypatch, question, expected):
    async def generate(self, prompt, **kwargs):
        return json.dumps({'topic': question, 'course_kind': 'algorithm', 'requires_lab': False,
            'lesson_plan': {'title': question, 'objectives': ['理解算法'], 'knowledge_points': ['状态变化']}})
    monkeypatch.setattr(OllamaProvider, 'generate', generate)
    result = asyncio.run(TeacherAgent_Node(create_initial_state(question)))
    assert result['requires_lab'] is expected


def test_nodes_do_not_mutate_input():
    initial = create_initial_state("Python 编程实验")
    state = {**initial, **asyncio.run(TeacherAgent_Node(initial))}
    before = deepcopy(state)
    asyncio.run(LabAgent_Node(state))
    assert state == before


def test_independent_oj_has_its_own_spec_and_no_scaffold():
    from lab_contracts import to_public_course
    result = invoke(create_initial_state("Python 编程实验"))["final_output"]
    public = to_public_course(result)
    guided, oj = public["scenes"]
    assert guided["problem"]["problemId"] != oj["problem"]["problemId"]
    assert guided["problem"]["instructions"] != oj["problem"]["instructions"]
    assert "class Solution" not in oj["interactiveCode"]
    assert "def solve" not in oj["interactiveCode"]
    assert len(guided["problem"]["publicTestCases"]) == 4
    assert result["problem"]["oj_assessment"]["reference_solution"]
    assert "oj_assessment" not in json.dumps(public)
    from jupyter_exporter import build_student_notebook
    notebook = build_student_notebook(public, scene_type="oj-lab")
    assert "class Solution" not in notebook.cells[1].source
    assert "public-tests" in notebook.cells[2].metadata.tags


def test_same_title_different_task_is_not_rejected(monkeypatch):
    state = create_initial_state("Python 编程实验")
    state.update(asyncio.run(TeacherAgent_Node(state)))
    async def generate(self, prompt, **kwargs):
        data = json.loads(prompt)
        if kwargs['schema'].__name__ == 'TaskAlignmentReview':
            return json.dumps(dict(core_algorithm_matches=True, inputs_sufficient=True,
                difficulty_appropriate=True, has_meaningful_application=True,
                reason='候选题使用列表处理核心算法，具有具体应用和充分输入。'))
        payload = independent_payload() if "guided_problem" in data else lab_draft_payload()
        payload["title"] = lab_draft_payload()["title"]
        return json.dumps(payload, ensure_ascii=False)
    monkeypatch.setattr(OllamaProvider, "generate", generate)
    output = asyncio.run(LabAgent_Node(state))["final_output"]
    guided, oj = output["problem"]["guided_scene"], output["problem"]["oj_scene"]
    assert guided["problem"]["instructions"] != oj["problem"]["instructions"]
    assert oj["problem"]["title"].startswith("独立迁移挑战：")


def test_model_cannot_ignore_transfer_return_contract(monkeypatch, caplog):
    state = create_initial_state('Python 编程实验')
    state.update(asyncio.run(TeacherAgent_Node(state)))
    async def generate(self, prompt, **kwargs):
        data=json.loads(prompt)
        payload=lab_draft_payload()
        if 'guided_problem' in data or 'original_request' in data:
            payload['instructions']='应用场景：换一个说法但忽略返回类型约束。'
            payload['reference_solution']=payload['reference_solution'].replace('sum(numbers)','sum(numbers) + 1')
        return json.dumps(payload)
    monkeypatch.setattr(OllamaProvider,'generate',generate)
    with pytest.raises(WorkflowGenerationError):
        asyncio.run(LabAgent_Node(state))
    assert '返回类型约束' in caplog.text


@pytest.mark.parametrize("same_description", [True, False])
def test_same_task_different_title_is_still_rejected(monkeypatch, same_description):
    state = create_initial_state("Python 编程实验")
    state.update(asyncio.run(TeacherAgent_Node(state)))
    async def generate(self, prompt, **kwargs):
        data = json.loads(prompt)
        payload = lab_draft_payload()
        if "guided_problem" in data:
            payload["title"] = "换一个名字的重复题"
            if not same_description:
                payload["instructions"] = "换一种描述但复制原参考实现的重复任务。"
        return json.dumps(payload, ensure_ascii=False)
    monkeypatch.setattr(OllamaProvider, "generate", generate)
    with pytest.raises(WorkflowGenerationError):
        asyncio.run(LabAgent_Node(state))


@pytest.mark.parametrize("independent", [False, True])
def test_known_two_sum_boundary_cases_are_mathematically_checked(independent):
    from agent_workflow import assemble_known_cases, validate_two_sum_cases
    from lab_contracts import LabDraft
    draft = assemble_known_cases(LabDraft.model_validate(lab_draft_payload()), "两数之和算法", independent=independent)
    validate_two_sum_cases(draft, "两数之和算法", independent=independent)
    assert len(draft.public_test_cases) == 4
    assert len(draft.hidden_test_cases) == 3
    broken = draft.model_copy(deep=True)
    broken.public_test_cases[0].expected = 999
    with pytest.raises(ValueError):
        validate_two_sum_cases(broken, "两数之和算法", independent=independent)


def test_lab_guard_and_router_reject_invalid_states():
    state = create_initial_state("理论")
    with pytest.raises(ValueError):
        asyncio.run(LabAgent_Node(state))
    state["requires_lab"] = "false"
    with pytest.raises(TypeError):
        route_after_teacher(state)


def test_eval_rejects_inconsistent_lab():
    result = invoke(create_initial_state("Python 编程实验"))
    result["final_output"]["lab"] = None
    with pytest.raises(ValidationError):
        EvalAgent_Node(result)


def test_missing_human_message_is_rejected():
    state = create_initial_state("topic")
    state["messages"] = []
    with pytest.raises(ValueError):
        invoke(state)


def test_generated_grading_template(tmp_path):
    lab = invoke(create_initial_state("Python 编程实验"))["final_output"]["lab"]
    for filename, code in lab["files"].items():
        (tmp_path / filename).write_text(code, encoding="utf-8")
    command = [sys.executable, "-X", "utf8", "-m", "pytest", "-q", "test_solution.py"]
    # Runtime failures remain visible; an unverified model reference cannot
    # turn model-authored expected values into mathematical authority.
    child_env = {**os.environ, 'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1'}
    stub = subprocess.run(command, cwd=tmp_path, env=child_env, capture_output=True, encoding="utf-8", timeout=30)
    assert stub.returncode == 1, stub.stdout + stub.stderr
    (tmp_path / "solution.py").write_text(lab["reference_solution"], encoding="utf-8")
    reference = subprocess.run(command, cwd=tmp_path, env=child_env, capture_output=True, encoding="utf-8", timeout=30)
    assert reference.returncode == 0, reference.stdout + reference.stderr
    assert "7 passed" in reference.stdout


@pytest.mark.parametrize("raw", ["not json", '{}', '{"topic":"x","requires_lab":"true","lesson_plan":{}}'])
def test_teacher_invalid_output_logged_and_chained(raw, monkeypatch, caplog):
    async def generate(self, prompt, **kwargs):
        return raw
    monkeypatch.setattr(OllamaProvider, "generate", generate)
    with pytest.raises(WorkflowGenerationError) as caught:
        invoke(create_initial_state("Python 编程实验"))
    assert caught.value.__cause__ is not None
    assert "TeacherAgent 生成失败" in caplog.text


@pytest.mark.parametrize("raw", ["not json", '{}', '{"title":"x"}'])
def test_lab_invalid_output_keeps_input(monkeypatch, raw, caplog):
    state = create_initial_state("Python 编程实验")
    state.update(asyncio.run(TeacherAgent_Node(state)))
    before = deepcopy(state)
    async def generate(self, prompt, **kwargs):
        return raw
    monkeypatch.setattr(OllamaProvider, "generate", generate)
    with pytest.raises(WorkflowGenerationError) as caught:
        asyncio.run(LabAgent_Node(state))
    assert state == before
    assert caught.value.__cause__ is not None
    assert "LabAgent 生成/资产校验失败" in caplog.text


@pytest.mark.parametrize("change", ["bad_path", "syntax", "signature", "weak_tests", "no_todo"])
def test_lab_static_validation(change):
    lab = lab_payload()
    if change == "bad_path":
        lab["files"]["../solution.py"] = lab["files"].pop("solution.py")
    elif change == "syntax":
        lab["files"]["solution.py"] = "class :"
    elif change == "signature":
        lab["reference_solution"] = lab["reference_solution"].replace("numbers:", "values:")
    elif change == "weak_tests":
        lab["files"]["test_solution.py"] = "import pytest\nfrom solution import Solution\ndef test_a():\n    assert True\n"
    else:
        lab["files"]["solution.py"] = lab["files"]["solution.py"].replace("# TODO", "# 完成代码")
    with pytest.raises((ValueError, SyntaxError)):
        validate_lab_assets(LabSpec.model_validate(lab))


def test_lab_one_repair_and_fixed_grading_command(monkeypatch):
    state = create_initial_state("Python 编程实验")
    state.update(asyncio.run(TeacherAgent_Node(state)))
    calls = []
    async def generate(self, prompt, **kwargs):
        if kwargs['schema'].__name__ == 'TaskAlignmentReview':
            return json.dumps(dict(core_algorithm_matches=True, inputs_sufficient=True,
                difficulty_appropriate=True, has_meaningful_application=True,
                reason='候选题使用列表处理核心算法，具有具体应用和充分输入。'))
        calls.append(json.loads(prompt))
        if len(calls) == 1:
            return '{}'
        return json.dumps(independent_payload() if "guided_problem" in calls[-1] else lab_draft_payload())
    monkeypatch.setattr(OllamaProvider, "generate", generate)
    result = asyncio.run(LabAgent_Node(state))
    assert len(calls) == 3
    assert "validation_error" in calls[1]
    assert result["final_output"]["lab"]["grading"]["command"] == [
        "python", "-m", "pytest", "-q", "test_solution.py",
    ]

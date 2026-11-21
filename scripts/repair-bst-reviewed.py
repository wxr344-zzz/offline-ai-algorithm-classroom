"""Explicit migration of the reported BST exercise; original assets stay saved."""
import json
from uuid import uuid4
from lab_contracts import FinalOutput, LabDraft, PrivateAssessment, TestCase, to_public_course
from lab_assembly import assemble_lab
from autonomous_tasks import function_task_to_stdio
from applied_task import AppliedTask, apply_task
from sorting_applications import compile_score_ranking
from bst_assets import bst_guide


def repair_bst(value):
    original = FinalOutput.model_validate(value)
    guide = bst_guide(original.topic)
    if guide is None:
        raise ValueError('This repair requires a BST course')
    old = original.problem
    samples = []
    for case in old.oj_scene.problem.public_test_cases + old.oj_assessment.hidden_test_cases:
        data = json.loads(case.inputs['stdin'])
        samples.append(TestCase(case_id=case.case_id, inputs=data, expected=json.loads(case.expected), description=case.description))
    draft = LabDraft(title=old.oj_scene.problem.title, instructions=old.oj_scene.problem.instructions,
        scaffold_code='class Solution:\n    def solve(self, nums: list[int], scenario_limit: int) -> list[str]:\n        # TODO\n        raise NotImplementedError\n',
        reference_solution='class Solution:\n    def solve(self, nums: list[int], scenario_limit: int) -> list[str]:\n        return []\n',
        difficulty='Medium', constraints=['整数成绩与名额'], teaching_steps=guide.teaching_steps,
        public_test_cases=samples[:4], hidden_test_cases=samples[4:])
    plan = AppliedTask(title='BST 成绩管理：排名与奖励名额',
        setting='在线教育平台将本次测验成绩录入二叉排序树，管理员需要依据成绩和奖励名额生成获奖成绩清单。',
        actor='负责测验成绩与奖励清单的平台管理员',
        objective='按成绩排名选取给定奖励名额内的学生成绩，保留同分记录。',
        input_roles=[{'parameter':'nums','meaning':'按录入顺序给出的学生整数分数列表，每个位置代表一名学生。'},
                     {'parameter':'scenario_limit','meaning':'本次可以获得奖励的学生数量上限。'}],
        decision_rules=['成绩从高到低排名','根据奖励名额选出前几名学生'],
        output_meaning='返回入选学生的分数字符串列表。',
        boundary_rules=['同分仍是不同学生'], transfer_difference='引导题练习树操作，本题通过BST有序遍历实现排名与名额筛选。')
    draft, plan = compile_score_ranking(original.topic, draft, plan)
    # Avoid interpreting the clarification "not student IDs" as an ID output.
    if draft.public_test_cases[0].expected != ['95','92','91']:
        raise ValueError('Unexpected ranking compilation')
    draft = function_task_to_stdio(apply_task(draft, plan))
    course_id = str(uuid4())
    lab, private = assemble_lab(guide, course_id)
    _, oj = assemble_lab(draft, course_id)
    private.oj_scene = oj.oj_scene.model_copy(update={
        'interactive_code':'# 请独立编写完整程序，读取标准输入并打印结果。\n',
        'problem':oj.oj_scene.problem.model_copy(update={'execution_mode':'stdio'})})
    private.oj_assessment = PrivateAssessment(hidden_test_cases=oj.hidden_test_cases,
        reference_solution=oj.reference_solution, pytest_source=oj.pytest_source)
    updated = original.model_copy(deep=True, update={'course_id':course_id,'lab':lab,'problem':private})
    final = FinalOutput.model_validate(updated.model_dump()).model_dump(mode='json',by_alias=True)
    return {'publicCourse':to_public_course(final),'privateOutput':final}

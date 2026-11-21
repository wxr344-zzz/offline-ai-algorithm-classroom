"""Compile recognized sorting decisions; keep generated setting and parameters.

This is a semantic rule compiler, not a fixed question bank. Unsupported task
forms continue through the general workflow; no generated code is executed.
"""
import re
import json
from copy import deepcopy
from applied_task import AppliedTask
from lab_contracts import LabDraft, TestCase
from lab_assembly import entry_point_from_source, normalize_generated_draft


def compile_score_ranking(topic: str, draft: LabDraft, task: AppliedTask):
    bst = bool(re.search(r'二叉排序树|\bBST\b|binary[ -]?search[ -]?tree', topic, re.I))
    if not bst and not re.search(r'排序|sort|bubble', topic, re.I):
        return draft, task
    entry = entry_point_from_source(draft.reference_solution)
    types = {p.name: p.type for p in entry.parameters}
    scores = [r.parameter for r in task.input_roles
              if types.get(r.parameter) == 'list[int]' and re.search('分数|成绩|得分', r.meaning)]
    quotas = [r.parameter for r in task.input_roles
              if types.get(r.parameter) == 'int' and re.search('名额|数量上限|人数|选手数量|前.*名', r.meaning)]
    text = task.objective + ' '.join(task.decision_rules) + task.output_meaning
    if len(types) != 2 or len(scores) != 1 or len(quotas) != 1 or entry.return_type not in ('list[int]', 'list[str]'):
        return draft, task
    if not re.search('前.*名|排名|录取|入选', text) or re.search('分组|区间|及格|最低分|阈值|分数线', text):
        return draft, task
    indexed = bool(re.search('编号|下标|索引|学号', task.output_meaning))
    string_values = entry.return_type == 'list[str]'
    if not indexed and not re.search('分数|成绩|得分', task.output_meaning):
        return draft, task
    score, quota = scores[0], quotas[0]
    result = draft.model_copy(deep=True)
    # Replaying an audited migration must not grow duplicate boundary cases.
    seen_inputs = {json.dumps(c.inputs, sort_keys=True) for c in result.public_test_cases}
    kept = []
    for case in result.hidden_test_cases:
        key = json.dumps(case.inputs, sort_keys=True)
        if case.case_id.startswith('ranking-boundary-') and key in seen_inputs:
            continue
        kept.append(case)
        seen_inputs.add(key)
    result.hidden_test_cases = kept
    # Independent oracle: Python's stable ordering. Reference below uses adjacent
    # swaps, so a bug in its comparison or loop bounds cannot label the examples.
    def answer(values, limit):
        order = sorted(range(len(values)), key=lambda i: (-values[i], i))[:limit]
        selected = order if indexed else [values[i] for i in order]
        return list(map(str, selected)) if string_values else selected
    for case in result.public_test_cases + result.hidden_test_cases:
        values, limit = case.inputs[score], case.inputs[quota]
        if (not isinstance(values, list) or len(values) > 200 or any(type(x) != int for x in values)
                or type(limit) != int or not 0 <= limit <= 200):
            raise ValueError('排名题要求至多200个整数分数及0到200的整数名额，请修复输入用例。')
        case.expected = answer(values, limit)
        case.description = '分数降序，同分按原始下标升序，取至多给定名额；保留重复分数。'
    examples = [([], 0), ([90, 90, 70], 0), ([90, 90, 70], 8), ([70, 95, 95, 88], 2)]
    used = {c.case_id for c in result.public_test_cases + result.hidden_test_cases}
    for i, (values, limit) in enumerate(examples):
        inputs = {score: values, quota: limit}
        if any(c.inputs == inputs for c in result.public_test_cases + result.hidden_test_cases):
            continue
        case_id = f'ranking-boundary-{i}'
        while case_id in used:
            case_id += '-extra'
        used.add(case_id)
        result.hidden_test_cases.append(TestCase(case_id=case_id,
            inputs=inputs, expected=answer(values, limit),
            description='分数降序，同分按原始下标升序，取至多给定名额；保留重复分数。'))
    result.reference_solution = f'''class Solution:
    def solve(self, {score}: list[int], {quota}: int) -> {entry.return_type}:
        order = list(range(len({score})))
        for end in range(len(order) - 1, 0, -1):
            changed = False
            for j in range(end):
                if {score}[order[j]] < {score}[order[j + 1]]:
                    order[j], order[j + 1] = order[j + 1], order[j]
                    changed = True
            if not changed:
                break
        chosen = order[:{quota}]
        result = {'chosen' if indexed else f'[{score}[i] for i in chosen]'}
        return {'list(map(str, result))' if string_values else 'result'}
'''
    if bst:
        result.reference_solution = f'''class Solution:
    def solve(self, {score}: list[int], {quota}: int) -> {entry.return_type}:
        nodes = []
        root = -1
        for i, value in enumerate({score}):
            node = len(nodes)
            nodes.append([(value, -i), i, -1, -1])
            if root == -1:
                root = node
                continue
            current = root
            while True:
                side = 2 if nodes[node][0] < nodes[current][0] else 3
                if nodes[current][side] == -1:
                    nodes[current][side] = node
                    break
                current = nodes[current][side]
        chosen, stack, current = [], [], root
        while (current != -1 or stack) and len(chosen) < {quota}:
            while current != -1:
                stack.append(current)
                current = nodes[current][3]
            current = stack.pop()
            chosen.append(nodes[current][1])
            current = nodes[current][2]
        result = {'chosen' if indexed else f'[{score}[i] for i in chosen]'}
        return {'list(map(str, result))' if string_values else 'result'}
'''
    task = task.model_copy(deep=True, update={
        'objective': '按分数从高到低确定排名，再依据给定名额筛选入选名单。',
        'decision_rules': ['按分数降序排列；分数相同按输入的原始下标升序，编号从0开始。',
                           '选取排名最前的 min(名额,人数) 条记录；重复分数分别占用名额，名额为0时返回空列表。'],
        'output_meaning': '返回按排名顺序的入选者原始下标列表。' if indexed else '返回按排名顺序的入选者分数列表，重复分数仍需保留。',
        'boundary_rules': ['分数列表允许为空；名额为0时返回空列表，名额超过人数时返回全部排名。',
                           '至多200个整数分数，名额为0到200的整数；同分不扩招，严格按原始下标取够名额。'],
        'transfer_difference': ('引导题练习BST的插入、删除与查找；本题使用BST逆中序遍历，结合降序排名、同分顺序和奖励名额筛选。' if bst else '引导题只输出全部元素的排序结果；本题还要处理降序排名、同分顺序、名额与边界。'),
    })
    if string_values:
        task.output_meaning += ' 每个结果元素须输出为JSON字符串，而非JSON数字。'
    result.constraints = deepcopy(task.boundary_rules)
    result.difficulty = 'Medium'
    return normalize_generated_draft(result), task

"""Generated narratives over an executable, typed quicksort application spec.

The model selects a rule and context, never reference code or expected answers.
Selection, ties, boundaries and serialization all share one server-owned spec.
"""
import hashlib
import json
import random
import re
from typing import Literal
from pydantic import Field
from applied_task import AppliedTask, DecisionEvidence, apply_task
from lab_contracts import InternalModel, LabDraft, TeachingStep, TestCase
from lab_assembly import entry_point_from_source, normalize_generated_draft


class QuicksortApplicationSpec(InternalModel):
    title: str = Field(min_length=4, max_length=60)
    setting: str = Field(min_length=20, max_length=180)
    actor: str = Field(min_length=4, max_length=60)
    quantity: str = Field(min_length=2, max_length=16,
        description='每条记录的单个整数测量量名称，例如耗时、得分、温度；不是对象或代码')
    order: Literal['ascending', 'descending']
    result: Literal['values', 'indices', 'total']


def supports_quicksort_application(topic, guided):
    entry=entry_point_from_source(guided.reference_solution)
    return bool(re.search(r'快速排序|quick[ -]?sort',topic,re.I)
        and len(entry.parameters)==1 and entry.parameters[0].type=='list[int]'
        and entry.return_type=='list[int]')


def compile_quicksort_application(spec, guided, identity, *, algorithm='quicksort'):
    """Compile a selected business rule, not an arbitrary model program."""
    entry=entry_point_from_source(guided.reference_solution)
    if len(entry.parameters)!=1 or entry.parameters[0].type!='list[int]':
        raise ValueError('快速排序应用规格需要一个整数列表基础参数')
    name=entry.parameters[0].name
    limit='scenario_limit'
    while limit==name: limit+='_extra'
    descending=spec.order=='descending'
    technique = 'AVL 平衡搜索树插入及中序遍历' if algorithm == 'avl' else '快速排序'
    direction='从高到低' if descending else '从低到高'
    output={'values':'所选记录的整数数值列表，保留重复数值',
            'indices':'所选记录在原输入中的下标列表，下标从0开始',
            'total':'所选记录的整数数值总和'}[spec.result]
    goal=f'将全部记录按{spec.quantity}{direction}排名，在名额内选择记录，返回{output}。'
    # Expected answers use stable builtin ordering; reference uses iterative
    # quicksort partitioning, independently tested against exhaustive inputs.
    def answer(values, quota):
        positions=sorted(range(len(values)),key=lambda i:((-values[i] if descending else values[i]),i))[:quota]
        if spec.result=='indices': return positions
        chosen=[values[i] for i in positions]
        return sum(chosen) if spec.result=='total' else chosen
    samples=[([8,3,8,1],1),([8,3,8,1],3),([],2),([4,4,1],0),
             ([2,2,1],8),([-3,0,-3,4],3),([5],1)]
    rng=random.Random(int.from_bytes(hashlib.sha256(identity.encode()).digest()[:8],'big'))
    samples += [([rng.randint(-30,30) for _ in range(rng.randint(0,18))],rng.randint(0,20)) for _ in range(8)]
    cases=[TestCase(case_id=f'quick-application-{i}',inputs={name:values,limit:quota},
        expected=answer(values,quota),description=f'按{spec.quantity}{direction}排名，同值按原下标，严格按名额选择并返回规定结果。')
        for i,(values,quota) in enumerate(samples)]
    task=AppliedTask(title=spec.title,setting=spec.setting,actor=spec.actor,objective=goal,
        input_roles=[{'parameter':name,'meaning':f'按登记顺序给出的{spec.quantity}整数列表；每个整数对应一条独立记录。'},
                     {'parameter':limit,'meaning':'本次最多选择的记录条数，取值为0到200的整数。'}],
        decision_rules=[f'用{technique}将记录按数值{direction}排列；数值相同时按原始下标升序。',
                        f'选取排名最前的 min({limit},记录数) 条记录；每条重复记录分别占用一个名额。'],
        output_meaning=output+'；列表顺序与排名顺序一致。' if spec.result!='total' else output+'；没有选中记录时总和为0。',
        boundary_rules=['允许空列表，0名额不选择任何记录；名额超过记录数时选择全部记录。',
                        '记录数至多200，数值为-10000到10000的整数；不对同值记录扩招。'],
        transfer_difference='本题以课程算法构建有序记录，还需处理排名方向、同值次序、可变名额和所选记录的结果计算。',
        decision_evidence=DecisionEvidence(base_inputs={name:samples[0][0]},variants=[
            {'constraint':quota,'expected':answer(samples[0][0],quota),'explanation':'只改变名额，由相同基础记录计算所选结果。'} for quota in (1,3)]))
    return_type='int' if spec.result=='total' else 'list[int]'
    final={'values':f'[{name}[i] for i in chosen]', 'indices':'chosen',
           'total':f'sum({name}[i] for i in chosen)'}[spec.result]
    body=f'''        order = list(range(len({name})))
        def key(i):
            return ({'-' if descending else ''}{name}[i], i)
        pending = [(0, len(order) - 1)]
        while pending:
            left, right = pending.pop()
            if left >= right:
                continue
            i, j = left, right
            pivot = key(order[(left + right) // 2])
            while i <= j:
                while key(order[i]) < pivot:
                    i += 1
                while key(order[j]) > pivot:
                    j -= 1
                if i <= j:
                    order[i], order[j] = order[j], order[i]
                    i += 1
                    j -= 1
            if left < j:
                pending.append((left, j))
            if i < right:
                pending.append((i, right))
        chosen = order[:{limit}]
        return {final}
'''
    if algorithm == 'avl':
        from avl_assets import avl_order_body
        body = avl_order_body(name, descending) + f'        chosen = order[:{limit}]\n        return {final}\n'
    draft=LabDraft(title=spec.title,instructions=goal,difficulty='Medium',constraints=task.boundary_rules,
        scaffold_code=f'class Solution:\n    def solve(self, {name}: list[int], {limit}: int) -> {return_type}:\n        # TODO\n        raise NotImplementedError\n',
        reference_solution=f'class Solution:\n    def solve(self, {name}: list[int], {limit}: int) -> {return_type}:\n'+body,
        teaching_steps=[TeachingStep(step_id='ordered-application',title='排名与名额',instruction=f'先完成{technique}，再处理同值顺序、名额和结果。')],
        public_test_cases=cases[:4],hidden_test_cases=cases[4:])
    return apply_task(normalize_generated_draft(draft),task)


async def generate_quicksort_application(provider,topic,guided,identity):
    avl = bool(re.search(r'(?<![a-z])AVL(?![a-z])|平衡二叉树',topic,re.I))
    if not supports_quicksort_application(topic,guided) and not avl: return None
    technique = 'AVL 平衡树动态插入并通过中序遍历生成排名' if avl else '快速排序'
    raw=await provider.generate(json.dumps({'topic':topic, 'algorithm_technique': technique,
        'instruction':f'为{technique}独立练习设计具体的真实活动场景，难度中等偏下。每条记录只有一个整数测量值；任务是按该测量值排序，再按可变名额选取。选择升序或降序，返回所选数值、原下标或总和之一。仅填写场景、角色、测量量名称和枚举选项。不要在场景里写额外预算、固定阈值、及格线、最大利润或其他计算规则；平台按选项统一生成规则、实现和正确测试。题目标题应为场景名称，不叫手动演示。'},ensure_ascii=False),
        json_mode=True,schema=QuicksortApplicationSpec,system='你是算法应用场景设计者。只输出规定JSON，不编写代码或测试答案。',
        options={'temperature':0,'num_predict':768,'num_ctx':4096})
    spec=QuicksortApplicationSpec.model_validate_json(raw,strict=True)
    return compile_quicksort_application(spec,guided,identity,algorithm='avl' if avl else 'quicksort')

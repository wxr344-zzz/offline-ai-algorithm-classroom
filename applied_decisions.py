"""Reviewed decision rules selected by task semantics and typed roles, not topic names."""
import re
from applied_task import AppliedTask
from lab_contracts import LabDraft
from lab_assembly import entry_point_from_source, normalize_generated_draft


def compile_cost_selection(draft: LabDraft, task: AppliedTask) -> tuple[LabDraft,AppliedTask]:
    entry=entry_point_from_source(draft.reference_solution)
    types={p.name:p.type for p in entry.parameters}
    if len(types)!=2 or entry.return_type!='list[int]': return draft,task
    costs=[r.parameter for r in task.input_roles if types.get(r.parameter)=='list[int]' and re.search('价格|成本|费用',r.meaning)]
    budgets=[r.parameter for r in task.input_roles if types.get(r.parameter)=='int' and '预算' in r.meaning]
    rules=' '.join(task.decision_rules)
    indexed=bool(re.search('索引|下标',task.output_meaning))
    prices=bool(re.search('价格|成本|费用',task.output_meaning))
    total_budget=bool(re.search('总预算|总采购预算|总和|总费用|总成本|总价|合计',rules+' '+ ' '.join(r.meaning for r in task.input_roles)))
    # A generated procurement plan often says only “预算上限”. Resolve that
    # underspecification to an explicit cumulative budget before publishing;
    # an explicit per-item cap keeps its original separate meaning.
    if (not total_budget and re.search('采购|购买',task.title+' '+task.objective)
        and re.search('优先.{0,8}(低|便宜)|从低到高',rules)
        and not re.search('单件|每件.{0,6}(上限|预算)|单价上限',rules+' '+ ' '.join(r.meaning for r in task.input_roles))):
        total_budget=True
    if (len(costs)!=1 or len(budgets)!=1 or not (indexed or prices) or not total_budget
        or re.search('两件|两项|两个|2件|二件|最接近',rules+' '+task.objective)):
        return draft,task
    cost_name,budget_name=costs[0],budgets[0]
    result=draft.model_copy(deep=True)
    for case in result.public_test_cases+result.hidden_test_cases:
        values,limit=case.inputs[cost_name],case.inputs[budget_name]
        if not isinstance(values,list) or any(type(x)!=int or x<0 for x in values) or type(limit)!=int or limit<0:
            raise ValueError('成本选择题要求非负整数价格和预算，必须同步修正题面与用例')
        spent,selected=0,[]
        for index in sorted(range(len(values)),key=lambda i:(values[i],i)):
            if spent+values[index]>limit: break
            spent+=values[index]
            selected.append(index)
        case.expected=selected if indexed else [values[i] for i in selected]
        case.description=f'按成本、原下标升序选择，总支出 {spent}，允许总支出恰好等于预算。'
    samples=result.public_test_cases+result.hidden_test_cases
    # Construct boundary evidence from the audited policy when changing the
    # supplied budgets did not actually change any purchase decision.
    if not any(left.inputs[cost_name]==right.inputs[cost_name] and left.expected!=right.expected
               for i,left in enumerate(samples) for right in samples[i+1:]):
        from lab_contracts import TestCase
        result.public_test_cases[:2]=[
            TestCase(case_id='public-1',inputs={cost_name:[2,3],budget_name:1},expected=[],description='预算不足以购买任何物品'),
            TestCase(case_id='public-2',inputs={cost_name:[2,3],budget_name:5},expected=[0,1] if indexed else [2,3],description='预算恰好购买两件物品，总支出为5')]
    # This implementation is developer-owned; generated source is never executed.
    result.reference_solution=f'''class Solution:
    def solve(self, {cost_name}: list[int], {budget_name}: int) -> list[int]:
        selected = []
        spent = 0
        for index in sorted(range(len({cost_name})), key=lambda i: ({cost_name}[i], i)):
            if spent + {cost_name}[index] > {budget_name}:
                break
            spent += {cost_name}[index]
            selected.append(index)
        return {'selected' if indexed else f'[{cost_name}[i] for i in selected]'}
'''
    task=task.model_copy(update={
        'input_roles':[role.model_copy(update={'meaning':'本次采购的累计总预算，全部已选物品成本之和不得超过它。'}) if role.parameter==budget_name else role for role in task.input_roles],
        'objective':'在总预算内购买尽可能多件物品，每件最多购买一次；' + ('返回所选物品的原始下标。' if indexed else '返回按购买顺序排列的物品成本列表。'),
        'decision_rules':['按照成本从低到高选择；成本相同时，原始下标小的优先。','累计支出不能超过总预算，允许累计支出恰好等于预算；遇到下一件也买不起时结束。'],
        'output_meaning':('返回按购买顺序排列的原始下标列表（从 0 开始），不是排序后的成本列表。' if indexed else '返回按购买顺序排列的成本列表；只包含实际购买的物品，重复成本代表不同物品。'),
        'boundary_rules':['成本和预算为非负整数；空列表或没有可以买的物品时返回空列表。','零成本物品可以购买，重复成本仍是不同物品，单件物品最多选择一次。'],
        'transfer_difference':'引导题只输出排序结果；本题还要累计预算并决定哪些物品能被购买。'})
    result.constraints=['成本列表可以为空，成本和预算均为非负整数','每件最多选择一次，重复成本按原下标升序选择，累计费用允许等于预算']
    return normalize_generated_draft(result),task

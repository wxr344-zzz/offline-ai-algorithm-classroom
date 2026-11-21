import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from task_alignment import review_task_alignment, reject_obvious_topic_drift
from applied_task import AppliedTask, InputRole, validate_plan


@pytest.mark.parametrize('topic', ['冒泡排序算法', '快速排序', '归并排序', 'bubble sort'])
def test_sorting_cannot_be_disguised_knapsack(topic):
    with pytest.raises(ValueError, match='偏离排序考点'):
        reject_obvious_topic_drift(topic, {
            'objective': '在预算内采购商品，确保总采购成本不超过预算，并最大化利润',
            'decision_rules': ['按商品的利润密度从高到低排序', '总采购成本不能超过预算'],
        })


@pytest.mark.parametrize('task', [
    {'objective': '按成绩降序排名，按名额筛选录取名单，同分保留原始顺序'},
    {'objective': '按耗时升序处理任务，在配额内选择任务并统计总耗时'},
    {'objective': '按整数温度排序并对相邻读数分组，输出各组最小值和数量'},
])
def test_sorting_has_varied_valid_applications(task):
    reject_obvious_topic_drift('冒泡排序', task)


def test_reported_item_records_are_incompatible_with_integer_list():
    plan = AppliedTask(title='预算内采购排序', setting='公司需要在日常采购活动中对多种商品进行采购决策。',
        actor='负责日常采购的采购经理', objective='按性价比排序商品，在预算内最大化采购利润。',
        input_roles=[InputRole(parameter='nums', meaning='商品列表，每个商品包含名称、单价和利润'),
                     InputRole(parameter='scenario_limit', meaning='本次采购预算上限')],
        decision_rules=['按性价比排序商品', '累计成本不超过预算'],
        output_meaning='返回采购商品列表', boundary_rules=['预算为非负整数'],
        transfer_difference='增加实际采购预算')
    with pytest.raises(ValueError, match='平坦列表'):
        validate_plan(plan, {'nums': 'list[int]'})


@pytest.mark.parametrize('flag', ['core_algorithm_matches', 'inputs_sufficient',
                                 'difficulty_appropriate', 'has_meaningful_application'])
def test_any_semantic_rejection_requires_replanning(flag):
    verdict = dict(core_algorithm_matches=True, inputs_sufficient=True,
                   difficulty_appropriate=True, has_meaningful_application=True,
                   reason='候选题依赖另一种核心算法，需重新生成符合当前算法的任务。')
    verdict[flag] = False
    provider = SimpleNamespace(generate=AsyncMock(return_value=json.dumps(verdict)))
    with pytest.raises(ValueError, match='考点一致性审查'):
        asyncio.run(review_task_alignment(provider, 'KMP',
            SimpleNamespace(title='字符串匹配', instructions='查找模式串'), {'objective': '某候选业务任务'}))


def test_review_is_topic_independent_and_receives_no_reference_answers():
    verdict = dict(core_algorithm_matches=True, inputs_sufficient=True,
                   difficulty_appropriate=True, has_meaningful_application=True,
                   reason='候选任务由当前算法直接解决，并且只增加简单筛选条件。')
    provider = SimpleNamespace(generate=AsyncMock(return_value=json.dumps(verdict)))
    guide = SimpleNamespace(title='自定义算法引导', instructions='处理当前算法的输入结构')
    task = {'objective': '使用当前算法产生结果，再做一次分组统计'}
    asyncio.run(review_task_alignment(provider, '未预设名称的新算法', guide, task))
    sent = json.loads(provider.generate.call_args.args[0])
    assert sent['topic'] == '未预设名称的新算法'
    assert sent['proposed_task'] == task
    assert 'reference_solution' not in sent and 'expected' not in sent
    assert sent['review_phase'] == 'task_specification_before_implementation'
    assert '不得声称不存在的代码' in sent['instruction']
    assert '未列出具体输入数值' in sent['instruction']


@pytest.mark.parametrize('algorithm', ['AVL', 'KMP', '快速排序', '未登记的新算法'])
def test_algorithm_requirement_does_not_invalidate_computable_rules(algorithm):
    from applied_task import validate_business_rules
    validate_business_rules([
        f'实现{algorithm}算法维护物资索引。',
        '只处理前 scenario_limit 条登记记录，按编号递增返回有效记录。',
    ])


def test_textbook_only_rules_still_rejected():
    from applied_task import validate_business_rules
    with pytest.raises(ValueError, match='业务规则'):
        validate_business_rules(['介绍算法的基本原理。', '实现AVL算法。'])


def test_plan_review_receives_typed_signature_without_exposing_solution():
    from lab_contracts import LabDraft
    from test_agent_workflow import lab_draft_payload
    verdict = dict(core_algorithm_matches=True, inputs_sufficient=True,
                   difficulty_appropriate=True, has_meaningful_application=True,
                   reason='题目输入结构足以表达业务目标，由当前算法维护索引。')
    provider = SimpleNamespace(generate=AsyncMock(return_value=json.dumps(verdict)))
    guide = LabDraft.model_validate(lab_draft_payload())
    asyncio.run(review_task_alignment(provider, 'AVL', guide, {'objective': '维护动态物资索引'}))
    sent = json.loads(provider.generate.call_args.args[0])
    assert sent['input_contract']['parameters'] == [{'name': 'numbers', 'type': 'list[int]'}]
    assert guide.reference_solution not in json.dumps(sent, ensure_ascii=False)

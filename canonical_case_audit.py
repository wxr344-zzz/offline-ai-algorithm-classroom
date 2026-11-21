"""Independent case mathematics for canonical elementary contracts.

Only exact signatures and stated goals are accepted. Never infer a new problem
from its expected values, and never execute an untrusted reference solution.
"""
import re
from lab_assembly import entry_point_from_source


def audit_canonical_cases(draft, topic):
    entry = entry_point_from_source(draft.reference_solution)
    types = {p.name:p.type for p in entry.parameters}
    lists = [name for name, kind in types.items() if kind == 'list[int]']
    if len(lists) != 1:
        return draft
    name = lists[0]
    goal = draft.instructions
    result = draft.model_copy(deep=True)
    if (len(types) == 1 and re.search(r'排序|\bsort|bubble|quicksort|mergesort', topic, re.I)
            and entry.return_type == 'list[int]' and re.search('排序|sort', goal, re.I)
            and not re.search('名额|配额|前.*名|排名|分组|逆序对|次数|步数', goal)):
        descending = bool(re.search('降序|从大到小|descending', goal, re.I))
        for case in result.public_test_cases + result.hidden_test_cases:
            case.expected = sorted(case.inputs[name], reverse=descending)
        return result
    targets = [key for key, kind in types.items() if kind == 'int']
    if (len(types) == 2 and len(targets) == 1 and
            re.search(r'二分查找|折半查找|顺序查找|binary[ -]?search|sequential[ -]?search', topic, re.I)
            and entry.return_type in ('int', 'bool')):
        target = targets[0]
        for case in result.public_test_cases + result.hidden_test_cases:
            values, value = case.inputs[name], case.inputs[target]
            if re.search('二分|折半|binary', topic, re.I) and values != sorted(values):
                raise ValueError('折半查找的输入必须有序；请同步修复题面和测试输入。')
            if entry.return_type == 'bool':
                case.expected = value in values
            else:
                if values.count(value) > 1 and not re.search('首次|第一个|最左|first|leftmost', goal, re.I):
                    raise ValueError('存在重复目标时必须声明首次位置，或使用多解校验器，不能用单一任意下标误判。')
                case.expected = values.index(value) if value in values else -1
        return result
    return draft

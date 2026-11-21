"""Read-only independent audit of this repaired contract, including hidden cases."""
import json
from pathlib import Path
import sys

assets = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
private = assets['privateOutput']['problem']
reports = []
guide = private['guided_scene']['problem']
for phase, cases in [('guided-lab', guide['publicTestCases'] + private['hidden_test_cases']),
                     ('oj-lab', private['oj_scene']['problem']['publicTestCases'] + private['oj_assessment']['hidden_test_cases'])]:
    checked = []
    for case in cases:
        if phase == 'guided-lab':
            nums = case['inputs']['nums']
            expected = [f'插入 {v}' for v in nums]+[f'删除 {v}' for v in nums]+[f'查找 {v} 失败' for v in nums]
            actual = case['expected']
        else:
            data = json.loads(case['inputs']['stdin'])
            expected = [str(v) for v in sorted(data['nums'], reverse=True)[:data['scenario_limit']]]
            actual = json.loads(case['expected'])
        if actual != expected:
            raise ValueError(f"Independent oracle mismatch: {phase} {case['caseId']}")
        checked.append(case['caseId'])
    reports.append({'phase':phase,'verified':len(checked),'cases':checked})
report = {'courseId':assets['publicCourse']['courseId'],'allCasesAgree':True,'reports':reports}
Path('logs/bst-case-audit-20261022.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))

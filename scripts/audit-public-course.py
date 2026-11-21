"""Read-only checks of generated public assets; never execute generated source."""
import json
from pathlib import Path
import re
import sys


def audit(course: dict) -> list[str]:
    issues = []
    guided, independent = course['scenes']
    if guided['problem']['instructions'] == independent['problem']['instructions']:
        issues.append('独立题与引导题题面相同')
    for scene in course['scenes']:
        problem = scene['problem']
        prefix = scene['sceneType']
        if len(problem['publicTestCases']) < 4:
            issues.append(prefix + ': 缺少四项公开用例')
        text = problem['instructions']
        if problem['executionMode'] == 'stdio':
            expected_values = []
            for case in problem['publicTestCases']:
                try:
                    expected_values.append(json.loads(case['expected']))
                except (ValueError, TypeError):
                    pass
                try:
                    inputs = json.loads(case['inputs']['stdin'])
                except (ValueError, KeyError):
                    continue  # Plain text stdin is valid; it need not be JSON.
                for name, value in inputs.items() if isinstance(inputs, dict) else []:
                    if isinstance(value, str) and value.lstrip().startswith(('[', '{')) and 'JSON' in text:
                        try: json.loads(value)
                        except ValueError: issues.append(f'{prefix}: {case["caseId"]}.{name} 包含无效的嵌套 JSON')
            if expected_values and all(type(value) in (int, bool) for value in expected_values):
                if re.search(r'输出\s*(?:是|为)?\s*[:：]?\s*(?:[-•]\s*)?(?:list\[|列表|遍历.*顺序)', text):
                    issues.append(prefix + ': 题面要求列表/遍历顺序，但公开预期值为标量')
                if all(type(value) is bool for value in expected_values) and re.search(r'返回.{0,8}(?:第一个位置|索引|下标)', text):
                    issues.append(prefix + ': 题面要求位置，但公开预期值为布尔值')
        else:
            for case in problem['publicTestCases']:
                for name, value in case['inputs'].items():
                    if isinstance(value, str) and value.lstrip().startswith(('[', '{')) and 'JSON' in text:
                        try: json.loads(value)
                        except ValueError: issues.append(f'{prefix}: {case["caseId"]}.{name} 包含无效 JSON')
        if prefix == 'oj-lab' and re.search(r'class Solution|def solve', scene['interactiveCode']):
            issues.append('独立题仍包含类/函数骨架')
    if all(re.search(r'(?:最大.{0,4}价值|价值最大)', scene['problem']['instructions']) for scene in course['scenes']):
        issues.append('双实验都要求最大价值，需人工确认独立迁移目标是否重复')
    return issues


if __name__ == '__main__':
    root = Path(sys.argv[1])
    results = []
    for path in sorted(root.glob('*-public.json')):
        value = json.loads(path.read_text(encoding='utf-8'))
        course = value.get('course', value)
        results.append({'file': path.name, 'topic': course['topic'], 'issues': audit(course)})
    output = root / 'public-asset-audit.json'
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(results, ensure_ascii=False))

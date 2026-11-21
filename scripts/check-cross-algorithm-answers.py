"""Independent handwritten oracles for this test run; never executes generated code."""
import itertools
import json
from pathlib import Path
import sys


def shortest_paths(matrix, source):
    size = len(matrix)
    dist = [[0 if i == j else matrix[i][j] if matrix[i][j] > 0 else float('inf')
             for j in range(size)] for i in range(size)]
    for middle in range(size):
        for left in range(size):
            for right in range(size):
                dist[left][right] = min(dist[left][right], dist[left][middle] + dist[middle][right])
    return [-1 if value == float('inf') else value for value in dist[source]]


def backpack(weights, values, capacity):
    return max((sum(values[i] for i in selected)
                for size in range(len(weights) + 1) for selected in itertools.combinations(range(len(weights)), size)
                if sum(weights[i] for i in selected) <= capacity), default=0)


def check(name, course):
    reports = []
    for scene in course['scenes']:
        problem = scene['problem']
        failures = []
        for case in problem['publicTestCases']:
            data, expected = case['inputs'], case['expected']
            if problem['executionMode'] == 'stdio':
                if name == 'knapsack':
                    tokens = list(map(int, data['stdin'].split()))
                    n, capacity = tokens[:2]
                    data = {'weights': tokens[2::2][:n], 'values': tokens[3::2][:n], 'capacity': capacity}
                    expected = int(expected)
                else:
                    data = json.loads(data['stdin'])
                    expected = json.loads(expected)
            if name == 'binary-search':
                actual = (data['target'] in data['nums']) if type(expected) is bool else (
                    data['nums'].index(data['target']) if data['target'] in data['nums'] else -1)
            elif name == 'dijkstra':
                distances = shortest_paths(json.loads(data['graph']), data['source'])
                actual = (all(value >= 0 for value in distances) if type(expected) is bool else
                          distances if isinstance(expected, list) else
                          sum(distances) if all(value >= 0 for value in distances) else -1)
            elif problem.get('standardIoProfile') == 'knapsack-minweight':
                choices = [sum(data['weights'][i] for i in selected)
                           for size in range(len(data['weights']) + 1)
                           for selected in itertools.combinations(range(len(data['weights'])), size)
                           if sum(data['values'][i] for i in selected) >= data['capacity']]
                actual = min(choices, default=-1)
            else:
                actual = backpack(data['weights'], data['values'], data['capacity'])
            if expected != actual:
                failures.append({'caseId': case['caseId'], 'publishedExpected': expected, 'oracleExpected': actual})
        reports.append({'phase': scene['sceneType'], 'title': problem['title'],
                        'passed': len(problem['publicTestCases']) - len(failures), 'total': len(problem['publicTestCases']), 'failures': failures})
    return {'algorithm': name, 'courseId': course['courseId'], 'phases': reports}


if __name__ == '__main__':
    root = Path(sys.argv[1])
    reports = []
    for name in ('binary-search', 'dijkstra', 'knapsack'):
        path = root / f'{name}-verified-assets.json'
        if not path.exists(): path = root / f'{name}-public.json'
        data = json.loads(path.read_text(encoding='utf-8-sig'))
        reports.append(check(name, data.get('course', data)))
    (root / 'answer-oracle-report.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(reports, ensure_ascii=False))

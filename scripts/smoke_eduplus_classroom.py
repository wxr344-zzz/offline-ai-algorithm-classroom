"""验证真实课堂创建、复盘、导出和所有权；不执行模型或学生代码。"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

import httpx
import nbformat


def smoke(base: str) -> None:
    evidence = []
    root = Path(__file__).resolve().parents[1]
    with httpx.Client(base_url=base, timeout=660) as client:
        for prompt, expected_lab in [
            ('Python 整数列表求和编程实验，Solution.solve(nums)，空列表返回 0', True),
            ('计算机网络分层，只讲理论，不需要编程实验', False),
        ]:
            start = time.monotonic()
            generated = client.post('/api/generate', json={'prompt': prompt})
            generated.raise_for_status()
            course = generated.json()
            assert course['requiresLab'] is expected_lab
            prefix = f"/api/eduplus/courses/{course['courseId']}"
            classroom = client.post(prefix + '/classroom')
            classroom.raise_for_status()
            assert classroom.status_code == 201
            target = classroom.json()
            repeated = client.post(prefix + '/classroom')
            repeated.raise_for_status()
            assert repeated.status_code == 200 and repeated.json() == target
            public = client.get(prefix + '/classroom')
            public.raise_for_status()
            assert public.json()['course'] == course
            assert len(public.json()['teaching']['questions']) >= 3
            assert 'reference_solution' not in public.text and 'hidden_test_cases' not in public.text
            review = client.get(prefix + '/review')
            review.raise_for_status()
            assert review.json()['quiz'] is None and review.json()['quizStatus'] == 'not-submitted'
            assert review.json()['events'] == [] and review.json()['dialogue'] == []
            markdown = client.get(prefix + '/review', params={'format': 'markdown'})
            markdown.raise_for_status()
            assert 'text/markdown' in markdown.headers['content-type']
            assert '尚无已提交' in markdown.text and '不是正式判题成绩' in markdown.text
            notebook = client.get(prefix + '/notebook')
            notebook.raise_for_status()
            parsed = nbformat.reads(notebook.text, as_version=4)
            nbformat.validate(parsed)
            assert len(parsed.cells) == (3 if expected_lab else 1)
            assert client.get(prefix + '/teacher-notebook').status_code == 403
            with httpx.Client(base_url=base, timeout=30) as other:
                for path in ('/classroom', '/review'):
                    assert other.get(prefix + path).status_code == 404
                assert other.post(prefix + '/classroom').status_code == 404
            (root / f'logs/eduplus-review-{expected_lab}.md').write_text(markdown.text, encoding='utf-8')
            evidence.append({
                'courseId': course['courseId'], 'stageId': target['stageId'],
                'requiresLab': expected_lab, 'nativeClassroomCreated': True,
                'idempotentReuse': True, 'publicOnly': True, 'emptyReviewIsHonest': True,
                'markdownExport': True, 'studentNotebook': True,
                'teacherRoleDenied': True, 'otherOwnerDenied': True,
                'seconds': round(time.monotonic() - start, 2),
            })
            print(json.dumps(evidence[-1], ensure_ascii=False), flush=True)
    (root / 'logs/eduplus-classroom-smoke.json').write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8',
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:3000')
    smoke(parser.parse_args().base)

"""真实 Next/Python/Ollama/PostgreSQL 草稿与导出链路；不在宿主机执行学生代码。"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

import httpx
import nbformat


def smoke(base: str) -> None:
    start = time.monotonic()
    with httpx.Client(base_url=base, timeout=660) as client:
        response = client.post('/api/generate', json={'prompt': 'Python 整数列表求和编程实验，使用 Solution.solve，参数名 nums，空列表返回 0'})
        response.raise_for_status()
        course = response.json()
        guided, oj = course['scenes']
        course_id = course['courseId']
        url = f"/api/eduplus/courses/{course_id}/drafts/{guided['sceneId']}"
        draft = client.get(url)
        draft.raise_for_status()
        assert draft.json()['revision'] == 0
        code = '# 已保存的学生作答，用于验证导出，不执行\n' + guided['interactiveCode']
        body = {'problemVersion': guided['problem']['problemVersion'], 'code': code, 'revision': 0}
        saved = client.put(url, json=body)
        saved.raise_for_status()
        assert saved.json()['revision'] == 1
        assert client.get(url).json()['code'] == code
        conflict = client.put(url, json=body)
        assert conflict.status_code == 409
        assert conflict.json()['error']['code'] == 'DRAFT_CONFLICT'
        independent = client.get(f"/api/eduplus/courses/{course_id}/drafts/{oj['sceneId']}")
        independent.raise_for_status()
        assert independent.json()['revision'] == 0
        download = client.get(f'/api/eduplus/courses/{course_id}/notebook', params={'sceneType': 'guided-lab', 'source': 'draft'})
        download.raise_for_status()
        assert download.content, 'Notebook 响应不能为空'
        notebook = nbformat.reads(download.text, as_version=4)
        nbformat.validate(notebook)
        assert len(notebook.cells) == 3
        assert code in notebook.cells[1].source
        assert notebook.metadata.eduplus.draftRevision == 1
        assert notebook.metadata.eduplus.codeSource == 'saved-student-draft'
        assert notebook.metadata.eduplus.audience == 'student'
        assert client.get(f'/api/eduplus/courses/{course_id}/notebook', params={'sceneType': 'oj-lab', 'source': 'draft'}).status_code == 409
        with httpx.Client(base_url=base, timeout=30) as other:
            assert other.get(url).status_code == 404
            assert other.put(url, json=body).status_code == 404
        root = Path(__file__).resolve().parents[1]
        nbformat.write(notebook, root / 'logs/eduplus-student-draft.ipynb')
        evidence = {'courseId': course_id, 'savedDraft': True, 'casConflict': True, 'independentScenes': True, 'otherOwnerDenied': True, 'studentDraftNotebook': True, 'seconds': round(time.monotonic() - start, 2)}
        (root / 'logs/eduplus-practice-smoke.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(evidence, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:3000')
    smoke(parser.parse_args().base)

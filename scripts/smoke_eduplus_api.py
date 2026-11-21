"""通过真实 HTTP 验证 Next → Python → Ollama；需先启动两个服务。"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time

import httpx
import nbformat

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lab_contracts import PublicCourse  # noqa: E402


def smoke(url: str, timeout: float) -> None:
    evidence = []
    with httpx.Client(timeout=timeout) as client:
        invalid = client.post(url, json={"prompt": " "})
        assert invalid.status_code == 400, f"无效请求应为 400，实际为 {invalid.status_code}"
        for prompt, requires_lab in [
            ("Python 列表求和编程实验，输入整数列表，空列表返回 0", True),
            ("计算机网络分层，只讲理论，不需要实验", False),
        ]:
            start = time.monotonic()
            response = client.post(url, json={"prompt": prompt})
            response.raise_for_status()
            body = response.json()
            course = PublicCourse.model_validate(body)
            assert course.requires_lab is requires_lab
            base = url.rsplit('/api/generate', 1)[0]
            saved = client.get(f'{base}/api/eduplus/courses/{course.course_id}')
            saved.raise_for_status()
            assert saved.json() == body, '保存后的课程与生成响应不一致'
            library = client.get(f'{base}/api/eduplus/courses')
            library.raise_for_status()
            assert course.course_id in [item['courseId'] for item in library.json()['courses']]
            for scene_type in ('guided-lab', 'oj-lab') if requires_lab else ('guided-lab',):
                download = client.get(f'{base}/api/eduplus/courses/{course.course_id}/notebook', params={'sceneType': scene_type})
                download.raise_for_status()
                notebook = nbformat.reads(download.text, as_version=4)
                nbformat.validate(notebook)
                assert notebook.metadata.eduplus.courseId == course.course_id
                assert len(notebook.cells) == (3 if requires_lab else 1)
            serialized = json.dumps(body, ensure_ascii=False)
            for forbidden in ("reference_solution", "referenceSolution", "hidden_test_cases", "hiddenTestCases", "pytest_source", "pytestSource"):
                assert f'"{forbidden}"' not in serialized, f"响应包含私有字段 {forbidden}"
            evidence.append({
                "status": response.status_code, "requiresLab": requires_lab,
                "sceneCount": len(course.scenes), "courseId": course.course_id,
                "requestId": response.headers.get("X-Request-ID"),
                "seconds": round(time.monotonic() - start, 2),
                "persistedRead": True, "studentNotebook": True,
            })
            print(json.dumps(evidence[-1], ensure_ascii=False), flush=True)
    root = Path(__file__).resolve().parents[1]
    path = root / "logs/eduplus-api-smoke.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps({"url": url, "results": evidence}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:3000/api/generate")
    parser.add_argument("--timeout", type=float, default=660)
    args = parser.parse_args()
    smoke(args.url, args.timeout)

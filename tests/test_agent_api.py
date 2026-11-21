"""HTTP 契约、私有资产隔离、失败状态及取消/并发回归。"""
import asyncio
from pathlib import Path
import json

from fastapi.testclient import TestClient
import httpx
import pytest

from agent_api import APISettings, create_app
from agent_workflow import WorkflowGenerationError
from lab_assembly import assemble_lab
from lab_contracts import FinalOutput, LabDraft, PublicCourse
from ollama_provider import OllamaConnectionError, OllamaModelNotFoundError, OllamaTimeoutError, OllamaTransientError, OllamaRepetitionError


def theory_result():
    return FinalOutput(
        course_id="course-1", topic="网络分层", requires_lab=False,
        lesson_plan={"title": "网络分层", "objectives": ["认识分层"], "knowledge_points": ["OSI"]},
        common_mistakes=[], lab=None, problem=None, status="ready",
    ).model_dump(mode="json")


def test_success_trims_prompt_and_health():
    prompts = []
    async def runner(prompt):
        prompts.append(prompt)
        return theory_result()
    with TestClient(create_app(runner=runner)) as client:
        assert client.get("/health").json()["status"] == "ok"
        response = client.post("/v1/generate", json={"prompt": " 网络分层 "})
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-request-id"]
        PublicCourse.model_validate(response.json())
        assert response.json()["scenes"] == []
    assert prompts == ["网络分层"]


@pytest.mark.parametrize("body", [None, {}, {"prompt": " "}, {"prompt": 1}, {"prompt": "x", "extra": "secret"}, {"prompt": "x" * 12001}])
def test_invalid_request_never_invokes_agent(body):
    async def runner(_prompt):
        pytest.fail("无效请求不能调用 Agent")
    with TestClient(create_app(runner=runner)) as client:
        response = client.post("/v1/generate", json=body)
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "INVALID_REQUEST"
        assert "secret" not in response.text


def test_malformed_json():
    with TestClient(create_app()) as client:
        assert client.post("/v1/generate", content="{", headers={"Content-Type": "application/json"}).status_code == 400


def test_owner_cache_namespace_is_internal_only_and_validated():
    token='owner-cache-internal-token-at-least-32-chars'
    async def runner(prompt):return theory_result()
    with TestClient(create_app(APISettings(service_token=token),runner=runner)) as client:
        body={'prompt':'网络分层','cache_namespace':'owner:'+'a'*64}
        assert client.post('/v1/generate',json=body).status_code==400
        assert client.post('/internal/v1/generate',json=body).status_code==401
        headers={'Authorization':'Bearer '+token}
        assert client.post('/internal/v1/generate',json=body,headers=headers).status_code==200
        assert client.post('/internal/v1/generate',json={**body,'cache_namespace':'../another-owner'},headers=headers).status_code==400


@pytest.mark.parametrize("cause,status,code", [
    (OllamaConnectionError("PRIVATE_CONNECTION"), 503, "OLLAMA_UNAVAILABLE"),
    (OllamaModelNotFoundError("PRIVATE_MODEL"), 503, "MODEL_NOT_FOUND"),
    (OllamaTimeoutError("PRIVATE_TIMEOUT"), 504, "AGENT_TIMEOUT"),
    (OllamaTransientError("PRIVATE_SERVER_ERROR"), 503, "OLLAMA_GENERATION_ERROR"),
    (OllamaRepetitionError("PRIVATE_REPETITION"), 503, "OLLAMA_REPETITION"),
    (ValueError("PRIVATE_INVALID_OUTPUT"), 502, "GENERATION_FAILED"),
])
def test_wrapped_failure_mapping(cause, status, code):
    async def runner(_prompt):
        raise WorkflowGenerationError("PRIVATE_OUTPUT") from cause
    with TestClient(create_app(runner=runner)) as client:
        response = client.post("/v1/generate", json={"prompt": "实验"})
    assert response.status_code == status
    assert response.json()["error"]["code"] == code
    assert response.json()["error"]["requestId"] == response.headers["x-request-id"]
    assert "PRIVATE" not in response.text


def test_unknown_failure_is_safe_500():
    async def runner(_prompt):
        raise RuntimeError("PRIVATE_TRACE")
    with TestClient(create_app(runner=runner)) as client:
        response = client.post("/v1/generate", json={"prompt": "实验"})
    assert response.status_code == 500
    assert "PRIVATE_TRACE" not in response.text


def test_timeout_cancels_runner_and_releases_slot():
    cancelled = []
    async def runner(prompt):
        if prompt == "slow":
            try:
                await asyncio.sleep(10)
            finally:
                cancelled.append(True)
        return theory_result()
    with TestClient(create_app(APISettings(timeout_seconds=0.02), runner)) as client:
        response = client.post("/v1/generate", json={"prompt": "slow"})
        assert response.status_code == 504
        assert cancelled == [True]
        assert client.post("/v1/generate", json={"prompt": "fast"}).status_code == 200


def test_concurrent_request_fails_fast():
    async def exercise():
        started, release = asyncio.Event(), asyncio.Event()
        async def runner(_prompt):
            started.set()
            await release.wait()
            return theory_result()
        transport = httpx.ASGITransport(app=create_app(runner=runner))
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            first = asyncio.create_task(client.post("/v1/generate", json={"prompt": "first"}))
            await asyncio.wait_for(started.wait(), 2)
            second = await client.post("/v1/generate", json={"prompt": "second"})
            assert second.status_code == 429
            assert second.headers["retry-after"] == "5"
            release.set()
            assert (await first).status_code == 200
    asyncio.run(exercise())


def test_authenticated_course_requests_queue_without_rejecting_normal_concurrency():
    async def exercise():
        started,release=asyncio.Event(),asyncio.Event()
        calls=[]
        async def runner(prompt):
            calls.append(prompt)
            if prompt=='first':
                started.set()
                await release.wait()
            return theory_result()
        app=create_app(APISettings(service_token='t'*32,timeout_seconds=2),runner)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            headers={'Authorization':'Bearer '+'t'*32}
            first=asyncio.create_task(client.post('/internal/v1/generate',json={'prompt':'first'},headers=headers))
            await asyncio.wait_for(started.wait(),1)
            second=asyncio.create_task(client.post('/internal/v1/generate',json={'prompt':'second'},headers=headers))
            await asyncio.sleep(0.02)
            assert calls==['first']
            assert not second.done()
            release.set()
            assert (await first).status_code==200
            assert (await second).status_code==200
            assert calls==['first','second']
    asyncio.run(exercise())


def test_cancelled_internal_waiter_never_consumes_a_generation_slot(monkeypatch):
    async def disconnected(request):
        if request.query_params.get('cancel')=='1':
            await asyncio.sleep(0.01)
        else:
            await asyncio.Event().wait()
    monkeypatch.setattr('agent_api.watch_disconnect',disconnected)
    async def exercise():
        started,release=asyncio.Event(),asyncio.Event();calls=[]
        async def runner(prompt):
            calls.append(prompt)
            if prompt=='first':
                started.set();await release.wait()
            return theory_result()
        app=create_app(APISettings(service_token='t'*32,timeout_seconds=2),runner)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            headers={'Authorization':'Bearer '+'t'*32}
            first=asyncio.create_task(client.post('/internal/v1/generate',json={'prompt':'first'},headers=headers))
            await started.wait()
            cancelled=await client.post('/internal/v1/generate?cancel=1',json={'prompt':'cancelled'},headers=headers)
            assert cancelled.status_code==499
            assert calls==['first']
            release.set();assert (await first).status_code==200
            assert (await client.post('/internal/v1/generate',json={'prompt':'third'},headers=headers)).status_code==200
            assert calls==['first','third']
    asyncio.run(exercise())


def test_disconnect_cancels_generation(monkeypatch):
    async def disconnected(_request):
        await asyncio.sleep(0.01)
    monkeypatch.setattr("agent_api.watch_disconnect", disconnected)
    cancelled = []
    async def runner(_prompt):
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.append(True)
    with TestClient(create_app(runner=runner)) as client:
        response = client.post("/v1/generate", json={"prompt": "实验"})
    assert response.status_code == 499
    assert cancelled == [True]


def test_public_fixture_validates():
    path = Path(__file__).resolve().parents[1] / "contracts/examples/public-lab.json"
    PublicCourse.model_validate(json.loads(path.read_text(encoding="utf-8")))


def test_dynamic_simulator_routes_unknown_topics_without_host_code(monkeypatch):
    calls=[]
    async def compute(algorithm,topic,data,scope):
        calls.append((algorithm,topic,data,scope))
        return {'engine':'python-sandbox','frames':[{'index':0}],'outcome':2,'verified':True}
    monkeypatch.setattr('exam_simulator.generated.compute_trace',compute)
    with TestClient(create_app(APISettings(service_token='t'*32))) as client:
        headers={'Authorization':'Bearer '+'t'*32}
        response=client.post('/internal/v1/simulations/trace',headers=headers,
            json={'topic':'某明确新算法','input':{'n':3},'scope':'owner-a'})
        assert response.status_code==200
        assert response.json()['engine']=='python-sandbox'
        assert calls==[(None,'某明确新算法',{'n':3},'owner-a')]
        assert client.post('/internal/v1/simulations/trace',headers=headers,
            json={'topic':'算法','source':'open(".env")'}).status_code==400


def test_simulator_disconnect_cancels_model_and_sandbox_work(monkeypatch):
    cancelled=[]
    async def compute(*args):
        try:await asyncio.sleep(10)
        finally:cancelled.append(True)
    async def disconnected(request):await asyncio.sleep(0.01)
    monkeypatch.setattr('exam_simulator.generated.compute_trace',compute)
    monkeypatch.setattr('agent_api.watch_disconnect',disconnected)
    with TestClient(create_app(APISettings(service_token='t'*32))) as client:
        response=client.post('/internal/v1/simulations/trace',
            headers={'Authorization':'Bearer '+'t'*32},json={'topic':'新算法'})
        assert response.status_code==499
        assert cancelled==[True]


def test_lab_http_response_excludes_private_assets():
    draft = LabDraft(
        title="列表求和", instructions="返回总和，空列表为 0", difficulty="Easy", constraints=["整数列表"],
        scaffold_code="class Solution:\n    def solve(self, nums: list[int]) -> int:\n        # TODO\n        raise NotImplementedError\n",
        reference_solution="class Solution:\n    def solve(self, nums: list[int]) -> int:\n        return sum(nums)  # PRIVATE_REFERENCE\n",
        teaching_steps=[{"stepId": "step-1", "title": "累加", "instruction": "遍历", "hint": "从 0 开始"}],
        public_test_cases=[{"caseId": "public", "inputs": {"nums": [1]}, "expected": 1, "description": "示例"}],
        hidden_test_cases=[
            {"caseId": f"PRIVATE_CASE_{i}", "inputs": {"nums": values}, "expected": total, "description": "PRIVATE_DESCRIPTION"}
            for i, (values, total) in enumerate([([], 0), ([-1], -1), ([1, -1], 0)])
        ],
    )
    legacy, private = assemble_lab(draft, "course-1")
    data = theory_result()
    data.update(requires_lab=True, lab=legacy.model_dump(mode="json"), problem=private.model_dump(mode="json"))
    async def runner(_prompt):
        return data
    with TestClient(create_app(runner=runner)) as client:
        response = client.post("/v1/generate", json={"prompt": "列表求和"})
    assert response.status_code == 200
    assert len(PublicCourse.model_validate(response.json()).scenes) == 2
    assert "PRIVATE_" not in response.text
    assert "pytest_source" not in response.text

def test_code_version_matches_the_app_rule(tmp_path):
    # Same files and value as tests/server/eduplus-local-agent.test.ts (line endings ignored).
    from agent_api import code_version
    (tmp_path/'exam_simulator').mkdir()
    (tmp_path/'agent_api.py').write_bytes(b'a = 1\r\n')
    (tmp_path/'exam_simulator'/'graphs.py').write_bytes(b'b = 2\n')
    (tmp_path/'notes.txt').write_text('ignored')
    assert code_version(tmp_path)=='3a011a614280b433'


def test_unverified_dynamic_simulation_reports_a_plain_reason(monkeypatch):
    async def compute(*args):
        raise ValueError('动态算法经隔离执行或交叉校验未通过：候选实现预运行失败：ValueError: CHECKER_EXECUTION_ERROR:{...}')
    monkeypatch.setattr('exam_simulator.generated.compute_trace',compute)
    with TestClient(create_app(APISettings(service_token='t'*32))) as client:
        response=client.post('/internal/v1/simulations/trace',headers={'Authorization':'Bearer '+'t'*32},
            json={'topic':'请为我讲解梯度下降算法'})
        assert response.status_code==422
        body=response.json()['error']
        assert body['code']=='DYNAMIC_ALGORITHM_UNVERIFIED'
        assert 'CHECKER' not in body['message']

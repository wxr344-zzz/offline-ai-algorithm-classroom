"""本机 Agent HTTP 服务：只返回学生公开契约，不执行生成代码。"""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, field
import hashlib
import hmac
import logging
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
import nbformat
from pydantic import Field

from agent_workflow import app as workflow, create_initial_state, WorkflowGenerationError
from lab_contracts import GenerateRequest, PublicCourse, GeneratedCourse, FinalOutput, to_public_course
from jupyter_exporter import build_student_notebook, build_teacher_notebook
from teaching_assets import ClassroomTeaching, run_teaching
from ollama_provider import OllamaError, OllamaConnectionError, OllamaModelNotFoundError, OllamaTimeoutError, OllamaTransientError, OllamaRepetitionError

logger = logging.getLogger(__name__)
Runner = Callable[[str], Awaitable[dict[str, Any]]]


def code_version(root: Path | None = None) -> str:
    """Fingerprint of the Python sources this process loaded at startup.

    The app compares it with the files on disk: a managed Agent left running
    from before an update (it outlives the app server) is restarted instead
    of silently serving old algorithms. Line endings are ignored. The app's
    copy of this rule is in lib/server/eduplus-local-agent.ts.
    """
    root = root or Path(__file__).resolve().parent
    files = sorted([*root.glob('*.py'), *(root / 'exam_simulator').glob('*.py')],
                   key=lambda p: p.relative_to(root).as_posix())
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.relative_to(root).as_posix().encode() + b'\0')
        digest.update(path.read_bytes().replace(b'\r\n', b'\n') + b'\0')
    return digest.hexdigest()[:16]


CODE_VERSION = code_version()


@dataclass(frozen=True)
class APISettings:
    timeout_seconds: float = 600.0
    max_concurrency: int = 1
    service_token: str = field(default="", repr=False)

    def __post_init__(self) -> None:
        if not 0 < self.timeout_seconds <= 3600:
            raise ValueError("Agent 超时必须介于 0 与 3600 秒之间")
        if not 1 <= self.max_concurrency <= 8:
            raise ValueError("Agent 并发数必须介于 1 与 8 之间")

    @classmethod
    def from_environment(cls) -> APISettings:
        return cls(
            timeout_seconds=float(os.getenv("EDUPLUS_AGENT_TIMEOUT_SECONDS", "600")),
            max_concurrency=int(os.getenv("EDUPLUS_AGENT_MAX_CONCURRENCY", "1")),
            service_token=os.getenv("EDUPLUS_AGENT_SERVICE_TOKEN", ""),
        )


class InternalGenerateRequest(GenerateRequest):
    cache_namespace: str=Field(default='',pattern=r'^$|^owner:[a-f0-9]{64}$')


async def run_agent(prompt: str, *, cache_namespace: str='') -> dict[str, Any]:
    state=create_initial_state(prompt, executable_labs=True)
    state['execution_scope']=cache_namespace
    result = await workflow.ainvoke(state)
    if result.get('verified_lab_assets'):
        # The compiler owns statements, code and executed examples together.
        # Editorial regeneration must not change that accepted contract.
        return result['final_output']
    from problem_statements import review_problem_statements
    try:
        return await review_problem_statements(result["final_output"])
    except (OllamaError, ValueError) as exc:
        raise WorkflowGenerationError('题面核对未通过，请重试当前生成步骤。') from exc


def failure(status: int, code: str, message: str, request_id: str) -> JSONResponse:
    headers = {"Cache-Control": "no-store", "X-Request-ID": request_id}
    if status == 429:
        headers["Retry-After"] = "5"
    return JSONResponse(
        {"error": {"code": code, "message": message, "requestId": request_id}},
        status_code=status, headers=headers,
    )


def classify_failure(exc: Exception) -> tuple[int, str, str]:
    """检查封装异常的原因链，不向客户端泄露模型输出、堆栈或内部地址。"""
    from lesson_execution import LessonExecutionError
    from executable_lessons import AlgorithmContractError
    cause: BaseException | None = exc
    seen: set[int] = set()
    while cause is not None and id(cause) not in seen:
        seen.add(id(cause))
        if isinstance(cause, LessonExecutionError):
            return 502, 'REFERENCE_EXECUTION_FAILED', '实验参考实现未通过沙箱执行断言，未发布无效题目；可恢复当前生成步骤。'
        if isinstance(cause, AlgorithmContractError):
            return 502, 'ALGORITHM_CONTRACT_FAILED', '算法实现尚未通过独立执行校验，可恢复当前生成步骤；无需修改正常的教学需求。'
        if isinstance(cause, OllamaModelNotFoundError):
            return 503, "MODEL_NOT_FOUND", "本地模型尚未安装，请先使用 ollama pull 拉取模型。"
        if isinstance(cause, OllamaConnectionError):
            return 503, "OLLAMA_UNAVAILABLE", "无法连接本地 Ollama，请确认服务已启动。"
        if isinstance(cause, OllamaTimeoutError):
            return 504, "AGENT_TIMEOUT", "本地模型请求超时，请稍后重试。"
        if isinstance(cause, OllamaRepetitionError):
            return 503, "OLLAMA_REPETITION", "本地模型输出重复，自动调整生成策略后仍未完成，请重试。"
        if isinstance(cause, OllamaTransientError):
            return 503, "OLLAMA_GENERATION_ERROR", "本地 Ollama 生成服务暂时异常，请稍后重试。"
        cause = cause.__cause__
    if isinstance(exc, WorkflowGenerationError):
        return 502, "GENERATION_FAILED", "本次实验数据经自动修复后仍未通过校验，可重试生成；无需修改正常的教学需求。"
    return 500, "INTERNAL_ERROR", "Agent 服务执行失败，请通过请求 ID 查看服务端日志。"


async def watch_disconnect(request: Request) -> None:
    # 路由开始前 FastAPI 已读取并解析请求体；此后只等断开事件。
    # 避免轮询 is_disconnected() 的 AnyIO CancelScope 干扰 asyncio task.cancel()。
    while True:
        event = await request.receive()
        if event["type"] == "http.disconnect":
            return


def create_app(settings: APISettings | None = None, runner: Runner = run_agent,
               teaching_runner: Callable[[PublicCourse], Awaitable[dict[str, Any]]] = run_teaching) -> FastAPI:
    config = settings or APISettings.from_environment()
    slots = asyncio.Semaphore(config.max_concurrency)
    application = FastAPI(title="OpenMAIC EduPlus Agent API", version="1.0")

    @application.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        # 默认 FastAPI 校验详情会包含 input；不回显用户完整 prompt。
        return failure(400, "INVALID_REQUEST", "请求数据未通过接口契约校验，请检查必填字段、类型与长度。", str(uuid4()))

    @application.get("/health")
    async def health() -> dict[str, Any]:
        # 进程存活检查；不代表 Ollama 或某个模型已就绪。
        return {"status": "ok", "service": "eduplus-agent", "schemaVersion": "1.0",
                "codeVersion": CODE_VERSION, "pid": os.getpid()}

    def authorize_internal(request: Request) -> JSONResponse | None:
        if not config.service_token:
            return failure(503, "AGENT_CONFIG_ERROR", "内部服务凭据尚未配置。", str(uuid4()))
        credential = request.headers.get("authorization", "")
        if not hmac.compare_digest(credential.encode(), f"Bearer {config.service_token}".encode()):
            return failure(401, "INVALID_SERVICE_CREDENTIAL", "内部服务认证失败。", str(uuid4()))
        return None

    @application.get('/internal/v1/simulations', include_in_schema=False)
    async def simulation_catalog(request: Request):
        denied=authorize_internal(request)
        if denied is not None:return denied
        from exam_simulator import catalog
        from exam_simulator.i18n import localize_catalog
        lang=request.query_params.get('lang','')[:20]
        return JSONResponse({'profiles':localize_catalog(catalog(),lang)}, headers={'Cache-Control':'no-store'})

    @application.post('/internal/v1/simulations/trace', include_in_schema=False)
    async def simulation_trace(request: Request):
        denied=authorize_internal(request)
        if denied is not None:return denied
        import json
        from exam_simulator.generated import compute_trace,replay_execution_proof
        request_id=str(uuid4())
        # Registry hits keep the maintained executor; unknown named topics use
        # generated pure functions inside a disposable WASM sandbox.
        raw=await request.body()
        if len(raw)>200000:return failure(413,'INPUT_TOO_LARGE','推演契约超过大小限制。',request_id)
        try:
            body=json.loads(raw)
            # Presentation language of the teaching text; applied after execution and verification.
            lang=body.pop('lang','') if type(body) is dict else ''
            if type(lang) is not str or len(lang)>20:raise ValueError('语言参数无效')
            if type(body)is not dict or set(body)-{'algorithm','topic','input','scope','proof'}:raise ValueError('请求字段无效')
            if 'proof' not in body and len(raw)>24000:return failure(413,'INPUT_TOO_LARGE','教学输入超过24KB。',request_id)
            if 'algorithm'in body and (type(body['algorithm'])is not str or len(body['algorithm'])>100):raise ValueError('算法编号无效')
            scope=body.get('scope','local')
            if type(scope)is not str or len(scope)>128:raise ValueError('推演作用域无效')
            operation=(replay_execution_proof(body['proof'],body.get('input'),body.get('topic',''),scope)
                       if 'proof' in body else compute_trace(body.get('algorithm'),body.get('topic',''),body.get('input'),scope))
            generation=asyncio.create_task(asyncio.wait_for(operation,300))
            disconnect=asyncio.create_task(watch_disconnect(request))
            try:
                done,_pending=await asyncio.wait([generation,disconnect],return_when=asyncio.FIRST_COMPLETED)
                if generation not in done:
                    return failure(499,'REQUEST_CANCELLED','推演已取消',request_id)
                trace=await generation
            finally:
                for task in (generation,disconnect):
                    if not task.done():task.cancel()
                for task in (generation,disconnect):
                    with suppress(asyncio.CancelledError):await task
            from exam_simulator.i18n import localize_trace
            return JSONResponse(localize_trace(trace,lang), headers={'Cache-Control':'no-store'})
        except (ValueError,TypeError,KeyError,IndexError) as exc:
            if str(exc).startswith('动态算法经隔离执行或交叉校验未通过'):
                # Model-written implementation rejected: say so plainly; details stay in the log.
                logger.warning('Dynamic simulation unverified: %s',str(exc)[:1000])
                return failure(422,'DYNAMIC_ALGORITHM_UNVERIFIED','这个算法的推演实现未能通过独立校验，暂时无法演示；可以重试，或换一种说法描述算法。',request_id)
            return failure(400,'INVALID_SIMULATION_INPUT',str(exc)[:240],request_id)
        except asyncio.TimeoutError:
            return failure(504,'DYNAMIC_SIMULATION_TIMEOUT','动态推演生成超时，请重试或缩小输入。',request_id)
        except OSError:
            return failure(503,'SIMULATION_SANDBOX_UNAVAILABLE','隔离推演运行环境暂不可用，请重试。',request_id)
        except OllamaError as exc:
            status,code,message=classify_failure(exc)
            return failure(status,code,message,request_id)

    async def execute(body: GenerateRequest | PublicCourse, request: Request, internal_result: bool = False,
                      teaching: bool = False) -> Any:
        request_id = str(uuid4())
        if slots.locked() and not (internal_result or teaching):
            return failure(429, "AGENT_BUSY", "本地模型正在生成其他课程，请稍后重试。", request_id)
        async def scheduled():
            async with slots:
                if not teaching and runner is run_agent and getattr(body,'cache_namespace',''):
                    return await run_agent(body.prompt.strip(),cache_namespace=body.cache_namespace)
                return await (teaching_runner(body) if teaching else runner(body.prompt.strip()))
        generation = asyncio.create_task(scheduled())
        disconnect = asyncio.create_task(watch_disconnect(request))
        try:
            done, _pending = await asyncio.wait(
                [generation, disconnect], timeout=config.timeout_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if generation in done:
                internal = await generation
                if teaching:
                    payload = ClassroomTeaching.model_validate(internal).model_dump(mode="json", by_alias=True)
                    return JSONResponse(payload, headers={"Cache-Control": "no-store", "X-Request-ID": request_id})
                public = PublicCourse.model_validate(to_public_course(internal))
                payload = (
                    GeneratedCourse(public_course=public, private_output=internal).model_dump(mode="json", by_alias=True)
                    if internal_result else public.model_dump(mode="json", by_alias=True)
                )
                return JSONResponse(
                    payload,
                    headers={"Cache-Control": "no-store", "X-Request-ID": request_id},
                )
            if disconnect in done:
                await disconnect
                return failure(499, "REQUEST_CANCELLED", "客户端已取消生成请求。", request_id)
            return failure(504, "AGENT_TIMEOUT", "课程生成超时，请稍后重试。", request_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Agent 请求失败 requestId=%s errorType=%s", request_id, type(exc).__name__)
            status, code, message = classify_failure(exc)
            return failure(status, code, message, request_id)
        finally:
            for task in (generation, disconnect):
                task.cancel()
            for task in (generation, disconnect):
                with suppress(asyncio.CancelledError, Exception):
                    await task

    @application.post("/v1/generate", response_model=PublicCourse, response_model_by_alias=True)
    async def generate(body: GenerateRequest, request: Request) -> Any:
        return await execute(body, request)

    @application.post("/internal/v1/generate", response_model=GeneratedCourse, include_in_schema=False)
    async def generate_internal(body: InternalGenerateRequest, request: Request) -> Any:
        denied = authorize_internal(request)
        if denied is not None:
            return denied
        return await execute(body, request, internal_result=True)

    @application.post("/internal/v1/notebook", include_in_schema=False)
    async def export_student(course: PublicCourse, request: Request, scene_type: str = "guided-lab") -> Any:
        denied = authorize_internal(request)
        if denied is not None:
            return denied
        if scene_type not in {"guided-lab", "oj-lab"}:
            return failure(400, "INVALID_REQUEST", "实验页面类型无效。", str(uuid4()))
        try:
            notebook = build_student_notebook(course.model_dump(mode="json", by_alias=True), scene_type)
            return Response(
                nbformat.writes(notebook).encode("utf-8"), media_type="application/x-ipynb+json",
                headers={"Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="eduplus-student.ipynb"'},
            )
        except (ValueError, SyntaxError) as exc:
            logger.error("Notebook 导出校验失败 errorType=%s", type(exc).__name__)
            return failure(422, "EXPORT_FAILED", "课程资产未通过导出校验。", str(uuid4()))

    @application.post("/internal/v1/teaching", response_model=ClassroomTeaching, include_in_schema=False)
    async def generate_teaching(course: PublicCourse, request: Request) -> Any:
        denied = authorize_internal(request)
        if denied is not None:
            return denied
        return await execute(course, request, teaching=True)

    @application.post("/internal/v1/teacher-notebook", include_in_schema=False)
    async def export_teacher(body: FinalOutput, request: Request) -> Any:
        denied = authorize_internal(request)
        if denied is not None:
            return denied
        try:
            notebook = build_teacher_notebook(body.model_dump(mode="json"))
            return Response(nbformat.writes(notebook).encode("utf-8"), media_type="application/x-ipynb+json",
                            headers={"Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="eduplus-teacher.ipynb"'})
        except (ValueError, SyntaxError):
            return failure(422, "EXPORT_FAILED", "教师 Notebook 资产未通过校验。", str(uuid4()))

    return application


app = create_app()

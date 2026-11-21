"""Async Ollama transport for a future Python/FastAPI backend (Python 3.10+).

The existing Next.js application uses its own TypeScript Ollama integration.
JSON streams yield text fragments; validation happens when the stream ends.
Callers must discard buffered fragments if iteration raises an exception.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Callable, Mapping
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from tenacity import (
    AsyncRetrying,
    before_sleep_log,
    retry_if_exception,
    stop_after_attempt,
    wait_random_exponential,
)

logger = logging.getLogger(__name__)
SchemaT = TypeVar("SchemaT", bound=BaseModel)
OutputSchema = type[BaseModel] | None


class OllamaError(RuntimeError):
    """Base exception, suitable for catching at the application boundary."""


class OllamaTransientError(OllamaError):
    """A failure that may succeed on a later request."""


class OllamaConnectionError(OllamaTransientError, ConnectionError):
    pass


class OllamaTimeoutError(OllamaTransientError, TimeoutError):
    pass


class OllamaRepetitionError(OllamaTransientError):
    """The sampler aborted a repetitive prediction; identical retries cannot recover it."""


class OllamaModelNotFoundError(OllamaError):
    pass


class OllamaResponseError(OllamaError):
    """Invalid envelope, invalid structured output, or API-level error."""


class _Envelope(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    response: str = ""
    done: bool = False
    error: str | None = None
    done_reason: str | None = None


class BaseLLMProvider(ABC):
    """Placeholder interface; replace with your Python backend's real base."""

    @abstractmethod
    async def generate(
        self, prompt: str, *, json_mode: bool = True,
        schema: OutputSchema = None, system: str | None = None,
        options: Mapping[str, Any] | None = None,
    ) -> str:
        raise NotImplementedError

    @abstractmethod
    def generate_stream(
        self, prompt: str, *, json_mode: bool = True,
        schema: OutputSchema = None, system: str | None = None,
        options: Mapping[str, Any] | None = None,
    ) -> AsyncIterator[str]:
        raise NotImplementedError


DEFAULT_MODEL = "qwen2.5-coder:7b"
DEFAULT_BASE_URL = "http://localhost:11434"


class OllamaProvider(BaseLLMProvider):
    """Reuse one instance per event loop; close it at application shutdown.

    Read timeout is per network read, not a total generation deadline.
    Retries replay generation and may incur extra local inference work.
    A stream is retried only before the first fragment has been delivered.
    """

    def __init__(
        self, model: str | None = None,
        base_url: str | None = None, *,
        timeout: float = 180.0, max_attempts: int = 3,
        retry_min: float = 1.0, retry_max: float = 10.0,
        max_output_chars: int = 2_000_000,
        transport: httpx.AsyncBaseTransport | None = None,
        prefer_streaming: bool = False,
    ) -> None:
        # One model for the whole app: the launcher passes the llm slot of
        # openmaic.yml (EDUPLUS_OLLAMA_MODEL); the default is the shipped model.
        if model is None:
            model = os.environ.get("EDUPLUS_OLLAMA_MODEL", "").strip() or DEFAULT_MODEL
        if base_url is None:
            base_url = os.environ.get("EDUPLUS_OLLAMA_BASE_URL", "").strip() or DEFAULT_BASE_URL
        if not model.strip():
            raise ValueError("model must not be blank")
        if timeout <= 0 or max_attempts < 1 or max_output_chars < 1:
            raise ValueError("timeout, max_attempts and max_output_chars must be positive")
        if retry_min < 0 or retry_max < retry_min:
            raise ValueError("require 0 <= retry_min <= retry_max")
        url = httpx.URL(base_url)
        if url.scheme not in ("http", "https") or not url.host:
            raise ValueError("base_url must be an HTTP(S) URL")
        if url.path not in ("", "/") or url.query or url.fragment or url.userinfo:
            raise ValueError("base_url must contain only scheme, host and optional port")
        self.model = model.strip()
        self.base_url = base_url.rstrip("/")
        self.max_attempts = max_attempts
        self.retry_min = retry_min
        self.retry_max = retry_max
        self.max_output_chars = max_output_chars
        self._schema_repetition_seen = False
        self.prefer_streaming = prefer_streaming
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(timeout, connect=min(timeout, 5.0)),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            trust_env=False,  # Local Ollama must not go through system proxies.
            follow_redirects=False,
            transport=transport,
        )

    async def __aenter__(self) -> OllamaProvider:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    def _payload(
        self, prompt: str, stream: bool, json_mode: bool,
        schema: OutputSchema, system: str | None,
        options: Mapping[str, Any] | None,
    ) -> dict[str, Any]:
        if self._client.is_closed:
            raise OllamaError("OllamaProvider 已关闭，请创建新实例。")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("prompt must be a nonempty string")
        if schema is not None and not issubclass(schema, BaseModel):
            raise TypeError("schema must be a Pydantic BaseModel class")
        structured = json_mode or schema is not None
        payload: dict[str, Any] = {
            "model": self.model, "prompt": prompt, "stream": stream,
            "options": {"temperature": 0.0, **dict(options or {})},
        }
        if structured:
            instruction = "Return only valid JSON, without Markdown or explanatory text."
            if schema is not None:
                shape = schema.model_json_schema()
                payload["format"] = 'json' if self._schema_repetition_seen else shape
                instruction += " Match this JSON Schema: " + json.dumps(shape, ensure_ascii=False)
            else:
                payload["format"] = "json"
            payload["system"] = ((system + "\n") if system else "") + instruction
        elif system is not None:
            payload["system"] = system
        if self._schema_repetition_seen:
            self._recover_repetition(payload)
        # Reject non-JSON values and NaN before attempting network requests.
        json.dumps(payload, allow_nan=False)
        return payload

    def _retry(self, delivered: Callable[[], bool] = lambda: False) -> AsyncRetrying:
        return AsyncRetrying(
            retry=retry_if_exception(
                lambda exc: isinstance(exc, OllamaTransientError) and not delivered()
            ),
            stop=stop_after_attempt(self.max_attempts),
            wait=wait_random_exponential(
                multiplier=1, min=self.retry_min, max=self.retry_max,
            ),
            before_sleep=before_sleep_log(logger, logging.WARNING),
            reraise=True,
        )

    def _check_status(self, response: httpx.Response) -> None:
        status = response.status_code
        if 200 <= status < 300:
            return
        if status == 500:
            try:
                error = response.json().get('error', '')
            except (ValueError, AttributeError):
                error = ''
            if isinstance(error, str) and 'token repeat limit reached' in error.lower():
                raise OllamaRepetitionError('本地模型生成陷入重复，Ollama 已中止本次输出。')
        if status == 404:
            raise OllamaModelNotFoundError(
                f"Ollama 返回 404：请运行 ollama pull {self.model}，"
                "并检查服务地址和 /api/generate 路径。"
            )
        if status in (408, 429, 500, 502, 503, 504):
            raise OllamaTransientError(f"Ollama 暂时不可用（HTTP {status}）。")
        raise OllamaError(f"Ollama 请求失败（HTTP {status}），请检查参数与服务配置。")

    def _recover_repetition(self, payload: dict[str, Any]) -> None:
        # Large recursive schemas can trap the sampler in one grammar branch.
        # Keep JSON-only generation and ALL local Pydantic validation; change
        # only decoding, rather than retrying the same deterministic failure.
        if isinstance(payload.get('format'), dict):
            payload['format'] = 'json'
            self._schema_repetition_seen = True
        options = dict(payload['options'])
        options.update(temperature=max(float(options.get('temperature', 0)), 0.2),
                       repeat_penalty=max(float(options.get('repeat_penalty', 1)), 1.12),
                       repeat_last_n=128, seed=int(options.get('seed', 0)) + 1)
        payload['options'] = options

    def _transport_error(self, exc: httpx.RequestError) -> OllamaError:
        if isinstance(exc, httpx.TimeoutException):
            return OllamaTimeoutError(
                f"Ollama 请求超时：{self.model} 可能仍在加载或生成；请检查资源或增大 timeout。"
            )
        if isinstance(exc, httpx.ConnectError):
            return OllamaConnectionError(
                f"无法连接 {self.base_url}，请启动 Ollama（ollama serve）并检查端口。"
            )
        if isinstance(exc, (httpx.NetworkError, httpx.RemoteProtocolError)):
            return OllamaTransientError("Ollama 网络连接中断，请检查服务状态。")
        return OllamaError(f"Ollama HTTP 传输失败：{type(exc).__name__}。")

    @staticmethod
    def _reject_constant(value: str) -> Any:
        raise ValueError(f"Invalid JSON constant: {value}")

    def _decode(self, text: str) -> _Envelope:
        try:
            data = json.loads(text, parse_constant=self._reject_constant)
            envelope = _Envelope.model_validate(data)
        except (ValueError, ValidationError) as exc:
            raise OllamaResponseError("Ollama 返回了无效的 JSON 响应信封。") from exc
        if envelope.error is not None:
            # Do not log raw prompts, model output, or server error payloads.
            raise OllamaResponseError("Ollama 返回生成错误，请查看本地服务日志。")
        return envelope

    def _validate_output(self, text: str, structured: bool, schema: OutputSchema) -> None:
        if len(text) > self.max_output_chars:
            raise OllamaResponseError("生成内容超过 max_output_chars 限制。")
        if not structured:
            return
        try:
            json.loads(text, parse_constant=self._reject_constant)
            if schema is not None:
                schema.model_validate_json(text, strict=True)
        except ValidationError as exc:
            # Pass repairable field locations, never raw generated values, to
            # the workflow. A generic 'invalid JSON' hid all useful feedback.
            details='; '.join('.'.join(map(str,error['loc']))+': '+error['type']
                              for error in exc.errors(include_input=False,include_url=False)[:8])
            raise OllamaResponseError('生成 JSON 字段校验未通过：'+details) from exc
        except ValueError as exc:
            raise OllamaResponseError("生成结果不是有效 JSON，或不符合指定的 Schema。") from exc

    async def generate(
        self, prompt: str, *, json_mode: bool = True,
        schema: OutputSchema = None, system: str | None = None,
        options: Mapping[str, Any] | None = None,
    ) -> str:
        """Return text; JSON mode validates it before returning."""
        if self.prefer_streaming:
            # Keep receiving tokens from a slow but live local model. The
            # caller still receives only complete, schema-validated JSON.
            chunks=[]
            async for chunk in self.generate_stream(prompt,json_mode=json_mode,schema=schema,system=system,options=options):
                chunks.append(chunk)
            return ''.join(chunks)
        payload = self._payload(prompt, False, json_mode, schema, system, options)
        try:
            async for attempt in self._retry():
                with attempt:
                    try:
                        response = await self._client.post("/api/generate", json=payload)
                        self._check_status(response)
                        envelope = self._decode(response.text)
                        if not envelope.done:
                            raise OllamaResponseError("Ollama 未返回完成标记，响应不完整。")
                        if "format" in payload and envelope.done_reason == "length":
                            raise OllamaResponseError("JSON 生成达到长度上限，请增大 options.num_predict。")
                        self._validate_output(envelope.response, "format" in payload, schema)
                        return envelope.response
                    except OllamaRepetitionError:
                        self._recover_repetition(payload)
                        raise
                    except httpx.RequestError as exc:
                        raise self._transport_error(exc) from exc
        except OllamaError as exc:
            logger.error("Ollama 非流式生成失败（模型 %s）：%s", self.model, exc)
            raise
        raise AssertionError("Unreachable retry state")

    async def generate_json(
        self, prompt: str, schema: type[SchemaT], *,
        system: str | None = None, options: Mapping[str, Any] | None = None,
    ) -> SchemaT:
        """Generate a validated Pydantic object for downstream agents."""
        text = await self.generate(prompt, schema=schema, system=system, options=options)
        return schema.model_validate_json(text, strict=True)

    async def generate_stream(
        self, prompt: str, *, json_mode: bool = True,
        schema: OutputSchema = None, system: str | None = None,
        options: Mapping[str, Any] | None = None,
    ) -> AsyncIterator[str]:
        """Yield fragments. Structured content is valid only after normal completion."""
        payload = self._payload(prompt, True, json_mode, schema, system, options)
        delivered = False
        try:
            async for attempt in self._retry(lambda: delivered):
                with attempt:
                    chunks: list[str] = []
                    size = 0
                    try:
                        async with self._client.stream("POST", "/api/generate", json=payload) as response:
                            if response.status_code >= 400:
                                await response.aread()
                            self._check_status(response)
                            async for line in response.aiter_lines():
                                if not line.strip():
                                    continue
                                if len(line) > self.max_output_chars + 65536:
                                    raise OllamaResponseError("Ollama 流式响应行过大。")
                                envelope = self._decode(line)
                                chunk = envelope.response
                                size += len(chunk)
                                if size > self.max_output_chars:
                                    raise OllamaResponseError("生成内容超过 max_output_chars 限制。")
                                if "format" in payload:
                                    chunks.append(chunk)
                                if envelope.done:
                                    if "format" in payload and envelope.done_reason == "length":
                                        raise OllamaResponseError("JSON 生成达到长度上限，请增大 options.num_predict。")
                                    self._validate_output("".join(chunks), "format" in payload, schema)
                                if chunk:
                                    delivered = True
                                    yield chunk
                                if envelope.done:
                                    return
                            raise OllamaTransientError("Ollama 流提前结束，未收到完成标记。")
                    except OllamaRepetitionError:
                        if not delivered:
                            self._recover_repetition(payload)
                        raise
                    except httpx.RequestError as exc:
                        raise self._transport_error(exc) from exc
        except OllamaError as exc:
            logger.error("Ollama 流式生成失败（模型 %s，已交付内容 %s）：%s", self.model, delivered, exc)
            raise


class ExampleResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: str
    answer: int = Field(ge=0)


async def _main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    async with OllamaProvider() as provider:
        result = await provider.generate_json(
            "计算 2 + 2；language 字段填 Python，answer 字段填计算结果。", ExampleResult,
        )
        print(result.model_dump_json())
        async for chunk in provider.generate_stream("只回答：本地模型连接成功。", json_mode=False):
            print(chunk, end="", flush=True)
        print()


if __name__ == "__main__":
    asyncio.run(_main())

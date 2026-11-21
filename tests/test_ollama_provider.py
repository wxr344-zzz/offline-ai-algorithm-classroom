"""Offline failure-path tests: python -m unittest discover -s tests -p test_ollama_provider.py."""
import json
import logging
import unittest
from datetime import date

import httpx
from pydantic import BaseModel

from ollama_provider import (
    OllamaConnectionError, OllamaModelNotFoundError, OllamaProvider,
    OllamaResponseError, OllamaTimeoutError, OllamaTransientError,
)


class Result(BaseModel):
    answer: int


class BrokenStream(httpx.AsyncByteStream):
    def __init__(self, fragment: bytes | None = None) -> None:
        self.fragment = fragment

    async def __aiter__(self):
        if self.fragment:
            yield self.fragment
        raise httpx.ReadError("interrupted")


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.previous_log_level = logging.root.manager.disable
        logging.disable(logging.CRITICAL)

    def tearDown(self):
        logging.disable(self.previous_log_level)

    def provider(self, handler):
        return OllamaProvider(
            transport=httpx.MockTransport(handler), retry_min=0, retry_max=0,
        )

    async def test_schema_and_native_payload(self):
        def handle(request):
            body = json.loads(request.content)
            self.assertEqual(body["format"]["type"], "object")
            self.assertFalse(body["stream"])
            self.assertEqual(request.url.path, "/api/generate")
            return httpx.Response(200, json={"response": '{"answer":4}', "done": True})
        async with self.provider(handle) as provider:
            self.assertEqual((await provider.generate_json("2+2", Result)).answer, 4)

    async def test_slow_code_transport_streams_but_returns_only_validated_json(self):
        def handle(request):
            body=json.loads(request.content)
            self.assertTrue(body['stream'])
            return httpx.Response(200,content=b'{"response":"{\\"answer\\":","done":false}\n{"response":"4}","done":true}\n')
        async with OllamaProvider(transport=httpx.MockTransport(handle),prefer_streaming=True) as provider:
            self.assertEqual((await provider.generate_json('2+2',Result)).answer,4)
        def invalid(request):
            return httpx.Response(200,content=b'{"response":"{\\"answer\\":\\"wrong\\"}","done":true}\n')
        async with OllamaProvider(transport=httpx.MockTransport(invalid),prefer_streaming=True) as provider:
            with self.assertRaises(OllamaResponseError):await provider.generate_json('2+2',Result)

    async def test_connection_retry_recovers(self):
        calls = 0
        def handle(request):
            nonlocal calls
            calls += 1
            if calls < 3:
                raise httpx.ConnectError("refused", request=request)
            return httpx.Response(200, json={"response": '{}', "done": True})
        async with self.provider(handle) as provider:
            self.assertEqual(await provider.generate("hello"), "{}")
        self.assertEqual(calls, 3)

    async def test_connection_exhaustion_preserves_cause(self):
        calls = 0
        def handle(request):
            nonlocal calls
            calls += 1
            raise httpx.ConnectError("refused", request=request)
        async with self.provider(handle) as provider:
            with self.assertRaises(OllamaConnectionError) as caught:
                await provider.generate("hello")
        self.assertIsInstance(caught.exception.__cause__, httpx.ConnectError)
        self.assertEqual(calls, 3)

    async def test_timeout_retry_exhaustion(self):
        calls = 0
        def handle(request):
            nonlocal calls
            calls += 1
            raise httpx.ReadTimeout("slow", request=request)
        async with self.provider(handle) as provider:
            with self.assertRaises(OllamaTimeoutError):
                await provider.generate("hello")
        self.assertEqual(calls, 3)

    async def test_404_never_retried(self):
        calls = 0
        def handle(request):
            nonlocal calls
            calls += 1
            return httpx.Response(404, json={"error": "model missing"})
        async with self.provider(handle) as provider:
            with self.assertRaisesRegex(OllamaModelNotFoundError, "ollama pull"):
                await provider.generate("hello")
        self.assertEqual(calls, 1)

    async def test_503_retried(self):
        calls = 0
        def handle(request):
            nonlocal calls
            calls += 1
            return httpx.Response(503)
        async with self.provider(handle) as provider:
            with self.assertRaises(OllamaTransientError):
                await provider.generate("hello")
        self.assertEqual(calls, 3)

    async def test_repetition_changes_decoding_but_preserves_schema_validation(self):
        bodies=[]
        def handle(request):
            bodies.append(json.loads(request.content))
            if len(bodies)==1:
                return httpx.Response(500,json={'error':'prediction aborted, token repeat limit reached'})
            return httpx.Response(200,json={'response':'{"answer":4}','done':True})
        async with self.provider(handle) as provider:
            self.assertEqual((await provider.generate_json('2+2',Result)).answer,4)
        self.assertIsInstance(bodies[0]['format'],dict)
        self.assertEqual(bodies[1]['format'],'json')
        self.assertGreater(bodies[1]['options']['repeat_penalty'],1)
        self.assertNotEqual(bodies[0]['options'],bodies[1]['options'])
        self.assertEqual(bodies[0]['system'],bodies[1]['system'])

        calls=0
        def invalid(request):
            nonlocal calls
            calls+=1
            return (httpx.Response(500,json={'error':'prediction aborted, token repeat limit reached'}) if calls==1 else
                    httpx.Response(200,json={'response':'{"answer":"4"}','done':True}))
        async with self.provider(invalid) as provider:
            with self.assertRaises(OllamaResponseError):
                await provider.generate_json('2+2',Result)

    async def test_invalid_json_and_schema_rejected(self):
        for output in ("not json", '{"answer":"4"}', '{"answer":NaN}'):
            with self.subTest(output=output):
                async with self.provider(lambda request: httpx.Response(
                    200, json={"response": output, "done": True},
                )) as provider:
                    with self.assertRaises(OllamaResponseError):
                        await provider.generate("hello", schema=Result)

    async def test_schema_feedback_keeps_locations_without_echoing_generated_values(self):
        async with self.provider(lambda request:httpx.Response(200,json={'response':'{"answer":"PRIVATE_VALUE"}','done':True})) as provider:
            with self.assertRaises(OllamaResponseError) as caught:
                await provider.generate_json('test',Result)
        self.assertIn('answer: int_type',str(caught.exception))
        self.assertNotIn('PRIVATE_VALUE',str(caught.exception))

    async def test_stream_validates_complete_json(self):
        body = b'{"response":"{\\"answer\\":","done":false}\n{"response":"4}","done":true}\n'
        async with self.provider(lambda request: httpx.Response(200, content=body)) as provider:
            parts = [part async for part in provider.generate_stream("hello", schema=Result)]
        self.assertEqual("".join(parts), '{"answer":4}')

    async def test_stream_recovers_repetition_before_delivery_and_keeps_strict_schema(self):
        bodies=[]
        def handle(request):
            bodies.append(json.loads(request.content))
            if len(bodies)==1:
                return httpx.Response(500,json={'error':'prediction aborted, token repeat limit reached'})
            return httpx.Response(200,content=b'{"response":"{\\"answer\\":4}","done":true}\n')
        async with self.provider(handle) as provider:
            parts=[part async for part in provider.generate_stream('2+2',schema=Result)]
        self.assertEqual(''.join(parts),'{"answer":4}')
        self.assertEqual(bodies[1]['format'],'json')

    async def test_stream_error_inside_200(self):
        async with self.provider(lambda request: httpx.Response(
            200, content=b'{"error":"out of memory"}\n',
        )) as provider:
            with self.assertRaises(OllamaResponseError):
                _ = [part async for part in provider.generate_stream("hello")]

    async def test_stream_never_replays_delivered_text(self):
        calls = 0
        def handle(request):
            nonlocal calls
            calls += 1
            return httpx.Response(200, stream=BrokenStream(b'{"response":"hello","done":false}\n'))
        parts = []
        async with self.provider(handle) as provider:
            with self.assertRaises(OllamaTransientError):
                async for part in provider.generate_stream("hello", json_mode=False):
                    parts.append(part)
        self.assertEqual(parts, ["hello"])
        self.assertEqual(calls, 1)

    async def test_stream_retries_before_first_fragment(self):
        calls = 0
        def handle(request):
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(200, stream=BrokenStream())
            return httpx.Response(200, content=b'{"response":"{}","done":true}\n')
        async with self.provider(handle) as provider:
            parts = [part async for part in provider.generate_stream("hello")]
        self.assertEqual(parts, ["{}"])
        self.assertEqual(calls, 2)

    async def test_missing_done_fails(self):
        async with self.provider(lambda request: httpx.Response(
            200, content=b'{"response":"hello","done":false}\n',
        )) as provider:
            with self.assertRaises(OllamaTransientError):
                _ = [part async for part in provider.generate_stream("hello", json_mode=False)]

    async def test_json_date_schema(self):
        class DatedResult(BaseModel):
            day: date
        async with self.provider(lambda request: httpx.Response(
            200, json={"response": '{"day":"2026-10-12"}', "done": True},
        )) as provider:
            result = await provider.generate_json("hello", DatedResult)
        self.assertEqual(result.day, date(2026, 10, 12))

    async def test_json_length_limit_not_accepted(self):
        async with self.provider(lambda request: httpx.Response(
            200, json={"response": '{}', "done": True, "done_reason": "length"},
        )) as provider:
            with self.assertRaises(OllamaResponseError):
                await provider.generate("hello")


class ModelSelectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_launcher_environment_selects_model_and_address(self):
        from unittest import mock
        env = {"EDUPLUS_OLLAMA_MODEL": "qwen2.5:7b-16k", "EDUPLUS_OLLAMA_BASE_URL": "http://127.0.0.1:11500"}
        with mock.patch.dict("os.environ", env):
            async with OllamaProvider() as provider:
                self.assertEqual((provider.model, provider.base_url), ("qwen2.5:7b-16k", "http://127.0.0.1:11500"))
            async with OllamaProvider(model="explicit:1b") as provider:
                self.assertEqual(provider.model, "explicit:1b")
        with mock.patch.dict("os.environ", {"EDUPLUS_OLLAMA_MODEL": " "}):
            async with OllamaProvider() as provider:
                self.assertEqual((provider.model, provider.base_url), ("qwen2.5-coder:7b", "http://localhost:11434"))


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    unittest.main()

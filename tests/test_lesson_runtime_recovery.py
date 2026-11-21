import asyncio
from unittest.mock import AsyncMock
import pytest
import lesson_execution as execution


def test_runtime_bootstrap_retries_identical_jobs_once(monkeypatch):
    jobs=[{'code':'test-owned code','cases':[]}]
    run=AsyncMock(side_effect=[execution.LessonRuntimeError('bootstrap'),[[]]])
    monkeypatch.setattr(execution,'_execute_jobs_once',run)
    assert asyncio.run(execution.execute_jobs(jobs)) == [[]]
    assert run.await_count == 2
    assert all(call.args == (jobs,) for call in run.await_args_list)


def test_program_failure_never_retries_or_passes(monkeypatch):
    run=AsyncMock(side_effect=execution.LessonExecutionError('wrong result'))
    monkeypatch.setattr(execution,'_execute_jobs_once',run)
    with pytest.raises(execution.LessonExecutionError,match='wrong result'):
        asyncio.run(execution.execute_jobs([{}]))
    assert run.await_count == 1


def test_runtime_retries_are_bounded(monkeypatch):
    run=AsyncMock(side_effect=execution.LessonRuntimeError('bootstrap'))
    monkeypatch.setattr(execution,'_execute_jobs_once',run)
    with pytest.raises(execution.LessonRuntimeError):
        asyncio.run(execution.execute_jobs([{}]))
    assert run.await_count == 2

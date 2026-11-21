"""Execute reference acceptance checks in WASM, never in the Agent interpreter."""
import asyncio
import json
import os
from pathlib import Path
import shutil
import logging

ROOT = Path(__file__).resolve().parent


class LessonExecutionError(ValueError):
    """An acceptance failure, distinct from a transport or schema failure."""


class LessonRuntimeError(LessonExecutionError):
    """The isolated runtime failed before it could verify a program."""


def equivalent(actual, expected, strict_strings=False):
    if type(actual) in (int,float) and type(expected) in (int,float):
        return actual == expected
    if isinstance(actual, str) and isinstance(expected, str):
        if strict_strings: return actual == expected
        try:
            return equivalent(json.loads(actual), json.loads(expected), strict_strings=True)
        except (ValueError, RecursionError):
            return actual.replace('\r\n', '\n').rstrip() == expected.replace('\r\n', '\n').rstrip()
    if type(actual) is not type(expected):
        return False
    if isinstance(actual, list):
        return len(actual) == len(expected) and all(equivalent(a,b,strict_strings) for a,b in zip(actual,expected))
    if isinstance(actual, dict):
        return actual.keys() == expected.keys() and all(equivalent(actual[k],expected[k],strict_strings) for k in actual)
    return actual == expected


async def _execute_jobs_once(jobs):
    env = {k:v for k,v in os.environ.items() if k.upper() in {'SYSTEMROOT','WINDIR','TEMP','TMP'}}
    try:
        process = await asyncio.create_subprocess_exec(shutil.which('node') or 'node',
            str(ROOT/'scripts'/'lesson-reference-sandbox.mjs'), cwd=ROOT, env=env,
            stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
    except OSError as exc:
        raise LessonRuntimeError('本地WASM执行器无法启动') from exc
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(json.dumps(jobs,ensure_ascii=False).encode()),45)
    except BaseException as exc:
        if process.returncode is None: process.kill()
        await process.wait()
        if isinstance(exc,asyncio.TimeoutError):raise LessonExecutionError('实验沙箱执行超时') from exc
        raise
    if process.returncode or len(stdout)>2000000:
        raise LessonExecutionError('实验沙箱未完成执行：'+stderr.decode(errors='replace')[-500:])
    try:value=json.loads(stdout)
    except ValueError as exc:raise LessonExecutionError('实验沙箱返回无效结果') from exc
    if value.get('error'):
        error_type = LessonRuntimeError if value.get('kind') == 'runtime' else LessonExecutionError
        raise error_type('实验沙箱校验失败：'+value['error'][-1200:])
    return value['jobs']


async def execute_jobs(jobs):
    # Retry only a runtime bootstrap failure. Bad program output, assertions,
    # execution timeouts and missing results still fail immediately.
    for attempt in range(2):
        try:
            return await _execute_jobs_once(jobs)
        except LessonRuntimeError:
            if attempt: raise
            logging.getLogger(__name__).warning('WASM runtime bootstrap failed; retrying the same verification once')


async def verify_drafts(*drafts):
    from lab_assembly import entry_point_from_source
    jobs=[{'code':d.reference_solution,'entry':entry_point_from_source(d.reference_solution).model_dump(by_alias=True),
        'cases':[c.model_dump(mode='json',by_alias=True) for c in d.public_test_cases+d.hidden_test_cases]}
        for d in drafts]
    try:
        results=await execute_jobs(jobs)
    except LessonExecutionError as exc:
        logging.getLogger(__name__).error('Reference acceptance failed: %s', str(exc)[-1400:])
        raise
    if len(results)!=len(jobs): raise LessonExecutionError('实验沙箱结果数量不一致')
    for job,actual in zip(jobs,results):
        if len(actual)!=len(job['cases']): raise LessonExecutionError('实验沙箱缺少用例结果')
        for case,result in zip(job['cases'],actual):
            if result['caseId']!=case['caseId'] or result.get('error') or not equivalent(result.get('actual'),case['expected']):
                raise LessonExecutionError(f"实验执行断言未通过 {case['caseId']}：{result.get('error','实际结果与标准答案不同')}")
    return sum(len(j['cases']) for j in jobs)

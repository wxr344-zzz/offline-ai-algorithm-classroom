"""课堂补充数据的严格契约及内部接口权限。"""
import json
import ast
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError

from agent_api import APISettings, create_app
from teaching_assets import ClassroomTeaching
from teaching_assets import run_teaching
from jupyter_exporter import build_teacher_notebook, build_student_notebook
from lab_contracts import to_public_course

ROOT = Path(__file__).resolve().parents[1]
COURSE = json.loads((ROOT / 'contracts/examples/public-lab.json').read_text(encoding='utf-8'))
TEACHING = json.loads((ROOT / 'tests/fixtures/eduplus-teaching.json').read_text(encoding='utf-8'))


def test_classroom_teaching_contract():
    ClassroomTeaching.model_validate(TEACHING)
    bad = json.loads(json.dumps(TEACHING))
    bad['questions'][0]['options'][1] = bad['questions'][0]['options'][0]
    with pytest.raises(ValidationError):
        ClassroomTeaching.model_validate(bad)


def test_model_schema_excludes_execution_states_and_discards_legacy_trace(monkeypatch):
    import asyncio
    from copy import deepcopy
    from lab_contracts import PublicCourse
    from teaching_assets import GeneratedTeachingText
    reply = deepcopy(TEACHING)
    reply['algorithmTrace'] = {'steps': reply['algorithmTrace']['steps']}
    reply['algorithmTrace']['steps'][0]['activeIndices'] = [0, 0, 999, -1]
    class Provider:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def generate(self, prompt, **kwargs):
            assert kwargs['schema'] is GeneratedTeachingText
            fields = kwargs['schema'].model_json_schema(by_alias=True)['properties']
            assert set(fields) == {'overview', 'demoExplanation', 'questions'}
            assert 'traceExample' not in json.loads(prompt)
            return json.dumps(reply)
    monkeypatch.setattr('teaching_assets.OllamaProvider', Provider)
    result = asyncio.run(run_teaching(PublicCourse.model_validate(COURSE)))
    assert result['algorithmTrace'] is None
    ClassroomTeaching.model_validate(result)


@pytest.mark.parametrize('invalid_trace', [None, {'exampleCaseId': 'foreign-case'}, {'outcome': 999}, {'steps': [{'label': '越界', 'explanation': '无此位置', 'values': ['0'], 'activeIndices': [1]}] * 2}])
def test_model_trace_is_never_published_even_if_missing_foreign_or_wrong(monkeypatch, invalid_trace):
    import asyncio
    from copy import deepcopy
    from lab_contracts import PublicCourse
    calls = []
    invalid = deepcopy(TEACHING)
    invalid['algorithmTrace'] = None if invalid_trace is None else {**invalid['algorithmTrace'], **invalid_trace}
    class Provider:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def generate(self, *args, **kwargs):
            calls.append(1)
            return json.dumps(invalid)
    monkeypatch.setattr('teaching_assets.OllamaProvider', Provider)
    result = asyncio.run(run_teaching(PublicCourse.model_validate(COURSE)))
    assert result['algorithmTrace'] is None
    assert len(calls) == 1


def test_real_teaching_enforces_schema_and_repairs_invalid_output_once(monkeypatch):
    import asyncio
    from lab_contracts import PublicCourse
    from ollama_provider import OllamaResponseError
    calls = []
    class Provider:
        def __init__(self, **_kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return None
        async def generate(self, prompt, **kwargs):
            calls.append((prompt, kwargs))
            if len(calls) == 1: raise OllamaResponseError('invalid schema')
            return json.dumps(TEACHING)
    monkeypatch.setattr('teaching_assets.OllamaProvider', Provider)
    assert asyncio.run(run_teaching(PublicCourse.model_validate(COURSE))) == {**TEACHING, 'algorithmTrace': None}
    assert len(calls) == 2
    from teaching_assets import GeneratedTeachingText
    assert calls[0][1]['schema'] is GeneratedTeachingText
    assert '上次输出未通过结构校验' in calls[1][0]


def test_internal_teaching_requires_credentials_and_uses_public_input_only():
    received = []
    async def teaching(course):
        received.append(course.model_dump(mode='json', by_alias=True))
        return TEACHING
    with TestClient(create_app(APISettings(service_token='t' * 64), teaching_runner=teaching)) as client:
        assert client.post('/internal/v1/teaching', json=COURSE).status_code == 401
        assert received == []
        result = client.post('/internal/v1/teaching', json=COURSE, headers={'Authorization': 'Bearer ' + 't' * 64})
        assert result.status_code == 200
        assert result.json() == TEACHING
        from lab_contracts import PublicCourse
        assert received == [PublicCourse.model_validate(COURSE).model_dump(mode='json', by_alias=True)]
        assert 'reference' not in json.dumps(received)
        assert '/internal/v1/teaching' not in client.get('/openapi.json').json()['paths']


def test_schema_repair_receives_field_path_without_raw_model_input(monkeypatch, caplog):
    import asyncio
    from copy import deepcopy
    from lab_contracts import PublicCourse
    from ollama_provider import OllamaResponseError
    from teaching_assets import AlgorithmClassroomTeaching

    invalid = deepcopy(TEACHING)
    invalid['algorithmTrace']['steps'][0]['values'] = ['PRIVATE_INPUT_SENTINEL']
    invalid['algorithmTrace']['steps'][0]['activeIndices'] = [99]
    calls = []

    class Provider:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def generate(self, prompt, **kwargs):
            calls.append(prompt)
            if len(calls) == 1:
                try:
                    AlgorithmClassroomTeaching.model_validate(invalid)
                except ValidationError as exc:
                    raise OllamaResponseError('invalid schema') from exc
            return json.dumps(TEACHING)

    monkeypatch.setattr('teaching_assets.OllamaProvider', Provider)
    assert asyncio.run(run_teaching(PublicCourse.model_validate(COURSE))) == {**TEACHING, 'algorithmTrace': None}
    assert 'algorithmTrace' in calls[1]
    assert '高亮下标' in calls[1]
    assert 'PRIVATE_INPUT_SENTINEL' not in calls[1]
    assert 'PRIVATE_INPUT_SENTINEL' not in caplog.text


def test_rejects_private_or_unknown_fields_before_model_call():
    async def teaching(_course):
        pytest.fail('Invalid request must not call model')
    with TestClient(create_app(APISettings(service_token='t' * 64), teaching_runner=teaching)) as client:
        body = {**COURSE, 'referenceSolution': 'PRIVATE_SENTINEL'}
        response = client.post('/internal/v1/teaching', json=body, headers={'Authorization': 'Bearer ' + 't' * 64})
        assert response.status_code == 400
        assert 'PRIVATE_SENTINEL' not in response.text


def test_teacher_notebook_includes_private_assets_student_version_excludes_them():
    generated = json.loads((ROOT / 'tests/fixtures/eduplus-generated.json').read_text(encoding='utf-8'))
    internal = generated['privateOutput']
    teacher = build_teacher_notebook(internal)
    student = build_student_notebook(to_public_course(internal))
    assert teacher.metadata.eduplus.audience == 'teacher'
    assert internal['problem']['reference_solution'] in teacher.cells[1].source
    def test_functions(source):
        return {node.name: ast.dump(node) for node in ast.walk(ast.parse(source))
                if isinstance(node, ast.FunctionDef) and node.name.startswith('test_case_')}
    assert test_functions(teacher.cells[2].source) == test_functions(internal['problem']['pytest_source'])
    assert len(test_functions(teacher.cells[2].source)) > len(test_functions(student.cells[2].source))
    assert 'REFERENCE_SENTINEL' not in json.dumps(student)
    assert 'teacher-private-tests' not in json.dumps(student)


def test_private_teacher_export_endpoint_requires_service_credential():
    generated = json.loads((ROOT / 'tests/fixtures/eduplus-generated.json').read_text(encoding='utf-8'))
    with TestClient(create_app(APISettings(service_token='t' * 64))) as client:
        assert client.post('/internal/v1/teacher-notebook', json=generated['privateOutput']).status_code == 401
        response = client.post('/internal/v1/teacher-notebook', json=generated['privateOutput'], headers={'Authorization': 'Bearer ' + 't' * 64})
        assert response.status_code == 200
        assert json.loads(response.content)['metadata']['eduplus']['audience'] == 'teacher'

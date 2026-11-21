"""学生下载只包含公开用例；同时验证内部传输的认证与投影。"""
import json
from pathlib import Path

from fastapi.testclient import TestClient
import nbformat
import pytest
from pydantic import ValidationError

from agent_api import APISettings, create_app
from jupyter_exporter import build_student_notebook
from lab_contracts import GeneratedCourse

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "x" * 64


@pytest.fixture
def generated():
    return json.loads((ROOT / "tests/fixtures/eduplus-generated.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("scene_type", ["guided-lab", "oj-lab"])
def test_student_notebook_has_only_public_assets(generated, scene_type):
    notebook = build_student_notebook(generated["publicCourse"], scene_type)
    nbformat.validate(notebook)
    assert [cell.cell_type for cell in notebook.cells] == ["markdown", "code", "code"]
    assert notebook.metadata.eduplus.audience == "student"
    assert notebook.metadata.eduplus.sceneType == scene_type
    assert notebook.cells[2].metadata.tags == ["public-tests"]
    source = nbformat.writes(notebook)
    for marker in ["HIDDEN_CASE_SENTINEL", "HIDDEN_DESCRIPTION_SENTINEL", "REFERENCE_SENTINEL"]:
        assert marker not in source
    assert "def test_case_0" in notebook.cells[2].source
    assert "def test_case_1" not in notebook.cells[2].source
    assert 'pytest.main(["-q", "--disable-warnings"])' in notebook.cells[2].source
    assert ("# TODO" in notebook.cells[1].source) == (scene_type == "guided-lab")


def test_export_rejects_private_or_invalid_assets(generated):
    generated["publicCourse"]["referenceSolution"] = "private"
    with pytest.raises(ValidationError):
        build_student_notebook(generated["publicCourse"])


def test_envelope_must_match_projection(generated):
    generated["publicCourse"]["topic"] = "different"
    with pytest.raises(ValidationError):
        GeneratedCourse.model_validate(generated)


@pytest.mark.parametrize("credential", [None, "Bearer incorrect"])
def test_internal_generate_requires_auth(generated, credential):
    async def runner(_prompt):
        pytest.fail("拒绝认证后不得调用模型")
    with TestClient(create_app(APISettings(service_token=TOKEN), runner)) as client:
        response = client.post("/internal/v1/generate", json={"prompt": "实验"}, headers={"Authorization": credential} if credential else {})
    assert response.status_code == 401
    assert "privateOutput" not in response.text


def test_authorized_internal_generate(generated):
    async def runner(_prompt):
        return generated["privateOutput"]
    with TestClient(create_app(APISettings(service_token=TOKEN), runner)) as client:
        response = client.post("/internal/v1/generate", json={"prompt": "实验"}, headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 200
    GeneratedCourse.model_validate(response.json())
    assert "HIDDEN_CASE_SENTINEL" in response.text


def test_student_download_endpoint(generated):
    with TestClient(create_app(APISettings(service_token=TOKEN))) as client:
        denied = client.post("/internal/v1/notebook", json=generated["publicCourse"])
        assert denied.status_code == 401
        response = client.post("/internal/v1/notebook?scene_type=oj-lab", json=generated["publicCourse"], headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 200
    nbformat.validate(nbformat.reads(response.text, as_version=4))
    assert "HIDDEN_CASE_SENTINEL" not in response.text


def test_unconfigured_service_token_fails_closed(generated):
    with TestClient(create_app(APISettings())) as client:
        response = client.post("/internal/v1/notebook", json=generated["publicCourse"])
    assert response.status_code == 503

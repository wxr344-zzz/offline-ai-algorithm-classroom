"""EduPlus v1 契约。私有工作流数据与学生公开 DTO 分别建模。"""
from __future__ import annotations
import json

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic.alias_generators import to_camel
from typing_extensions import TypeAliasType

SCHEMA_VERSION = "1.0"
Text = Annotated[str, StringConstraints(min_length=1, pattern=r"\S")]
Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")]
ValueType = Literal["int", "str", "bool", "list[int]", "list[str]", "list[bool]"]
JsonValue = TypeAliasType(
    "JsonValue", Union[dict[str, "JsonValue"], list["JsonValue"], str, int, float, bool, None],
)


class InternalModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class PublicModel(BaseModel):
    model_config = ConfigDict(
        strict=True, extra="forbid", alias_generator=to_camel, populate_by_name=True,
        json_schema_serialization_defaults_required=True,
    )


class LessonPlan(InternalModel):
    title: Text
    objectives: list[Text] = Field(min_length=1)
    knowledge_points: list[Text] = Field(min_length=1)


class TeacherDecision(InternalModel):
    topic: Text
    requires_lab: bool
    lesson_plan: LessonPlan
    course_kind: Literal["algorithm", "programming", "theory", "general"] = "general"


class LabSpec(InternalModel):
    """保留旧导出器的内部输入格式；禁止直接作为学生 HTTP 响应。"""
    title: Text
    instructions: Text
    files: dict[str, str]
    reference_solution: Text
    grading: dict[str, Any]


class TestCase(PublicModel):
    case_id: Text
    inputs: dict[str, JsonValue]
    expected: JsonValue
    description: Text


class TeachingStep(PublicModel):
    step_id: Text
    title: Text
    instruction: Text
    hint: str = ""


class LabDraft(InternalModel):
    """模型只生成题目资产和结构化用例；ID、pytest 和评分入口由后端组装。"""
    title: Text
    instructions: Text
    scaffold_code: Text
    reference_solution: Text
    difficulty: Literal["Easy", "Medium", "Hard"]
    constraints: list[Text] = Field(min_length=1)
    teaching_steps: list[TeachingStep] = Field(min_length=1)
    public_test_cases: list[TestCase] = Field(min_length=1)
    hidden_test_cases: list[TestCase] = Field(min_length=3)

    @model_validator(mode="after")
    def unique_ids(self) -> LabDraft:
        ids = [case.case_id for case in self.public_test_cases + self.hidden_test_cases]
        if len(ids) != len(set(ids)):
            raise ValueError("公开和隐藏用例的 caseId 必须全局唯一")
        steps = [step.step_id for step in self.teaching_steps]
        if len(steps) != len(set(steps)):
            raise ValueError("教学步骤 stepId 必须唯一")
        return self


class Parameter(PublicModel):
    name: Identifier
    type: ValueType


class EntryPoint(PublicModel):
    class_name: Literal["Solution"] = "Solution"
    method_name: Literal["solve"] = "solve"
    parameters: list[Parameter] = Field(min_length=1)
    return_type: ValueType


class ExecutionPolicy(PublicModel):
    """声明期望限制；实际执行/强制限制属于后续运行器。"""
    timeout_ms: int = Field(default=3000, ge=100, le=30000)
    max_output_chars: int = Field(default=20000, ge=100, le=100000)
    network_allowed: Literal[False] = False
    comparison: Literal["exact"] = "exact"


class PublicProblem(PublicModel):
    # 新字段在读取旧课程时可省略；旧函数式实验保持兼容。
    model_config = ConfigDict(json_schema_serialization_defaults_required=False)
    problem_id: Text
    problem_version: int = Field(ge=1)
    title: Text
    instructions: Text
    difficulty: Literal["Easy", "Medium", "Hard"]
    constraints: list[Text] = Field(min_length=1)
    entry_point: EntryPoint
    public_test_cases: list[TestCase] = Field(min_length=1)
    execution_policy: ExecutionPolicy
    execution_mode: Literal["function", "stdio"] = "function"
    standard_io_profile: Literal["budget-pair", "tree-traversals", "knapsack", "knapsack-minweight", "delivery-deadline"] | None = None
    # Assigned by server-owned review code, never part of the model's draft schema.
    # Missing on legacy assets means that the expected answer is only a proposal.
    answer_check: Literal["lcs-string", "lcs-edit-budget", "capped-matches", "json-value"] | None = None

    @model_validator(mode="after")
    def valid_stdio(self) -> PublicProblem:
        if self.answer_check == "json-value":
            if self.entry_point.return_type != "str":
                raise ValueError("JSON语义判题要求返回JSON字符串")
            def reject_constant(value):
                raise ValueError(f"JSON不允许常量 {value}")
            for case in self.public_test_cases:
                if type(case.expected) is not str:
                    raise ValueError("JSON语义判题的标准答案必须为JSON字符串")
                try: json.loads(case.expected, parse_constant=reject_constant)
                except ValueError as exc:
                    raise ValueError("JSON语义判题的标准答案必须是有效JSON") from exc
        if self.standard_io_profile is not None and self.execution_mode != "stdio":
            raise ValueError("标准输入输出题型仅适用于 stdio 运行模式")
        if self.execution_mode == "stdio":
            if (len(self.entry_point.parameters) != 1 or self.entry_point.parameters[0].name != "stdin"
                or self.entry_point.parameters[0].type != "str" or self.entry_point.return_type != "str"):
                raise ValueError("标准输入输出题必须声明 stdin: str -> str 适配入口")
            if any(set(c.inputs) != {"stdin"} or type(c.inputs["stdin"]) is not str or type(c.expected) is not str
                   for c in self.public_test_cases):
                raise ValueError("标准输入输出用例必须包含字符串输入和输出")
        return self


class SceneBase(PublicModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    course_id: Text
    scene_id: Text
    language: Literal["python"] = "python"
    markdown_content: Text
    interactive_code: Text
    problem: PublicProblem


class GuidedLabScene(SceneBase):
    scene_type: Literal["guided-lab"] = "guided-lab"
    template: Literal["guided-lab-v1"] = "guided-lab-v1"
    teaching_steps: list[TeachingStep] = Field(min_length=1)


class OJLabScene(SceneBase):
    scene_type: Literal["oj-lab"] = "oj-lab"
    template: Literal["oj-lab-v1"] = "oj-lab-v1"


LabScene = Annotated[GuidedLabScene | OJLabScene, Field(discriminator="scene_type")]


class PrivateAssessment(InternalModel):
    hidden_test_cases: list[TestCase] = Field(min_length=3)
    reference_solution: Text
    pytest_source: Text


class PrivateProblem(InternalModel):
    """仅供服务端存储和判题；学生数据显式从 scenes 投影。"""
    guided_scene: GuidedLabScene
    oj_scene: OJLabScene
    hidden_test_cases: list[TestCase] = Field(min_length=3)
    reference_solution: Text
    pytest_source: Text
    oj_assessment: PrivateAssessment | None = None
    quality_status: Literal["static-validated"] = "static-validated"

    @model_validator(mode="after")
    def coherent_scenes(self) -> PrivateProblem:
        guided, oj = self.guided_scene, self.oj_scene
        if guided.course_id != oj.course_id:
            raise ValueError("双页必须共享课程")
        if guided.problem != oj.problem and self.oj_assessment is None:
            raise ValueError("独立 OJ 题目必须有对应私有评测资产")
        if guided.scene_id == oj.scene_id:
            raise ValueError("双页 sceneId 必须不同")
        ids = [case.case_id for case in guided.problem.public_test_cases + self.hidden_test_cases]
        if len(ids) != len(set(ids)):
            raise ValueError("公开与隐藏用例 ID 重复")
        if self.oj_assessment:
            ids = [case.case_id for case in oj.problem.public_test_cases + self.oj_assessment.hidden_test_cases]
            if len(ids) != len(set(ids)):
                raise ValueError("独立题公开与隐藏用例 ID 重复")
        return self


class FinalOutput(InternalModel):
    """工作流内部结果：兼容旧 lab 导出格式，新增私有双页题目。"""
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    course_id: Text
    topic: Text
    requires_lab: bool
    lesson_plan: LessonPlan
    common_mistakes: list[str]
    lab: LabSpec | None
    problem: PrivateProblem | None
    status: Literal["ready"]

    @model_validator(mode="after")
    def validate_lab_branch(self) -> FinalOutput:
        if self.requires_lab != (self.lab is not None and self.problem is not None):
            raise ValueError("requires_lab 与 lab/problem 内容不一致")
        if not self.requires_lab and (self.lab is not None or self.problem is not None):
            raise ValueError("理论分支不能残留实验资产")
        if self.problem is not None and self.problem.guided_scene.course_id != self.course_id:
            raise ValueError("题目课程 ID 与工作流不一致")
        return self


class PublicLessonPlan(PublicModel):
    title: Text
    objectives: list[Text] = Field(min_length=1)
    knowledge_points: list[Text] = Field(min_length=1)


class GenerateRequest(PublicModel):
    prompt: Text = Field(max_length=12000)


class PublicCourse(PublicModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    course_id: Text
    topic: Text
    requires_lab: bool
    lesson_plan: PublicLessonPlan
    common_mistakes: list[str]
    generation_status: Literal["generated"] = "generated"
    quality_status: Literal["static-validated"] = "static-validated"
    scenes: list[LabScene]

    @model_validator(mode="after")
    def validate_scenes(self) -> PublicCourse:
        if not self.requires_lab:
            if self.scenes:
                raise ValueError("理论课程的 Lab 场景必须为空")
            return self
        if len(self.scenes) != 2 or not isinstance(self.scenes[0], GuidedLabScene) or not isinstance(self.scenes[1], OJLabScene):
            raise ValueError("实验课程必须依次包含 guided-lab 和 oj-lab")
        guided, oj = self.scenes
        if guided.scene_id == oj.scene_id:
            raise ValueError("双页身份/题目规格不一致")
        if any(scene.course_id != self.course_id for scene in self.scenes):
            raise ValueError("场景所属课程不一致")
        return self


def to_public_course(data: dict[str, Any]) -> dict[str, Any]:
    """唯一学生投影入口：白名单组装，绝不序列化整个私有工作流结果。"""
    final = FinalOutput.model_validate(data)
    public = PublicCourse(
        course_id=final.course_id, topic=final.topic, requires_lab=final.requires_lab,
        lesson_plan=PublicLessonPlan(**final.lesson_plan.model_dump()),
        common_mistakes=final.common_mistakes,
        scenes=[final.problem.guided_scene, final.problem.oj_scene] if final.problem else [],
    )
    return public.model_dump(mode="json", by_alias=True)


class GeneratedCourse(PublicModel):
    """仅供已认证的 Next.js 服务与 Python 传输；不能作为浏览器响应。"""
    public_course: PublicCourse
    private_output: FinalOutput

    @model_validator(mode="after")
    def matches_projection(self) -> GeneratedCourse:
        expected = to_public_course(self.private_output.model_dump(mode="json"))
        if self.public_course.model_dump(mode="json", by_alias=True) != expected:
            raise ValueError("内部传输的公开数据必须与私有资产投影一致")
        return self

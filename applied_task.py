"""Topic-independent applied OJ specification, assembled before code adaptation.

Scenario roles are part of the task contract, not an editorial caption. No
algorithm names or industry whitelist are used to select this workflow.
"""
from typing import Annotated, Literal
from pydantic import Field, create_model, model_validator
from lab_contracts import InternalModel, LabDraft, JsonValue, TestCase
from lab_assembly import entry_point_from_source, _matches_type, validate_test_cases
import json
import re
import ast

Text = Annotated[str, Field(min_length=4, max_length=400)]


class InputRole(InternalModel):
    parameter: str = Field(min_length=1, max_length=80, pattern=r'^[A-Za-z_][A-Za-z0-9_]*$')
    meaning: Text


class DecisionVariant(InternalModel):
    constraint: int = Field(ge=0,le=1000000000,
        description='新增可变额度、时限或数量上限参数的非负整数取值，不是说明文字或赋值表达式')
    # Match the runtime's actual return-value contract. Recursive arbitrary
    # JSON here invited object/matrix answers that no lab entry can return.
    expected: int | str | bool | list[int] | list[str] | list[bool]
    explanation: Text


class DecisionEvidence(InternalModel):
    base_inputs: dict[str, JsonValue]
    variants: list[DecisionVariant] = Field(min_length=2,max_length=2)


class AppliedTask(InternalModel):
    title: Text
    setting: Annotated[str, Field(min_length=20, max_length=400)]
    actor: Text
    objective: Annotated[str, Field(min_length=16, max_length=400)]
    input_roles: list[InputRole] = Field(min_length=1, max_length=8)
    decision_rules: list[Text] = Field(min_length=2, max_length=4)
    output_meaning: Text
    boundary_rules: list[Text] = Field(min_length=1, max_length=3)
    transfer_difference: Text
    # Optional for reading older plans; new model schemas require this before
    # implementation. These are proposed specification examples, not oracles.
    decision_evidence: DecisionEvidence | None = None


def decision_evidence_types(task: AppliedTask):
    if task.decision_evidence is None: return None
    variants=task.decision_evidence.variants
    kinds=('int','str','bool','list[int]','list[str]','list[bool]')
    inferred=[]
    for field in ('constraint','expected'):
        candidates=[kind for kind in kinds if all(_matches_type(getattr(v,field),kind) for v in variants)]
        if not candidates: raise ValueError('场景对照用例必须使用一致的标量或平坦列表类型，不能混用数字与字符串')
        inferred.append(candidates[0])
    return tuple(inferred)


def applied_plan_schema(base_parameters: dict[str,str]):
    """Make required source roles structural, rather than hoping prose is obeyed."""
    roles=create_model('RequiredSourceRoles',__base__=InternalModel,
        **{name:(Text,Field(description=f'基础参数 {name}，类型 {kind}，说明场景含义，不改变结构'))
           for name,kind in base_parameters.items()})
    # Allocate a valid, non-colliding transport identity. The model designs
    # its business meaning (capacity/budget/deadline), never its Python name.
    constraint_name='scenario_limit'
    while constraint_name in base_parameters:
        constraint_name+='_extra'
    constraint=create_model('ScenarioConstraintRole',__base__=InputRole,
        parameter=(Literal[constraint_name],...),
        meaning=(Text,Field(description='说明输入的可变整数额度、数量上限或时限如何影响业务决策，不要将其写成固定常量或文本命令')))
    types={'int':int,'str':str,'bool':bool,'list[int]':list[int],'list[str]':list[str],'list[bool]':list[bool]}
    base_inputs=create_model('DecisionBaseInputs',__base__=InternalModel,
        **{name:(types[kind],...) for name,kind in base_parameters.items()})
    evidence=create_model('RequiredDecisionEvidence',__base__=InternalModel,
        base_inputs=(base_inputs,...), variants=(list[DecisionVariant],Field(min_length=2,max_length=2)))
    def canonical_constraint_identity(cls, value):
        # The platform allocates this transport identity; the model owns its
        # business meaning, not its Python variable name. A safe alias such as
        # budget is canonicalized before validation, without changing examples.
        if isinstance(value,dict) and isinstance(value.get('additional_constraint'),dict):
            alias=value['additional_constraint'].get('parameter')
            if isinstance(alias,str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',alias) and alias not in base_parameters:
                value={**value,'additional_constraint':{**value['additional_constraint'],'parameter':constraint_name}}
        return value
    return create_model('ConstrainedAppliedTask',__base__=AppliedTask,
        __validators__={'canonical_constraint_identity':model_validator(mode='before')(canonical_constraint_identity)},
        input_roles=(roles,...), additional_constraint=(constraint,...), decision_evidence=(evidence,...))


def parse_applied_plan(raw: str, base_parameters: dict[str,str]) -> AppliedTask:
    data=json.loads(raw)
    if isinstance(data.get('input_roles'),dict):
        parsed=applied_plan_schema(base_parameters).model_validate(data,strict=True)
        data=parsed.model_dump(mode='json')
        constraint=data.pop('additional_constraint')
        data['input_roles']=[{'parameter':name,'meaning':meaning}
                             for name,meaning in data['input_roles'].items()]+[constraint]
    task=AppliedTask.model_validate(data,strict=True)
    validate_plan(task,base_parameters)
    return task


def validate_business_rules(rules: list[str]) -> None:
    # A required solution technique is legitimate alongside computable task
    # rules. Reject textbook-only plans, not any mention of implementing the
    # lesson algorithm (e.g. "使用 AVL 算法实现动态索引").
    pedagogical = r'基本原理|算法的步骤|实现.{0,20}算法|算法实现'
    if all(re.search(pedagogical, rule) for rule in rules):
        raise ValueError('场景计划必须包含可计算业务规则，不能只有算法原理或教学步骤')


def validate_plan(task: AppliedTask, base_parameters: set[str] | dict[str,str]) -> None:
    roles = [role.parameter for role in task.input_roles]
    if len(set(roles)) != len(roles) or not set(base_parameters) < set(roles):
        raise ValueError(f'场景计划须保留全部基础参数，并增加实际约束参数；名称不能重复。基础参数={list(base_parameters)}，实际角色={roles}')
    if isinstance(base_parameters,dict):
        for role in task.input_roles:
            kind = base_parameters.get(role.parameter)
            compound_scalar = kind in ('list[int]', 'list[bool]') and re.search(r'每[个件项条].{0,12}(?:包含|含有).{0,24}(?:和|及|、|与)|每[个件项条].{0,12}(?:名称|单价).{0,16}(?:利润|评分|价格)',role.meaning)
            if kind in ('list[int]','list[str]','list[bool]') and (re.search(r'字典|对象|结构体',role.meaning) or compound_scalar):
                raise ValueError('基础输入为平坦列表，场景不能将其解释成字典或对象列表；请使用原列表中的数值设计预算、配额或时限决策')
    validate_business_rules(task.decision_rules)
    if re.search(r'某个阈值|某一阈值|一定阈值|某个限制', ' '.join(task.decision_rules)):
        raise ValueError('场景规则不能使用未定义的阈值；必须给出具体数值或对应输入参数，并明确是否包含边界')
    if task.decision_evidence:
        evidence=task.decision_evidence
        if set(evidence.base_inputs)!=set(base_parameters):
            raise ValueError('场景对照用例必须恰好保留全部基础参数')
        if len(set(roles)-set(base_parameters))!=1:
            raise ValueError('场景对照用例只允许一个新增决策约束')
        left,right=evidence.variants
        if left.constraint==right.constraint or left.expected==right.expected:
            raise ValueError('场景对照用例需要两个不同约束、两个真实不同的正确输出；请重新设计会改变决策的任务，不得捏造输出')
        kinds=decision_evidence_types(task)
        extra=next(r for r in task.input_roles if r.parameter not in base_parameters)
        if re.search(r'长度|字符数|预算|容量|额度|上限|下限|次数|整数|最高.{0,16}(价格|成本|费用|重量)|\bint\b',extra.meaning,re.I) and kinds[0]!='int':
            raise ValueError('场景对照用例中的长度、预算或数量限制必须给整数，不能填写说明文字或修改基础输入的赋值表达式')


def apply_decision_evidence(draft: LabDraft, task: AppliedTask) -> LabDraft:
    """Carry approved small examples into implementation instead of regenerating them."""
    if task.decision_evidence is None: return draft
    evidence=task.decision_evidence
    extra=set(r.parameter for r in task.input_roles)-set(evidence.base_inputs)
    if len(extra)!=1: raise ValueError('场景对照用例缺少唯一新增约束')
    name=next(iter(extra))
    planned=[TestCase(case_id=f'public-{i+1}',inputs={**evidence.base_inputs,name:v.constraint},
        expected=v.expected,description=v.explanation) for i,v in enumerate(evidence.variants)]
    validate_test_cases(planned,entry_point_from_source(draft.reference_solution))
    candidate=draft.model_copy(deep=True)
    candidate.public_test_cases=planned+candidate.public_test_cases[2:]
    # Identical inputs cannot acquire another expected from the implementation
    # generator. This is specification consistency, not mathematical validation.
    for case in candidate.public_test_cases+candidate.hidden_test_cases:
        for approved in planned:
            if case.inputs==approved.inputs:case.expected=approved.expected
    return candidate


def apply_task(draft: LabDraft, task: AppliedTask) -> LabDraft:
    entry = entry_point_from_source(draft.reference_solution)
    names = [p.name for p in entry.parameters]
    roles = [role.parameter for role in task.input_roles]
    if sorted(names) != sorted(roles):
        raise ValueError(f'场景必须逐一说明每个输入参数代表的实际对象或资源，不能遗漏或重复。已批准参数={roles}；实现参数={names}；请让 implementation.parameters 与全部用例 inputs 恰好使用已批准参数')
    if task.decision_evidence:
        extra=set(roles)-set(task.decision_evidence.base_inputs)
        reads={node.id for node in ast.walk(ast.parse(draft.reference_solution))
               if isinstance(node,ast.Name) and isinstance(node.ctx,ast.Load)}
        if not extra <= reads:
            raise ValueError('场景对照用例中的新增约束未被实现读取；不能编造不同输出证明无效参数，请重新设计实际影响决策的任务')
    if len(set(task.decision_rules)) != len(task.decision_rules):
        raise ValueError('综合任务的决策要求不能重复')
    validate_business_rules(task.decision_rules)
    if re.search(r'(排序|遍历).{0,8}(长度|元素个数|节点数量)',task.output_meaning):
        raise ValueError('不能用排序或遍历后未改变的集合长度充当综合任务')
    # A textbook introduction is not a setting, even with a scenario prefix.
    if task.setting.lstrip().startswith(('在图论中', '在计算机科学中', '在算法中', '给定一个图', '给定一个数组')):
        raise ValueError('场景必须有实际使用者与具体活动，不能填写算法定义')
    text = (f'{task.setting}\n\n{task.actor}\n\n任务：{task.objective}\n\n要求：\n'
            + '\n'.join(f'- {rule}' for rule in task.decision_rules)
            + '\n\n输入含义：\n' + '\n'.join(f'- {r.parameter}：{r.meaning}' for r in task.input_roles)
            + f'\n\n输出：{task.output_meaning}\n\n边界约定：\n'
            + '\n'.join(f'- {rule}' for rule in task.boundary_rules)
            + f'\n\n与引导任务的区别：{task.transfer_difference}')
    return draft.model_copy(update={'title': task.title, 'instructions': text})


def validate_scenario_decision(guided: LabDraft, independent: LabDraft) -> None:
    """Require evidence that a new real-world constraint affects the answer.

    This is a relational check of declared examples, not execution or a proof
    that an arbitrary generated algorithm is mathematically correct.
    """
    base_types = {p.name:p.type for p in entry_point_from_source(guided.reference_solution).parameters}
    new_types = {p.name:p.type for p in entry_point_from_source(independent.reference_solution).parameters}
    base, new = set(base_types), set(new_types)
    if not base < new:
        raise ValueError('自主题须保留基础数据参数并增加场景约束参数（如预算、时限、配额或已有条件）；不能仅返回原结果的长度')
    if any(new_types[name] != kind for name,kind in base_types.items()):
        raise ValueError('必须保留基础参数的数据类型，不能把整数价格列表偷偷改成包含未声明评分的字典或 JSON 字符串；场景应依据已有基础结构设计')
    samples = independent.public_test_cases + independent.hidden_test_cases
    for i,left in enumerate(samples):
        for right in samples[i+1:]:
            if (all(left.inputs[name] == right.inputs[name] for name in base)
                and any(left.inputs[name] != right.inputs[name] for name in new-base)
                and json.dumps(left.expected,sort_keys=True) != json.dumps(right.expected,sort_keys=True)):
                return
    raise ValueError('必须至少有一对公开或隐藏用例：基础数据相同，只改变新增场景约束，正确答案随之改变；证明实现真正做了场景决策')

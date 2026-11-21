"""确定性组装双页资产；不执行模型代码。"""
from __future__ import annotations

import ast
import json
import io
import re
import tokenize
from copy import deepcopy
from uuid import uuid4

from lab_contracts import (
    EntryPoint, ExecutionPolicy, GuidedLabScene, LabDraft, LabSpec, OJLabScene,
    Parameter, PrivateProblem, PublicProblem, TestCase,
)


def normalize_body_layout(source: str) -> str:
    """Decode layout escapes before indenting a generated method body.

    Escapes inside Python string tokens remain literal. This is a syntax-only
    transformation; it never fills missing blocks or executes source.
    """
    # JSON replies sometimes turn a Python '\n' delimiter into a literal
    # newline between two quotes. Repair only that exact malformed token,
    # never valid strings, comments, multiline strings or missing quote ends.
    offsets=[0]
    for line in source.splitlines(keepends=True):offsets.append(offsets[-1]+len(line))
    replacements=[]
    try:
        for token in tokenize.generate_tokens(io.StringIO(source).readline):
            if token.type==tokenize.ERRORTOKEN and token.string in ("'",'"'):
                start=offsets[token.start[0]-1]+token.start[1]
                fragment=source[start:]
                for newline in ('\r\n','\n'):
                    if fragment.startswith(token.string+newline+token.string):
                        replacements.append((start+1,len(newline)))
    except (tokenize.TokenError,IndentationError):
        pass
    for position,length in reversed(replacements):
        source=source[:position]+'\\n'+source[position+length:]

    def parse_with_margin(text: str) -> str:
        try:
            ast.parse(text)
            return text
        except IndentationError as error:
            # Some replies omit the common margin on the first line only.
            # Normalize that margin only when the result parses, and do not
            # touch multiline strings whose whitespace is actual data.
            if 'unexpected indent' not in str(error) or "'''" in text or '"""' in text:
                raise
            lines=text.splitlines(keepends=True)
            margins=[len(line)-len(line.lstrip(' ')) for line in lines[1:] if line.strip()]
            if not margins or min(margins)==0 or lines[0].startswith((' ','\t')):
                raise
            margin=min(margins)
            fixed=lines[0]+''.join(line[margin:] if line.strip() else line for line in lines[1:])
            ast.parse(fixed)
            return fixed
    try:
        return parse_with_margin(source)
    except SyntaxError:
        pass
    spans, offsets = [], [0]
    for line in source.splitlines(keepends=True):
        offsets.append(offsets[-1]+len(line))
    try:
        for token in tokenize.generate_tokens(io.StringIO(source).readline):
            if token.type == tokenize.STRING:
                spans.append((offsets[token.start[0]-1]+token.start[1],offsets[token.end[0]-1]+token.end[1]))
    except (tokenize.TokenError,IndentationError):
        pass
    parts,cursor=[],0
    for start,end in spans:
        parts.extend([source[cursor:start].replace('\\n','\n').replace('\\t','\t'),source[start:end]])
        cursor=end
    parts.append(source[cursor:].replace('\\n','\n').replace('\\t','\t'))
    repaired=''.join(parts)
    return parse_with_margin(repaired)


def normalize_generated_draft(draft: LabDraft) -> LabDraft:
    """Build boilerplate from a statically validated reference signature; never run model code."""
    source = draft.reference_solution.strip()
    fenced = re.fullmatch(r'```(?:python|py)?\s*\n(.*?)\n```', source, re.S)
    if fenced:
        source = fenced.group(1)
    try:
        tree = ast.parse(source)
    except SyntaxError:
        # Some JSON-mode replies double-escape layout newlines. Preserve actual string
        # literals, including '\\n' inside a returned string, when repairing outer layout.
        spans = []
        offsets = [0]
        for line in source.splitlines(keepends=True):
            offsets.append(offsets[-1] + len(line))
        try:
            for token in tokenize.generate_tokens(io.StringIO(source).readline):
                if token.type == tokenize.STRING:
                    spans.append((offsets[token.start[0]-1] + token.start[1], offsets[token.end[0]-1] + token.end[1]))
        except (tokenize.TokenError, IndentationError):
            pass
        parts, cursor = [], 0
        for start, end in spans:
            parts.extend([source[cursor:start].replace('\\n', '\n').replace('\\t', '\t'), source[start:end]])
            cursor = end
        parts.append(source[cursor:].replace('\\n', '\n').replace('\\t', '\t'))
        tree = ast.parse(''.join(parts))
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Solution']
    if len(classes) == 1 and not any(isinstance(node, ast.FunctionDef) and node.name == 'solve' for node in classes[0].body):
        methods = [node for node in classes[0].body if isinstance(node, ast.FunctionDef) and not node.name.startswith('_')]
        if len(methods) == 1 and not methods[0].decorator_list:
            old_name = methods[0].name
            methods[0].name = 'solve'
            for node in ast.walk(methods[0]):
                if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == 'self' and node.attr == old_name:
                    node.attr = 'solve'
    # all()/any() return booleans; comparing them to infinity cannot detect
    # unreachable numeric entries. Reject this language-level error for every topic.
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare):
            operands = [node.left, *node.comparators]
            boolean_reduce = any(isinstance(value, ast.Call) and isinstance(value.func, ast.Name)
                                 and value.func.id in ('all', 'any') for value in operands)
            infinity = any(isinstance(value, ast.Call) and isinstance(value.func, ast.Name)
                           and value.func.id == 'float' and value.args and isinstance(value.args[0], ast.Constant)
                           and str(value.args[0].value).lower() in ('inf', 'infinity') for value in operands)
            if boolean_reduce and infinity:
                raise ValueError('all/any 返回布尔值，不能与 float(inf) 比较来判断集合是否包含无穷；必须逐元素比较并重新计算相关用例')
    # A collection initialized with infinity is a numeric sentinel table, not a
    # Boolean reachability table. Its 0 entries are false and infinity is true.
    sentinel_tables = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(item, ast.Call) and isinstance(item.func, ast.Name) and item.func.id == 'float'
            and item.args and isinstance(item.args[0], ast.Constant)
            and str(item.args[0].value).lower() in ('inf', 'infinity') for item in ast.walk(node.value)
        ) and isinstance(node.value, (ast.List, ast.ListComp, ast.BinOp)):
            sentinel_tables.update(target.id for target in node.targets if isinstance(target, ast.Name))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('all', 'any')
            and node.args and isinstance(node.args[0], ast.Name) and node.args[0].id in sentinel_tables):
            raise ValueError('无穷哨兵数值表不能直接用 all/any 判断状态：0 为假但 inf 为真；请显式逐元素比较并重新计算用例')
    reference = ast.unparse(tree) + '\n'
    method = solve_method(tree)
    def returns_value(node):
        if isinstance(node, ast.Return):
            return node.value is not None
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            return False
        return any(returns_value(child) for child in ast.iter_child_nodes(node))
    if not any(returns_value(node) for node in method.body):
        raise ValueError('solve 方法自身必须返回声明类型的计算结果；仅定义辅助函数而未调用返回会隐式返回 None，不能发布。请将实际计算放入方法体或调用辅助函数并返回结果。')
    if len(method.body) == 1 and isinstance(method.body[0], ast.Return):
        result = method.body[0].value
        if isinstance(result, ast.Constant) or (
            isinstance(result, (ast.List, ast.Tuple, ast.Dict))
            and not any(isinstance(item, ast.Name) for item in ast.walk(result))
        ) or (
            isinstance(result, ast.BinOp) and isinstance(result.op, ast.Mult)
            and isinstance(result.left, ast.List) and result.left.elts
            and all(isinstance(item, ast.Constant) for item in result.left.elts)
        ):
            raise ValueError('参考实现只返回常量或重复常量列表，未实现题目计算；禁止发布占位答案')
    entry_point_from_source(reference)  # Do not repair missing/unsupported types or invent semantics.
    method = deepcopy(solve_method(tree))
    if method.decorator_list:
        raise ValueError('solve 不支持装饰器，必须为普通实例方法')
    method.body = [ast.Raise(exc=ast.Name(id='NotImplementedError', ctx=ast.Load()))]
    method_source = ast.unparse(ast.fix_missing_locations(method))
    lines = method_source.splitlines()
    scaffold = 'class Solution:\n' + '\n'.join('    ' + line for line in [lines[0], '    # TODO', *lines[1:]]) + '\n'
    return draft.model_copy(update={'reference_solution': reference, 'scaffold_code': scaffold})


def solve_method(tree: ast.Module) -> ast.FunctionDef:
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Solution"]
    if len(classes) != 1:
        raise ValueError("必须包含唯一 class Solution")
    methods = [node for node in classes[0].body if isinstance(node, ast.FunctionDef) and node.name == "solve"]
    if len(methods) != 1:
        raise ValueError("必须包含唯一同步 solve 方法")
    return methods[0]


def entry_point_from_source(source: str) -> EntryPoint:
    method = solve_method(ast.parse(source))
    args = method.args
    if args.posonlyargs or args.kwonlyargs or args.vararg or args.kwarg or args.defaults:
        raise ValueError("v1 仅支持必填的位置/关键字参数，不支持默认值或可变参数")
    if not args.args or args.args[0].arg != "self" or method.returns is None:
        raise ValueError("solve 必须是有返回类型的实例方法")
    parameters = []
    for arg in args.args[1:]:
        if arg.annotation is None:
            raise ValueError("参数缺少类型提示")
        parameters.append(Parameter(name=arg.arg, type=ast.unparse(arg.annotation).replace(" ", "")))
    return EntryPoint(parameters=parameters, return_type=ast.unparse(method.returns).replace(" ", ""))


def _matches_type(value: object, expected: str) -> bool:
    scalars = {"int": int, "str": str, "bool": bool}
    if expected in scalars:
        return type(value) is scalars[expected]
    return isinstance(value, list) and all(type(item) is scalars[expected[5:-1]] for item in value)


def validate_test_cases(cases: list[TestCase], entry: EntryPoint, *, allow_alternatives: bool = False) -> None:
    parameters = {parameter.name: parameter.type for parameter in entry.parameters}
    seen = {}
    for case in cases:
        json.dumps(case.model_dump(mode="json"), allow_nan=False)
        if set(case.inputs) != set(parameters):
            raise ValueError(f"用例 {case.case_id} 参数名/数量与 solve 不一致")
        for name, kind in parameters.items():
            if not _matches_type(case.inputs[name], kind):
                value = case.inputs[name]
                shape = type(value).__name__
                if isinstance(value, list):
                    shape += '[' + ','.join(sorted({type(item).__name__ for item in value})) + ']'
                raise ValueError(f"用例 {case.case_id} 的 inputs.{name} 应为 {kind}，实际为 {shape}；复杂结构必须统一使用 JSON 字符串编码")
        if not _matches_type(case.expected, entry.return_type):
            raise ValueError(f"用例 {case.case_id} 预期输出类型不一致")
        key = json.dumps(case.inputs, sort_keys=True, ensure_ascii=False)
        if not allow_alternatives and key in seen and seen[key] != case.expected:
            raise ValueError(f"用例 {case.case_id} 与相同输入的另一个用例答案冲突；不得将模型候选值直接作为确定答案")
        seen[key] = case.expected


def build_pytest_source(cases: list[TestCase], answer_check: str | None = None, *, stdio_runner: bool = False) -> str:
    """仅从已验证 JSON 数据创建固定测试入口；字符串用 repr 防止源码注入。"""
    call = '_run' if stdio_runner else 'Solution().solve'
    lines = ["# 服务端/教师评测资产", "import pytest", "import json", "" if stdio_runner else "from solution import Solution", "",
             "def _normalize(value):",
             "    return '\\n'.join(line.rstrip(' \\t') for line in value.replace('\\r\\n', '\\n').replace('\\r', '\\n').split('\\n')).rstrip('\\n')", "",
             "def _equal(actual, expected):",
             "    if type(actual) in (int, float) and type(expected) in (int, float): return actual == expected",
             "    if type(actual) is not type(expected): return False",
             "    if isinstance(actual, str): return _normalize(actual) == _normalize(expected)",
             "    if isinstance(actual, list): return len(actual) == len(expected) and all(_equal(a, b) for a, b in zip(actual, expected))",
             "    if isinstance(actual, dict): return actual.keys() == expected.keys() and all(_equal(actual[k], expected[k]) for k in actual)",
             "    return actual == expected", "",
             "def _json_value_equal(actual, expected):",
             "    if type(actual) in (int, float) and type(expected) in (int, float): return actual == expected",
             "    if type(actual) is not type(expected): return False",
             "    if isinstance(actual, list): return len(actual) == len(expected) and all(_json_value_equal(a, b) for a, b in zip(actual, expected))",
             "    if isinstance(actual, dict): return actual.keys() == expected.keys() and all(_json_value_equal(actual[k], expected[k]) for k in actual)",
             "    return actual == expected", "",
             "def _json_output_equal(actual, expected):",
             "    if type(actual) is not str or type(expected) is not str: return False",
             "    try: return _json_value_equal(json.loads(actual), json.loads(expected))",
             "    except (ValueError, TypeError): return False", "",
             "def _stdio_equal(actual, expected):",
             "    try: parsed = json.loads(expected)",
             "    except (ValueError, TypeError): return _equal(actual, expected)",
             "    try: return type(actual) is str and _json_value_equal(json.loads(actual), parsed)",
             "    except (ValueError, TypeError): return False", ""]
    if answer_check == 'capped-matches':
        lines += ['import json',
            'def _valid_capped(actual, expected):',
            '    value = json.loads(actual)',
            '    return type(value) is list and all(type(x) in (int, float) and x == int(x) for x in value) and value == json.loads(expected)', '']
    if answer_check == 'lcs-string':
        # Self-contained export: no dependency on the server's lcs_assets module.
        lines += ['def lcs_length(a, b):',
                  '    row = [0] * (len(b) + 1)',
                  '    for x in a:',
                  '        previous = row[:]',
                  '        for j, y in enumerate(b, 1):',
                  '            row[j] = previous[j-1] + 1 if x == y else max(previous[j], row[j-1])',
                  '    return row[-1]', '',
                  'def _valid_lcs(actual, a, b):',
                  '    def subseq(s, t):',
                  '        it = iter(t)',
                  '        return all(any(x == y for y in it) for x in s)',
                  '    return type(actual) is str and subseq(actual, a) and subseq(actual, b) and len(actual) == lcs_length(a, b)', '']
    for index, case in enumerate(cases):
        assertion = (f'_valid_lcs({call}(**{case.inputs!r}), {case.inputs["str1"]!r}, {case.inputs["str2"]!r})'
                     if answer_check == 'lcs-string' else
                     f'_valid_capped({call}(**{case.inputs!r}), {case.expected!r})' if answer_check == 'capped-matches' else
                     f'_json_output_equal({call}(**{case.inputs!r}), {case.expected!r})' if answer_check == 'json-value' else
                     f'{"_stdio_equal" if set(case.inputs) == {"stdin"} else "_equal"}({call}(**{case.inputs!r}), {case.expected!r})')
        lines.append(f"def test_case_{index}():")
        lines += [f"    assert {assertion}", ""]
    return "\n".join(lines)


def autonomous_scaffold(source: str) -> str:
    """从同一学生模板保留入口，移除引导 TODO 和方法体，不接触参考答案。"""
    tree = ast.parse(source)
    solve_method(tree).body = [ast.Pass()]
    return ast.unparse(ast.fix_missing_locations(tree)) + "\n"


def assemble_lab(draft: LabDraft, course_id: str, *, answer_check: str | None = None) -> tuple[LabSpec, PrivateProblem]:
    entry = entry_point_from_source(draft.scaffold_code)
    if entry != entry_point_from_source(draft.reference_solution):
        raise ValueError("学生模板与参考实现的入口不一致")
    cases = draft.public_test_cases + draft.hidden_test_cases
    validate_test_cases(cases, entry, allow_alternatives=True)
    from lcs_assets import draft_check
    from capped_match_assets import checker_for_draft
    answer_check = answer_check or draft_check(draft) or checker_for_draft(draft)
    if answer_check != 'lcs-string':
        validate_test_cases(cases, entry)
    pytest_source = build_pytest_source(cases, answer_check)
    legacy = LabSpec(
        title=draft.title, instructions=draft.instructions,
        files={"solution.py": draft.scaffold_code, "test_solution.py": pytest_source},
        reference_solution=draft.reference_solution,
        grading={
            "answer_authority": answer_check or "test-set",
            "command": ["python", "-m", "pytest", "-q", "test_solution.py"],
            "working_directory": "实验文件所在目录",
            "pass_condition": "全部测试断言通过",
            "criteria": [case.description for case in cases],
        },
    )
    problem = PublicProblem(
        problem_id=str(uuid4()), problem_version=1,
        title=draft.title, instructions=draft.instructions, difficulty=draft.difficulty,
        constraints=draft.constraints, entry_point=entry,
        public_test_cases=draft.public_test_cases, execution_policy=ExecutionPolicy(), answer_check=answer_check,
    )
    guided = GuidedLabScene(
        course_id=course_id, scene_id=str(uuid4()), problem=problem,
        markdown_content=f"# {draft.title}\n\n{draft.instructions}\n\n## 分步任务\n" + "\n".join(
            f"{index + 1}. {step.title}：{step.instruction}" for index, step in enumerate(draft.teaching_steps)
        ),
        interactive_code=draft.scaffold_code, teaching_steps=draft.teaching_steps,
    )
    oj = OJLabScene(
        course_id=course_id, scene_id=str(uuid4()), problem=problem,
        markdown_content=f"# {draft.title}\n\n{draft.instructions}",
        interactive_code=autonomous_scaffold(draft.scaffold_code),
    )
    private = PrivateProblem(
        guided_scene=guided, oj_scene=oj, hidden_test_cases=draft.hidden_test_cases,
        reference_solution=draft.reference_solution, pytest_source=pytest_source,
    )
    return legacy, private

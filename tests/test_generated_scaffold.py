"""Mechanical model output repairs must preserve literals and never execute source."""
import ast
import pytest
from lab_contracts import LabDraft
from lab_assembly import normalize_generated_draft, entry_point_from_source
from test_agent_workflow import lab_draft_payload


def test_boolean_translation_is_rejected_as_a_duplicate_task():
    from agent_workflow import validate_transfer_examples
    payload = lab_draft_payload()
    payload['reference_solution'] = 'class Solution:\n    def solve(self, numbers: list[int]) -> bool:\n        return not numbers\n'
    for case in payload['public_test_cases'] + payload['hidden_test_cases']:
        case['expected'] = not case['inputs']['numbers']
    guided = normalize_generated_draft(LabDraft.model_validate(payload))
    translated = guided.model_copy(deep=True)
    translated.reference_solution = 'class Solution:\n    def solve(self, numbers: list[int]) -> str:\n        return "空" if not numbers else "非空"\n'
    translated = normalize_generated_draft(translated)
    for case in translated.public_test_cases + translated.hidden_test_cases:
        case.expected = '空' if not case.inputs['numbers'] else '非空'
    with pytest.raises(ValueError, match='布尔结果'):
        validate_transfer_examples(guided, translated)


def test_scaffold_is_derived_even_if_model_omits_todo_or_solve():
    payload = lab_draft_payload()
    payload['scaffold_code'] = 'class Solution:\n    pass\n'
    draft = normalize_generated_draft(LabDraft.model_validate(payload))
    assert '# TODO' in draft.scaffold_code
    assert 'raise NotImplementedError' in draft.scaffold_code
    assert 'sum(' not in draft.scaffold_code
    assert entry_point_from_source(draft.scaffold_code) == entry_point_from_source(draft.reference_solution)


def test_double_escaped_layout_preserves_escaped_string_contents():
    payload = lab_draft_payload()
    source = 'class Solution:\n    def solve(self, numbers: list[int]) -> str:\n        return "\\n".join(map(str, numbers))\n'
    payload['reference_solution'] = source.replace('\n','\\n')
    draft = normalize_generated_draft(LabDraft.model_validate(payload))
    assert ast.dump(ast.parse(draft.reference_solution)) == ast.dump(ast.parse(source))


def test_single_public_method_can_be_named_solve_without_changing_computation():
    payload = lab_draft_payload()
    payload['reference_solution'] = payload['reference_solution'].replace('def solve(', 'def calculate(')
    draft = normalize_generated_draft(LabDraft.model_validate(payload))
    assert 'def solve(' in draft.reference_solution
    assert 'return sum(numbers)' in draft.reference_solution


def test_ambiguous_stack_api_is_not_silently_renamed():
    payload = lab_draft_payload()
    payload['reference_solution'] = 'class Solution:\n    def push(self, x: int) -> int:\n        return x\n    def pop(self) -> int:\n        return 0\n'
    with pytest.raises(ValueError, match='solve'):
        normalize_generated_draft(LabDraft.model_validate(payload))


def test_structured_method_body_builds_entry_and_student_template_deterministically():
    from agent_workflow import parse_generation_draft, StructuredGenerationDraft
    payload=lab_draft_payload()
    payload.pop('scaffold_code'); payload.pop('reference_solution')
    payload['implementation']={'parameters':[{'name':'numbers','type':'list[int]'}], 'return_type':'int', 'body':'return sum(numbers)'}
    StructuredGenerationDraft.model_validate(payload)
    draft=parse_generation_draft(payload)
    assert '# TODO' in draft.scaffold_code
    assert 'return sum(numbers)' not in draft.scaffold_code
    assert 'return sum(numbers)' in draft.reference_solution
    assert entry_point_from_source(draft.scaffold_code)==entry_point_from_source(draft.reference_solution)


def test_model_repeated_case_labels_are_assigned_distinct_server_ids():
    from agent_workflow import parse_generation_draft
    payload=lab_draft_payload()
    payload.pop('scaffold_code'); payload.pop('reference_solution')
    payload['implementation']={'parameters':[{'name':'numbers','type':'list[int]'}], 'return_type':'int', 'body':'return sum(numbers)'}
    for case in payload['public_test_cases']+payload['hidden_test_cases']:
        case['caseId']='case-1'
    draft=parse_generation_draft(payload)
    assert len({case.case_id for case in draft.public_test_cases+draft.hidden_test_cases})==7


def test_body_layout_is_decoded_before_indentation_and_preserves_string_escapes():
    from agent_workflow import parse_generation_draft
    payload=lab_draft_payload()
    payload.pop('scaffold_code'); payload.pop('reference_solution')
    payload['implementation']={'parameters':[{'name':'numbers','type':'list[int]'}], 'return_type':'int',
        'body':r"def total(values):\n    return sum(values)\ntext = '\n'\nreturn total(numbers)"}
    draft=parse_generation_draft(payload)
    tree=ast.parse(draft.reference_solution)
    strings=[node.value for node in ast.walk(tree) if isinstance(node,ast.Constant) and isinstance(node.value,str)]
    assert '\n' in strings
    assert 'def total(values):\n' in draft.reference_solution


@pytest.mark.parametrize('body',[
    'import heapq\n        total = sum(numbers)\n        return total',
    r'import heapq\n        total = sum(numbers)\n        return total',
])
def test_first_line_without_shared_margin_is_normalized(body):
    from agent_workflow import parse_generation_draft
    payload=lab_draft_payload()
    payload.pop('scaffold_code');payload.pop('reference_solution')
    payload['implementation']={'parameters':[{'name':'numbers','type':'list[int]'}],'return_type':'int','body':body}
    draft=parse_generation_draft(payload)
    ast.parse(draft.reference_solution)
    assert 'total = sum(numbers)' in draft.reference_solution


@pytest.mark.parametrize('quote',["'",'"'])
def test_literal_newline_between_delimiter_quotes_is_repaired_syntactically(quote):
    from lab_assembly import normalize_body_layout
    source='text = '+quote+'\n'+quote+'\nreturn text'
    repaired=normalize_body_layout(source)
    tree=ast.parse(repaired)
    assert tree.body[0].value.value=='\n'


def test_delimiter_repair_does_not_change_valid_strings_comments_or_multiline_data():
    from lab_assembly import normalize_body_layout
    source='value = """first\nsecond"""\n# quote\'\n# \'\nreturn "\\\\n"'
    assert normalize_body_layout(source)==source
    with pytest.raises(SyntaxError):normalize_body_layout("return 'unclosed\nnext_statement()")

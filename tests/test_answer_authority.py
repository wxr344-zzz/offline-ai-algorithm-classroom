"""Expected values need independent evidence, not agreement between two model replies."""
import ast
import itertools
import json
import pytest
import asyncio
from pydantic import ValidationError
from lcs_assets import lcs_guide, lcs_transfer, lcs_length, witness, draft_check, edit_answer, reviewed_lcs_teaching
from lab_assembly import assemble_lab, build_pytest_source, validate_test_cases, entry_point_from_source
from lab_contracts import LabDraft


def subsequences(seq):
    return {tuple(seq[i] for i in range(len(seq)) if mask & (1 << i)) for mask in range(1 << len(seq))}


def test_oracle_matches_exhaustive_subsequences_including_duplicates_and_empty():
    strings=[''.join(xs) for n in range(5) for xs in itertools.product('ab',repeat=n)]
    for a,b in itertools.product(strings,repeat=2):
        optimum=max(map(len,subsequences(a) & subsequences(b)))
        assert lcs_length(a,b)==optimum
        assert tuple(witness(a,b)) in subsequences(a) & subsequences(b)
        assert len(witness(a,b))==optimum


def test_screenshot_answer_is_impossible_and_cannot_be_published_as_reviewed():
    a=['面向对象','动态类型','解释型']; b=['静态类型','编译型','面向对象']
    assert witness(a,b)==['面向对象']
    assert lcs_length(a,b)==1
    assert ('面向对象','动态类型') not in subsequences(b)
    draft=lcs_guide('LCS')
    draft.public_test_cases[3].expected='AYZ'
    with pytest.raises(ValueError,match='公共性'):
        assemble_lab(draft,'test')


def test_multiple_optimal_outputs_are_valid_and_export_uses_property_checker():
    draft=lcs_guide('最长公共子序列')
    draft.public_test_cases[3].expected='AX'
    assert draft_check(draft)=='lcs-string'
    _,private=assemble_lab(draft,'test')
    source=private.pytest_source
    assert '_valid_lcs(' in source and 'from lcs_assets' not in source
    ast.parse(source)
    # Only developer-owned checker definitions are evaluated, never model source.
    definitions=ast.Module(body=[n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and not n.name.startswith('test_')],type_ignores=[])
    namespace={}; exec(compile(definitions,'audited-checker','exec'),namespace)
    for candidate in ['AY','AX']:
        assert namespace['_valid_lcs'](candidate,'AXYT','AYZX')
    for candidate in ['AYZ','A','XX']:
        assert not namespace['_valid_lcs'](candidate,'AXYT','AYZX')


def test_generic_model_cannot_claim_oracle_but_exports_strictly_assert_test_set():
    draft=lcs_guide('LCS')
    payload=draft.model_dump();payload['answer_check']='lcs-string'
    with pytest.raises(ValidationError): LabDraft.model_validate(payload)
    draft.reference_solution=draft.reference_solution.replace("return ''.join(result)","return 'invented'")
    _,private=assemble_lab(draft,'test')
    assert private.guided_scene.problem.answer_check is None
    assert 'pytest.skip' not in private.pytest_source
    assert '    assert ' in private.pytest_source


def test_same_input_cannot_have_conflicting_exact_answers():
    draft=lcs_guide('LCS'); a=draft.public_test_cases[0]
    cases=[a,a.model_copy(update={'case_id':'other','expected':'impossible'})]
    with pytest.raises(ValueError,match='答案冲突'):
        validate_test_cases(cases,entry_point_from_source(draft.scaffold_code))


def test_applied_task_has_real_constraint_and_oracle_for_every_public_and_hidden_case():
    draft=lcs_transfer(lcs_guide('LCS'),'LCS')
    _,problem=assemble_lab(draft,'test')
    assert problem.guided_scene.problem.answer_check=='lcs-edit-budget'
    cases=draft.public_test_cases+draft.hidden_test_cases
    for c in cases:
        data=json.loads(c.inputs['stdin'])
        a,b=data['planA'],data['planB']
        best=max(map(len,subsequences(a)&subsequences(b)))
        cost=len(a)+len(b)-2*best
        assert c.expected==f'{"YES" if cost<=data["budget"] else "NO"} {cost}'
    first,second=[json.loads(c.inputs['stdin']) for c in cases[:2]]
    assert first['planA']==second['planA'] and first['planB']==second['planB']
    assert cases[0].expected=='YES 4' and cases[1].expected=='NO 4'
    assert '万元' not in draft.instructions


@pytest.mark.parametrize('data',[{'planA':"['a']",'planB':[],'budget':1},
    {'planA':[],'planB':[],'budget':True},{'planA':[],'planB':[],'budget':-1}])
def test_no_eval_or_ambiguous_stringified_sequences(data):
    with pytest.raises(ValueError):edit_answer(data)


def test_workflow_publishes_reviewed_cases_and_cannot_let_an_editor_reinvent_answers(monkeypatch):
    from agent_workflow import LabAgent_Node, create_initial_state, OllamaProvider
    from problem_statements import review_problem_statements
    from lab_contracts import FinalOutput, PublicCourse, to_public_course
    from teaching_assets import run_teaching
    async def no_model(*args, **kwargs):
        raise AssertionError('Reviewed mathematical assets must not be replaced by model answers')
    monkeypatch.setattr(OllamaProvider,'generate',no_model)
    state=create_initial_state('给我讲解最长公共子序列 LCS 算法')
    state.update(current_topic='最长公共子序列 LCS 算法', requires_lab=True,
        final_output={'course_id':'lcs-integration','topic':'最长公共子序列 LCS 算法','requires_lab':True,
            'lesson_plan':{'title':'LCS','objectives':['掌握有序匹配'],'knowledge_points':['动态规划']},'common_mistakes':[]})
    update=asyncio.run(LabAgent_Node(state,replay_reviewed_transfer=True))
    output={**update['final_output'], 'status':'ready'}
    reviewed=asyncio.run(review_problem_statements(output))
    public=PublicCourse.model_validate(to_public_course(reviewed))
    assert [s.problem.answer_check for s in public.scenes]==['lcs-string','lcs-edit-budget']
    teaching=asyncio.run(run_teaching(public))
    assert teaching['algorithmTrace']['outcome']==public.scenes[0].problem.public_test_cases[0].expected
    assert len(teaching['algorithmTrace']['steps'])==9

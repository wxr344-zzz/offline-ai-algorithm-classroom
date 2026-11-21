import itertools
import json
import pytest
from capped_match_assets import REFERENCE,expected,checker_for_draft
from lcs_assets import lcs_guide
from lab_contracts import TestCase as Case
from lab_assembly import normalize_generated_draft,assemble_lab


def test_reviewed_first_match_kmp_agrees_with_independent_builtin_search():
    from capped_match_assets import FIRST_REFERENCE
    namespace={}
    exec(FIRST_REFERENCE,namespace)  # Fixed developer source, never generated code.
    solve=namespace['Solution']().solve
    strings=[''.join(x) for n in range(4) for x in itertools.product('ab',repeat=n)]
    for text,pattern in itertools.product(strings,strings):
        assert solve(text,pattern)==text.find(pattern)
    assert solve('🙂甲🙂','🙂')==0


def test_developer_kmp_matches_exhaustive_search_with_overlap_and_limits():
    namespace={}
    exec(REFERENCE,namespace)  # Fixed developer code only, never generated source.
    solve=namespace['Solution']().solve
    strings=[''.join(x) for n in range(4) for x in itertools.product('ab',repeat=n)]
    for text,pattern,limit in itertools.product(strings,strings,range(4)):
        data={'text':text,'pattern':pattern,'scenario_limit':limit}
        exhaustive=[] if not pattern else [i for i in range(len(text)-len(pattern)+1) if text[i:i+len(pattern)]==pattern][:limit]
        assert expected(data)==exhaustive
        assert json.loads(solve(json.dumps(data)))==exhaustive
    assert expected({'text':'🙂甲🙂','pattern':'🙂','scenario_limit':5})==[0,2]


def test_reviewed_marker_requires_audited_code_and_correct_expected():
    draft=lcs_guide('LCS')
    samples=[('hello world','o',1),('hello world','o',2),('aaaaa','aa',3),('abc','x',2),('abc','a',0),('abc','',2),('','a',2)]
    cases=[]
    for i,(text,pattern,limit) in enumerate(samples):
        data={'text':text,'pattern':pattern,'scenario_limit':limit}
        cases.append(Case(case_id=f'test-{i}',inputs={'stdin':json.dumps(data)},expected=json.dumps(expected(data)),description='限定数量匹配'))
    draft=draft.model_copy(update={'reference_solution':REFERENCE,'public_test_cases':cases[:4],'hidden_test_cases':cases[4:]})
    draft=normalize_generated_draft(draft)
    _,private=assemble_lab(draft,'reviewed-capped')
    assert private.guided_scene.problem.answer_check=='capped-matches'
    assert '_valid_capped' in private.pytest_source
    corrupted=draft.model_copy(deep=True)
    corrupted.public_test_cases[2].expected='[false, 1, 2]'
    with pytest.raises(ValueError,match='独立计算'):checker_for_draft(corrupted)
    draft.public_test_cases[0].expected='[0]'
    with pytest.raises(ValueError,match='独立计算'):checker_for_draft(draft)


@pytest.mark.parametrize('data',[{'text':'abc','pattern':'a','scenario_limit':"pattern='x'"},
    {'text':'abc','pattern':'a','scenario_limit':True},{'text':'abc','pattern':'a','scenario_limit':-1}])
def test_malformed_quotas_are_not_interpreted_as_commands(data):
    with pytest.raises(ValueError):expected(data)


def test_teaching_frames_show_the_actual_compared_character_and_final_position():
    from pathlib import Path
    from lab_contracts import PublicCourse,EntryPoint,Parameter
    from capped_match_assets import reviewed_teaching
    from teaching_assets import AlgorithmClassroomTeaching
    course=PublicCourse.model_validate(json.loads((Path(__file__).parents[1]/'contracts/examples/public-lab.json').read_text(encoding='utf-8')))
    guide=course.scenes[0].problem
    guide.entry_point=EntryPoint(parameters=[Parameter(name='text',type='str'),Parameter(name='pattern',type='str')],return_type='int')
    guide.public_test_cases=[Case(case_id='first',inputs={'text':'hello','pattern':'ll'},expected=2,description='首次匹配')]
    course.scenes[1].problem.answer_check='capped-matches'
    teaching=AlgorithmClassroomTeaching.model_validate(reviewed_teaching(course))
    assert teaching.algorithm_trace.outcome==2
    assert len(teaching.algorithm_trace.steps)==6
    assert teaching.algorithm_trace.steps[-1].values[-2:]==['文本下标 i=3','已匹配长度 j=2']
    assert 'LPS: [0, 1]' in teaching.algorithm_trace.steps[0].values

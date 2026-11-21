"""Quiz answers are computational facts of the current algorithm, not UI metadata."""
import json
from types import SimpleNamespace
import pytest
from exam_simulator import catalog
from executable_lessons import known_contract, compile_drafts, compiled_teaching, ApplicationLabels
from teaching_assets import ClassroomTeaching


@pytest.mark.parametrize('profile', catalog(), ids=lambda p:p['id'])
def test_algorithm_quiz_uses_real_calculations_and_execution_order(profile):
    contract=known_contract(profile['id'])
    guide,_=compile_drafts(contract,ApplicationLabels(location='机房',actor='学生',record='任务',summary='distinct'))
    course=SimpleNamespace(topic=contract.title,scenes=[SimpleNamespace(problem=guide,teaching_steps=guide.teaching_steps)])
    teaching=ClassroomTeaching.model_validate(compiled_teaching(course))
    assert len(teaching.questions)==3
    for question in teaching.questions:
        assert contract.title in question.question
        assert not any(term in question.question for term in ['JSON 类型','字段有哪些','批量处理相同','通过率'])
        assert len(set(question.options))==4
    # First two questions are actual computations, with matching result types
    # and one distinct, executable answer pair, even for boolean algorithms.
    from executable_lessons import _quiz_focus
    for index,question in enumerate(teaching.questions[:2]):
        expected=[_quiz_focus(json.loads(guide.public_test_cases[i].expected))[1] for i in [index,index+1]]
        correct=f'输入一：{json.dumps(expected[0],ensure_ascii=False,sort_keys=True,separators=(",",":"))}；输入二：{json.dumps(expected[1],ensure_ascii=False,sort_keys=True,separators=(",",":"))}'
        assert question.options['ABCD'.index(question.answer)]==correct


def test_non_catalog_topic_keeps_its_actual_computation():
    contract=known_contract('merge')
    guide,_=compile_drafts(contract,ApplicationLabels(location='机房',actor='学生',record='任务',summary='distinct'))
    course=SimpleNamespace(topic='整数列表整理新主题',scenes=[SimpleNamespace(problem=guide,teaching_steps=guide.teaching_steps)])
    result=ClassroomTeaching.model_validate(compiled_teaching(course))
    assert all('手算' in question.question for question in result.questions)

import asyncio
import json
import pytest
from case_review import review_case_answers
from tests.test_agent_workflow import lab_draft_payload
from lab_contracts import LabDraft


class Reviewer:
    def __init__(self, wrong=False, duplicate=False):
        self.wrong, self.duplicate = wrong, duplicate

    async def generate(self, prompt, **kwargs):
        data = json.loads(prompt)
        assert 'reference' not in data and 'reference_solution' not in data
        assert all(set(case) == {'case_id', 'inputs'} for case in data['cases'])
        answers = [{'case_id': c['case_id'], 'expected': sum(c['inputs']['numbers'])}
                   for c in data['cases']]
        if self.wrong:
            answers[0]['expected'] += 1
        if self.duplicate:
            answers[-1]['case_id'] = answers[0]['case_id']
        return json.dumps({'answers': answers})


def test_blind_review_accepts_agreement_and_rejects_disagreement_without_changing_assets():
    draft = LabDraft.model_validate(lab_draft_payload())
    before = draft.model_dump()
    asyncio.run(review_case_answers(Reviewer(), draft))
    for provider in (Reviewer(wrong=True), Reviewer(duplicate=True)):
        with pytest.raises(ValueError):
            asyncio.run(review_case_answers(provider, draft))
    assert before == draft.model_dump()

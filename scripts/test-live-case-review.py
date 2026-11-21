"""Exercise the real blind reviewer against the audited fixtures, no source execution."""
import asyncio
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from case_review import review_case_answers
from lab_contracts import FinalOutput, LabDraft
from ollama_provider import OllamaProvider


async def main():
    reports = []
    for stage in ('stage-PepYtATxqt1H', 'stage-yPwxDpKVAx-t'):
        value = json.loads(Path(f'logs/{stage}-quality-assets.json').read_text(encoding='utf-8'))
        output = FinalOutput.model_validate(value['privateOutput'])
        problem = output.problem
        draft = LabDraft(title=problem.guided_scene.problem.title,
            instructions=problem.guided_scene.problem.instructions,
            scaffold_code=problem.guided_scene.interactive_code, reference_solution=problem.reference_solution,
            difficulty=problem.guided_scene.problem.difficulty, constraints=problem.guided_scene.problem.constraints,
            teaching_steps=problem.guided_scene.teaching_steps,
            public_test_cases=problem.guided_scene.problem.public_test_cases,
            hidden_test_cases=problem.hidden_test_cases)
        class Capture:
            async def generate(self, *args, **kwargs):
                self.raw = await provider.generate(*args, **kwargs)
                return self.raw
        async with OllamaProvider(timeout=240) as provider:
            capture = Capture()
            try:
                await review_case_answers(capture, draft)
                agreed = True
            except ValueError as exc:
                agreed = False
                print(type(exc).__name__ + ': ' + str(exc)[:180], flush=True)
            class Replay:
                async def generate(self, *args, **kwargs):
                    return capture.raw
            broken = draft.model_copy(deep=True)
            broken.public_test_cases[0].expected = 999999
            try:
                await review_case_answers(Replay(), broken)
                caught = False
            except ValueError:
                caught = True
        report = {'stageId': stage, 'realReviewerAgreedWithTrustedAnswers': agreed,
                  'sameReviewRejectsCorruptedLabel': caught}
        reports.append(report)
        print(json.dumps(report), flush=True)
    Path('logs/cross-algorithm-20261017/live-blind-review.json').write_text(
        json.dumps(reports, indent=2), encoding='utf-8')


if __name__ == '__main__':
    asyncio.run(main())

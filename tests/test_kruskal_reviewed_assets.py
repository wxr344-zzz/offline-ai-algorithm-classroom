"""Only the developer-owned repair recipe is executed here, never model code."""
import importlib.util
import json
from pathlib import Path
import pytest

script=Path(__file__).parents[1]/'scripts/kruskal-reviewed-assets.py'
spec=importlib.util.spec_from_file_location('reviewed_kruskal_recipe',script)
recipe=importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)


def test_trusted_recipe_agrees_with_exhaustive_spanning_subsets():
    source=json.loads((Path(__file__).parent/'fixtures/eduplus-generated.json').read_text(encoding='utf-8'))['privateOutput']
    repaired=recipe.repair_kruskal(source)['privateOutput']
    problem=repaired['problem']
    for scene,reference,hidden in [
        (problem['guided_scene'],problem['reference_solution'],problem['hidden_test_cases']),
        (problem['oj_scene'],problem['oj_assessment']['reference_solution'],problem['oj_assessment']['hidden_test_cases'])]:
        scope={}
        # Both implementations originate exclusively from recipe.REFERENCE.
        exec(reference,scope)
        for case in scene['problem']['publicTestCases']+hidden:
            assert scope['Solution']().solve(**case['inputs']) == case['expected']
    assert '已有' in problem['oj_scene']['problem']['instructions']
    assert '应用场景' not in problem['guided_scene']['problem']['instructions']

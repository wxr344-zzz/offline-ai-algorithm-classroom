"""Check trusted audit oracles, independent from generated reference implementations."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('cross_oracles', Path(__file__).resolve().parents[1] / 'scripts/check-cross-algorithm-answers.py')
oracles = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracles)


def test_floyd_oracle_handles_self_distance_and_indirect_paths():
    assert oracles.shortest_paths([[0, 0, 0], [0, 0, 0], [0, 0, 0]], 0) == [0, -1, -1]
    assert oracles.shortest_paths([[0, 1, 2], [1, 0, 0], [2, 0, 0]], 2) == [2, 3, 0]


def test_exhaustive_knapsack_oracle_checks_combining_items():
    assert oracles.backpack([1, 2, 3], [1, 2, 3], 4) == 4
    assert oracles.backpack([10, 20, 30], [60, 100, 120], 50) == 220

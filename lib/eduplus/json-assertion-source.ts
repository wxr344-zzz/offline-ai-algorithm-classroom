/** Public, self-contained assertion helper. It contains no reference solution. */
export const JSON_ASSERTION_HELPER = `import json as _assert_json
def _same_json_value(actual, expected):
    if type(actual) in (int, float) and type(expected) in (int, float): return actual == expected
    if type(actual) is not type(expected): return False
    if isinstance(actual, list): return len(actual) == len(expected) and all(_same_json_value(a, b) for a, b in zip(actual, expected))
    if isinstance(actual, dict): return actual.keys() == expected.keys() and all(_same_json_value(actual[k], expected[k]) for k in actual)
    return actual == expected
def _same_json_output(actual, expected):
    if type(actual) is not str or type(expected) is not str: return False
    try: return _same_json_value(_assert_json.loads(actual), _assert_json.loads(expected))
    except (ValueError, TypeError): return False
`;

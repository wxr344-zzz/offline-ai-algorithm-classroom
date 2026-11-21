import json
import re

from exam_simulator import run_trace
from exam_simulator.core import REGISTRY
from exam_simulator.i18n import localize_catalog, localize_text, localize_trace

HAN = re.compile(r'[㐀-䶿一-鿿]')


def test_dynamic_snapshot_headers_are_english_and_values_unchanged():
    from exam_simulator.generated import views_from_snapshot
    state = {'data': {'n': 5}}
    views = views_from_snapshot(state, {})
    trace = {'title': 'Test', 'input': state, 'outcome': 5, 'frames': [
        {'label': 'Step', 'explanation': 'Run', 'views': views + [
            {'kind': 'table', 'name': '调用栈', 'columns': ['函数', '源码行'], 'rows': [['solve', 2]], 'active': [0]}]}]}
    english = localize_trace(trace, 'en-US')
    assert english['frames'][0]['views'][0]['name'] == 'Local variables.data'
    assert english['frames'][0]['views'][0]['columns'] == ['Variable', 'Actual value']
    assert english['frames'][0]['views'][1]['columns'] == ['Function', 'Source line']
    assert english['frames'][0]['views'][0]['rows'] == [['n', 5]]
    assert english['frames'][0]['views'][1]['rows'] == [['solve', 2]]
    assert english['input'] == state and english['outcome'] == 5


def test_every_maintained_trace_reads_in_english_without_changing_data():
    for key in REGISTRY:
        trace = run_trace(key)
        english = localize_trace(trace, 'en-US')
        text = json.dumps({k: v for k, v in english.items() if k != 'input'}, ensure_ascii=False)
        assert not HAN.search(text), key
        assert english['input'] == trace['input'] and english['algorithm'] == trace['algorithm']
        assert len(english['frames']) == len(trace['frames'])
        for a, b in zip(trace['frames'], english['frames']):
            assert [v['kind'] for v in a['views']] == [v['kind'] for v in b['views']]
            for va, vb in zip(a['views'], b['views']):
                if va['kind'] == 'sequence':
                    assert va['values'] == vb['values'] and va['active'] == vb['active']
                    assert list(va['pointers'].values()) == list(vb['pointers'].values())


def test_chinese_courses_keep_the_original_text():
    trace = run_trace('bubble')
    assert localize_trace(trace, 'zh-CN') is trace
    assert localize_trace(trace, '') is trace


def test_values_are_carried_verbatim_into_the_template():
    assert localize_text('比较 a[1]=3 与 a[0]=7，min=1。', 'en') == 'Compare a[1]=3 with a[0]=7, min=1.'
    assert localize_text('7 > 3：True。', 'en') == '7 > 3: True.'
    # Unknown wording stays as computed rather than being guessed.
    assert localize_text('未登记的说明', 'en') == '未登记的说明'


def test_catalog_titles_follow_the_language():
    profiles = [{'id': 'bubble', 'title': '冒泡排序', 'aliases': [], 'section': 'x', 'default': {}}]
    assert localize_catalog(profiles, 'en')[0]['title'] == 'Bubble sort'

"""Presentation-language layer for deterministic traces.

Executors record their teaching text in Chinese. A trace is computed and
verified first; only then are its human-readable strings (titles, step
labels, explanations, view names, pointer and column labels) rendered in the
learner's language. Values, indices, inputs and outcomes are never changed:
every non-Chinese run of a string (numbers, identifiers, arrays, operators)
is carried over verbatim into the translated template.
"""
import json
import re
from functools import lru_cache
from pathlib import Path

HAN = re.compile(r'([㐀-䶿一-鿿]+)')
_PUNCT = {'，': ', ', '。': '. ', '；': '; ', '：': ': ', '、': ', ', '（': ' (', '）': ') ',
          '／': '/', '？': '? ', '！': '! ', '“': '"', '”': '"', '‘': "'", '’': "'", '【': '[', '】': ']',
          '《': '"', '》': '"', '…': '...', '＼': '\\'}
_PUNCT_RE = re.compile('|'.join(map(re.escape, _PUNCT)))


def is_chinese_language(lang):
    return not lang or str(lang).lower().startswith('zh')


@lru_cache(maxsize=1)
def _table():
    path = Path(__file__).with_name('locale_en.json')
    return json.loads(path.read_text(encoding='utf-8'))


def skeleton(text):
    parts = HAN.split(text)
    return ''.join(p if i % 2 else ('{}' if p else '') for i, p in enumerate(parts))


def _slots(text):
    return [p for i, p in enumerate(HAN.split(text)) if i % 2 == 0 and p]


def _fill(template, slots):
    pieces = re.split(r'(\{\})', template)
    out = ''
    k = 0
    for piece in pieces:
        if piece == '{}':
            value = _PUNCT_RE.sub(lambda m: _PUNCT[m.group(0)], slots[k])
            k += 1
            if out and re.search(r'[A-Za-z0-9)\]]$', out) and re.match(r'[A-Za-z0-9(\[∞α-ωΑ-Ω]', value):
                out += ' '
            out += value
        elif piece:
            # Sentence case for the template's own words only, never for values
            # such as "h", "a[0]" or a function name carried from the trace.
            if not out.strip() or re.search(r'[.!?]\s*$', out):
                piece = re.sub(r'^(\s*)([a-z])(?=[a-z]{2})', lambda m: m.group(1) + m.group(2).upper(), piece)
            if out and re.search(r'[A-Za-z0-9)\]=]$', out) and re.match(r'[A-Za-z]', piece):
                out += ' '
            elif out and re.search(r'[.;:,]$', out) and re.match(r'[A-Za-z]', piece):
                out += ' '
            out += piece
    out = re.sub(r'[ \t]{2,}', ' ', out)
    out = re.sub(r' +([,.;:)\]])', r'\1', out)
    out = re.sub(r'([(\[]) +', r'\1', out)
    return out.strip()


def localize_text(text, lang):
    if is_chinese_language(lang) or type(text) is not str:
        return text
    if not HAN.search(text):
        # Full-width punctuation around values ("7 > 3：True。") reads as Chinese too.
        return _fill('{}', [text]) if _PUNCT_RE.search(text) else text
    template = _table().get(skeleton(text))
    if template is None:
        return text
    slots = _slots(text)
    if template.count('{}') != len(slots):
        return text
    return _fill(template, slots)


def _localize_value(value, lang):
    if type(value) is str:
        return localize_text(value, lang)
    if type(value) is list:
        return [_localize_value(item, lang) for item in value]
    if type(value) is dict:
        return {localize_text(k, lang) if type(k) is str else k: (v if k == 'kind' else _localize_value(v, lang))
                for k, v in value.items()}
    return value


def localize_trace(trace, lang):
    """A copy of a verified trace with its teaching text in ``lang``."""
    if is_chinese_language(lang) or type(trace) is not dict:
        return trace
    result = dict(trace)
    if type(result.get('title')) is str:
        result['title'] = localize_text(result['title'], lang)
    frames = []
    for frame in result.get('frames') or []:
        if type(frame) is not dict:
            frames.append(frame)
            continue
        copy = dict(frame)
        for key in ('label', 'explanation'):
            if type(copy.get(key)) is str:
                copy[key] = localize_text(copy[key], lang)
        if 'views' in copy:
            copy['views'] = _localize_value(copy['views'], lang)
        if 'state' in copy:
            copy['state'] = _localize_value(copy['state'], lang)
        frames.append(copy)
    if 'frames' in result:
        result['frames'] = frames
    # Outcome labels only (e.g. thread kinds); the outcome values themselves are data.
    if type(result.get('outcome')) is dict:
        result['outcome'] = _localize_value(result['outcome'], lang)
    return result


SECTIONS_EN = {
    '串': 'Strings', '图': 'Graphs', '堆': 'Heaps', '外排序': 'External sorting', '排序': 'Sorting',
    '散列': 'Hashing', '数组矩阵': 'Arrays and matrices', '查找': 'Searching', '栈和队列': 'Stacks and queues',
    '栈应用': 'Stack applications', '树': 'Trees', '树和森林': 'Trees and forests', '线性表': 'Linear lists',
    '自命题高级查找树': 'Advanced search trees', '集合': 'Sets', '博弈搜索': 'Game search', '搜索': 'Search',
    '双指针': 'Two pointers', '递推': 'Recurrences', '最短路': 'Shortest paths', '动态规划': 'Dynamic programming',
    '区间DP': 'Interval DP', '多路查找树': 'Multiway search trees',
    '常见扩展': 'Common extensions', '浙江': 'Zhejiang', '自命题': 'Custom',
}


def localize_section(section, lang):
    if is_chinese_language(lang) or type(section) is not str:
        return section
    return '/'.join(SECTIONS_EN.get(part, part) for part in re.split('[／/]', section))


def localize_catalog(profiles, lang):
    if is_chinese_language(lang):
        return profiles
    return [{**p, 'title': localize_text(p.get('title'), lang), 'section': localize_section(p.get('section'), lang)}
            if type(p) is dict else p for p in profiles]

/* Isolated execution only. The parent applies strict assertions; worker verdicts are ignored. */
let ready;
let running = false;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    ready ??= (async () => {
      importScripts(`${data.assetBase}pyodide.js`);
      return self.loadPyodide({ indexURL: data.assetBase, fullStdLib: false });
    })();
    try {
      await ready;
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: `Python 初始化失败：${String(error.message ?? error).slice(0, 1000)}`,
      });
    }
    return;
  }
  if (data.type !== 'run' || running || !ready) return;
  running = true;
  try {
    const pyodide = await ready;
    self.postMessage({ type: 'running' });
    pyodide.globals.set('__practice_payload', JSON.stringify(data.payload));
    const raw = pyodide.runPython(`
import json as _json, io as _io, contextlib as _contextlib, traceback as _traceback, math as _math, sys as _sys
_payload = _json.loads(__practice_payload)
class _BoundedOutput(_io.TextIOBase):
    def __init__(self, limit):
        self.parts = []; self.count = 0; self.limit = limit; self.truncated = False
    def write(self, text):
        text = str(text)
        remaining = max(0, self.limit - self.count)
        if remaining: self.parts.append(text[:remaining])
        self.count += min(len(text), remaining)
        if len(text) > remaining: self.truncated = True
        return len(text)
    def flush(self): pass
    def value(self):
        return ''.join(self.parts) + ('\\n[输出已截断]' if self.truncated else '')
def _typed(value, kind):
    if kind == 'int': return type(value) is int
    if kind == 'str': return type(value) is str
    if kind == 'bool': return type(value) is bool
    if kind.startswith('list['):
        return type(value) is list and all(_typed(v, kind[5:-1]) for v in value)
    return False
_buffer = _BoundedOutput(_payload['limit'])
_results = []
_namespace = {'__name__': '__student__'}
if _payload.get('mode') == 'stdio':
    for _case in _payload['cases']:
        _capture = _BoundedOutput(_payload['limit'])
        _old_stdin = _sys.stdin
        try:
            _sys.stdin = _io.StringIO(_case['inputs']['stdin'])
            with _contextlib.redirect_stdout(_capture), _contextlib.redirect_stderr(_buffer):
                try:
                    exec(compile(_payload['code'], 'solution.py', 'exec'), {'__name__': '__main__'})
                except SystemExit as _exit:
                    if _exit.code not in (None, 0): raise
            if _capture.truncated: raise ValueError('标准输出超出显示上限')
            _actual = _capture.value()
            _results.append({'caseId': _case['caseId'], 'passed': False, 'actual': _actual})
        except BaseException as _exc:
            _results.append({'caseId': _case['caseId'], 'passed': False, 'error': ''.join(_traceback.format_exception_only(type(_exc), _exc))[:2000]})
        finally:
            _sys.stdin = _old_stdin
else:
 with _contextlib.redirect_stdout(_buffer), _contextlib.redirect_stderr(_buffer):
    try:
        exec(compile(_payload['code'], 'solution.py', 'exec'), _namespace)
        _class = _namespace[_payload['entry']['className']]
    except BaseException as _exc:
        _message = ''.join(_traceback.format_exception_only(type(_exc), _exc))[:2000]
        _results = [{'caseId': case['caseId'], 'passed': False, 'error': _message} for case in _payload['cases']]
    else:
        for _case in _payload['cases']:
            try:
                _method = getattr(_class(), _payload['entry']['methodName'])
                _inputs = _json.loads(_json.dumps(_case['inputs']))
                _actual = _method(**_inputs)
                _encoded = _json.dumps(_actual, ensure_ascii=False, allow_nan=False)
                if len(_encoded) > _payload['limit']:
                    raise ValueError('返回值超出显示上限')
                _results.append({'caseId': _case['caseId'], 'passed': False, 'actual': _actual})
            except BaseException as _exc:
                _results.append({'caseId': _case['caseId'], 'passed': False, 'error': ''.join(_traceback.format_exception_only(type(_exc), _exc))[:2000]})
_json.dumps({'cases': _results, 'output': _buffer.value()}, ensure_ascii=False, allow_nan=False)
`);
    self.postMessage({ type: 'result', result: JSON.parse(raw) });
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error.message ?? error).slice(0, 2000) });
  }
};

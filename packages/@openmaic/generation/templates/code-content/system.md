# Code Playground Widget Generator

Generate a self-contained HTML code editor with execution and test validation.

## Supported Languages

- Python (via Pyodide CDN)
- JavaScript (native browser execution)
- TypeScript (via Babel CDN transpilation)

## Widget Config Schema

```json
{
  "type": "code",
  "language": "python",
  "description": "...",
  "starterCode": "def solution(x):\n    # Your code here\n    pass",
  "testCases": [
    { "id": "t1", "input": "5", "expected": "25", "description": "Square the input" }
  ],
  "hints": ["Think about multiplication", "What is x * x?"],
  "solution": "def solution(x):\n    return x * x"
}
```

## Python Execution Requirements (CRITICAL)

When generating Python widgets using Pyodide, follow these **mandatory patterns**:

### 1. Proper Stdout Capture Setup

**ALWAYS use this exact pattern for stdout capture:**
```javascript
// CORRECT - imports both sys AND io
await pyodide.runPythonAsync(`
    import sys
    import io
    sys.stdout = io.StringIO()
`);
```

**NEVER do this (causes NameError):**
```javascript
// WRONG - missing import io
pyodide.runPython('import sys; sys.stdout = io.StringIO()');
```

### 2. Use Async Execution

- Always use `pyodide.runPythonAsync()` instead of `pyodide.runPython()`
- Async execution is more reliable and handles module loading correctly
- All Pyodide operations should be wrapped in async functions

### 3. Load Required Packages Before Execution

If user code needs packages like numpy, load them during initialization:
```javascript
await pyodide.loadPackage(['numpy']);
```

`micropip` is included with Pyodide but is not loaded by default. If generated
code installs PyPI packages with `micropip`, load it before importing it:

```javascript
await pyodide.loadPackage('micropip');
await pyodide.runPythonAsync(`
    import micropip
    await micropip.install('package-name')
`);
```

Never run `import micropip` before `loadPackage('micropip')` resolves, because
that aborts widget initialization with `ModuleNotFoundError`.

### 4. Wait for Pyodide Initialization

- Disable the run button until Pyodide is fully loaded
- Show loading status to users
- Check `pyodide !== null` before running code

### 5. Retrieve Output Correctly

```javascript
const output = pyodide.runPython('sys.stdout.getvalue()');
```

## Complete Python Widget Runtime Pattern

The markup MUST contain `id="run-btn"` (initially disabled), `id="status"`,
and `id="output"`. These IDs must match the script exactly. Initialize the editor
only after its container exists and its CDN library has loaded. Worker code must
never access `document`; report results to the iframe through messages instead.

```javascript
let pyodide = null;
let initPromise = null;
let disposed = false;
let running = false;

function requiredElement(id) {
    const element = document.getElementById(id);
    if (!element || !element.isConnected) {
        throw new Error('Missing playground element #' + id);
    }
    return element;
}

function reportRuntimeError(error) {
    if (disposed) return;
    console.error('Python playground failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    const status = document.getElementById('status');
    if (status && status.isConnected) status.textContent = 'Python failed: ' + message;
    const button = document.getElementById('run-btn');
    if (button && button.isConnected) button.disabled = true;
    let fallback = document.getElementById('python-runtime-error');
    if (!fallback) {
        fallback = document.createElement('div');
        fallback.id = 'python-runtime-error';
        fallback.setAttribute('role', 'alert');
        (document.body || document.documentElement).appendChild(fallback);
    }
    fallback.textContent = 'Python playground error: ' + message;
}

function domReady() {
    if (document.readyState !== 'loading') return Promise.resolve();
    return new Promise((resolve) => {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
}

function initPyodide() {
    if (disposed) return Promise.resolve(null);
    if (pyodide) return Promise.resolve(pyodide);
    if (initPromise) return initPromise;
    initPromise = (async () => {
        await domReady();
        if (disposed) return null;
        requiredElement('run-btn').disabled = true;
        requiredElement('status').textContent = 'Loading Python...';
        requiredElement('output');
        if (typeof window.loadPyodide !== 'function') {
            throw new Error('Pyodide loader did not load; check the CDN request');
        }
        const runtime = await window.loadPyodide();
        if (disposed) return null;
        // Load only packages the exercise requires, before enabling execution.
        await runtime.loadPackage(['numpy']);
        if (disposed) return null;
        // Re-resolve live nodes after asynchronous loading.
        const runButton = requiredElement('run-btn');
        const status = requiredElement('status');
        requiredElement('output');
        pyodide = runtime;
        runButton.disabled = false;
        status.textContent = 'Python ready';
        document.getElementById('python-runtime-error')?.remove();
        return runtime;
    })().catch((error) => {
        reportRuntimeError(error);
        return null;
    }).finally(() => {
        initPromise = null;
    });
    return initPromise;
}

async function runCode() {
    if (disposed || running) return;
    const runtime = await initPyodide();
    if (!runtime || disposed || running) return;
    running = true;
    try {
        requiredElement('run-btn').disabled = true;
        const code = editor.getValue();
        // MUST import sys AND io before using StringIO
        await runtime.runPythonAsync(`
            import sys
            import io
            sys.stdout = io.StringIO()
        `);
        await runtime.runPythonAsync(code);
        if (disposed) return;
        requiredElement('output').textContent = String(runtime.runPython('sys.stdout.getvalue()'));
    } catch (e) {
        if (!disposed) {
            const output = document.getElementById('output');
            if (output && output.isConnected) output.textContent = 'Error: ' + String(e);
            else reportRuntimeError(e);
        }
    } finally {
        running = false;
        const button = document.getElementById('run-btn');
        if (!disposed && button && button.isConnected && pyodide) button.disabled = false;
    }
}

window.addEventListener('pagehide', () => {
    disposed = true;
    pyodide = null;
    if (typeof editor !== 'undefined' && typeof editor.dispose === 'function') editor.dispose();
    // Terminate any worker created by this page here as well.
}, { once: true });

// initPyodide handles its rejection internally; do not launch bare async work.
void initPyodide();
```

Do not emit bare `document.getElementById(...).textContent = ...` assignments.
Check DOM readiness, required IDs, and page lifetime after asynchronous loading.
Handle worker `error` and `messageerror` events if the widget uses a worker.

## Technical Requirements

- Use CodeMirror or Monaco via CDN for editing
- Syntax highlighting for the language
- Run button with output display
- Test case validation with pass/fail indicators
- Hint button that reveals hints progressively
- Mobile-responsive layout

## Layout Guidelines

- Code editor should be visible and not overlap with output panel
- On mobile, stack editor above output (not side-by-side)
- Ensure editor has minimum height of 200px on mobile
- Test cases should be collapsible on small screens

## CRITICAL: postMessage Listener for Widget Actions (REQUIRED)

The platform drives this widget by posting messages into the iframe
(`SET_WIDGET_STATE`, `HIGHLIGHT_ELEMENT`, `ANNOTATE_ELEMENT`, `REVEAL_ELEMENT`).
Your HTML MUST register this listener, or those actions silently do nothing.
For a code playground, `SET_WIDGET_STATE` typically loads code into the editor and
optionally runs it:

```javascript
window.addEventListener('message', function(event) {
  const { type, target, state, content } = event.data;

  switch (type) {
    case 'SET_WIDGET_STATE':
      // e.g. { code: "...", run: true } — set editor contents, optionally run.
      if (state && typeof state.code === 'string') {
        // Guard the identifier itself: `editor?.setValue` still throws
        // ReferenceError when no `editor` variable is declared (e.g. a
        // textarea-only widget). `typeof editor` is safe for that case.
        if (typeof editor !== 'undefined' && typeof editor.setValue === 'function') editor.setValue(state.code);
        else { const ta = document.getElementById('code-input'); if (ta) ta.value = state.code; }
      }
      if (state && state.run && typeof runCode === 'function') runCode();
      break;

    case 'HIGHLIGHT_ELEMENT':
      const highlightEl = document.querySelector(target);
      if (highlightEl) {
        highlightEl.style.outline = '3px solid rgba(139, 92, 246, 0.8)';
        highlightEl.style.outlineOffset = '4px';
        highlightEl.style.animation = 'pulse-highlight 2s infinite';
        setTimeout(() => {
          highlightEl.style.outline = '';
          highlightEl.style.animation = '';
        }, 3000);
      }
      break;

    case 'ANNOTATE_ELEMENT':
      const annotateEl = document.querySelector(target);
      if (annotateEl && content) {
        const rect = annotateEl.getBoundingClientRect();
        const tooltip = document.createElement('div');
        tooltip.className = 'teacher-annotation';
        tooltip.style.cssText = 'position:fixed; top:' + (rect.top - 40) + 'px; left:' + rect.left + 'px; background:rgba(139,92,246,0.95); color:white; padding:8px 12px; border-radius:8px; font-size:14px; z-index:1000; animation:fadeIn 0.3s;';
        tooltip.textContent = content;
        document.body.appendChild(tooltip);
        setTimeout(() => tooltip.remove(), 4000);
      }
      break;

    case 'REVEAL_ELEMENT':
      // Reveal a hidden element (e.g. the solution or a hint panel)
      const revealEl = document.querySelector(target);
      if (revealEl) {
        revealEl.style.display = '';
        revealEl.style.opacity = '1';
      }
      break;
  }
});

const style = document.createElement('style');
style.textContent = '@keyframes pulse-highlight { 0%, 100% { outline-color: rgba(139, 92, 246, 0.8); } 50% { outline-color: rgba(139, 92, 246, 0.4); } } @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }';
document.head.appendChild(style);
```

### Element Naming Convention

So highlight/annotate/reveal can target UI, use consistent ids:
- Run button: `id="run-btn"`, output panel: `id="output"`, editor host: `id="code-input"`.
- Solution/hint panels: `id="solution"`, `id="hint-{n}"`.

## Output Format

Return ONLY the HTML document, no markdown fences or explanations.

**CRITICAL: Output EXACTLY ONE HTML document.**
- Do NOT duplicate content
- Do NOT include multiple `<!DOCTYPE html>` tags
- The output must end with exactly one `</html>` tag

## Quality Checklist

- [ ] Code editor is visible and usable on mobile
- [ ] Run button works correctly
- [ ] Output panel doesn't overlap editor
- [ ] Test cases show pass/fail clearly
- [ ] Hints reveal progressively
- [ ] **NO DUPLICATED HTML** - exactly ONE `<!DOCTYPE html>` tag
- [ ] **Python stdout uses correct import pattern** - imports BOTH `sys` AND `io`
- [ ] **Pyodide uses async execution** - `runPythonAsync()` not `runPython()`


{{snippet:interactive-observation}}

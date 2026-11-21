'use strict';
/**
 * Runtime smoke test for a generated interactive widget, run in a worker thread.
 *
 * workerData.tree is the parse5 document converted to plain JSON by
 * widget-smoke-test.ts. The page is rebuilt node by node and every classic
 * inline script runs at its own position (so a script in <head> does not see
 * the body, as in a browser). Then load events fire and every control is
 * operated once or twice. Only errors that are bugs in any browser are
 * reported: SyntaxError, ReferenceError (an undefined name or TDZ access),
 * and reads/writes on null (a missing element). Gaps in this small DOM yield
 * permissive stubs or `undefined`, never `null`, so they cannot produce a
 * reported error.
 */
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');

const STEP_TIMEOUT_MS = 400;
const DEADLINE = Date.now() + 6000;
const MAX_ERRORS = 8;
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
const JS_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/jscript',
  'text/x-javascript',
]);
const LIBRARY_GLOBALS = [
  'katex',
  'renderMathInElement',
  'MathJax',
  'Chart',
  'd3',
  'THREE',
  'p5',
  'Matter',
  'gsap',
  'anime',
  'Plotly',
  'echarts',
  'Konva',
  'fabric',
  'PIXI',
  'Phaser',
  'createjs',
  'Two',
  'math',
  'tf',
  'Tone',
  'Howl',
  'Howler',
  'confetti',
  'Prism',
  'hljs',
  'mermaid',
  'JXG',
  'Desmos',
  'paper',
  'ml5',
  'Vue',
  'React',
  'ReactDOM',
  '$',
  'jQuery',
  '_',
  'TWEEN',
  'OrbitControls',
];
const BROWSER_PREFIX =
  /^(HTML|SVG|CSS|DOM|Web|IDB|RTC|Media|Audio|Speech|XR|GPU|Intl|WebGL|Offscreen)/;
const BROWSER_NAMES = new Set([
  'webkitAudioContext',
  'webkitRequestAnimationFrame',
  'mozRequestAnimationFrame',
  'chrome',
  'opener',
  'external',
  'speechSynthesis',
  'indexedDB',
  'crypto',
  'caches',
  'visualViewport',
  'customElements',
  'getSelection',
  'print',
  'open',
  'close',
  'stop',
  'focus',
  'blur',
  'origin',
  'isSecureContext',
  'reportError',
  'createImageBitmap',
  'atob',
  'btoa',
  'Worker',
  'WebSocket',
  'EventSource',
  'Notification',
  'BroadcastChannel',
  'MessageChannel',
  'FormData',
  'Headers',
  'Request',
  'Response',
  'AbortController',
  'File',
  'ImageData',
  'ImageBitmap',
  'Range',
  'Selection',
  'NodeFilter',
  'TreeWalker',
  'DocumentFragment',
  'Text',
  'Comment',
  'Option',
  'FontFace',
  'Touch',
  'DragEvent',
  'WheelEvent',
  'FocusEvent',
  'AnimationEvent',
  'TransitionEvent',
  'ClipboardEvent',
  'ErrorEvent',
  'MessageEvent',
  'ProgressEvent',
]);

const PAINT_OPS = new Set([
  'stroke',
  'fill',
  'fillRect',
  'strokeRect',
  'fillText',
  'strokeText',
  'drawImage',
  'putImageData',
  'drawArrays',
  'drawElements',
]);
const errors = [];
const seen = new Set();
/** All inline script source, for telling page-defined fields from browser APIs. */
let pageSource = '';
let timedOut = false;
let hasExternalScripts = false;

function classify(error) {
  if (!error || typeof error !== 'object') return null;
  const name = String(error.name || '');
  const message = String(error.message || '');
  if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
    timedOut = true;
    return null;
  }
  if (name === 'SyntaxError') return `SyntaxError: ${message}`;
  if (name === 'ReferenceError') {
    const missing = /^(\S+) is not defined$/.exec(message);
    if (missing) {
      const id = missing[1];
      if (BROWSER_PREFIX.test(id) || BROWSER_NAMES.has(id)) return null;
      if (hasExternalScripts && /^[A-Z$_]/.test(id)) return null;
    }
    return `ReferenceError: ${message}`;
  }
  if (
    name === 'TypeError' &&
    /(properties|property '[^']*') of null|Cannot set properties of null|null is not an object/.test(
      message,
    )
  )
    return `TypeError: ${message}`;
  if (name === 'TypeError' && /^Assignment to constant variable/.test(message))
    return `TypeError: ${message}`;
  // Reading a field of an undefined object counts only when the field is one
  // the page itself defines (e.g. state.running before state exists). Fields
  // of browser APIs this environment does not model are not the page's fault.
  const undef =
    /Cannot (?:read|set) properties of undefined \((?:reading|setting) '([^']+)'\)/.exec(message);
  if (name === 'TypeError' && undef) {
    const field = undef[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:[{,]\\s*['"]?${field}['"]?\\s*:|\\.${field}\\s*=[^=])`).test(pageSource))
      return `TypeError: ${message}`;
  }
  return null;
}

function record(error, where) {
  const text = classify(error);
  // An unsupported DOM API can abort a whole script before a later real bug.
  // Silence is not evidence that the remaining statements/handlers ran.
  if (!text) {
    if (error) timedOut = true;
    return;
  }
  const line = `${text}（${where}）`;
  if (seen.has(text) || errors.length >= MAX_ERRORS) return;
  seen.add(text);
  errors.push(line);
}

const outOfTime = () => timedOut || Date.now() > DEADLINE;

// ── Permissive stub: any member, call or construction yields another stub ──
function stub() {
  const target = function () {};
  return new Proxy(target, {
    get(t, key) {
      if (key === 'prototype') return Reflect.get(t, key);
      if (key === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');
      if (key === Symbol.iterator) return function* () {};
      if (typeof key === 'symbol' || key === 'then') return undefined;
      if (key === 'length') return 0;
      if (key === 'toString' || key === 'valueOf' || key === 'toJSON') return () => '';
      return stub();
    },
    set: () => true,
    has: () => true,
    apply: () => stub(),
    construct: () => stub(),
  });
}

// ── Style declaration ──
function makeStyle() {
  const values = Object.create(null);
  const api = {
    setProperty(name, value) {
      values[name] = String(value);
    },
    removeProperty(name) {
      delete values[name];
      return '';
    },
    getPropertyValue(name) {
      return values[name] || '';
    },
    get cssText() {
      return Object.keys(values)
        .map((k) => `${k}: ${values[k]}`)
        .join('; ');
    },
    set cssText(v) {
      for (const k of Object.keys(values)) delete values[k];
      String(v)
        .split(';')
        .forEach((decl) => {
          const i = decl.indexOf(':');
          if (i > 0) values[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
        });
    },
  };
  return new Proxy(api, {
    get(t, key) {
      if (key in t) return Reflect.get(t, key);
      if (typeof key === 'symbol') return undefined;
      return values[key] === undefined ? '' : values[key];
    },
    set(t, key, value) {
      if (key === 'cssText') t.cssText = value;
      else values[key] = String(value);
      return true;
    },
  });
}

// ── Tiny HTML fragment parser for innerHTML / insertAdjacentHTML ──
function decode(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function parseFragment(html) {
  const root = { tag: '#fragment', attrs: [], children: [] };
  const stack = [root];
  const token =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</gi;
  let match;
  const source = String(html);
  while ((match = token.exec(source))) {
    const top = stack[stack.length - 1];
    if (match[1]) {
      const tag = match[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i -= 1)
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      continue;
    }
    if (match[2]) {
      const tag = match[2].toLowerCase();
      const attrs = [];
      const attr = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = attr.exec(match[3] || '')))
        attrs.push([a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? '')]);
      const node = { tag, attrs, children: [] };
      top.children.push(node);
      if (RAW_TEXT.has(tag)) {
        const end = source.toLowerCase().indexOf(`</${tag}`, token.lastIndex);
        const stop = end === -1 ? source.length : end;
        node.children.push({ text: source.slice(token.lastIndex, stop) });
        const close = source.indexOf('>', stop);
        token.lastIndex = close === -1 ? source.length : close + 1;
        continue;
      }
      if (!VOID.has(tag) && !match[4]) stack.push(node);
      continue;
    }
    if (match[0].startsWith('<!')) continue;
    top.children.push({ text: decode(match[0]) });
  }
  return root.children;
}

// ── Selector engine (subset). Unsupported syntax throws UNSUPPORTED. ──
const UNSUPPORTED = Symbol('unsupported');

function parseCompound(text) {
  const parts = { tag: null, id: null, classes: [], attrs: [], pseudos: [] };
  const re =
    /^(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]|:(not)\(([^()]*)\)|:([\w-]+)/y;
  let index = 0;
  while (index < text.length) {
    re.lastIndex = index;
    const m = re.exec(text);
    if (!m || m.index !== index || m[0] === '') throw UNSUPPORTED;
    if (m[1]) parts.tag = m[1] === '*' ? null : m[1].toLowerCase();
    else if (m[2]) parts.id = m[2];
    else if (m[3]) parts.classes.push(m[3]);
    else if (m[4]) parts.attrs.push([m[4].toLowerCase(), m[5], m[6] ?? m[7] ?? m[8]]);
    else if (m[9]) parts.pseudos.push(['not', parseCompound(m[10].trim())]);
    else if (m[11]) {
      if (
        !['checked', 'disabled', 'enabled', 'first-child', 'last-child', 'selected'].includes(m[11])
      )
        throw UNSUPPORTED;
      parts.pseudos.push([m[11]]);
    }
    index = re.lastIndex;
    if (index === 0) break;
    re.lastIndex = 0;
    // Subsequent tokens must not be a tag name.
    text = text.slice(index);
    index = 0;
  }
  return parts;
}

function parseSelector(selector) {
  if (typeof selector !== 'string') throw UNSUPPORTED;
  return selector.split(',').map((group) => {
    const tokens = group
      .trim()
      .replace(/\s*([>+~])\s*/g, ' $1 ')
      .split(/\s+/)
      .filter(Boolean);
    if (!tokens.length) throw UNSUPPORTED;
    const chain = [];
    let combinator = ' ';
    for (const token of tokens) {
      if (token === '>' || token === '+' || token === '~') {
        combinator = token;
        continue;
      }
      chain.push({ combinator, compound: parseCompound(token) });
      combinator = ' ';
    }
    return chain;
  });
}

function matchesCompound(el, c) {
  if (!el || el.nodeType !== 1) return false;
  if (c.tag && el.localName !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  const classes = (el.getAttribute('class') || '').split(/\s+/);
  for (const cls of c.classes) if (!classes.includes(cls)) return false;
  for (const [name, op, value] of c.attrs) {
    const actual = el.getAttribute(name);
    if (actual === null) return false;
    if (!op) continue;
    if (op === '=' && actual !== value) return false;
    if (op === '~=' && !actual.split(/\s+/).includes(value)) return false;
    if (op === '^=' && !actual.startsWith(value)) return false;
    if (op === '$=' && !actual.endsWith(value)) return false;
    if (op === '*=' && !actual.includes(value)) return false;
    if (op === '|=' && actual !== value && !actual.startsWith(`${value}-`)) return false;
  }
  for (const [kind, inner] of c.pseudos) {
    if (kind === 'not' && matchesCompound(el, inner)) return false;
    if (kind === 'checked' && !(el.checked || el._selected)) return false;
    if (kind === 'selected' && !el._selected) return false;
    if (kind === 'disabled' && !el.hasAttribute('disabled')) return false;
    if (kind === 'enabled' && el.hasAttribute('disabled')) return false;
    if (kind === 'first-child' && el.previousElementSibling) return false;
    if (kind === 'last-child' && el.nextElementSibling) return false;
  }
  return true;
}

function matchesChain(el, chain, index) {
  if (!matchesCompound(el, chain[index].compound)) return false;
  if (index === 0) return true;
  const combinator = chain[index].combinator;
  if (combinator === '>') return matchesChain(el.parentElement, chain, index - 1);
  if (combinator === '+') return matchesChain(el.previousElementSibling, chain, index - 1);
  if (combinator === '~') {
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling)
      if (matchesChain(s, chain, index - 1)) return true;
    return false;
  }
  for (let p = el.parentElement; p; p = p.parentElement)
    if (matchesChain(p, chain, index - 1)) return true;
  return false;
}

function matchesSelector(el, groups) {
  return groups.some((chain) => matchesChain(el, chain, chain.length - 1));
}

// ── Nodes ──
class TextNode {
  constructor(data, doc) {
    this.nodeType = 3;
    this.nodeName = '#text';
    this.data = String(data);
    this.parentNode = null;
    this.ownerDocument = doc;
  }
  get textContent() {
    return this.data;
  }
  set textContent(v) {
    this.data = String(v);
  }
  get nodeValue() {
    return this.data;
  }
  set nodeValue(v) {
    this.data = String(v);
  }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  cloneNode() {
    return new TextNode(this.data, this.ownerDocument);
  }
  addEventListener() {}
  removeEventListener() {}
}

function asArray(list) {
  const array = Array.from(list);
  array.item = (i) => array[i] ?? null;
  return array;
}

const elementHandler = {
  get(target, key, receiver) {
    if (key in target) return Reflect.get(target, key, receiver);
    if (typeof key === 'symbol') return undefined;
    if (/^on[a-z]+$/.test(key)) return null;
    return stub();
  },
};

class Node {
  constructor(doc) {
    this.childNodes = [];
    this.parentNode = null;
    this.ownerDocument = doc;
    this._listeners = new Map();
  }
  get children() {
    return asArray(this.childNodes.filter((n) => n.nodeType === 1));
  }
  get childElementCount() {
    return this.children.length;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  get lastElementChild() {
    const c = this.children;
    return c[c.length - 1] ?? null;
  }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  _sibling(offset, elementsOnly) {
    if (!this.parentNode) return null;
    const list = elementsOnly ? this.parentNode.children : this.parentNode.childNodes;
    const index = list.indexOf(this._self || this);
    return list[index + offset] ?? null;
  }
  get nextSibling() {
    return this._sibling(1, false);
  }
  get previousSibling() {
    return this._sibling(-1, false);
  }
  get nextElementSibling() {
    return this._sibling(1, true);
  }
  get previousElementSibling() {
    return this._sibling(-1, true);
  }
  get isConnected() {
    let n = this._self || this;
    while (n.parentNode) n = n.parentNode;
    return n.nodeType === 9;
  }
  _adopt(node) {
    if (node === null || node === undefined || typeof node !== 'object') {
      throw new (vmGlobal('TypeError'))(
        "Failed to execute 'appendChild': parameter 1 is not of type 'Node'.",
      );
    }
    if (node.nodeType === 11) return node.childNodes.slice();
    if (node.parentNode) node.parentNode.removeChild(node);
    return [node];
  }
  appendChild(node) {
    for (const n of this._adopt(node)) {
      if (node.nodeType === 11) node.childNodes.splice(node.childNodes.indexOf(n), 1);
      n.parentNode = this._self || this;
      this.childNodes.push(n);
    }
    return node;
  }
  append(...nodes) {
    for (const n of nodes)
      this.appendChild(
        typeof n === 'object' && n ? n : new TextNode(String(n), this.ownerDocument),
      );
  }
  prepend(...nodes) {
    const first = this.firstChild;
    for (const n of nodes)
      this.insertBefore(
        typeof n === 'object' && n ? n : new TextNode(String(n), this.ownerDocument),
        first,
      );
  }
  insertBefore(node, reference) {
    if (!reference) return this.appendChild(node);
    for (const n of this._adopt(node)) {
      if (node.nodeType === 11) node.childNodes.splice(node.childNodes.indexOf(n), 1);
      n.parentNode = this._self || this;
      const index = this.childNodes.indexOf(reference);
      this.childNodes.splice(index === -1 ? this.childNodes.length : index, 0, n);
    }
    return node;
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index === -1) {
      throw new (vmGlobal('TypeError'))(
        "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
      );
    }
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  replaceChild(next, old) {
    this.insertBefore(next, old);
    return this.removeChild(old);
  }
  replaceChildren(...nodes) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === (this._self || this)) return true;
    return false;
  }
  _descendants() {
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes)
        if (c.nodeType === 1) {
          out.push(c);
          walk(c);
        }
    };
    walk(this);
    return out;
  }
  querySelectorAll(selector) {
    let groups;
    try {
      groups = parseSelector(String(selector));
    } catch {
      return asArray([]);
    }
    return asArray(this._descendants().filter((el) => matchesSelector(el, groups)));
  }
  querySelector(selector) {
    let groups;
    try {
      groups = parseSelector(String(selector));
    } catch {
      return stub();
    }
    return this._descendants().find((el) => matchesSelector(el, groups)) ?? null;
  }
  getElementsByClassName(names) {
    const wanted = String(names).split(/\s+/).filter(Boolean);
    return asArray(
      this._descendants().filter((el) => {
        const classes = (el.getAttribute('class') || '').split(/\s+/);
        return wanted.every((w) => classes.includes(w));
      }),
    );
  }
  getElementsByTagName(tag) {
    const t = String(tag).toLowerCase();
    return asArray(this._descendants().filter((el) => t === '*' || el.localName === t));
  }
  get textContent() {
    let text = '';
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) text += c.data;
        else if (c.nodeType === 1) walk(c);
      }
    };
    walk(this);
    return text;
  }
  set textContent(value) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    if (value !== null && value !== undefined && String(value) !== '')
      this.appendChild(new TextNode(String(value), this.ownerDocument));
  }
  addEventListener(type, listener) {
    if (!listener) return;
    const key = String(type);
    if (!this._listeners.has(key)) this._listeners.set(key, []);
    const list = this._listeners.get(key);
    if (!list.includes(listener)) list.push(listener);
  }
  removeEventListener(type, listener) {
    const list = this._listeners.get(String(type));
    if (list && list.includes(listener)) list.splice(list.indexOf(listener), 1);
  }
  dispatchEvent(event) {
    dispatch(this._self || this, event);
    return !event.defaultPrevented;
  }
}

class Element extends Node {
  constructor(tag, doc, ns) {
    super(doc);
    this.nodeType = 1;
    this.localName = String(tag).toLowerCase();
    this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
    this._attrs = new Map();
    this.style = makeStyle();
    this._value = undefined;
    this._checked = undefined;
    this._selected = false;
    this.width = this.localName === 'canvas' ? 300 : 0;
    this.height = this.localName === 'canvas' ? 150 : 0;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.tabIndex = 0;
    this.hidden = false;
  }
  get tagName() {
    return this.namespaceURI === 'http://www.w3.org/1999/xhtml'
      ? this.localName.toUpperCase()
      : this.localName;
  }
  get nodeName() {
    return this.tagName;
  }
  getAttribute(name) {
    const v = this._attrs.get(String(name).toLowerCase());
    return v === undefined ? null : v;
  }
  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    this._attrs.set(key, String(value));
    if (key === 'style') this.style.cssText = String(value);
    if (key === 'width' && this.localName === 'canvas') this.width = Number(value) || 0;
    if (key === 'height' && this.localName === 'canvas') this.height = Number(value) || 0;
  }
  hasAttribute(name) {
    return this._attrs.has(String(name).toLowerCase());
  }
  removeAttribute(name) {
    this._attrs.delete(String(name).toLowerCase());
  }
  toggleAttribute(name, force) {
    const on = force === undefined ? !this.hasAttribute(name) : Boolean(force);
    if (on) this.setAttribute(name, '');
    else this.removeAttribute(name);
    return on;
  }
  get attributes() {
    return asArray([...this._attrs].map(([name, value]) => ({ name, value })));
  }
  get id() {
    return this.getAttribute('id') || '';
  }
  set id(v) {
    this.setAttribute('id', v);
  }
  get className() {
    return this.getAttribute('class') || '';
  }
  set className(v) {
    this.setAttribute('class', v);
  }
  get classList() {
    const self = this;
    const read = () => (self.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    const write = (list) => self.setAttribute('class', list.join(' '));
    return {
      add: (...c) => write([...new Set([...read(), ...c.map(String)])]),
      remove: (...c) => write(read().filter((x) => !c.map(String).includes(x))),
      contains: (c) => read().includes(String(c)),
      toggle: (c, force) => {
        const has = read().includes(String(c));
        const on = force === undefined ? !has : Boolean(force);
        if (on && !has) write([...read(), String(c)]);
        if (!on && has) write(read().filter((x) => x !== String(c)));
        return on;
      },
      replace: (a, b) => write(read().map((x) => (x === a ? b : x))),
      item: (i) => read()[i] ?? null,
      get length() {
        return read().length;
      },
      forEach: (fn) => read().forEach(fn),
      get value() {
        return self.getAttribute('class') || '';
      },
      toString: () => self.getAttribute('class') || '',
    };
  }
  get dataset() {
    const self = this;
    const attr = (k) => `data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    return new Proxy(
      {},
      {
        get: (_, k) =>
          typeof k === 'symbol' ? undefined : (self.getAttribute(attr(k)) ?? undefined),
        set: (_, k, v) => {
          self.setAttribute(attr(k), v);
          return true;
        },
        has: (_, k) => self.hasAttribute(attr(k)),
        deleteProperty: (_, k) => {
          self.removeAttribute(attr(k));
          return true;
        },
      },
    );
  }
  get innerHTML() {
    return serializeChildren(this);
  }
  set innerHTML(html) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    for (const n of parseFragment(html)) this.appendChild(buildNode(n, this.ownerDocument, false));
  }
  get outerHTML() {
    return serialize(this._self || this);
  }
  insertAdjacentHTML(position, html) {
    const nodes = parseFragment(html).map((n) => buildNode(n, this.ownerDocument, false));
    const where = String(position).toLowerCase();
    const self = this._self || this;
    for (const n of where === 'afterbegin' || where === 'afterend' ? nodes.reverse() : nodes) {
      if (where === 'beforeend') this.appendChild(n);
      else if (where === 'afterbegin') this.insertBefore(n, this.firstChild);
      else if (where === 'beforebegin' && self.parentNode) self.parentNode.insertBefore(n, self);
      else if (where === 'afterend' && self.parentNode)
        self.parentNode.insertBefore(n, self.nextSibling);
    }
  }
  insertAdjacentElement(position, el) {
    const where = String(position).toLowerCase();
    const self = this._self || this;
    if (where === 'beforeend') this.appendChild(el);
    else if (where === 'afterbegin') this.insertBefore(el, this.firstChild);
    else if (where === 'beforebegin' && self.parentNode) self.parentNode.insertBefore(el, self);
    else if (where === 'afterend' && self.parentNode)
      self.parentNode.insertBefore(el, self.nextSibling);
    return el;
  }
  insertAdjacentText(position, text) {
    this.insertAdjacentElement(position, new TextNode(text, this.ownerDocument));
  }
  get innerText() {
    return this.textContent;
  }
  set innerText(v) {
    this.textContent = v;
  }
  remove() {
    const self = this._self || this;
    if (self.parentNode) self.parentNode.removeChild(self);
  }
  replaceWith(...nodes) {
    const self = this._self || this;
    const parent = self.parentNode;
    if (!parent) return;
    for (const n of nodes) parent.insertBefore(n, self);
    parent.removeChild(self);
  }
  before(...nodes) {
    const self = this._self || this;
    if (self.parentNode) for (const n of nodes) self.parentNode.insertBefore(n, self);
  }
  after(...nodes) {
    const self = this._self || this;
    if (self.parentNode)
      for (const n of nodes.reverse()) self.parentNode.insertBefore(n, self.nextSibling);
  }
  cloneNode(deep) {
    const copy = createElement(this.localName, this.ownerDocument, this.namespaceURI);
    for (const [k, v] of this._attrs) copy.setAttribute(k, v);
    if (deep) for (const c of this.childNodes) copy.appendChild(c.cloneNode(true));
    return copy;
  }
  closest(selector) {
    let groups;
    try {
      groups = parseSelector(String(selector));
    } catch {
      return stub();
    }
    for (let n = this._self || this; n && n.nodeType === 1; n = n.parentNode)
      if (matchesSelector(n, groups)) return n;
    return null;
  }
  matches(selector) {
    try {
      return matchesSelector(this._self || this, parseSelector(String(selector)));
    } catch {
      return false;
    }
  }
  get type() {
    const t = this.getAttribute('type');
    if (this.localName === 'input') return (t || 'text').toLowerCase();
    if (this.localName === 'button') return (t || 'submit').toLowerCase();
    if (this.localName === 'select')
      return this.hasAttribute('multiple') ? 'select-multiple' : 'select-one';
    return t || '';
  }
  set type(v) {
    this.setAttribute('type', v);
  }
  get name() {
    return this.getAttribute('name') || '';
  }
  set name(v) {
    this.setAttribute('name', v);
  }
  get min() {
    return this.getAttribute('min') || '';
  }
  set min(v) {
    this.setAttribute('min', v);
  }
  get max() {
    return this.getAttribute('max') || '';
  }
  set max(v) {
    this.setAttribute('max', v);
  }
  get step() {
    return this.getAttribute('step') || '';
  }
  set step(v) {
    this.setAttribute('step', v);
  }
  get disabled() {
    return this.hasAttribute('disabled');
  }
  set disabled(v) {
    this.toggleAttribute('disabled', Boolean(v));
  }
  get placeholder() {
    return this.getAttribute('placeholder') || '';
  }
  set placeholder(v) {
    this.setAttribute('placeholder', v);
  }
  get href() {
    return this.getAttribute('href') || '';
  }
  set href(v) {
    this.setAttribute('href', v);
  }
  get src() {
    return this.getAttribute('src') || '';
  }
  set src(v) {
    this.setAttribute('src', v);
  }
  get title() {
    return this.getAttribute('title') || '';
  }
  set title(v) {
    this.setAttribute('title', v);
  }
  get options() {
    return asArray(this._descendants().filter((el) => el.localName === 'option'));
  }
  get selectedIndex() {
    const options = this.options;
    const i = options.findIndex((o) => o._selected);
    return i === -1 ? (options.length ? 0 : -1) : i;
  }
  set selectedIndex(i) {
    this.options.forEach((o, k) => {
      o._selected = k === Number(i);
    });
  }
  get selectedOptions() {
    const o = this.options[this.selectedIndex];
    return asArray(o ? [o] : []);
  }
  get value() {
    const tag = this.localName;
    if (tag === 'select') {
      const o = this.options[this.selectedIndex];
      return o ? o.value : '';
    }
    if (tag === 'option') return this.getAttribute('value') ?? this.textContent;
    if (tag === 'textarea') return this._value ?? this.textContent;
    if (tag === 'input' || tag === 'button' || tag === 'output' || tag === 'data' || tag === 'li') {
      if (this._value !== undefined) return this._value;
      const attr = this.getAttribute('value');
      if (attr !== null) return attr;
      if (tag === 'input' && this.type === 'range') {
        const min = Number(this.getAttribute('min') || 0);
        const max = Number(this.getAttribute('max') || 100);
        return String(max < min ? min : min + (max - min) / 2);
      }
      if (tag === 'input' && (this.type === 'checkbox' || this.type === 'radio')) return 'on';
      if (tag === 'li') return 0;
      return '';
    }
    return undefined;
  }
  set value(v) {
    if (this.localName === 'select') {
      const i = this.options.findIndex((o) => o.value === String(v));
      this.selectedIndex = i;
      return;
    }
    this._value = String(v);
  }
  get valueAsNumber() {
    const n = Number(this.value);
    return this.value === '' ? NaN : n;
  }
  set valueAsNumber(v) {
    this._value = String(v);
  }
  get checked() {
    return this._checked ?? this.hasAttribute('checked');
  }
  set checked(v) {
    this._checked = Boolean(v);
  }
  get selected() {
    return this._selected;
  }
  set selected(v) {
    this._selected = Boolean(v);
  }
  get files() {
    return asArray([]);
  }
  getContext() {
    if (this.localName !== 'canvas') return undefined;
    const ctx = stub();
    const canvas = this._self || this;
    return new Proxy(
      {
        canvas: this._self || this,
        measureText: (t) => ({
          width: String(t).length * 7,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
        }),
        getImageData: (x, y, w, h) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(Math.max(0, (w * h * 4) | 0) || 4),
        }),
        createImageData: (w, h) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(Math.max(0, (w * h * 4) | 0) || 4),
        }),
        isPointInPath: () => false,
        getLineDash: () => [],
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      },
      {
        get(t, key) {
          if (key in t) return t[key];
          // Count operations that put pixels on the canvas (2D and WebGL).
          if (PAINT_OPS.has(key))
            return () => {
              canvas._paints = (canvas._paints || 0) + 1;
              return stub();
            };
          return ctx[key];
        },
        set(t, key, value) {
          t[key] = value;
          return true;
        },
      },
    );
  }
  toDataURL() {
    return 'data:image/png;base64,';
  }
  toBlob(callback) {
    if (typeof callback === 'function') schedule(() => callback(null), 0, false, []);
  }
  getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 300,
      height: 150,
      right: 300,
      bottom: 150,
      toJSON() {},
    };
  }
  getClientRects() {
    return asArray([this.getBoundingClientRect()]);
  }
  getBBox() {
    return { x: 0, y: 0, width: 100, height: 50 };
  }
  getTotalLength() {
    return 100;
  }
  getPointAtLength() {
    return { x: 0, y: 0 };
  }
  get clientWidth() {
    return 300;
  }
  get clientHeight() {
    return 150;
  }
  get offsetWidth() {
    return 300;
  }
  get offsetHeight() {
    return 150;
  }
  get offsetLeft() {
    return 0;
  }
  get offsetTop() {
    return 0;
  }
  get offsetParent() {
    return this.ownerDocument.body;
  }
  get scrollWidth() {
    return 300;
  }
  get scrollHeight() {
    return 150;
  }
  click() {
    const self = this._self || this;
    if (self.disabled) return;
    if (self.localName === 'input' && (self.type === 'checkbox' || self.type === 'radio'))
      self.checked = self.type === 'radio' ? true : !self.checked;
    dispatch(self, makeEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
  }
  focus() {}
  blur() {}
  select() {}
  scrollIntoView() {}
  scrollTo() {}
  scrollBy() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
  requestFullscreen() {
    return Promise.resolve();
  }
  animate() {
    return { finished: Promise.resolve(), cancel() {}, play() {}, pause() {}, onfinish: null };
  }
  attachShadow() {
    return createElement('div', this.ownerDocument);
  }
  reset() {}
  submit() {}
  checkValidity() {
    return true;
  }
  reportValidity() {
    return true;
  }
  setCustomValidity() {}
  play() {
    return Promise.resolve();
  }
  pause() {}
  load() {}
}

function createElement(tag, doc, ns) {
  const el = new Element(tag, doc, ns);
  const proxy = new Proxy(el, elementHandler);
  el._self = proxy;
  return proxy;
}

class DocumentNode extends Node {
  constructor() {
    super(null);
    this.ownerDocument = null;
    this.nodeType = 9;
    this.nodeName = '#document';
    this.readyState = 'loading';
    this.cookie = '';
    this.hidden = false;
    this.visibilityState = 'visible';
    this.fonts = { ready: Promise.resolve(), add() {}, load: () => Promise.resolve([]) };
    this.referrer = '';
    this.characterSet = 'UTF-8';
    this.compatMode = 'CSS1Compat';
    this.title = '';
  }
  get documentElement() {
    return this.children.find((n) => n.localName === 'html') ?? null;
  }
  get head() {
    const html = this.documentElement;
    return html ? (html.children.find((n) => n.localName === 'head') ?? null) : null;
  }
  get body() {
    const html = this.documentElement;
    return html ? (html.children.find((n) => n.localName === 'body') ?? null) : null;
  }
  get activeElement() {
    return this.body;
  }
  get scrollingElement() {
    return this.documentElement;
  }
  get forms() {
    return this.getElementsByTagName('form');
  }
  get images() {
    return this.getElementsByTagName('img');
  }
  get defaultView() {
    return sandbox;
  }
  get location() {
    return sandbox.location;
  }
  getElementById(id) {
    const wanted = String(id);
    return this._descendants().find((el) => el.getAttribute('id') === wanted) ?? null;
  }
  getElementsByName(name) {
    return asArray(this._descendants().filter((el) => el.getAttribute('name') === String(name)));
  }
  createElement(tag) {
    return createElement(tag, this._self || this);
  }
  createElementNS(ns, tag) {
    return createElement(String(tag).replace(/^\w+:/, ''), this._self || this, ns);
  }
  createTextNode(text) {
    return new TextNode(text, this._self || this);
  }
  createComment() {
    return new TextNode('', this._self || this);
  }
  createDocumentFragment() {
    const fragment = new Node(this._self || this);
    fragment.nodeType = 11;
    fragment.nodeName = '#document-fragment';
    return fragment;
  }
  createEvent() {
    return makeEvent('', {});
  }
  createRange() {
    return stub();
  }
  elementFromPoint() {
    return this.body;
  }
  elementsFromPoint() {
    return asArray([this.body]);
  }
  hasFocus() {
    return true;
  }
  execCommand() {
    return false;
  }
  getSelection() {
    return stub();
  }
  open() {}
  close() {}
  write() {}
  writeln() {}
  exitFullscreen() {
    return Promise.resolve();
  }
}

function serialize(node) {
  if (node.nodeType === 3) return node.data.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (node.nodeType !== 1) return serializeChildren(node);
  const attrs = [...node._attrs]
    .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join('');
  if (VOID.has(node.localName)) return `<${node.localName}${attrs}>`;
  return `<${node.localName}${attrs}>${serializeChildren(node)}</${node.localName}>`;
}

function serializeChildren(node) {
  return node.childNodes.map(serialize).join('');
}

// ── Global environment ──
const sandbox = Object.create(null);
let context;
const vmGlobal = (name) => (context ? vm.runInContext(name, context) : globalThis[name]);
const windowListeners = new Map();

// Timers on a virtual clock.
let clock = 0;
let timerSeq = 1;
const timers = new Map();
function schedule(fn, delay, repeat, args) {
  const id = timerSeq++;
  const d = Math.max(0, Number(delay) || 0);
  timers.set(id, { fn, at: clock + d, delay: Math.max(d, 1), repeat, args });
  return id;
}
function runTimers(budget) {
  let ran = 0;
  while (ran < budget && timers.size && !outOfTime()) {
    let nextId = null;
    let next = null;
    for (const [id, t] of timers)
      if (!next || t.at < next.at) {
        next = t;
        nextId = id;
      }
    clock = Math.max(clock, next.at);
    if (next.repeat) next.at = clock + next.delay;
    else timers.delete(nextId);
    ran += 1;
    if (typeof next.fn === 'function') callGuest(next.fn, sandbox, next.args, 'timer');
    else if (typeof next.fn === 'string') runSource(next.fn, 'timer');
  }
}

function makeEvent(type, init, target) {
  const event = {
    type: String(type),
    bubbles: Boolean(init.bubbles),
    cancelable: true,
    defaultPrevented: false,
    target: target ?? null,
    currentTarget: null,
    srcElement: target ?? null,
    timeStamp: clock,
    isTrusted: true,
    detail: init.detail ?? 0,
    key: '',
    code: '',
    keyCode: 0,
    which: 0,
    button: 0,
    buttons: 1,
    clientX: 0,
    clientY: 0,
    offsetX: 0,
    offsetY: 0,
    pageX: 0,
    pageY: 0,
    screenX: 0,
    screenY: 0,
    movementX: 0,
    movementY: 0,
    deltaX: 0,
    deltaY: 0,
    pointerId: 1,
    pointerType: 'mouse',
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    touches: [],
    targetTouches: [],
    changedTouches: [],
    data: undefined,
    origin: '',
    source: null,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this._stop = true;
    },
    stopImmediatePropagation() {
      this._stop = true;
      this._stopNow = true;
    },
    composedPath() {
      return [];
    },
    initEvent(t, b) {
      this.type = String(t);
      this.bubbles = Boolean(b);
    },
    ...init,
  };
  return event;
}

function eventClass(defaultBubbles) {
  return class GuestEvent {
    constructor(type, init = {}) {
      Object.assign(this, makeEvent(type, { bubbles: defaultBubbles, ...init }));
    }
  };
}

const inlineHandlers = new WeakMap();
function inlineHandler(node, type) {
  if (!node || node.nodeType !== 1) return null;
  const source = node.getAttribute(`on${type}`);
  if (source === null) return null;
  let cache = inlineHandlers.get(node);
  if (!cache) inlineHandlers.set(node, (cache = new Map()));
  if (!cache.has(type)) {
    try {
      cache.set(type, new vm.Script(`(function(event){${source}\n})`).runInContext(context));
    } catch (error) {
      record(error, `on${type} 属性`);
      cache.set(type, null);
    }
  }
  return cache.get(type);
}

function listenersOf(node, type) {
  if (node === sandbox) return (windowListeners.get(type) || []).slice();
  return (node._listeners && node._listeners.get(type) ? node._listeners.get(type) : []).slice();
}

function propertyHandler(node, type) {
  if (node === sandbox) {
    const h = sandbox[`on${type}`];
    if (typeof h === 'function') return h;
    if (type === 'load' && document.body) return inlineHandler(document.body, 'load');
    return null;
  }
  if (node.nodeType === 1 || node.nodeType === 9) {
    const own = Object.prototype.hasOwnProperty.call(node, `on${type}`) ? node[`on${type}`] : null;
    if (typeof own === 'function') return own;
    return inlineHandler(node, type);
  }
  return null;
}

function dispatch(target, event) {
  if (!event || typeof event !== 'object') return;
  event.target = target;
  event.srcElement = target;
  const path = [];
  for (let n = target; n; n = n.parentNode) path.push(n);
  if (path[path.length - 1] === document) path.push(sandbox);
  for (const node of path) {
    event.currentTarget = node;
    const handler = propertyHandler(node, event.type);
    if (handler) callGuest(handler, node, [event], `${event.type} 事件`);
    for (const listener of listenersOf(node, event.type)) {
      if (event._stopNow) break;
      if (typeof listener === 'function') callGuest(listener, node, [event], `${event.type} 事件`);
      else if (listener && typeof listener.handleEvent === 'function')
        callGuest(listener.handleEvent, listener, [event], `${event.type} 事件`);
    }
    if (event._stop || !event.bubbles || outOfTime()) break;
  }
}

let invoker;
function callGuest(fn, thisArg, args, where) {
  if (outOfTime()) return;
  sandbox.__maicCall = () => Reflect.apply(fn, thisArg, args || []);
  try {
    invoker.runInContext(context, { timeout: STEP_TIMEOUT_MS });
  } catch (error) {
    record(error, where);
  } finally {
    delete sandbox.__maicCall;
  }
}

function runSource(source, where) {
  pageSource += '\n' + source;
  if (outOfTime()) return;
  let script;
  try {
    script = new vm.Script(source, { filename: where });
  } catch (error) {
    record(error, where);
    return;
  }
  try {
    script.runInContext(context, { timeout: STEP_TIMEOUT_MS });
  } catch (error) {
    record(error, where);
  }
}

// Browsers expose elements with an id as globals; define the ones not shadowed.
const IDENT = /^[A-Za-z_$][\w$]*$/;
const exposed = new Set();
// A later top-level `let/const/class` of the same name shadows the element.
function unexposeDeclared(source) {
  const declared = /\b(?:let|const|class|var|function)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = declared.exec(source)))
    if (exposed.has(m[1])) {
      delete sandbox[m[1]];
      exposed.delete(m[1]);
    }
}
function exposeIds() {
  for (const el of document._descendants()) {
    const id = el.getAttribute('id');
    if (id && IDENT.test(id) && !(id in sandbox)) {
      try {
        if (vm.runInContext(`typeof ${id}`, context) !== 'undefined') continue;
      } catch {
        continue;
      }
      sandbox[id] = el;
      exposed.add(id);
    }
  }
}

const document = new DocumentNode();

function storage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(String(k)) ? data.get(String(k)) : null),
    setItem: (k, v) => data.set(String(k), String(v)),
    removeItem: (k) => data.delete(String(k)),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

class Observer {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

Object.assign(sandbox, {
  document,
  console: {
    log() {},
    info() {},
    warn() {},
    error() {},
    debug() {},
    table() {},
    group() {},
    groupEnd() {},
    trace() {},
    assert() {},
    time() {},
    timeEnd() {},
    dir() {},
  },
  navigator: {
    userAgent: 'Mozilla/5.0',
    language: 'zh-CN',
    languages: ['zh-CN'],
    platform: 'Win32',
    maxTouchPoints: 0,
    onLine: true,
    clipboard: { writeText: () => Promise.resolve(), readText: () => Promise.resolve('') },
    vibrate: () => false,
    hardwareConcurrency: 4,
  },
  location: {
    href: 'about:srcdoc',
    origin: 'null',
    protocol: 'about:',
    host: '',
    hostname: '',
    pathname: 'srcdoc',
    search: '',
    hash: '',
    reload() {},
    assign() {},
    replace() {},
  },
  history: {
    length: 1,
    state: null,
    pushState() {},
    replaceState() {},
    back() {},
    forward() {},
    go() {},
  },
  screen: {
    width: 1280,
    height: 800,
    availWidth: 1280,
    availHeight: 800,
    orientation: { type: 'landscape-primary', angle: 0, addEventListener() {} },
  },
  performance: {
    now: () => clock,
    mark() {},
    measure() {},
    getEntriesByName: () => [],
    timeOrigin: 0,
  },
  localStorage: storage(),
  sessionStorage: storage(),
  innerWidth: 800,
  innerHeight: 600,
  outerWidth: 800,
  outerHeight: 600,
  devicePixelRatio: 1,
  scrollX: 0,
  scrollY: 0,
  pageXOffset: 0,
  pageYOffset: 0,
  name: '',
  status: '',
  closed: false,
  length: 0,
  frameElement: null,
  event: undefined,
  setTimeout: (fn, delay, ...args) => schedule(fn, delay, false, args),
  setInterval: (fn, delay, ...args) => schedule(fn, delay, true, args),
  clearTimeout: (id) => timers.delete(id),
  clearInterval: (id) => timers.delete(id),
  requestAnimationFrame: (fn) => schedule(() => fn(clock), 16, false, []),
  cancelAnimationFrame: (id) => timers.delete(id),
  requestIdleCallback: (fn) =>
    schedule(() => fn({ didTimeout: false, timeRemaining: () => 10 }), 1, false, []),
  cancelIdleCallback: (id) => timers.delete(id),
  queueMicrotask: (fn) => schedule(fn, 0, false, []),
  alert() {},
  confirm: () => true,
  prompt: () => '',
  scrollTo() {},
  scrollBy() {},
  scroll() {},
  resizeTo() {},
  moveTo() {},
  postMessage() {},
  matchMedia: (q) => ({
    matches: false,
    media: String(q),
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    onchange: null,
  }),
  getComputedStyle: (el) => (el && el.style ? el.style : makeStyle()),
  fetch: () => new Promise(() => {}),
  XMLHttpRequest: class {
    open() {}
    send() {}
    setRequestHeader() {}
    abort() {}
    addEventListener() {}
  },
  Image: class {
    constructor(w, h) {
      const img = createElement('img', document);
      img.width = w || 0;
      img.height = h || 0;
      return img;
    }
  },
  Audio: class {
    constructor() {
      return createElement('audio', document);
    }
  },
  AudioContext: class {
    constructor() {
      return stub();
    }
  },
  ResizeObserver: Observer,
  IntersectionObserver: Observer,
  MutationObserver: Observer,
  PerformanceObserver: Observer,
  Path2D: class {
    constructor() {
      return stub();
    }
  },
  DOMParser: class {
    parseFromString(html) {
      const doc = new DocumentNode();
      const htmlEl = createElement('html', doc);
      doc.appendChild(htmlEl);
      const body = createElement('body', doc);
      htmlEl.appendChild(body);
      body.innerHTML = html;
      return doc;
    }
  },
  XMLSerializer: class {
    serializeToString(n) {
      return n && n.nodeType ? serialize(n) : '';
    }
  },
  Blob: class {
    constructor(parts) {
      this.size = (parts || []).join('').length;
    }
  },
  FileReader: class {
    readAsText() {}
    readAsDataURL() {}
    addEventListener() {}
  },
  Event: eventClass(false),
  CustomEvent: eventClass(false),
  UIEvent: eventClass(false),
  MouseEvent: eventClass(false),
  PointerEvent: eventClass(false),
  KeyboardEvent: eventClass(false),
  InputEvent: eventClass(false),
  TouchEvent: eventClass(false),
  EventTarget: class {
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return true;
    }
  },
  Node: class {},
  Element: class {},
  HTMLElement: class {},
  HTMLCanvasElement: class {},
  HTMLInputElement: class {},
  SVGElement: class {},
  Document: class {},
  addEventListener(type, listener) {
    if (!listener) return;
    const key = String(type);
    if (!windowListeners.has(key)) windowListeners.set(key, []);
    windowListeners.get(key).push(listener);
  },
  removeEventListener(type, listener) {
    const list = windowListeners.get(String(type));
    if (list && list.includes(listener)) list.splice(list.indexOf(listener), 1);
  },
  dispatchEvent(event) {
    dispatch(sandbox, event);
    return true;
  },
});
for (const name of LIBRARY_GLOBALS) sandbox[name] = stub();
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.parent = sandbox;
sandbox.top = sandbox;
sandbox.frames = sandbox;
sandbox.globalThis = sandbox;

context = vm.createContext(sandbox, { codeGeneration: { strings: true, wasm: false } });
invoker = new vm.Script('__maicCall()');
// Built-ins (Promise, Math, JSON …) come from the new context itself.

// ── Build the page in document order, running scripts where they appear ──
function buildNode(json, doc, execute) {
  if (json.text !== undefined) return new TextNode(json.text, doc);
  const el = createElement(json.tag, doc, json.ns);
  for (const [k, v] of json.attrs || []) {
    el._attrs.set(k, v);
    if (k === 'style') el.style.cssText = v;
    if (k === 'selected') el._selected = true;
    if (k === 'width' && el.localName === 'canvas') el.width = Number(v) || 0;
    if (k === 'height' && el.localName === 'canvas') el.height = Number(v) || 0;
  }
  if (!execute || json.tag !== 'script') {
    for (const child of json.children || []) {
      if (json.tag === 'template') continue;
      el.appendChild(buildNode(child, doc, false));
    }
  } else {
    for (const child of json.children || []) el.appendChild(new TextNode(child.text ?? '', doc));
  }
  return el;
}

let scriptIndex = 0;
function attachAndRun(parent, json) {
  if (outOfTime()) return;
  if (json.text !== undefined) {
    parent.appendChild(new TextNode(json.text, document));
    return;
  }
  const el = buildNode({ ...json, children: [] }, document, false);
  parent.appendChild(el);
  if (json.tag === 'script') {
    for (const child of json.children || [])
      el.appendChild(new TextNode(child.text ?? '', document));
    const type = (el.getAttribute('type') || '').trim().toLowerCase();
    if (el.hasAttribute('src')) {
      hasExternalScripts = true;
      return;
    }
    if (!JS_TYPES.has(type)) return;
    scriptIndex += 1;
    exposeIds();
    unexposeDeclared(el.textContent);
    runSource(el.textContent, `第 ${scriptIndex} 个脚本`);
    runTimers(0);
    return;
  }
  if (json.tag === 'template') return;
  if (json.tag === 'option' && el._attrs.has('selected')) el._selected = true;
  for (const child of json.children || []) attachAndRun(el, child);
}

function value(el, kind) {
  const min = Number(el.getAttribute('min') ?? 0) || 0;
  const maxAttr = el.getAttribute('max');
  const max = maxAttr === null ? min + 10 : Number(maxAttr) || min + 10;
  if (kind === 'range' || kind === 'number') return String(min + (max - min) * 0.75);
  return '3';
}

function operateControls(pass) {
  const els = document._descendants();
  const pointerTypes = [
    'click',
    'mousedown',
    'mouseup',
    'pointerdown',
    'pointerup',
    'touchstart',
    'dblclick',
  ];
  let operated = 0;
  for (const el of els) {
    if (outOfTime() || operated >= 60) break;
    if (!el.isConnected) continue;
    const tag = el.localName;
    const hasListeners = el._listeners && el._listeners.size > 0;
    const hasInline = [...el._attrs.keys()].some((k) => /^on[a-z]+$/.test(k));
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      operated += 1;
      exposeIds();
      const kind = el.type;
      if (kind === 'checkbox' || kind === 'radio') {
        el.click();
        dispatch(el, makeEvent('input', { bubbles: true }));
        dispatch(el, makeEvent('change', { bubbles: true }));
      } else if (tag === 'select') {
        const options = el.options;
        if (options.length) el.selectedIndex = pass % 2 === 0 ? options.length - 1 : 0;
        dispatch(el, makeEvent('input', { bubbles: true }));
        dispatch(el, makeEvent('change', { bubbles: true }));
      } else if (kind !== 'file' && kind !== 'hidden') {
        el.value = value(el, kind);
        dispatch(el, makeEvent('input', { bubbles: true }));
        dispatch(el, makeEvent('change', { bubbles: true }));
        dispatch(
          el,
          makeEvent('keydown', {
            bubbles: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
          }),
        );
        dispatch(
          el,
          makeEvent('keyup', {
            bubbles: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
          }),
        );
      }
      runTimers(25);
      continue;
    }
    const pointerListeners = hasListeners && pointerTypes.some((t) => el._listeners.has(t));
    if (tag === 'button' || hasInline || tag === 'canvas' || pointerListeners) {
      operated += 1;
      exposeIds();
      const point = {
        bubbles: true,
        clientX: 120,
        clientY: 80,
        offsetX: 120,
        offsetY: 80,
        pageX: 120,
        pageY: 80,
      };
      const touch = { clientX: 120, clientY: 80, pageX: 120, pageY: 80, identifier: 0 };
      if (tag === 'canvas' || el.localName === 'svg') {
        dispatch(el, makeEvent('pointerdown', point));
        dispatch(el, makeEvent('mousedown', point));
        dispatch(el, makeEvent('pointermove', { ...point, clientX: 160, offsetX: 160 }));
        dispatch(el, makeEvent('mousemove', { ...point, clientX: 160, offsetX: 160 }));
        dispatch(el, makeEvent('pointerup', point));
        dispatch(el, makeEvent('mouseup', point));
        dispatch(
          el,
          makeEvent('touchstart', {
            ...point,
            touches: [touch],
            targetTouches: [touch],
            changedTouches: [touch],
          }),
        );
        dispatch(
          el,
          makeEvent('touchend', {
            ...point,
            touches: [],
            targetTouches: [],
            changedTouches: [touch],
          }),
        );
      } else {
        dispatch(el, makeEvent('pointerdown', point));
        dispatch(el, makeEvent('mousedown', point));
        dispatch(el, makeEvent('pointerup', point));
        dispatch(el, makeEvent('mouseup', point));
      }
      if (!el.disabled) dispatch(el, makeEvent('click', point));
      const form = tag === 'button' && el.type === 'submit' ? el.closest('form') : null;
      if (form && !el.disabled) dispatch(form, makeEvent('submit', { bubbles: true }));
      for (const type of ['dblclick', 'mouseenter', 'mouseover', 'mouseleave', 'dragstart', 'drop'])
        if (el._listeners && el._listeners.has(type)) dispatch(el, makeEvent(type, point));
      runTimers(25);
    }
  }
}

function widgetDefaults() {
  const config = document.getElementById('widget-config');
  if (!config) return {};
  try {
    const parsed = JSON.parse(config.textContent);
    const state = {};
    for (const v of Array.isArray(parsed.variables) ? parsed.variables : [])
      if (v && typeof v.name === 'string') state[v.name] = v.default ?? v.min ?? 1;
    return state;
  } catch {
    return {};
  }
}

// Canvas → its paint record right after load (elements keep unknown properties as text).
const loadPaints = new Map();
function run(tree) {
  const doctype = tree.children || [];
  for (const child of doctype) attachAndRun(document, child);
  exposeIds();
  document.readyState = 'interactive';
  dispatch(document, makeEvent('DOMContentLoaded', { bubbles: true }));
  runTimers(30);
  document.readyState = 'complete';
  dispatch(sandbox, makeEvent('load', {}));
  dispatch(sandbox, makeEvent('resize', {}));
  runTimers(40);
  // What the learner sees on arrival, before touching anything.
  for (const el of document._descendants())
    if (el.localName === 'canvas') loadPaints.set(el._self || el, String(el._paints || ''));
  for (let pass = 0; pass < 2 && !outOfTime(); pass += 1) {
    operateControls(pass);
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', ' ', 'Enter']) {
      const init = {
        bubbles: true,
        key,
        code: key === ' ' ? 'Space' : key,
        keyCode: key === ' ' ? 32 : 13,
      };
      dispatch(document.body || document, makeEvent('keydown', init));
      dispatch(document.body || document, makeEvent('keyup', init));
    }
    runTimers(40);
  }
  dispatch(
    sandbox,
    makeEvent('message', { data: { type: 'SET_WIDGET_STATE', state: widgetDefaults() } }),
  );
  dispatch(sandbox, makeEvent('message', { data: { type: 'HIGHLIGHT_ELEMENT', target: 'body' } }));
  runTimers(20);
}

// ── Visible defects: pages that run without throwing but show broken values ──
const SKIP_TEXT = new Set(['script', 'style', 'template', 'noscript']);
function visibleText(node) {
  let text = '';
  const walk = (n) => {
    for (const c of n.childNodes || []) {
      if (c.nodeType === 3) text += c.data + ' ';
      else if (c.nodeType === 1 && !SKIP_TEXT.has(c.localName)) walk(c);
    }
  };
  walk(node);
  return text.replace(/\s+/g, ' ');
}
function issue(text) {
  if (seen.has(text) || errors.length >= MAX_ERRORS) return;
  seen.add(text);
  errors.push(text);
}
function checkVisibleDefects(widgetType) {
  const els = document._descendants().filter((el) => el.isConnected);
  for (const el of els)
    if (el.localName === 'select' && el.options.length === 0)
      issue(`页面缺陷：下拉框${el.id ? ` #${el.id} ` : ''}没有任何选项，学生无法选择`);
  const text = visibleText(document.body || document);
  const shown =
    /(?:^|[^A-Za-z0-9_$.])(undefined|NaN|\[object Object\])(?![A-Za-z0-9_])/.exec(text) ||
    /[:：=]\s*(null)(?![A-Za-z0-9_])/.exec(text);
  if (shown) issue(`页面缺陷：操作后页面上显示“${shown[1]}”，说明数值或选项没有正确计算或初始化`);
  if (widgetType === 'simulation' || widgetType === 'game') {
    const controls = els.some(
      (el) =>
        ['input', 'select', 'textarea', 'button'].includes(el.localName) ||
        (el._listeners && el._listeners.size > 0) ||
        [...el._attrs.keys()].some((k) => /^on[a-z]+$/.test(k)),
    );
    if (!controls) issue('页面缺陷：页面上没有任何可操作的控件，学生无法与之互动');
    // A visible canvas that nothing ever draws on (not at load, not after
    // operating every control) leaves an empty frame on the page.
    const hidden = (el) => {
      for (let n = el; n && n.nodeType === 1; n = n.parentNode)
        if (n.hidden || (n.style && String(n.style.display) === 'none')) return true;
      return false;
    };
    // Simulations only: a game that failed here would fall back to a quiz-like page.
    const blank = els.filter(
      (el) =>
        widgetType === 'simulation' &&
        el.localName === 'canvas' &&
        !hidden(el) &&
        !(el._paints > 0),
    );
    if (blank.length)
      issue(
        `页面缺陷：画布${blank[0].id ? ` #${blank[0].id} ` : ''}从未绘制任何内容（加载后和操作所有控件后都是空白），请在初始化时就绘制图像，并在参数变化时重绘`,
      );
    // Drawn only after a start button: the page opens on an empty frame.
    const late = els.filter(
      (el) =>
        widgetType === 'simulation' &&
        el.localName === 'canvas' &&
        !hidden(el) &&
        el._paints > 0 &&
        !loadPaints.get(el._self || el),
    );
    // Drawn once at load, then never again while every slider and button was
    // operated: the graph ignores its controls (moving a slider changes nothing).
    const sliders = els.some(
      (el) =>
        el.localName === 'input' && String(el.getAttribute('type') || '').toLowerCase() === 'range',
    );
    const frozen = els.filter(
      (el) =>
        widgetType === 'simulation' &&
        sliders &&
        el.localName === 'canvas' &&
        !hidden(el) &&
        el._paints > 0 &&
        loadPaints.get(el._self || el) === String(el._paints || ''),
    );
    if (!blank.length && frozen.length)
      issue(
        `页面缺陷：拖动滑块后画布${frozen[0].id ? ` #${frozen[0].id} ` : ''}没有重绘，图像不随参数变化；请在滑块的 input 事件中按新参数重新计算并重绘图像`,
      );
    if (!blank.length && late.length)
      issue(
        `页面缺陷：画布${late[0].id ? ` #${late[0].id} ` : ''}在页面打开时是空白的，要点击按钮后才开始绘制；请在初始化时就按当前参数画出图像（动画可以之后再启动）`,
      );
  }
}

process.on('unhandledRejection', (reason) => record(reason, 'Promise'));
try {
  run(workerData.tree);
  if (!outOfTime()) checkVisibleDefects(workerData.widgetType);
} catch (error) {
  record(error, '页面');
}
// Let pending guest promise rejections surface before reporting.
setImmediate(() => {
  parentPort.postMessage({ errors, inconclusive: timedOut });
});

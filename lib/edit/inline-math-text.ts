/**
 * Slide text boxes render plain HTML, so inline TeX written by the model
 * (`$\sin(30^\circ)$`) shows up raw. Worse, JSON output often loses the
 * backslashes (`$sin(30^circ)$`). Rewrite short inline formulas in text nodes
 * into readable Unicode (sin(30°)). Text outside `$…$`, tags, KaTeX markup and
 * currency amounts ("$5 and $10") are left untouched.
 */

const SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
  times: '×',
  cdot: '·',
  div: '÷',
  pm: '±',
  mp: '∓',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  equiv: '≡',
  sim: '∼',
  propto: '∝',
  infty: '∞',
  to: '→',
  rightarrow: '→',
  Rightarrow: '⇒',
  leftarrow: '←',
  Leftrightarrow: '⇔',
  iff: '⇔',
  implies: '⇒',
  sum: 'Σ',
  prod: 'Π',
  int: '∫',
  oint: '∮',
  partial: '∂',
  nabla: '∇',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  subseteq: '⊆',
  cup: '∪',
  cap: '∩',
  emptyset: '∅',
  forall: '∀',
  exists: '∃',
  angle: '∠',
  perp: '⊥',
  parallel: '∥',
  triangle: '△',
  circ: '°',
  degree: '°',
  ldots: '…',
  cdots: '⋯',
  lt: '<',
  gt: '>',
};
const FUNCTIONS =
  'sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|lg|exp|lim|max|min|det|gcd';
const SUP: Record<string, string> = {
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
};
const SUB: Record<string, string> = {
  0: '₀',
  1: '₁',
  2: '₂',
  3: '₃',
  4: '₄',
  5: '₅',
  6: '₆',
  7: '₇',
  8: '₈',
  9: '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
};
const NAMES = Object.keys(SYMBOLS)
  .sort((a, b) => b.length - a.length)
  .join('|');

function script(text: string, map: Record<string, string>, mark: string): string {
  const chars = [...text];
  if (chars.every((c) => map[c])) return chars.map((c) => map[c]).join('');
  return /^\w+$/.test(text) ? `${mark}${text}` : `${mark}(${text})`;
}

/** Replace `\cmd{…}` (or a stripped `cmd{…}`) whose argument has no nested braces. */
/** Like group(), but the command must carry its backslash (prose stays untouched). */
function command(source: string, cmd: string, render: (...args: string[]) => string, arity = 1) {
  const arg = '\\{([^{}]*)\\}';
  return source.replace(
    new RegExp(`\\\\(?:${cmd})\\s*${Array(arity).fill(arg).join('\\s*')}`, 'g'),
    (_m, ...args: string[]) => render(...args.slice(0, arity)),
  );
}

function group(source: string, cmd: string, render: (...args: string[]) => string, arity = 1) {
  const arg = '\\{([^{}]*)\\}';
  // `\cmd{…}`, or a stripped `cmd{…}` not glued to a preceding word ("H_2mathrm{O}" is H₂O).
  return source.replace(
    new RegExp(`(?:\\\\|(?<![A-Za-z]))(?:${cmd})\\s*${Array(arity).fill(arg).join('\\s*')}`, 'g'),
    (_m, ...args: string[]) => render(...args.slice(0, arity)),
  );
}

const wrap = (s: string) => (/^[\w.αβγθπ²³√]+$/u.test(s.trim()) ? s.trim() : `(${s.trim()})`);

export function texToReadable(tex: string): string {
  let s = tex;
  for (let i = 0; i < 4; i += 1) {
    const before = s;
    s = group(s, 'd?frac', (a, b) => `${wrap(a)}/${wrap(b)}`, 2);
    s = group(s, 'sqrt', (a) => `√${wrap(a)}`);
    s = group(s, '(?:text|mathrm|mathbf|mathit|operatorname|textbf|boxed)', (a) => a);
    // Reaction/condition arrows: \xrightarrow{光照} reads as —光照→.
    s = group(s, '(?:xrightarrow|xlongrightarrow)', (a) => (a.trim() ? `—${a.trim()}→` : '→'));
    s = group(s, 'xleftarrow', (a) => (a.trim() ? `←${a.trim()}—` : '←'));
    s = group(
      s,
      'overset',
      (a, b) => (b.trim() === '→' || /rightarrow/.test(b) ? `—${a.trim()}→` : `${b}${a}`),
      2,
    );
    s = group(s, '(?:bar|overline)', (a) => `${a}̄`);
    s = group(s, '(?:vec|overrightarrow)', (a) => `${a}⃗`);
    s = group(s, 'hat', (a) => `${a}̂`);
    if (s === before) break;
  }
  s = s
    .replace(/\\(?:left|right|big|Big|bigg|Bigg|displaystyle)\b/g, '')
    .replace(/\\[,;:! ]|\\quad\b|\\qquad\b|~/g, ' ')
    .replace(/\\\\/g, ' ')
    .replace(/\\([{}%$&#_])/g, '$1');
  // Degree signs: ^\circ, ^{\circ}, and the backslash-stripped ^circ.
  s = s.replace(/\^\s*\{?\s*\\?(?:circ|degree)(?:\s*\})?/g, '°');
  s = s.replace(new RegExp(`\\\\(${FUNCTIONS})(?![A-Za-z])`, 'g'), '$1');
  // \name always; a bare name only when it stands alone (backslash lost).
  s = s.replace(new RegExp(`\\\\(${NAMES})(?![A-Za-z])`, 'g'), (_m, n: string) => SYMBOLS[n]!);
  s = s.replace(new RegExp(`(?<![A-Za-z\\\\])(${NAMES})(?![A-Za-z])`, 'g'), (m, n: string) =>
    n.length >= 2 &&
    ![
      'in',
      'to',
      'le',
      'ge',
      'ne',
      'lt',
      'gt',
      'mu',
      'nu',
      'pi',
      'xi',
      'eta',
      'int',
      'sim',
      'cap',
      'cup',
      'div',
      'circ',
    ].includes(n)
      ? SYMBOLS[n]!
      : m,
  );
  s = s.replace(/(?<![A-Za-z\\])pi(?![A-Za-z])/g, 'π');
  s = s
    .replace(/\^\s*\{([^{}]*)\}/g, (_m, a: string) => script(a, SUP, '^'))
    .replace(/\^\s*([0-9A-Za-z+-])/g, (_m, a: string) => script(a, SUP, '^'))
    .replace(/_\s*\{([^{}]*)\}/g, (_m, a: string) => script(a, SUB, '_'))
    .replace(/_\s*([0-9])/g, (_m, a: string) => script(a, SUB, '_'))
    .replace(/[{}]/g, '')
    .replace(/\\(?=[A-Za-z])/g, '')
    .replace(/\s{2,}/g, ' ');
  return s.trim();
}

// JSON escapes eat the first letter of some commands: "\tan" arrives as a TAB
// followed by "an", "\frac" as a form feed + "rac", and so on. Put them back.
const CONTROL_ESCAPES: Array<[RegExp, string]> = [
  [/\t(?=an\b|heta|imes|o\b|ext|riangle|au\b|ilde)/g, '\\t'],
  [/\f(?=rac)/g, '\\f'],
  [/[\b](?=eta|ar\b|egin|ig)/g, '\\b'],
  [/\r(?=ho\b|ight)/g, '\\r'],
  [/\v(?=ec\b|arphi|arepsilon)/g, '\\v'],
];

/** Native LaTeX elements need the same JSON-escape repair as inline formulas. */
export function restoreLatexSource(source: string): string {
  let result = source;
  for (const [pattern, replacement] of CONTROL_ESCAPES)
    result = result.replace(pattern, replacement);
  return result.replace(
    /(?<![A-Za-z\\])(mathrm|mathbf|mathit|text|textbf|frac|dfrac|sqrt|xrightarrow|xleftarrow|overset)(?=\s*\{)/g,
    '\\$1',
  );
}
/** Only the brace-group commands of a formula that lost its backslashes; prose words stay. */
function strippedTex(text: string): string {
  let s = text;
  for (let i = 0; i < 4; i += 1) {
    const before = s;
    s = group(s, 'd?frac', (a, b) => `${wrap(a)}/${wrap(b)}`, 2);
    s = group(s, 'sqrt', (a) => `√${wrap(a)}`);
    s = group(s, '(?:text|mathrm|mathbf|mathit|operatorname|textbf|boxed)', (a) => a);
    s = group(s, '(?:xrightarrow|xlongrightarrow)', (a) => (a.trim() ? `—${a.trim()}→` : '→'));
    s = group(s, 'xleftarrow', (a) => (a.trim() ? `←${a.trim()}—` : '←'));
    if (s === before) break;
  }
  return (
    s
      // Residue of an earlier lossy pass: "xrightarrow\text光 葡萄糖", "H₂mathrmO".
      .replace(/(?<![A-Za-z])(?:xrightarrow|xlongrightarrow)\s*\\?text\s*([^\s{}]+)/g, '—$1→')
      .replace(/(?<![A-Za-z])(?:mathrm|mathbf)(?=[A-Z0-9(])/g, '')
      .replace(/(?<![A-Za-z])(?:xrightarrow|xlongrightarrow)(?![A-Za-z])/g, '→')
      .replace(
        /([A-Za-z\)])_\s*\{?([0-9]+)\}?/g,
        (_m, base: string, n: string) => base + script(n, SUB, '_'),
      )
      .replace(
        /([A-Za-z\)])\^\s*\{?([0-9+-]+)\}?/g,
        (_m, base: string, n: string) => base + script(n, SUP, '^'),
      )
  );
}

const STRIPPED_TEX =
  /(?<![A-Za-z])(?:mathrm|mathbf|xrightarrow|xlongrightarrow|xleftarrow|frac|dfrac|sqrt|overset|text)\s*\{|(?<![A-Za-z])(?:xrightarrow|xlongrightarrow)\s*\\?text|(?<![A-Za-z])mathrm(?=[A-Z])/;
const BARE_TEX =
  /\\(?:[A-Za-z]+|[()[\]])|\^\{|_\{|[\t\f\b\r\v](?=[a-z])|(?<![A-Za-z])(?:mathrm|mathbf|xrightarrow|xlongrightarrow|xleftarrow|dfrac|overset)\s*\{|(?<![A-Za-z])(?:xrightarrow|xlongrightarrow)\s*\\?text|(?<![A-Za-z])mathrm(?=[A-Z])/;

/**
 * TeX written without (or with lost) delimiters, such as "(y = sin^{-1}(x))" or
 * "[-\frac{\pi}{2}, \frac{\pi}{2}]". Only unambiguous TeX is rewritten:
 * backslash commands, ^{…}/_{…} groups and restored control-character escapes.
 * Bare words (pi, in, theta) are left alone, since this runs on prose.
 */
export function bareTexToReadable(text: string): string {
  if (!BARE_TEX.test(text)) return text;
  let s = text;
  for (const [pattern, replacement] of CONTROL_ESCAPES) s = s.replace(pattern, replacement);
  // A tangent whose "\t" vanished completely: "an^{-1}(x)", "an(x)".
  if (/\\[A-Za-z]+|\^\{/.test(s)) s = s.replace(/(?<![A-Za-z\\])an(?=\s*(?:\^|\())/g, 'tan');
  for (let i = 0; i < 4; i += 1) {
    const before = s;
    s = command(s, 'd?frac', (a, b) => `${wrap(texToReadable(a))}/${wrap(texToReadable(b))}`, 2);
    s = command(s, 'sqrt', (a) => `√${wrap(texToReadable(a))}`);
    s = command(s, 'text|mathrm|mathbf|mathit|operatorname|textbf|boxed', (a) => a);
    s = command(s, 'xrightarrow|xlongrightarrow', (a) =>
      a.trim() ? `—${texToReadable(a)}→` : '→',
    );
    s = command(s, 'xleftarrow', (a) => (a.trim() ? `←${texToReadable(a)}—` : '←'));
    if (s === before) break;
  }
  // A formula whose backslashes JSON swallowed ("H_2mathrm{O} xrightarrow{光}"): the
  // command words still carry their brace groups, so rewrite those groups too.
  if (STRIPPED_TEX.test(s)) s = strippedTex(s);
  return (
    s
      .replace(/\\(?:left|right|big|Big|bigg|Bigg|displaystyle)\b/g, '')
      .replace(/\\[,;:! ]|\\quad\b|\\qquad\b/g, ' ')
      .replace(/\^\s*\{?\s*\\(?:circ|degree)(?:\s*\})?/g, '°')
      .replace(new RegExp(`\\\\(${FUNCTIONS})(?![A-Za-z])`, 'g'), '$1')
      .replace(/\\[()[\]]/g, '')
      .replace(new RegExp(`\\\\(${NAMES})(?![A-Za-z])`, 'g'), (_m, n: string) => SYMBOLS[n]!)
      .replace(/\^\s*\{([^{}]*)\}/g, (_m, a: string) => script(a, SUP, '^'))
      .replace(/_\s*\{([^{}]*)\}/g, (_m, a: string) => script(a, SUB, '_'))
      .replace(/[\t\f\b\r\v]/g, ' ')
      // "([0, π])": the parentheses left by a lost \( … \) around an interval.
      .replace(/\(([[(][^[\]()]*[\])])\)/g, '$1')
      // Plain subscripts of the same formula ("6CO_2 + 6H_2O \xrightarrow{…}").
      .replace(/([A-Za-z)\]])_([0-9]+)(?![0-9])/g, (m, base: string, n: string) =>
        /\\[A-Za-z]/.test(text) ? base + script(n, SUB, '_') : m,
      )
  );
}

/** Does this `$…$` body look like a formula rather than prose between two dollar amounts? */
function isFormula(body: string): boolean {
  if (!body.trim() || body.length > 240 || /\n/.test(body)) return false;
  if (Object.hasOwn(SYMBOLS, body.trim().replace(/^\\/, ''))) return true;
  if (/\S\s+(?:ge|le|gt|lt|neq|ne|geq|leq)\s+\S/.test(body)) return true;
  if (/^\s|\s$/.test(body) && /^\s*\d/.test(body) && !/[\\^_{}=]/.test(body)) return false;
  return /[\\^_{}=<>+\-*/()]|\b(?:sin|cos|tan|log|ln|lim|frac|sqrt|circ)\b|^[A-Za-z]$/.test(body);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Rewrite inline formulas inside the text nodes of a slide text element's HTML. */
export function readableInlineMath(html: string): string {
  if (!html.includes('$') && !html.includes('\\(') && !BARE_TEX.test(html)) return html;
  if (/katex|data-math|<math/i.test(html)) return html;
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) return part;
      const decoded = part.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      let changed = false;
      const out = decoded.replace(
        /\$\$([^$]+)\$\$|\$([^$]+)\$|\\\((.+?)\\\)/g,
        (m, a?: string, b?: string, c?: string) => {
          const body = a ?? b ?? c ?? '';
          if (!isFormula(body)) return m;
          changed = true;
          // Only inside confirmed math delimiters: "ge" in prose or prices
          // must not be treated as a backslash-stripped relation command.
          return texToReadable(body.replace(/(?<=\S\s)(ge|le|gt|lt|ne)(?=\s+\S)/g, '\\$1'));
        },
      );
      // Then any TeX that has no (or lost its) delimiters.
      const bare = bareTexToReadable(out);
      return changed || bare !== out ? escapeHtml(bare) : part;
    })
    .join('');
}

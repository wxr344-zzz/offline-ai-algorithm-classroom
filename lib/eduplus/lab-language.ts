/**
 * The programming Labs run Python only (Pyodide sandbox). A request that names
 * another language gets a Python Lab; the app says so up front instead of
 * letting a learner who asked for C++ discover Python code in the Lab.
 */
const LANGUAGES: Array<[RegExp, string]> = [
  [/c\s*\+\+|cpp\b/i, 'C++'],
  [/c\s*#|c\s*sharp/i, 'C#'],
  [/(?:^|[^a-z])c\s*语言|用\s*c\s*(?:实现|写|编写|编程)|in\s+c\b/i, 'C'],
  [/typescript/i, 'TypeScript'],
  [/javascript|\bjs\b|node\.?js/i, 'JavaScript'],
  [/\bjava\b|java\s*语言|(?:^|[^a-z])java(?=[一-鿿])/i, 'Java'],
  [/\bgolang\b|\bgo\s*语言|用\s*go\s*(?:实现|写|编写)/i, 'Go'],
  [/\brust\b/i, 'Rust'],
  [/\bkotlin\b/i, 'Kotlin'],
  [/\bswift\b/i, 'Swift'],
  [/\bphp\b/i, 'PHP'],
  [/\bruby\b/i, 'Ruby'],
  [/\bmatlab\b/i, 'MATLAB'],
  [/\bscala\b/i, 'Scala'],
];

/** The non-Python language a request asks for, or null (Python or none named). */
export function requestedNonPythonLanguage(text: string): string | null {
  for (const [pattern, name] of LANGUAGES) if (pattern.test(text)) return name;
  return null;
}

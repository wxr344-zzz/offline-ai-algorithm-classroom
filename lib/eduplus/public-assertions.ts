import type { JsonValue, PublicProblem } from '@/lib/types/eduplus.generated';
import { JSON_ASSERTION_HELPER } from './json-assertion-source';
export function pythonLiteral(value: JsonValue): string {
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(', ')}]`;
  if (typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}: ${pythonLiteral(item)}`)
      .join(', ')}}`;
  return JSON.stringify(value);
}
export function publicAssertions(problem: PublicProblem): string[] {
  return problem.publicTestCases.map((test, index) =>
    problem.answerCheck === 'json-value'
      ? `${index === 0 ? JSON_ASSERTION_HELPER + '\n' : ''}assert _same_json_output(${problem.entryPoint.className}().${problem.entryPoint.methodName}(**${pythonLiteral(test.inputs)}), ${pythonLiteral(test.expected)})`
      : problem.answerCheck === 'lcs-string'
        ? `输入：${pythonLiteral(test.inputs)}\n合法答案示例：${pythonLiteral(test.expected)}\n判定规则：同时为两个输入的子序列，且长度达到最优值；接受所有最优解。`
        : `assert ${problem.entryPoint.className}().${problem.entryPoint.methodName}(**${pythonLiteral(test.inputs)}) == ${pythonLiteral(test.expected)}`,
  );
}

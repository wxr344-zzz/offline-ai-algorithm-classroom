import type { PublicCourse } from '@/lib/types/eduplus.generated';
import type { ClassroomTeaching } from '@/lib/types/eduplus-teaching.generated';

/** Reviewed state transitions; never execute model-authored source. */
export function insertionTrace(course: PublicCourse, inputs: Record<string, unknown>) {
  if (!/插入排序|insertion\s*sort/i.test(course.topic)) return null;
  const name = course.scenes[0]?.problem.entryPoint.parameters[0]?.name;
  const input = inputs[name];
  if (!Array.isArray(input) || input.some((x) => !Number.isSafeInteger(x)) || input.length > 14)
    return null;
  const values = [...input] as number[];
  const steps: NonNullable<ClassroomTeaching['algorithmTrace']>['steps'] = [
    {
      label: '初始化有序前缀',
      explanation: '将首个元素看作已排序部分，从第二个元素开始逐个插入。',
      values: values.length ? values.map(String) : ['空数组'],
      activeIndices: values.length ? [0] : [],
    },
  ];
  for (let i = 1; i < values.length; i++) {
    const key = values[i];
    let j = i - 1;
    while (j >= 0 && values[j] > key) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = key;
    steps.push({
      label: `插入第 ${i + 1} 个元素 ${key}`,
      explanation: `暂存 ${key}，将有序前缀中比它大的元素后移，再插入下标 ${j + 1}。现在下标 0 到 ${i} 已有序，右侧元素尚未处理。`,
      values: values.map(String),
      activeIndices: [j + 1],
    });
  }
  steps.push({
    label: '排序完成',
    explanation: '所有元素按非递减顺序排列，元素数量及重复值保持不变。',
    values: values.length ? values.map(String) : ['空数组'],
    activeIndices: [],
  });
  return { steps, outcome: values };
}

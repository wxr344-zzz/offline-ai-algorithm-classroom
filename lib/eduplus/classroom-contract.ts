import { z } from 'zod';
import schema from '@/contracts/eduplus-teaching.schema.json';
import type { ClassroomTeaching } from '@/lib/types/eduplus-teaching.generated';

const teaching = z.fromJSONSchema(schema as unknown as Parameters<typeof z.fromJSONSchema>[0]);
export const eduplusReferenceSchema = z
  .object({
    courseId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/),
    phase: z.enum(['concept', 'demo', 'guided-lab', 'oj-lab', 'review']),
  })
  .strict();
export type EduplusSceneReference = z.infer<typeof eduplusReferenceSchema>;
export interface ClassroomRecord {
  stageId: string;
  teaching: ClassroomTeaching;
  quizSceneId?: string;
}
export function parseTeaching(value: unknown): ClassroomTeaching {
  const parsed = teaching.parse(value) as ClassroomTeaching;
  if (
    !parsed.overview.trim() ||
    !parsed.demoExplanation.trim() ||
    parsed.questions.some(
      (q) =>
        !q.question.trim() ||
        !q.analysis.trim() ||
        q.options.some((option) => !option.trim()) ||
        new Set(q.options.map((option) => option.trim())).size !== 4,
    )
  )
    throw new Error('Invalid teaching content');
  return parsed;
}
export function parseClassroomRecord(value: unknown): ClassroomRecord {
  const record = z
    .object({
      stageId: z.string().min(1).max(180),
      teaching: z.unknown(),
      quizSceneId: z.string().min(1).max(256).optional(),
    })
    .strict()
    .parse(value);
  return {
    stageId: record.stageId,
    teaching: parseTeaching(record.teaching),
    ...(record.quizSceneId ? { quizSceneId: record.quizSceneId } : {}),
  };
}

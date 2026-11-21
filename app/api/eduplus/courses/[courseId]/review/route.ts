import { getLearningReview } from '@/lib/server/eduplus-review';
import { getEduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import { withEduplusOwner } from '@/lib/server/eduplus-route';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  return withEduplusOwner(request, async (ownerId, headers) => {
    const review = await getLearningReview(ownerId, courseId);
    if (new URL(request.url).searchParams.get('format') !== 'markdown')
      return Response.json(review, { headers });
    const course = (await (await getEduplusCourseStore()).get(ownerId, courseId))!;
    const lines = [
      `# ${course.lessonPlan.title}`,
      '',
      '## 教学目标',
      ...course.lessonPlan.objectives.map((item) => `- ${item}`),
      '',
      '## 知识点',
      ...course.lessonPlan.knowledgePoints.map((item) => `- ${item}`),
      '',
      '## 概念测验',
      review.quizStatus === 'content-changed'
        ? '测验内容已修改或课堂已删除，历史作答不自动重新评分。'
        : review.quiz
          ? `${review.quiz.correct}/${review.quiz.total} 正确，提交时间 ${review.quiz.submittedAt}`
          : '尚无已提交的测验记录。',
      ...(review.quiz?.wrongTopics.map((item) => `- 待复习：${item}`) ?? []),
      '',
      '## 公开编程练习记录',
      '以下为浏览器测试集评测记录，仅列出最近 100 次。',
      ...review.events.map(
        (event) =>
          `- ${event.createdAt} · ${event.sceneId} · ${event.status} · ${event.passed}/${event.total} · ${event.message}`,
      ),
      '',
      '## 已保存草稿',
      ...review.drafts.map(
        (draft) =>
          `- ${draft.sceneType} · 修订 ${draft.revision} · ${draft.updatedAt ?? '尚未保存'}`,
      ),
      '',
      '## 已保存课堂对白',
      '只包含已保存的可见文字，最多最近 200 条；不含系统提示词、思考过程或工具调用。',
      ...review.dialogue.flatMap((message) => [
        `### ${message.sender}`,
        '',
        ...message.text.split('\n').map((line) => `> ${line}`),
        '',
      ]),
      '',
      '评测按当前题目测试集判定，通过数与题目版本及作答修订相关联。',
      '',
    ];
    headers.set('Content-Type', 'text/markdown; charset=utf-8');
    headers.set('Content-Disposition', 'attachment; filename="eduplus-learning-review.md"');
    return new Response(lines.join('\n'), { headers });
  });
}

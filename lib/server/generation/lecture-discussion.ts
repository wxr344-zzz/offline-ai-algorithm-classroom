import type { AgentInfo } from '@openmaic/generation';
import type { Action } from '@/lib/types/action';
import type { SceneOutline } from '@/lib/types/generation';
import { contentLanguage } from '@/lib/eduplus/content-language';

const invitations: Record<string, string> = {
  'zh-CN': '请结合本页内容，用自己的话解释一个关键点，并提出一个希望与老师和同学一起讨论的问题。',
  'zh-TW': '請結合本頁內容，用自己的話解釋一個關鍵點，並提出一個希望與老師和同學一起討論的問題。',
  en: 'Using this page, explain one key idea in your own words and raise a question to discuss with the teacher and classmates.',
  'ar-SA':
    'استنادًا إلى هذه الصفحة، اشرح فكرة أساسية بكلماتك واطرح سؤالًا لمناقشته مع المعلم والزملاء.',
  'de-DE':
    'Erkläre anhand dieser Seite einen Kerngedanken mit eigenen Worten und stelle eine Frage zur Diskussion mit Lehrkraft und Mitschülern.',
  'es-MX':
    'Con base en esta página, explica una idea clave con tus propias palabras y plantea una pregunta para discutir con el docente y tus compañeros.',
  'fr-FR':
    'À partir de cette page, explique une idée essentielle avec tes propres mots et pose une question à discuter avec le professeur et tes camarades.',
  'ja-JP':
    'このページの重要な点を一つ自分の言葉で説明し、先生やクラスメートと話し合いたい質問を挙げてください。',
  'ko-KR':
    '이 페이지의 핵심 개념 하나를 자신의 말로 설명하고 선생님과 친구들과 토론할 질문을 제시하세요.',
  'pt-BR':
    'Com base nesta página, explique uma ideia central com suas palavras e proponha uma pergunta para discutir com o professor e os colegas.',
  'ru-RU':
    'Опираясь на эту страницу, объясните одну ключевую идею своими словами и предложите вопрос для обсуждения с учителем и одноклассниками.',
  'vi-VN':
    'Dựa vào trang này, hãy giải thích một ý chính bằng lời của mình và nêu một câu hỏi để thảo luận với giáo viên và các bạn.',
};

/** One native invitation after the initial concept segment, not one per page.
 * The playback engine still asks the learner to join or skip. Quiz/Lab holds
 * and teacher-only classrooms keep their existing behavior. */
export function ensureLectureDiscussion(
  actions: Action[],
  outline: SceneOutline,
  allOutlines: SceneOutline[],
  agents: AgentInfo[] = [],
  languageDirective?: string,
): Action[] {
  if (outline.type !== 'slide' || actions.some((action) => action.type === 'discussion'))
    return actions;
  const initiator =
    agents.find((agent) => agent.role === 'student') ??
    agents.find((agent) => agent.role === 'assistant');
  if (!initiator || !actions.some((action) => action.type === 'speech')) return actions;
  const ordered = [...allOutlines].sort((a, b) => a.order - b.order);
  const boundary = ordered.findIndex((item) => item.type !== 'slide');
  const concepts = (boundary < 0 ? ordered : ordered.slice(0, boundary)).filter(
    (item) => item.type === 'slide',
  );
  const target = concepts.at(-1);
  if (target?.id !== outline.id) return actions;
  return [
    ...actions,
    {
      id: `${outline.id}-classroom-discussion`,
      type: 'discussion',
      topic: outline.title,
      prompt: invitations[contentLanguage(languageDirective)] ?? invitations.en,
      agentId: initiator.id,
    },
  ];
}

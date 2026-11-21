/**
 * What the teacher sees of a deterministic simulator page when writing its
 * lines. The stored page is only an inert preview; the learner actually gets
 * the platform simulator with fixed controls, driven by a verified trace. The
 * narration is written from that real page: its real controls (in the course
 * language) and the real data of its default run, so the teacher never asks
 * for a control that does not exist or describes steps the run does not make.
 */
import type { GeneratedInteractiveContent } from '@/lib/types/generation';
import type { SpeechAction } from '@/lib/types/action';
import { nanoid } from 'nanoid';
import type { SimulationTrace } from '@/lib/eduplus/simulation-contract';
import {
  contentLanguage,
  contentLanguageTag,
  simulatorText,
  type ContentLanguage,
} from '@/lib/eduplus/content-language';

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

function shown(value: unknown, max = 160): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Real executed steps, with explicit manual navigation rather than claims
 * that the simulator has already moved while the teacher is speaking. */
export function verifiedSimulatorActions(
  trace: SimulationTrace,
  languageDirective?: string,
  mode: 'simulation' | 'game' = 'simulation',
): SpeechAction[] {
  const language = contentLanguage(languageDirective),
    t = simulatorText(language),
    zh = language === 'zh-CN' || language === 'zh-TW';
  const lines =
    mode === 'game'
      ? [
          `${trace.title}${t.gameSuffix}. ${t.gameIntro}`,
          `${t.sampleInput}${JSON.stringify(trace.input)}. ${t.gameHint}`,
          !zh
            ? `Choose cards in execution order, then use ${t.check} to check your arrangement. ${t.undo} removes the last chosen card.`
            : language === 'zh-TW'
              ? `按執行順序點選卡片後，用「${t.check}」核對排列；「${t.undo}」可撤回最後一次選擇。`
              : `按执行顺序点击卡片后，用“${t.check}”核对排列；“${t.undo}”可撤回最后一次选择。`,
        ]
      : [
          zh
            ? `现在进入${trace.title}的逐步推演。打开页面时显示初始状态。输入为 ${JSON.stringify(trace.input)}。`
            : `This is the step-by-step ${trace.title} simulation. The page opens at the initial state. Input: ${JSON.stringify(trace.input)}.`,
          zh
            ? `点击“${t.next}”前进一步，点击“${t.previous}”查看上一步。“${t.autoplay}”逐帧播放，“${t.pause}”暂停，“${t.restart}”回到初始状态。`
            : `Use ${t.next} to advance one step and ${t.previous} to go back. ${t.autoplay} advances frame by frame, ${t.pause} stops playback, and ${t.restart} returns to the initial state.`,
          ...trace.frames
            .slice(1, 3)
            .map((frame, i) =>
              zh
                ? `从初始状态点击“${t.next}”${i + 1}次后，可以观察到：${frame.explanation}`
                : `After pressing ${t.next} ${i + 1} time${i ? 's' : ''} from the initial state, observe: ${frame.explanation}`,
            ),
          zh
            ? `继续逐步运行到最后，再核对结果：${JSON.stringify(trace.outcome)}。修改输入后需要重新运行，先前的过程不代表新输入的结果。`
            : `Continue to the final frame, then compare the result: ${JSON.stringify(trace.outcome)}. After editing the input, run it again; the old trace does not describe the new input.`,
        ];
  return lines.map((text) => ({
    id: `verified-${mode}-speech-${nanoid()}`,
    type: 'speech',
    text,
  }));
}

export function describeSimulatorPage(
  title: string,
  mode: 'simulation' | 'game',
  language: ContentLanguage,
  trace?: Pick<SimulationTrace, 'title' | 'input' | 'frames' | 'outcome'> | null,
): string {
  const t = simulatorText(language);
  const zh = language === 'zh-CN' || language === 'zh-TW';
  const heading = `${trace?.title ?? title}${mode === 'game' ? t.gameSuffix : t.demoSuffix}`;
  const controls =
    mode === 'game'
      ? [t.check, t.undo]
      : [t.previous, t.next, t.autoplay, t.pause, t.restart, t.stepAria];
  const parts = [
    `<h1>${escape(heading)}</h1>`,
    `<p>${escape(mode === 'game' ? t.gameIntro : t.demoIntro)}</p>`,
    `<p>${escape(zh ? '页面上真实存在的控件（只能引用这些）：' : 'Controls that exist on this page (refer only to these): ')}${controls
      .map((c) => `<button>${escape(c)}</button>`)
      .join(
        ' ',
      )} <details><summary>${escape(t.editInput)}</summary>${escape(t.input)}</details></p>`,
  ];
  if (trace?.frames?.length) {
    const frames = trace.frames;
    const sample = frames.slice(0, Math.min(6, frames.length));
    parts.push(
      `<p>${escape(t.sampleInput)}${escape(shown(trace.input))}</p>`,
      `<p>${escape(zh ? `这次运行共 ${frames.length} 步，每一步是一次真实操作；前几步：` : `This run has ${frames.length} steps, each one real operation. The first steps:`)}</p>`,
      `<ol>${sample.map((f) => `<li>${escape(f.label)}：${escape(shown(f.explanation, 200))}</li>`).join('')}</ol>`,
      `<p>${escape(t.result)}${zh ? '：' : ': '}${escape(shown(trace.outcome))}</p>`,
    );
  }
  parts.push(
    `<p>${escape(
      zh
        ? '讲解要求：按页面真实控件引导学生逐步操作；一步只对应一次比较、交换、移动或更新，不要把一步说成一整轮；不要声称页面会自动给出未展示的结论。'
        : 'Narration rules: guide the learner with the real controls above; one step is one comparison, swap, move or update, never a whole pass; do not claim the page shows anything it does not.',
    )}</p>`,
  );
  return parts.join('');
}

/** The default verified run of a simulator page, in the course language (null when unavailable). */
export async function fetchDefaultTrace(
  topic: string,
  languageDirective: string | undefined,
  request: (body: unknown, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
  input?: Record<string, unknown>,
): Promise<SimulationTrace | null> {
  try {
    const lang = contentLanguageTag(contentLanguage(languageDirective));
    const timeout = AbortSignal.timeout(60_000);
    const result = (await request(
      { topic, lang, ...(input ? { input } : {}) },
      signal ? AbortSignal.any([signal, timeout]) : timeout,
    )) as SimulationTrace;
    return Array.isArray(result?.frames) ? result : null;
  } catch {
    return null;
  }
}

export function simulatorNarrationContent(
  content: GeneratedInteractiveContent,
  title: string,
  languageDirective: string | undefined,
  trace: SimulationTrace | null,
): GeneratedInteractiveContent {
  const mode = content.simulation?.mode === 'game' ? 'game' : 'simulation';
  return {
    ...content,
    html: describeSimulatorPage(title, mode, contentLanguage(languageDirective), trace),
  };
}

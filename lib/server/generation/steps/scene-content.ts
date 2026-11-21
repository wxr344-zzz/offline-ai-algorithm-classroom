/**
 * Scene content: generate one scene's content (a slide, quiz, interactive
 * widget or PBL project) from its outline, with the outline's assigned
 * material images attached when the model sees images. Actions are the scene
 * actions step. The logic of 1.1.x's POST /api/generate/scene-content; the
 * caller resolves the model for the scene type's stage.
 */
import { callLLM } from '@/lib/ai/llm';
import {
  layoutReadableSlide,
  hasUnreadableSlide,
  recoverSlideText,
} from '@/lib/edit/readable-slide-layout';
import { removeEmptyBlocks } from '@/lib/edit/empty-shape-cleanup';
import { removeUnplayableMedia } from '@/lib/edit/unplayable-media';
import { slideEmphasisToHtml, stripEmphasis } from '@/lib/edit/markdown-emphasis';
import { localizeLectureElements } from './lecture-language';
import { localizeWidgetHtml } from './widget-language';
import { algorithmCourseQuiz } from './quiz-review';
import { isAlgorithmCourse } from '@/lib/eduplus/course-intent';
import { courseExampleRule } from '@/lib/eduplus/course-example';
import { reviewSlideTeaching } from '../teaching-text-review';
import { slideTextIntegrity } from '../slide-text-integrity';
import { prepareSlideFormulas } from '../slide-formulas';
import { localizeWidgetSpec } from '../widget-display';
import { contentLanguage } from '@/lib/eduplus/content-language';
import { assertDisplayLanguage, translateTexts } from '../../course-translation';
import {
  cleanLectureElements,
  lectureKeyPoints,
  LECTURE_CONTENT_RULES,
} from '@/lib/eduplus/lecture-content';
import type {
  GeneratedInteractiveContent,
  GeneratedQuizContent,
  GeneratedSlideContent,
} from '@/lib/types/generation';
import {
  ensureRunnableWidget,
  outlineWithDesign,
  planSimulationDesign,
  generateNativeGame,
} from './widget-reliability';
import { fallbackLanguage, renderSimulationWidget } from '../widget-fallback';
import { inlineTailwind } from '../widget-tailwind';
import { smokeTestWidget } from '../widget-smoke-test';
import { applyNativeTheme } from '../widget-theme';
import { STEP_DEADLINES_MS } from '../run/deadline';
import {
  applyOutlineFallbacks,
  generateSceneContent as generateContent,
  buildVisionUserContent,
  extractWidgetConfig,
  partitionImagesForVision,
} from '@openmaic/generation';
import type { WidgetConfig } from '@/lib/types/widgets';
import type { AgentInfo } from '@openmaic/generation';
import type {
  SceneOutline,
  PdfImage,
  ImageMapping,
  UserRequirements,
} from '@/lib/types/generation';
import { resolveVocationalActive } from '@/lib/config/feature-flags';
import { MAX_VISION_IMAGES } from '@/lib/constants/generation';
import { sortDocumentImagesForVision } from '@/lib/document/bundle';
import { generatePBLV2Project } from '@/lib/pbl/v2/agents/planner';

import {
  StepRefusal,
  type OwnerStepContext,
  type StepLanguageModel,
  type VisionPromptImage,
} from './context';

/**
 * Aggregate budget for the WHOLE resolve-with-refill phase, reused from the
 * shared 15 s ingest-drain constant (the same constant the extraction cache's
 * probe phase reuses). Each probe is an unbounded server-side store round trip
 * (no statement timeout), so an all-fail phase must not churn every candidate
 * sequentially: when the budget expires the phase STOPS and generation
 * proceeds with whatever resolved so far (degrade, never fail).
 */
const VISION_RESOLUTION_BUDGET_MS = 15_000;

/**
 * Consecutive-failure fuse for the resolve-with-refill loop: after this many
 * unresolvable/errored candidates IN A ROW the store is evidently down, so
 * probing stops instead of churning the remaining candidates (one summary warn
 * names the fuse). A resolved candidate resets the streak.
 */
const MAX_CONSECUTIVE_UNRESOLVABLE_VISION_IMAGES = 3;

export interface SceneContentInput {
  outline: SceneOutline;
  /** Every page of the course (this one included), for cross-page coherence. */
  allOutlines?: SceneOutline[];
  pdfImages?: PdfImage[];
  imageMapping?: ImageMapping;
  agents?: AgentInfo[];
  languageDirective?: string;
  requirements?: UserRequirements;
  /** The learner's locale, when known. */
  targetLanguage?: string;
  /** The model of the outline type's scene-content stage. */
  model: StepLanguageModel;
  /** Independent local editorial reviewer; never supplies assessed answers. */
  reviewModel?: StepLanguageModel;
}

export type SceneContentRefusal = 'generation-failed';

export type GeneratedSceneContent = NonNullable<Awaited<ReturnType<typeof generateContent>>>;

export interface SceneContentResult {
  content: GeneratedSceneContent;
  /** The outline as generated, after the fallbacks for what it leaves out. */
  effectiveOutline: SceneOutline;
}

/** Correctness and coherence rules for every topic's slides and quizzes. */
function accuracyRules(languageDirective?: string): string {
  const zh = !languageDirective || /中文/.test(languageDirective);
  return zh
    ? '内容正确性约束：每句表述必须符合学科事实，不夸大、不以偏概全；比较多个对象时，所述区别必须对每个对象都成立，否则写明适用范围；有联系的过程说明它们如何衔接（物质、能量或数据如何传递），不要说成彼此转化。句子完整通顺，不留半句。公式用纯文本 Unicode 书写（如 H₂O、x²、→），不要输出 LaTeX 命令或 $ 符号。每条要点单独成段（一个 <p> 一条），不要用换行符把多条要点挤进同一段。版式：正文字号不小于 18px，标题不小于 28px；每页最多 5 条要点，内容多时精简措辞而不是缩小字号；带底色的卡片形状必须完整包住它承载的文字（文字框位于卡片内部），不要放没有文字的空卡片。'
    : 'Accuracy rules: every statement must be factually correct for the subject, without overgeneralising; when comparing several items, a stated difference must hold for each of them, otherwise state its scope; for linked processes explain how they connect (what matter, energy or data passes between them) instead of saying they turn into each other. Write complete sentences. Write formulas as plain Unicode text (H₂O, x², →), never LaTeX commands or $ signs. Put each bullet in its own paragraph (one <p> per point), never several points joined by line breaks in one paragraph. Layout: body text at least 18px, titles at least 28px; at most 5 bullets per slide - shorten the wording instead of shrinking the font; a filled card shape must fully enclose the text it carries (the text box lies inside the card), and never leave an empty card.';
}

/** The rest of the course plan, so a page covers its own focus and not its neighbours'. */
function coursePlan(all: SceneOutline[] | undefined, current: SceneOutline): string {
  if (!all || all.length < 2) return '';
  const lines = all
    .filter((item) => item.id !== current.id)
    .slice(0, 20)
    .map(
      (item) =>
        `- ${item.title}${item.keyPoints?.length ? `: ${item.keyPoints.slice(0, 3).join('; ')}` : ''}`,
    );
  return `Other pages of this course (cover only this page's own focus; do not repeat what these pages teach):\n${lines.join('\n')}`;
}

export async function generateSceneContent(
  input: SceneContentInput,
  ctx: OwnerStepContext,
): Promise<SceneContentResult> {
  const { pdfImages, imageMapping, agents, languageDirective, requirements } = input;
  // Only algorithm/programming classrooms use the EduPlus additions (lecture
  // rules, planned simulator designs, quiz review with a computed question);
  // every other topic is generated as in native OpenMAIC.
  const algorithmCourse = isAlgorithmCourse(requirements?.requirement ?? '');
  const {
    model: languageModel,
    modelInfo,
    modelString,
    thinkingConfig,
    serverManaged,
  } = input.model;
  const { log } = ctx;
  const startedAt = Date.now();
  const outline: SceneOutline = { ...input.outline };

  // Detect vision capability
  const hasVision = !!modelInfo?.capabilities?.vision;

  // Vision-aware AI call function. On a server-backed transport the
  // `imageMapping` values are allocated asset ids; the N3 pre-resolution
  // below has already resolved the vision slice's ids to bytes and stripped
  // every unresolvable id from the mapping, so the srcs this closure sees
  // are concrete data URLs and this resolution is a DEFENSIVE NO-OP — it
  // passes concrete srcs through untouched (RFC #1153 part 2 B) and would
  // only drop an id that still carried an allocated id, which the
  // pre-resolution makes impossible. Kept so a package consumer that
  // generates without pre-resolving still degrades cleanly.
  const aiCall = async (
    systemPrompt: string,
    userPrompt: string,
    images?: Array<{ id: string; src: string }>,
    /** An extra, narrower budget for this call (widget repair). */
    extraSignal?: AbortSignal,
    /** Review/translation has its own JSON contract; do not add slide HTML rules. */
    plain = false,
  ): Promise<string> => {
    const abortSignal = extraSignal
      ? ctx.signal
        ? AbortSignal.any([ctx.signal, extraSignal])
        : extraSignal
      : ctx.signal;
    if (!plain && algorithmCourse && outline.type === 'slide')
      systemPrompt += '\n\n' + LECTURE_CONTENT_RULES;
    if (!plain && outline.type === 'slide')
      systemPrompt +=
        '\n\nTeaching completeness: write the actual explanation, reasoning, concrete example or formula, not a list of topics to be explained later. For each key point include its meaning or mechanism, not just its name. Never use placeholders such as "formula here" or "equation display" as lesson content. State the assumptions and variant when a formula or conclusion is not universal. Keep introductory agenda labels distinct from the subject itself.';
    if (!plain && (outline.type === 'slide' || outline.type === 'quiz')) {
      systemPrompt += '\n\n' + accuracyRules(languageDirective);
      systemPrompt += courseExampleRule(requirements?.requirement);
      const others = coursePlan(input.allOutlines, outline);
      if (others) userPrompt += '\n\n' + others;
    }
    if (!plain && !algorithmCourse && outline.type === 'quiz')
      systemPrompt +=
        '\n\n检测题质量约束：先独立推导每道题的答案。单选题恰好一个正确选项，其余选项必须明确错误、不能与正确选项同义或同样成立；若有多个选项成立，改为多选题并标出全部正确答案。题干给出解题所需的全部条件；答案与解析一致，解析说明依据。';
    if (!plain && algorithmCourse && outline.type === 'quiz')
      systemPrompt +=
        '\n\n检测题质量约束：只考查当前课程的核心概念、推理、计算过程与应用，不考查平台格式、JSON 字段或操作界面。题干必须显式给出解题所依赖的条件、算法变体与输入约定；不能把某一种实现的前提、遍历顺序或结论说成所有情形都必须如此。先独立推导答案并核对所有选项与解析；单选恰有一个正确选项，只有一个正确选项时不得标成多选。解析说明推理依据，不能只复述选项。';
    if (!plain && languageDirective) {
      systemPrompt += `\n\n课程语言约束：${languageDirective}。严格保持原始教学需求的含义。`;
      userPrompt = `${languageDirective}\n\n${userPrompt}`;
    }
    if (images?.length && hasVision) {
      // Server-backed transport: `imageMapping` values are allocated asset
      // ids, so the image srcs reach here as ids. Resolve them to the same
      // bytes the base64 path would send BEFORE prompt assembly, keeping the
      // vision prompt byte-identical in both modes (RFC #1153 part 2 B).
      const resolvedImages = await ctx.resolveVisionImages(images);
      const result = await callLLM(
        {
          model: languageModel,
          temperature: plain ? 0 : undefined,
          // A run cancels the call when it loses its lease or its course.
          abortSignal,
          system: systemPrompt,
          messages: [
            {
              role: 'user' as const,
              content: buildVisionUserContent(userPrompt, resolvedImages),
            },
          ],
          maxOutputTokens: modelInfo?.outputWindow,
          maxRetries: 0,
        },
        'scene-content',
        undefined,
        thinkingConfig,
        { serverManaged },
      );
      return result.text;
    }
    const result = await callLLM(
      {
        model: languageModel,
        temperature: plain ? 0 : undefined,
        abortSignal,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: modelInfo?.outputWindow,
        maxRetries: 0,
      },
      'scene-content',
      undefined,
      thinkingConfig,
      { serverManaged },
    );
    return result.text;
  };

  // ── Apply fallbacks ──
  const vocationalActive = resolveVocationalActive(requirements);
  const effectiveOutline = applyOutlineFallbacks(outline, !!languageModel, {
    allowProceduralSkill: vocationalActive,
  });

  // ── Filter images assigned to this outline ──
  let assignedImages: PdfImage[] | undefined;
  if (
    pdfImages &&
    pdfImages.length > 0 &&
    effectiveOutline.suggestedImageIds &&
    effectiveOutline.suggestedImageIds.length > 0
  ) {
    const suggestedIds = new Set(effectiveOutline.suggestedImageIds);
    assignedImages = sortDocumentImagesForVision(
      pdfImages.filter((img) => suggestedIds.has(img.id)),
    );
  }

  // ── N3: resolve-then-slice the vision candidates BEFORE prompt assembly ──
  // The prompt text and the multimodal attachments must be built from the
  // SAME resolved set: an image the server cannot resolve (a reclaimed
  // asset, a store failure) is dropped from BOTH — its `[see attached]`
  // text mention and its attachment — instead of leaving a dangling promise
  // in the prompt. The candidates are computed in the generator's OWN order
  // (the shared `partitionImagesForVision` helper, so the step and the
  // generator cannot drift) and resolved IN ORDER with refill until the cap
  // is met or the candidates are exhausted: a drop admits the next image
  // WITH its resolution, so the generator's re-slice (same helper, same
  // cap) can never admit an image this step has not resolved (review P2).
  // Every id the resolution drops is STRIPPED from the `imageMapping` (and
  // `assignedImages`) passed onward, so a model-hallucinated reference to a
  // dropped id takes the existing clean "no mapping → remove element" path
  // in `resolveImageIds` instead of writing a dangling allocated id into
  // `src` (review P3). The resolved slice is passed to the generator so
  // `aiCall` does not re-resolve (its resolution is a defensive no-op).
  let visionImageMapping: ImageMapping | undefined = imageMapping;
  let resolvedVisionImages: VisionPromptImage[] | undefined;
  if (assignedImages && assignedImages.length > 0 && hasVision && imageMapping) {
    const { withSrc } = partitionImagesForVision(assignedImages, imageMapping, MAX_VISION_IMAGES);
    // Bound the resolve-with-refill loop (review P2, round 3): the store may
    // be down, and each probe is an unbounded server-side round trip, so an
    // all-fail phase must not churn every candidate (and emit a warn per
    // candidate) until the route's 300 s platform cap. Two stops, both
    // degrading to "whatever resolved so far" — never failing the step:
    // (a) an aggregate budget for the WHOLE phase (the shared 15 s ingest
    // constant, raced against each probe so even ONE hanging probe cannot
    // outlive it) and (b) a consecutive-failure fuse (3 unresolvable/errored
    // candidates in a row → stop). When a stop fires, every candidate that
    // did not resolve — unresolvable OR unprobed — is STRIPPED from the
    // mapping, so the generator can never hand an unresolved allocated id to
    // the defensive aiCall resolution (which would re-open the unbounded
    // probe the stop just closed); ONE summary warn names the stop.
    let phaseTimer: ReturnType<typeof setTimeout> | undefined;
    const phaseBudget = new Promise<'__vision-resolution-budget-expired__'>((resolve) => {
      phaseTimer = setTimeout(
        () => resolve('__vision-resolution-budget-expired__'),
        VISION_RESOLUTION_BUDGET_MS,
      );
    });
    const resolvedById = new Map<string, VisionPromptImage>();
    let consecutiveUnresolvable = 0;
    let stopReason: 'fuse' | 'budget' | null = null;
    for (const candidate of withSrc) {
      if (resolvedById.size >= MAX_VISION_IMAGES) break;
      if (consecutiveUnresolvable >= MAX_CONSECUTIVE_UNRESOLVABLE_VISION_IMAGES) {
        stopReason = 'fuse';
        break;
      }
      let attempted: VisionPromptImage[] | '__vision-resolution-budget-expired__';
      try {
        attempted = await Promise.race([
          ctx.resolveVisionImages([
            {
              id: candidate.id,
              src: imageMapping[candidate.id],
              ...(candidate.width !== undefined ? { width: candidate.width } : {}),
              ...(candidate.height !== undefined ? { height: candidate.height } : {}),
            },
          ]),
          phaseBudget,
        ]);
      } catch (error) {
        // A throwing probe counts as an unresolvable candidate (an errored
        // store must degrade, never fail the step).
        log.error(
          `Vision image resolution probe for "${candidate.id}" failed; treating it as unresolvable:`,
          error,
        );
        attempted = [];
      }
      if (attempted === '__vision-resolution-budget-expired__') {
        stopReason = 'budget';
        break;
      }
      if (attempted.length === 1) {
        resolvedById.set(attempted[0]!.id, attempted[0]!);
        consecutiveUnresolvable = 0;
      } else {
        consecutiveUnresolvable += 1;
      }
    }
    if (phaseTimer !== undefined) clearTimeout(phaseTimer);
    resolvedVisionImages = [...resolvedById.values()];
    // Every candidate that did not resolve — an unresolvable probe, OR an
    // unprobed one when the fuse/budget stopped the phase — is stripped from
    // the mapping and the assigned set, so the generator's re-slice (same
    // helper, same cap) can never admit an image this step has not resolved
    // (possibly all of them = text-only generation).
    const droppedIds = new Set(
      withSrc
        .filter((candidate) => !resolvedById.has(candidate.id))
        .map((candidate) => candidate.id),
    );
    if (droppedIds.size > 0) {
      assignedImages = assignedImages.filter((img) => !droppedIds.has(img.id));
      visionImageMapping = Object.fromEntries(
        Object.entries(imageMapping).filter(([id]) => !droppedIds.has(id)),
      );
    }
    if (stopReason !== null) {
      log.warn(
        `Stopped probing vision image candidates early: the ${
          stopReason === 'fuse'
            ? `consecutive-failure fuse (${MAX_CONSECUTIVE_UNRESOLVABLE_VISION_IMAGES} unresolvable in a row)`
            : `${VISION_RESOLUTION_BUDGET_MS}ms aggregate resolution budget`
        } fired; proceeding to generation with ${resolvedById.size} resolved image(s) and the rest dropped to text-only (degrade, not fail).`,
      );
    }
  }

  // ── Media generation is handled client-side in parallel (media-orchestrator.ts) ──
  // The content generator receives placeholder IDs (gen_img_1, gen_vid_1) as-is.
  // resolveImageIds() in generation-pipeline.ts will keep these placeholders in elements.
  const generatedMediaMapping: ImageMapping = {};

  // ── Generate content ──
  log.info(
    `Generating content: "${effectiveOutline.title}" (${effectiveOutline.type}) [model=${modelString}]`,
  );

  const generationOptions: Parameters<typeof generateContent>[2] = {
    logger: log,
    assignedImages,
    imageMapping: visionImageMapping,
    visionEnabled: hasVision,
    generatedMediaMapping,
    resolvedVisionImages,
    agents,
    languageDirective,
    targetLanguage: input.targetLanguage || undefined,
    userRequirements: requirements,
    allowProceduralSkill: vocationalActive,
    ...(effectiveOutline.type === 'pbl'
      ? {
          pblLoopFallback: (plannerInput) =>
            generatePBLV2Project(
              plannerInput,
              languageModel,
              callLLM,
              { logger: log },
              thinkingConfig,
            ),
        }
      : {}),
  };
  const widgetDeadline = startedAt + STEP_DEADLINES_MS.sceneContent - 15_000;
  // A small local model cannot design a topic-specific simulation from scratch;
  // plan its parameters and formulas first, then let the native template build it.
  // Every simulator page is planned first (parameters, formulas, a graph that
  // visibly reacts to the sliders) and rendered by the tested platform page in
  // the native look; the native template writes the page only when no usable
  // design comes back. Reported: native pages for ordinary topics that did not
  // react or fell back to a "我理解了" checklist.
  const plannedDesign =
    effectiveOutline.type === 'interactive' && effectiveOutline.widgetType === 'simulation'
      ? await planSimulationDesign({
          outline: effectiveOutline,
          aiCall: (system, user, signal) => aiCall(system, user, undefined, signal),
          log,
          languageDirective,
          deadlineAt: widgetDeadline,
        })
      : null;
  const design = plannedDesign
    ? await localizeWidgetSpec(plannedDesign, languageDirective, (system, prompt) =>
        aiCall(system, prompt, undefined, AbortSignal.timeout(90_000), true),
      )
    : null;
  const designLanguage = fallbackLanguage(
    languageDirective,
    `${effectiveOutline.title} ${effectiveOutline.description ?? ''}`,
  );
  const nativeOutline = design
    ? outlineWithDesign(effectiveOutline, design, designLanguage)
    : effectiveOutline;
  const generationStartedAt = Date.now();
  // With a usable design the platform renders the page itself: a small local
  // model's hand-written page is less reliable and less polished than the
  // tested renderer. Without one, the native template writes the page.
  let content = design
    ? ({
        html: renderSimulationWidget(
          design,
          designLanguage,
          effectiveOutline.title,
          contentLanguage(languageDirective),
        ),
        widgetType: 'simulation',
      } as GeneratedInteractiveContent)
    : effectiveOutline.type === 'interactive' && effectiveOutline.widgetType === 'game'
      ? await generateNativeGame({
          content: null,
          outline: nativeOutline,
          aiCall: (system, user, signal) => aiCall(system, user, undefined, signal),
          log,
          languageDirective,
          deadlineAt: widgetDeadline,
        })
      : await generateContent(nativeOutline, aiCall, generationOptions);
  if (design && content && 'html' in content)
    content = {
      ...content,
      widgetConfig: extractWidgetConfig(content.html, 'simulation') as WidgetConfig | undefined,
    };
  // Model-written widgets must run and stay on topic: repair or replace them.
  if (effectiveOutline.type === 'interactive' && effectiveOutline.widgetType !== 'code') {
    content = await ensureRunnableWidget({
      content: content && 'html' in content ? (content as GeneratedInteractiveContent) : null,
      outline: nativeOutline,
      design,
      aiCall: (system, user, signal) => aiCall(system, user, undefined, signal),
      log,
      languageDirective,
      // Stay inside this attempt's step budget; leave room for the result to save.
      deadlineAt: widgetDeadline,
      generationMs: Date.now() - generationStartedAt,
      regenerate: async (signal) => {
        const again = await generateContent(
          nativeOutline,
          (system, user, images) => aiCall(system, user, images, signal),
          generationOptions,
        );
        return again && 'html' in again ? (again as GeneratedInteractiveContent) : null;
      },
    });
    // Offline: compile the native template's Tailwind classes into the page,
    // then give unstyled elements the platform's look (appearance only).
    if (content && 'html' in content && typeof content.html === 'string')
      content = { ...content, html: applyNativeTheme(await inlineTailwind(content.html)) };
    // Model-written controls follow the course language (a platform-built page
    // is already written in it). Never fails the page: kept as built on error.
    if (
      content &&
      'html' in content &&
      typeof content.html === 'string' &&
      !content.html.includes('data-maic-platform')
    ) {
      try {
        const html = await localizeWidgetHtml(content.html, languageDirective, (system, prompt) =>
          aiCall(system, prompt, undefined, AbortSignal.timeout(90_000)),
        );
        if (html !== content.html) {
          const check = await smokeTestWidget(html, effectiveOutline.widgetType);
          if (check.inconclusive || check.errors.length)
            throw new Error(
              `Translated widget did not pass runtime verification: ${check.errors.join(' | ')}`,
            );
          content = { ...content, html };
        }
      } catch (error) {
        log.warn(`Widget language correction failed for "${effectiveOutline.title}":`, error);
      }
    }
  }
  // Every quiz gets an independent answer check (kept as written when the check
  // cannot finish); a maintained algorithm also gets one computed question.
  if (
    effectiveOutline.type === 'quiz' &&
    content &&
    'questions' in content &&
    content.questions.length
  ) {
    // The check stays inside this step's time budget; when time runs out the
    // questions are kept as written rather than the page failing.
    const reviewSignal = AbortSignal.timeout(
      Math.max(1, startedAt + STEP_DEADLINES_MS.sceneContent - 30_000 - Date.now()),
    );
    content = await algorithmCourseQuiz(
      content as GeneratedQuizContent,
      effectiveOutline,
      requirements?.requirement ?? effectiveOutline.description,
      languageDirective,
      (system, prompt) => aiCall(system, prompt, undefined, reviewSignal, true),
      log,
    );
  }
  // Quiz text is shown as plain text: Markdown bold would show its asterisks.
  if (content && 'questions' in content) {
    const strip = (value: unknown): unknown =>
      typeof value === 'string'
        ? stripEmphasis(value)
        : Array.isArray(value)
          ? value.map(strip)
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, strip(v)]))
            : value;
    content = strip(content) as typeof content;
    if (languageDirective) {
      const quiz = content as GeneratedQuizContent;
      const texts = quiz.questions
        .flatMap((question) => [
          question.question,
          question.analysis ?? '',
          ...(question.options ?? []).map((option) => option.label),
        ])
        .filter((text): text is string => typeof text === 'string' && !!text.trim());
      const map = await translateTexts(texts, languageDirective, (system, prompt) =>
        aiCall(system, prompt, undefined, AbortSignal.timeout(90_000), true),
      );
      const questions = quiz.questions.map((question) => {
        const options = question.options?.map((option) => ({
          ...option,
          label: map.get(option.label) ?? option.label,
        }));
        if (
          options &&
          new Set(options.map((option) => option.label.trim())).size !== options.length
        )
          throw new Error('Question translation merged distinct answer choices');
        return {
          ...question,
          question: map.get(question.question) ?? question.question,
          analysis: map.get(question.analysis ?? '') ?? question.analysis,
          ...(options ? { options } : {}),
        };
      });
      assertDisplayLanguage(
        questions.flatMap((question) => [
          question.question,
          question.analysis ?? '',
          ...(question.options ?? []).map((option) => option.label),
        ]),
        languageDirective,
      );
      content = { ...quiz, questions };
    }
  }
  if (effectiveOutline.type === 'slide' && content) {
    let slide = content as GeneratedSlideContent;
    const integrity = slideTextIntegrity(slide.elements, effectiveOutline);
    if (integrity) {
      log.warn(`Regenerating damaged slide "${effectiveOutline.title}": ${integrity}`);
      const regenerated = await generateContent(
        {
          ...nativeOutline,
          description: `${nativeOutline.description}\nRepair the previous draft: ${integrity}. Preserve the exact subject and teach the planned key points with complete, meaningful sentences. Do not invent substitute terminology.`,
        },
        aiCall,
        generationOptions,
      );
      if (
        !regenerated ||
        !('elements' in regenerated) ||
        slideTextIntegrity(regenerated.elements, effectiveOutline)
      )
        throw new Error(
          `Slide text integrity failed for "${effectiveOutline.title}"; retry this scene.`,
        );
      slide = regenerated as GeneratedSlideContent;
    }
    const cleaned = cleanLectureElements(
      // A video or generated image nobody planned stays an empty black frame.
      slideEmphasisToHtml(
        removeUnplayableMedia(
          recoverSlideText(
            await prepareSlideFormulas(slide.elements, languageDirective, (system, prompt) =>
              aiCall(system, prompt, undefined, AbortSignal.timeout(90_000), true),
            ),
          ),
          effectiveOutline.mediaGenerations ?? [],
        ),
      ),
      lectureKeyPoints(effectiveOutline.keyPoints ?? []),
    );
    // Language correction improves a slide but must never fail it: a small
    // local model may answer with malformed JSON or alter a number. Try twice,
    // then keep the slide as written.
    let elements = cleaned;
    const localizeSignal = AbortSignal.timeout(
      Math.max(1, startedAt + STEP_DEADLINES_MS.sceneContent - 30_000 - Date.now()),
    );
    for (let attempt = 1; attempt <= 2 && !localizeSignal.aborted; attempt += 1) {
      try {
        elements = await localizeLectureElements(cleaned, languageDirective, (system, prompt) =>
          aiCall(system, prompt, undefined, localizeSignal, true),
        );
        break;
      } catch (error) {
        log.warn(
          `Slide language correction failed for "${effectiveOutline.title}" (attempt ${attempt}); keeping the original text:`,
          error,
        );
      }
    }
    const layout = (items: typeof elements) => layoutReadableSlide(removeEmptyBlocks(items));
    // The slide text is the model's, in the course language (corrected above);
    // nothing after the language correction rewrites it.
    let laidOut = layout(elements);
    // One bounded review of the actual page, not just more generation rules.
    // Overcrowded pages are edited before layout rather than repeatedly shrunk.
    const reviewMs = Math.min(
      60_000,
      startedAt + STEP_DEADLINES_MS.sceneContent - 20_000 - Date.now(),
    );
    if (elements.some((e) => e.type === 'text') && reviewMs >= 15_000) {
      try {
        const reviewed = await reviewSlideTeaching(
          elements,
          {
            title: effectiveOutline.title,
            requirement: requirements?.requirement,
            language: languageDirective,
            compact: hasUnreadableSlide(laidOut),
          },
          async (system, prompt) => {
            const reviewer = input.reviewModel;
            const timeout = AbortSignal.timeout(reviewMs);
            if (!reviewer) return aiCall(system, prompt, undefined, timeout, true);
            const reply = await callLLM(
              {
                model: reviewer.model,
                temperature: 0,
                system,
                prompt,
                abortSignal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
                maxOutputTokens: Math.min(4096, reviewer.modelInfo?.outputWindow ?? 4096),
                maxRetries: 0,
              },
              'scene-content',
              undefined,
              reviewer.thinkingConfig,
              { serverManaged: reviewer.serverManaged },
            );
            return reply.text;
          },
        );
        const candidate = layout(reviewed);
        if (!hasUnreadableSlide(candidate) || hasUnreadableSlide(laidOut)) laidOut = candidate;
      } catch (error) {
        log.warn(`Teaching text review was unavailable for "${effectiveOutline.title}":`, error);
      }
    }
    if (hasUnreadableSlide(laidOut))
      log.warn(`Slide "${effectiveOutline.title}" still exceeds the readable layout capacity.`);
    content = { ...slide, elements: laidOut };
  }

  if (!content) {
    log.error(`Failed to generate content for: "${effectiveOutline.title}"`);

    throw new StepRefusal<SceneContentRefusal>(
      'generation-failed',
      `Failed to generate content: ${effectiveOutline.title}`,
    );
  }

  log.info(`Content generated successfully: "${effectiveOutline.title}"`);
  return {
    content,
    effectiveOutline: describeActualPage(effectiveOutline, content),
  };
}

/**
 * The teacher's lines for an interactive page are written from its outline.
 * When the platform built the page from a design (or replaced a broken one),
 * the outline may still describe controls the page does not have (reported:
 * the teacher asks for an interaction the simulator does not offer). Describe
 * the page that was actually built: its sliders and what they change.
 */
function describeActualPage(outline: SceneOutline, content: unknown): SceneOutline {
  if (outline.type !== 'interactive' || !content || typeof content !== 'object') return outline;
  const html = (content as { html?: unknown }).html;
  if (typeof html !== 'string' || !html.includes('data-maic-platform')) return outline;
  const config = (content as { widgetConfig?: { variables?: unknown; description?: unknown } })
    .widgetConfig;
  const variables = Array.isArray(config?.variables)
    ? (config.variables as Array<{ label?: unknown; min?: unknown; max?: unknown; unit?: unknown }>)
    : [];
  if (!variables.length) return outline;
  const english = !/[\u4e00-\u9fff]/.test(
    `${outline.title}${variables.map((v) => v.label).join('')}`,
  );
  const sliders = variables
    .map(
      (v) =>
        `${String(v.label ?? '')}（${String(v.min ?? '')}–${String(v.max ?? '')}${v.unit ? ` ${String(v.unit)}` : ''}）`,
    )
    .join(english ? '; ' : '、');
  const page = english
    ? `The page actually shows: sliders for ${sliders}, live values and a graph that changes as the sliders move. Ask learners only for these interactions.`
    : `本页实际的交互：可拖动的滑块有 ${sliders}，页面实时显示计算结果，图像随滑块变化。讲解时只引导学生做这些操作。`;
  return {
    ...outline,
    description: `${typeof config?.description === 'string' ? config.description + '\n' : ''}${page}`,
  };
}

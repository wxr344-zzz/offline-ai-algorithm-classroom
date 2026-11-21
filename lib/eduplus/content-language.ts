import { localizedUi } from './localized-ui';

/**
 * The language a classroom's own content is taught in. It is the learner's
 * choice recorded on the stage (`languageDirective`, written from the
 * generation locale), not the app's UI language: an English course opened in
 * a Chinese UI still shows English inside its scenes, and the reverse.
 */
export type ContentLanguage =
  | 'zh-CN'
  | 'zh-TW'
  | 'en'
  | 'ar-SA'
  | 'de-DE'
  | 'es-MX'
  | 'fr-FR'
  | 'ja-JP'
  | 'ko-KR'
  | 'pt-BR'
  | 'ru-RU'
  | 'vi-VN';

export const COURSE_LOCALES = [
  'ar-SA',
  'de-DE',
  'es-MX',
  'fr-FR',
  'ja-JP',
  'ko-KR',
  'pt-BR',
  'ru-RU',
  'vi-VN',
] as const;
export function courseLanguageName(language: string): string {
  return (
    (
      {
        'zh-CN': 'Simplified Chinese',
        'zh-TW': 'Traditional Chinese (Taiwan)',
        en: 'English',
        'ar-SA': 'Arabic',
        'de-DE': 'German',
        'es-MX': 'Spanish (Mexico)',
        'fr-FR': 'French',
        'ja-JP': 'Japanese',
        'ko-KR': 'Korean',
        'pt-BR': 'Portuguese (Brazil)',
        'ru-RU': 'Russian',
        'vi-VN': 'Vietnamese',
      } as Record<string, string>
    )[language] ?? language
  );
}
export function normalizedContentLocale(locale: string): ContentLanguage {
  if (/^zh-(TW|HK|MO|Hant)/i.test(locale)) return 'zh-TW';
  if (/^zh/i.test(locale)) return 'zh-CN';
  return (
    COURSE_LOCALES.find((value) => value.slice(0, 2) === locale.slice(0, 2).toLowerCase()) ?? 'en'
  );
}

export function contentLanguage(directive?: string | null, uiLocale?: string): ContentLanguage {
  const text = directive ?? '';
  const explicitLocale = text.match(/locale\s+([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)/i)?.[1];
  if (explicitLocale) return normalizedContentLocale(explicitLocale);
  if (/繁體中文|zh-(?:TW|HK|MO|Hant)/i.test(text)) return 'zh-TW';
  if (/简体中文|中文|locale\s+zh\b|locale\s+zh-/i.test(text)) return 'zh-CN';
  const locale = text.match(/locale\s+([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)/)?.[1];
  if (locale) return normalizedContentLocale(locale);
  if (text.trim()) return /[一-鿿]/.test(text) ? 'zh-CN' : 'en';
  if (uiLocale && /^zh-(?:TW|HK|MO|Hant)/i.test(uiLocale)) return 'zh-TW';
  if (uiLocale && /^zh/i.test(uiLocale)) return 'zh-CN';
  return uiLocale ? normalizedContentLocale(uiLocale) : 'zh-CN';
}

/** BCP-47 tag sent to services that render teaching text. */
export function contentLanguageTag(language: ContentLanguage): string {
  return language === 'en' ? 'en-US' : language;
}

export function isChineseContent(language: ContentLanguage): boolean {
  return language === 'zh-CN' || language === 'zh-TW';
}

/** Script consistency guard; it is not a proof of Latin-language correctness. */
export function hasForeignProseScript(text: string, language: ContentLanguage): boolean {
  const prose = text.replace(/```[\s\S]*?```|`[^`]*`/g, '');
  return (
    (!isChineseContent(language) && language !== 'ja-JP' && /[\u3400-\u9fff]/.test(prose)) ||
    (language !== 'ja-JP' && /[\u3040-\u30ff]/.test(prose)) ||
    (language !== 'ko-KR' && /[\uac00-\ud7af]/.test(prose)) ||
    (language !== 'ru-RU' && /[\u0400-\u052f]/.test(prose)) ||
    (language !== 'ar-SA' && /[\u0600-\u06ff]/.test(prose))
  );
}

const SIMULATOR = {
  'zh-CN': {
    gameSuffix: '：执行顺序挑战',
    demoSuffix: '：算法推演',
    gameIntro: '根据算法规则，把下面打乱的执行步骤按真实顺序排好；完成后可在推演页逐步核对。',
    demoIntro:
      '逐步查看真实计算快照。紫色表示当前操作，橙色表示依赖单元，绿色边框表示本步数值变化。',
    editInput: '修改算法与输入',
    topic: '算法主题',
    catalog: '算法目录',
    dynamicOption: '按算法主题动态生成',
    dynamicTag: '（动态）',
    input: '输入（JSON）',
    inputAria: '模拟器输入',
    apply: '应用输入并重新计算',
    loading: '正在匹配算法或生成实现，并执行沙箱校验；首次生成可能需要数分钟…',
    verified: (n: number) => `动态执行已校验 ${n} 组输入，逐行快照已复算一致。`,
    previous: '上一步',
    next: '下一步',
    autoplay: '自动演示',
    pause: '暂停',
    restart: '重新开始',
    stepAria: '推演步骤',
    result: '计算结果',
    gameHeading: (n: number) => `按当前示例的真实执行顺序排列前 ${n} 步`,
    sampleInput: '示例输入：',
    gameHint: '每张卡给出具体操作与数据，点击卡片加入作答区。',
    answerArea: (a: number, b: number) => `作答区（${a} / ${b}）`,
    answerEmpty: '点击上方卡片，按执行顺序依次加入。',
    pass: '通过：顺序与真实执行一致。',
    fail: '未通过：请根据具体数据变化核对顺序。',
    check: '检查顺序',
    undo: '撤回一步',
    pruned: '剪枝 · 未访问',
    emptySequence: '空序列',
    outOfBounds: '（边界外）',
    rowColumn: '行＼列',
    empty: '空',
    requestFailed: '推演服务请求失败',
    loadFailed: '载入失败',
    runFailed: '推演失败',
    inputObject: '输入须为 JSON 对象。',
  },
  'zh-TW': {
    gameSuffix: '：執行順序挑戰',
    demoSuffix: '：演算法推演',
    gameIntro: '依照演算法規則，把下面打亂的執行步驟按真實順序排好；完成後可在推演頁逐步核對。',
    demoIntro:
      '逐步檢視真實計算快照。紫色表示目前操作，橙色表示依賴單元，綠色邊框表示本步數值變化。',
    editInput: '修改演算法與輸入',
    topic: '演算法主題',
    catalog: '演算法目錄',
    dynamicOption: '依演算法主題動態產生',
    dynamicTag: '（動態）',
    input: '輸入（JSON）',
    inputAria: '模擬器輸入',
    apply: '套用輸入並重新計算',
    loading: '正在比對演算法或產生實作，並執行沙箱校驗；首次產生可能需要數分鐘…',
    verified: (n: number) => `動態執行已校驗 ${n} 組輸入，逐行快照已重新計算一致。`,
    previous: '上一步',
    next: '下一步',
    autoplay: '自動演示',
    pause: '暫停',
    restart: '重新開始',
    stepAria: '推演步驟',
    result: '計算結果',
    gameHeading: (n: number) => `按目前範例的真實執行順序排列前 ${n} 步`,
    sampleInput: '範例輸入：',
    gameHint: '每張卡給出具體操作與資料，點擊卡片加入作答區。',
    answerArea: (a: number, b: number) => `作答區（${a} / ${b}）`,
    answerEmpty: '點擊上方卡片，按執行順序依次加入。',
    pass: '通過：順序與真實執行一致。',
    fail: '未通過：請依具體資料變化核對順序。',
    check: '檢查順序',
    undo: '撤回一步',
    pruned: '剪枝 · 未造訪',
    emptySequence: '空序列',
    outOfBounds: '（邊界外）',
    rowColumn: '列＼行',
    empty: '空',
    requestFailed: '推演服務請求失敗',
    loadFailed: '載入失敗',
    runFailed: '推演失敗',
    inputObject: '輸入須為 JSON 物件。',
  },
  en: {
    gameSuffix: ': execution order challenge',
    demoSuffix: ': step-by-step run',
    gameIntro:
      'Put the shuffled execution steps below into their real order using the algorithm rules; afterwards you can check them step by step in the run.',
    demoIntro:
      'Step through real computation snapshots. Purple marks the current operation, orange the cells it depends on, and a green border the values changed in this step.',
    editInput: 'Change algorithm and input',
    topic: 'Algorithm topic',
    catalog: 'Algorithm catalog',
    dynamicOption: 'Generate from the topic',
    dynamicTag: ' (dynamic)',
    input: 'Input (JSON)',
    inputAria: 'Simulator input',
    apply: 'Apply input and recompute',
    loading:
      'Matching the algorithm or generating an implementation and checking it in the sandbox; the first run can take a few minutes…',
    verified: (n: number) =>
      `Dynamic execution checked on ${n} inputs; every snapshot was recomputed and matches.`,
    previous: 'Previous',
    next: 'Next',
    autoplay: 'Auto play',
    pause: 'Pause',
    restart: 'Restart',
    stepAria: 'Step',
    result: 'Result',
    gameHeading: (n: number) => `Order the first ${n} steps as they really run on this example`,
    sampleInput: 'Example input: ',
    gameHint:
      'Each card shows a concrete operation and its data. Click a card to add it to your answer.',
    answerArea: (a: number, b: number) => `Your answer (${a} / ${b})`,
    answerEmpty: 'Click the cards above in execution order.',
    pass: 'Correct: the order matches the real execution.',
    fail: 'Not yet: compare the order with how the data changes.',
    check: 'Check order',
    undo: 'Undo',
    pruned: 'pruned · not visited',
    emptySequence: 'Empty sequence',
    outOfBounds: ' (out of bounds)',
    rowColumn: 'row \\ col',
    empty: 'empty',
    requestFailed: 'The simulation service could not complete the request',
    loadFailed: 'Could not load the simulator',
    runFailed: 'The run failed',
    inputObject: 'The input must be a JSON object.',
  },
} as const;

export type SimulatorText = (typeof SIMULATOR)['en'];

export function simulatorText(language: ContentLanguage): SimulatorText {
  const native = SIMULATOR[language as keyof typeof SIMULATOR];
  return (native ?? localizedUi(SIMULATOR.en, language)) as unknown as SimulatorText;
}

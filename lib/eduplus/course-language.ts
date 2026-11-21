import { courseLanguageName, normalizedContentLocale } from './content-language';

/** The learner's locale is authoritative; a model cannot change the course language. */
export function courseLanguage(locale?: string, requirement = ''): string {
  if (locale && /^zh-(?:TW|HK|MO|Hant)(?:-|$)/i.test(locale))
    return '全課程使用繁體中文：標題、教學內容、題目、選項、解析、教師學生姓名與角色介紹、課堂對白、互動按鈕和回饋均為繁體中文。程式碼識別字及必要技術術語可保留英文。';
  if (locale?.startsWith('zh') || (!locale && /[\u4e00-\u9fff]/.test(requirement)))
    return '全课程使用简体中文：标题、教学内容、题目、选项、解析、教师学生姓名与角色介绍、课堂对白、互动按钮和反馈均为简体中文。代码标识符及必要技术术语可保留英文。';
  return locale
    ? `Teach the entire course in ${courseLanguageName(normalizedContentLocale(locale))} (locale ${locale}), including titles, questions, feedback, agent names and personas. All learner-facing prose must use this language.`
    : '';
}

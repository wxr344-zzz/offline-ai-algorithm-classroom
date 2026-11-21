import { it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/lib/eduplus/use-course-language', () => ({ useCourseLanguage: () => 'en' }));
import { ExamSimulator } from '@/components/eduplus/exam-simulator';
it('renders english controls', () => {
  const html = renderToStaticMarkup(createElement(ExamSimulator, { reference: { topic: 'Bubble Sort' } }));
  console.log('HTML', html.slice(0, 900));
  expect(html).not.toMatch(/[一-鿿]/);
});

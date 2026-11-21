'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useCourseLanguage } from '@/lib/eduplus/use-course-language';

export function NotebookExport({
  courseId,
  sceneType,
  hasLab = false,
}: {
  courseId: string;
  sceneType: 'guided-lab' | 'oj-lab';
  hasLab?: boolean;
}) {
  const en = useCourseLanguage() === 'en';
  const failed = en ? 'Notebook download failed' : 'Notebook 下载失败';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function download(source: 'template' | 'draft' = 'template') {
    setPending(true);
    setError('');
    try {
      const response = await fetch(
        `/api/eduplus/courses/${encodeURIComponent(courseId)}/notebook?sceneType=${sceneType}&source=${source}`,
      );
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message ?? failed);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `eduplus-${sceneType}${source === 'draft' ? '-draft' : ''}.ipynb`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failed);
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => download()}
        className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
      >
        {pending ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {pending
          ? en
            ? 'Exporting…'
            : '正在导出…'
          : en
            ? 'Download the student notebook'
            : '下载学生版 Notebook'}
      </button>
      {hasLab && (
        <button
          type="button"
          disabled={pending}
          onClick={() => download('draft')}
          className="ml-3 inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
        >
          <Download size={16} /> {en ? 'Download saved answers' : '下载已保存作答'}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

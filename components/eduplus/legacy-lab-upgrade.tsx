'use client';
import { useEffect, useRef, useState } from 'react';

/** Old generated editors are replaced through an owner-checked migration, never patched with eval. */
export function LegacyLabUpgrade({ stageId }: { stageId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function upgrade() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/eduplus/stages/${encodeURIComponent(stageId)}/integrate`, {
        method: 'POST',
        signal: abort.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? '修复失败，请重试。');
      if (result.changed || result.ready) window.location.reload();
      else setError('课程内容已更新，请刷新页面后重试。');
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : '修复失败');
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="h-full overflow-auto rounded-lg bg-background p-6 text-foreground">
      <h2 className="text-lg font-semibold">升级课程内嵌实验室</h2>
      <p className="my-4">
        这门已保存课程仍使用模型生成的旧 Python
        编辑器，其模块依赖不能可靠运行。升级后将在当前课程里加入 Guided Lab、OJ
        Lab、模拟器、游戏和复盘，保留原有讲解与测验。
      </p>
      <button
        className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        disabled={busy}
        onClick={upgrade}
      >
        {busy ? '正在生成并整合实验，请稍候…' : '修复并嵌入当前课程'}
      </button>
      {error && (
        <p role="alert" className="mt-4 text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export function ClassroomLaunch({ courseId, mayLeave }: { courseId: string; mayLeave(): boolean }) {
  const [pending, setPending] = useState(false);
  const [url, setURL] = useState('');
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function prepare() {
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError('');
    try {
      const response = await fetch(
        `/api/eduplus/courses/${encodeURIComponent(courseId)}/classroom`,
        { method: 'POST', signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? '创建原生课堂失败。');
      if (!controller.signal.aborted) setURL(`/classroom/${encodeURIComponent(data.stageId)}`);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '创建失败。');
    } finally {
      if (active.current === controller) setPending(false);
    }
  }
  return (
    <div className="rounded-lg border p-4">
      <p className="mb-3 text-sm">
        将课程接入原生课堂，补齐讲解、示例观察、概念测验与学习复盘。已有课堂会直接复用。
      </p>
      {url ? (
        <Link
          href={url}
          onClick={(event) => {
            if (!mayLeave()) event.preventDefault();
          }}
          className="rounded-lg bg-primary px-4 py-2 text-sm text-white"
        >
          打开原生课堂
        </Link>
      ) : (
        <button
          onClick={prepare}
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? '正在准备课堂…' : '接入原生课堂'}
        </button>
      )}
      {pending && (
        <button
          className="ml-3 text-sm underline"
          onClick={() => {
            active.current?.abort();
            setPending(false);
          }}
        >
          取消
        </button>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

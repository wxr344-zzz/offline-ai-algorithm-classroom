'use client';

export default function EduplusError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">课程页面暂时无法显示</h1>
      <p className="my-4">请重试；已保存的课程仍可重新读取。</p>
      <button onClick={reset} className="rounded-lg border px-4 py-2">
        重新加载
      </button>
    </main>
  );
}

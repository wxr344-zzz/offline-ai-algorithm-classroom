'use client';
import { useEffect, useRef, useState } from 'react';
import type { JsonValue } from '@/lib/types/eduplus.generated';
import { useCourseLanguage } from '@/lib/eduplus/use-course-language';

/** Observes public input only. Does not invent intermediate algorithm states or execute solutions. */
export function InputVisualization({ inputs }: { inputs: Record<string, JsonValue> }) {
  const english = useCourseLanguage() === 'en';
  const canvas = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const numeric = Object.entries(inputs).find(
    ([, value]) =>
      Array.isArray(value) &&
      value.every((item) => typeof item === 'number' && Number.isFinite(item)),
  );
  const values = numeric ? (numeric[1] as number[]).slice(0, 40) : [];
  const signature = JSON.stringify(values);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const data: number[] = JSON.parse(signature);
    const draw = () => {
      const width = Math.max(280, node.clientWidth);
      const height = 180;
      const ratio = window.devicePixelRatio || 1;
      node.width = Math.round(width * ratio);
      node.height = Math.round(height * ratio);
      const context = node.getContext('2d');
      if (!context) return;
      context.scale(ratio, ratio);
      context.clearRect(0, 0, width, height);
      context.fillStyle = '#0f172a';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = '#94a3b8';
      context.beginPath();
      context.moveTo(18, 90);
      context.lineTo(width - 18, 90);
      context.stroke();
      context.font = '12px sans-serif';
      context.textAlign = 'center';
      if (!data.length) {
        context.fillStyle = '#e2e8f0';
        context.fillText(english ? 'Empty list: no elements' : '空列表：没有元素', width / 2, 60);
        return;
      }
      const maximum = Math.max(1, ...data.map(Math.abs));
      const gap = (width - 40) / data.length;
      data.forEach((value, index) => {
        const length = (value / maximum) * 58;
        const x = 20 + index * gap;
        context.fillStyle = selected === index ? '#a78bfa' : value < 0 ? '#fb923c' : '#38bdf8';
        context.fillRect(
          x + 2,
          value >= 0 ? 90 - length : 90,
          Math.max(1, gap - 4),
          Math.max(2, Math.abs(length)),
        );
        context.fillStyle = '#e2e8f0';
        if (data.length <= 12)
          context.fillText(
            String(value),
            x + gap / 2,
            value >= 0 ? 82 - length : 106 + Math.abs(length),
          );
        context.fillText(String(index), x + gap / 2, 170);
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(node);
    return () => observer.disconnect();
  }, [signature, selected, english]);
  if (!numeric) return null;
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <h2 className="text-sm font-medium">
        {english
          ? `Input list ${numeric[0]}: element values`
          : `输入列表 ${numeric[0]}：元素分布`}
      </h2>
      <canvas
        ref={canvas}
        aria-label={english ? 'Bar chart of the public input list' : '公开输入列表的数值柱状图'}
        role="img"
        className="h-[180px] w-full rounded-lg"
      />
      <div className="flex flex-wrap gap-2">
        {values.map((value, index) => (
          <button
            key={index}
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
            className="rounded border px-2 py-1 text-xs"
          >
            [{index}] = {value}
          </button>
        ))}
      </div>
      {(numeric[1] as number[]).length > 40 && (
        <p className="text-xs text-muted-foreground">
          {english
            ? 'Only the first 40 elements are shown; the full input is above.'
            : '仅显示前 40 个元素，完整输入见上方数据。'}
        </p>
      )}
    </section>
  );
}

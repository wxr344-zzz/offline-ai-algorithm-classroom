'use client';
import { Component, type ReactNode } from 'react';
import { useCourseLanguage } from '@/lib/eduplus/use-course-language';

function LabFailure({ onRetry }: { onRetry(): void }) {
  const en = useCourseLanguage() === 'en';
  return (
    <div role="alert" className="rounded-lg border p-4">
      <p>
        {en
          ? 'The Lab failed to load; the course content and downloads still work.'
          : '实验组件加载失败，课程内容和下载功能仍可使用。'}
      </p>
      <button className="mt-2 underline" onClick={onRetry}>
        {en ? 'Reload the Lab' : '重新加载实验组件'}
      </button>
    </div>
  );
}

export class LabBoundary extends Component<
  { children: ReactNode; className?: string },
  { failed: boolean; retry: number }
> {
  state = { failed: false, retry: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error('[eduplus-lab]', error.name);
  }
  render() {
    if (this.state.failed)
      return (
        <LabFailure
          onRetry={() => this.setState(({ retry }) => ({ failed: false, retry: retry + 1 }))}
        />
      );
    return (
      <div key={this.state.retry} className={this.props.className}>
        {this.props.children}
      </div>
    );
  }
}

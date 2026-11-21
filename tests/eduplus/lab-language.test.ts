import { describe, expect, it } from 'vitest';
import { requestedNonPythonLanguage } from '@/lib/eduplus/lab-language';

describe('languages the Python Lab does not run', () => {
  it.each([
    ['用 C++ 实现快速排序', 'C++'],
    ['讲解Java中的快速排序', 'Java'],
    ['C语言实现链表', 'C'],
    ['JavaScript 闭包', 'JavaScript'],
    ['用C#写冒泡排序', 'C#'],
    ['Implement Dijkstra in Rust', 'Rust'],
  ])('%s → %s', (text, name) => {
    expect(requestedNonPythonLanguage(text)).toBe(name);
  });
  it.each([
    '讲解快速排序',
    '用 Python 实现冒泡排序',
    'Dijkstra 最短路径',
    '讲解B+树的分裂与合并',
    'ABC 分类法',
  ])('%s → none', (text) => {
    expect(requestedNonPythonLanguage(text)).toBeNull();
  });
});

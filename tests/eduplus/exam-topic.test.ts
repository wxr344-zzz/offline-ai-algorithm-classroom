import { describe, expect, it } from 'vitest';
import catalog from '@/lib/eduplus/exam-simulator-catalog.json';
import { isExamAlgorithmTopic, resolveExamAlgorithm } from '@/lib/eduplus/exam-topic';

describe('course routing shares Python textbook normalization', () => {
  it.each([
    ['Please explain the Depth-First Search (DFS) algorithm for me.', 'dfs'],
    ['Please explain the Breadth-First Search (BFS) algorithm for me.', 'bfs'],
    ['breadth first search', 'bfs'],
    ['depth first search', 'dfs'],
  ])('%s uses its maintained graph executor', (topic, key) => {
    expect(resolveExamAlgorithm(topic)).toBe(key);
  });
  it.each([
    [
      'Please explain the basic operations of linked lists, including node insertion and deletion.',
      'linked-list',
    ],
    ['singly linked lists', 'linked-list'],
    ['doubly linked lists', 'doubly-linked'],
    ['circular linked list', 'circular-linked'],
  ])('%s keeps the maintained linked-list executor', (topic, key) => {
    expect(resolveExamAlgorithm(topic)).toBe(key);
  });
  it('does not absorb linked-list variants outside the maintained catalog', () => {
    expect(resolveExamAlgorithm('persistent linked list')).toBeNull();
    expect(resolveExamAlgorithm('doubly circular linked lists')).toBeNull();
  });
  it.each(catalog)('$id retains every registered name in course requirements', (profile) => {
    for (const name of [profile.id, profile.title, ...profile.aliases])
      expect(isExamAlgorithmTopic(`请为我讲解 ${name}，并提供实验`)).toBe(true);
  });
  it.each(['朴素模式匹配算法', '朴素字符串模式匹配', 'ＫＭＰ模式匹配', 'Ｂ＋树分裂与合并'])(
    '%s uses existing execution metadata',
    (topic) => expect(isExamAlgorithmTopic(topic)).toBe(true),
  );
  it('keeps unknown algorithms eligible for dynamic generation', () => {
    expect(isExamAlgorithmTopic('K-Means聚类')).toBe(false);
    for (const topic of ['primality testing', 'list intersection', 'quickselect', 'shellshock'])
      expect(isExamAlgorithmTopic(topic)).toBe(false);
  });
});

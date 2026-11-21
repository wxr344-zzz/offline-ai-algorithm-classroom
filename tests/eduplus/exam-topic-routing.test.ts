import { describe, expect, it } from 'vitest';
import expected from '@/tests/fixtures/exam-topic-resolutions.json';
import { resolveExamAlgorithm } from '@/lib/eduplus/exam-topic';

// Fixture written by exam_simulator.catalog_snapshot from the Python resolver:
// the app routes a request to the maintained simulator exactly when Python
// can run that algorithm (otherwise the page would generate code on screen).
describe('maintained-algorithm routing agrees with the Python registry', () => {
  it.each(Object.entries(expected))('%s → %s', (topic, id) => {
    expect(resolveExamAlgorithm(topic)).toBe(id);
  });
});

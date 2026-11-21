import { beforeEach, describe, expect, it, vi } from 'vitest';
import generated from '@/tests/fixtures/eduplus-generated.json';
import fixture from '@/contracts/examples/public-lab.json';
import { EduplusCourseStore, rekeyEduplusCourses } from '@/lib/persistence/eduplus-courses';
import { parseGeneratedCourse, parsePublicCourse } from '@/lib/server/eduplus-agent-client';
import { fenceOwnerWrite } from '@/lib/persistence/owner-merges';

vi.mock('@/lib/persistence/owner-merges', () => ({ fenceOwnerWrite: vi.fn(async () => {}) }));
type Provider = ConstructorParameters<typeof EduplusCourseStore>[0];
const query = vi.fn();
const provider: Provider = {
  pool: { query: query as Provider['pool']['query'] },
  withTransaction: async (body) => body({ query: query as Provider['pool']['query'] }),
};
beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
  vi.mocked(fenceOwnerWrite).mockClear();
});

describe('EduPlus immutable course snapshots', () => {
  it('atomically stores public and private data under the server-resolved owner', async () => {
    const course = await new EduplusCourseStore(provider).save(
      'owner-a',
      parseGeneratedCourse(generated),
    );
    expect(course).toEqual(parsePublicCourse(fixture));
    expect(fenceOwnerWrite).toHaveBeenCalledWith(expect.anything(), 'owner-a', fixture.courseId);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toMatch(/^INSERT/);
    expect(sql).not.toContain('ON CONFLICT');
    expect(values.slice(0, 2)).toEqual([fixture.courseId, 'owner-a']);
    expect(values[2]).not.toContain('HIDDEN_CASE_SENTINEL');
    expect(values[3]).toContain('HIDDEN_CASE_SENTINEL');
  });
  it('propagates failed transactions and refuses overwrite conflicts', async () => {
    query.mockRejectedValueOnce(new Error('duplicate course ID'));
    await expect(
      new EduplusCourseStore(provider).save('owner-a', parseGeneratedCourse(generated)),
    ).rejects.toThrow('duplicate');
  });
  it('never selects private data and binds owner in the read predicate', async () => {
    expect(await new EduplusCourseStore(provider).get('other-owner', fixture.courseId)).toBeNull();
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('owner_id = $2');
    expect(sql).not.toContain('private_data');
    expect(values).toEqual([fixture.courseId, 'other-owner']);
  });
  it('returns only validated public courses', async () => {
    query.mockResolvedValueOnce({ rows: [{ public_data: fixture }] });
    expect(await new EduplusCourseStore(provider).get('owner-a', fixture.courseId)).toEqual(
      parsePublicCourse(fixture),
    );
  });
  it('rekeys course ownership when anonymous work is claimed', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ present: true }] })
      .mockResolvedValueOnce({ rows: [{ course_id: 'one' }, { course_id: 'two' }] });
    expect(await rekeyEduplusCourses(provider.pool, 'anonymous-owner', 'account-owner')).toBe(2);
    expect(query.mock.calls[1][1]).toEqual(['anonymous-owner', 'account-owner']);
  });
  it('skips a table not yet provisioned when claiming an owner', async () => {
    query.mockResolvedValueOnce({ rows: [{ present: false }] });
    expect(await rekeyEduplusCourses(provider.pool, 'from', 'to')).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

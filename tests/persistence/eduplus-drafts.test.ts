import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '@/contracts/examples/public-lab.json';
import { EDUPLUS_COURSE_MIGRATIONS, EduplusCourseStore } from '@/lib/persistence/eduplus-courses';
import type { PracticeEventInput } from '@/lib/types/eduplus-learning';

vi.mock('@/lib/persistence/owner-merges', () => ({ fenceOwnerWrite: vi.fn(async () => {}) }));
type Provider = ConstructorParameters<typeof EduplusCourseStore>[0];
const db = new PGlite();
const provider: Provider = {
  pool: db as unknown as Provider['pool'],
  withTransaction: (body) => db.transaction((tx) => body(tx as unknown as Provider['pool'])),
};
const store = new EduplusCourseStore(provider);
const scene = fixture.scenes[0];
const input = {
  code: 'class Solution: pass',
  revision: 0,
  problemVersion: scene.problem.problemVersion,
};
beforeAll(async () => {
  for (const migration of EDUPLUS_COURSE_MIGRATIONS.migrations) {
    if (typeof migration.up === 'string') await db.exec(migration.up);
    else throw new Error('This fixture expects SQL migrations.');
  }
}, 30000);
beforeEach(async () => {
  await db.exec('TRUNCATE eduplus_courses CASCADE');
  await db.query(
    'INSERT INTO eduplus_courses(course_id, owner_id, public_data, private_data) VALUES ($1,$2,$3,$4)',
    [
      fixture.courseId,
      'owner-a',
      JSON.stringify(fixture),
      JSON.stringify({ course_id: fixture.courseId }),
    ],
  );
});
afterAll(async () => {
  await db.close();
});

describe('owner-scoped versioned student drafts with real PostgreSQL semantics', () => {
  it('starts with the scaffold and saves subsequent revisions', async () => {
    expect(await store.getDraft('owner-a', fixture.courseId, scene.sceneId)).toMatchObject({
      code: scene.interactiveCode,
      revision: 0,
    });
    const first = await store.saveDraft('owner-a', fixture.courseId, scene.sceneId, input);
    expect(first.revision).toBe(1);
    const second = await store.saveDraft('owner-a', fixture.courseId, scene.sceneId, {
      ...input,
      code: '# updated',
      revision: 1,
    });
    expect(second.revision).toBe(2);
    expect(await store.getDraft('owner-a', fixture.courseId, scene.sceneId)).toEqual(second);
  });
  it('refuses stale initial and subsequent writes without losing newer code', async () => {
    await store.saveDraft('owner-a', fixture.courseId, scene.sceneId, input);
    await expect(
      store.saveDraft('owner-a', fixture.courseId, scene.sceneId, input),
    ).rejects.toMatchObject({ status: 409, code: 'DRAFT_CONFLICT' });
    await store.saveDraft('owner-a', fixture.courseId, scene.sceneId, {
      ...input,
      code: '# newest',
      revision: 1,
    });
    await expect(
      store.saveDraft('owner-a', fixture.courseId, scene.sceneId, { ...input, revision: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await store.getDraft('owner-a', fixture.courseId, scene.sceneId)).code).toBe(
      '# newest',
    );
  });
  it('keeps guided and OJ drafts independent', async () => {
    await store.saveDraft('owner-a', fixture.courseId, scene.sceneId, input);
    const oj = await store.getDraft('owner-a', fixture.courseId, fixture.scenes[1].sceneId);
    expect(oj.revision).toBe(0);
    expect(oj.code).toBe(fixture.scenes[1].interactiveCode);
  });
  it('rejects other owners, unrelated scenes, and wrong versions', async () => {
    await expect(store.getDraft('owner-b', fixture.courseId, scene.sceneId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      store.saveDraft('owner-b', fixture.courseId, scene.sceneId, input),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      store.saveDraft('owner-a', fixture.courseId, 'unrelated', input),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      store.saveDraft('owner-a', fixture.courseId, scene.sceneId, { ...input, problemVersion: 2 }),
    ).rejects.toMatchObject({ status: 409, code: 'PROBLEM_VERSION_CONFLICT' });
  });
  it('follows course ownership after a claim without leaving anonymous draft access', async () => {
    await store.saveDraft('owner-a', fixture.courseId, scene.sceneId, input);
    await db.query('UPDATE eduplus_courses SET owner_id=$1 WHERE course_id=$2', [
      'account-owner',
      fixture.courseId,
    ]);
    expect((await store.getDraft('account-owner', fixture.courseId, scene.sceneId)).code).toBe(
      input.code,
    );
    await expect(store.getDraft('owner-a', fixture.courseId, scene.sceneId)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('enforces the UTF-8 byte limit, including non-ASCII code', async () => {
    await expect(
      store.saveDraft('owner-a', fixture.courseId, scene.sceneId, {
        ...input,
        code: '中'.repeat(40000),
      }),
    ).rejects.toMatchObject({ status: 400, code: 'DRAFT_TOO_LARGE' });
  });
  it('records immutable idempotent practice facts and projects no grades', async () => {
    const event: PracticeEventInput = {
      eventId: '33333333-3333-4333-8333-333333333333',
      sceneId: scene.sceneId,
      problemVersion: input.problemVersion,
      status: 'completed',
      passed: 1,
      total: scene.problem.publicTestCases.length,
      draftRevision: null,
      message: '',
    };
    await store.recordPractice('owner-a', fixture.courseId, event);
    await store.recordPractice('owner-a', fixture.courseId, event);
    const events = await store.listPractice('owner-a', fixture.courseId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ...event, source: 'browser-practice' });
    expect(events[0]).not.toHaveProperty('grade');
    expect(await store.listPractice('owner-b', fixture.courseId)).toEqual([]);
    await expect(store.recordPractice('owner-b', fixture.courseId, event)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('refuses wrong versions, fabricated totals, and unknown draft revisions', async () => {
    const event: PracticeEventInput = {
      eventId: '44444444-4444-4444-8444-444444444444',
      sceneId: scene.sceneId,
      problemVersion: input.problemVersion,
      status: 'completed',
      passed: 0,
      total: scene.problem.publicTestCases.length,
      draftRevision: null,
      message: '',
    };
    await expect(
      store.recordPractice('owner-a', fixture.courseId, { ...event, problemVersion: 2 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      store.recordPractice('owner-a', fixture.courseId, { ...event, total: 999 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      store.recordPractice('owner-a', fixture.courseId, { ...event, draftRevision: 5 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await store.listPractice('owner-a', fixture.courseId)).toEqual([]);
  });
});

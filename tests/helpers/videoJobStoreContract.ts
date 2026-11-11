import { newVideoJobId, type NewVideoJob, type VideoJobStore } from '@/lib/video/video-job-store';

// What every VideoJobStore must do, run against the in-memory store (always) and against
// a real MongoDB (when VELLUM_TEST_MONGODB_URI is set).

const T0 = Date.UTC(2026, 0, 1);
const at = (seconds: number) => new Date(T0 + seconds * 1000);
const LATER = at(10_000);

export function newJob(overrides: Partial<NewVideoJob> = {}): NewVideoJob {
  const id = overrides.id ?? newVideoJobId();
  return {
    id,
    ownerId: 'user-1',
    guest: false,
    callerKey: `caller-${id}`,
    plan: 'Basic',
    options: { crf: 28, resolution: 'Original' },
    fileName: 'clip.mp4',
    originalSize: 1000,
    inputKey: `video-jobs/${id}/input.mp4`,
    ...overrides,
  };
}

const claim = (store: VideoJobStore, seconds: number, claimId: string, includeGuests = true, leaseSeconds = 60) =>
  store.claimNext({ now: at(seconds), leaseUntil: at(seconds + leaseSeconds), claimId, includeGuests });

const RESULT = { outputKey: 'video-jobs/x/output.mp4', outputSize: 400, outputFormat: { extension: 'mp4', contentType: 'video/mp4' }, compressed: true };

export function describeVideoJobStoreContract(name: string, makeStore: () => VideoJobStore, reset: () => Promise<void>) {
  describe(`${name}: the video job store contract`, () => {
    let store: VideoJobStore;

    beforeEach(async () => {
      await reset();
      store = makeStore();
    });

    it('creates a queued job and reads it back', async () => {
      const job = newJob({ guest: true, ownerId: 'token-hash', plan: 'Free' });
      await store.create(job, at(0));

      expect(await store.get(job.id)).toMatchObject({
        ...job,
        status: 'queued',
        attempts: 0,
        createdAt: at(0),
        outputKey: null,
        error: null,
        leaseUntil: null,
        resultExpiresAt: null,
      });
      expect(await store.get(newVideoJobId())).toBeNull();
      expect(await store.get('not-an-id')).toBeNull();
    });

    it('claims the oldest queued job first, once, and counts the attempt', async () => {
      const second = newJob();
      const first = newJob();
      await store.create(second, at(2));
      await store.create(first, at(1));

      const claimed = await claim(store, 5, 'claim-a');
      expect(claimed).toMatchObject({ id: first.id, status: 'running', attempts: 1, claimId: 'claim-a', startedAt: at(5), leaseUntil: at(65) });
      expect((await claim(store, 5, 'claim-b'))?.id).toBe(second.id);
      expect(await claim(store, 5, 'claim-c')).toBeNull();
    });

    it('skips guest jobs when guests are not allowed another slot', async () => {
      const guest = newJob({ guest: true });
      const user = newJob();
      await store.create(guest, at(1));
      await store.create(user, at(2));

      expect((await claim(store, 3, 'c1', false))?.id).toBe(user.id);
      expect(await claim(store, 3, 'c2', false)).toBeNull();
      expect((await claim(store, 3, 'c3', true))?.id).toBe(guest.id);
    });

    it('renews a lease only under the claim that holds it', async () => {
      const job = newJob();
      await store.create(job, at(0));
      await claim(store, 1, 'mine');

      expect(await store.renewLease(job.id, 'mine', at(200))).toBe(true);
      expect((await store.get(job.id))?.leaseUntil).toEqual(at(200));
      expect(await store.renewLease(job.id, 'theirs', at(300))).toBe(false);
      expect((await store.get(job.id))?.leaseUntil).toEqual(at(200));
    });

    it('finishes or fails a running job only under its claim', async () => {
      const done = newJob();
      const failed = newJob();
      await store.create(done, at(0));
      await store.create(failed, at(1));
      await claim(store, 2, 'claim-done');
      await claim(store, 2, 'claim-failed');

      expect(await store.finish(done.id, 'stale', RESULT, at(3), LATER)).toBeNull();
      expect(await store.finish(done.id, 'claim-done', RESULT, at(3), LATER)).toMatchObject({
        status: 'done', ...RESULT, finishedAt: at(3), resultExpiresAt: LATER, leaseUntil: null, claimId: null,
      });
      expect(await store.fail(failed.id, 'stale', 'Too slow', at(4), LATER)).toBeNull();
      expect(await store.fail(failed.id, 'claim-failed', 'Too slow', at(4), LATER)).toMatchObject({
        status: 'failed', error: 'Too slow', finishedAt: at(4), resultExpiresAt: LATER,
      });
      expect(await store.fail(done.id, 'claim-done', 'late', at(5), LATER)).toBeNull();
    });

    it('cancels a queued or running job, after which its worker can neither renew nor finish it', async () => {
      const queued = newJob();
      const running = newJob();
      await store.create(running, at(0));
      await store.create(queued, at(1));
      await claim(store, 2, 'claim-r');

      expect(await store.cancel(queued.id, at(3), LATER)).toMatchObject({ previousStatus: 'queued', job: { status: 'cancelled', finishedAt: at(3) } });
      expect(await store.cancel(running.id, at(3), LATER)).toMatchObject({ previousStatus: 'running', job: { status: 'cancelled' } });
      expect(await store.renewLease(running.id, 'claim-r', at(100))).toBe(false);
      expect(await store.finish(running.id, 'claim-r', RESULT, at(4), LATER)).toBeNull();
      expect(await store.cancel(running.id, at(5), LATER)).toBeNull();
      expect(await store.cancel(newVideoJobId(), at(5), LATER)).toBeNull();
      expect(await store.cancel('nope', at(5), LATER)).toBeNull();
      expect((await store.get(running.id))?.status).toBe('cancelled');
    });

    it('requeues an expired lease, and fails the job once it is out of attempts', async () => {
      const job = newJob();
      const healthy = newJob();
      await store.create(job, at(0));
      await store.create(healthy, at(1));
      await claim(store, 1, 'first', true, 10);
      await claim(store, 1, 'healthy', true, 1000);
      const expiry = { maxAttempts: 2, failMessage: 'Restarted', resultExpiresAt: LATER };

      const firstExpiry = await store.expireLeases({ now: at(20), ...expiry });
      expect(firstExpiry.requeued.map((j) => j.id)).toEqual([job.id]);
      expect(firstExpiry.failed).toEqual([]);
      expect(await store.get(job.id)).toMatchObject({ status: 'queued', attempts: 1, claimId: null, leaseUntil: null, startedAt: null });
      expect(await store.finish(job.id, 'first', RESULT, at(21), LATER)).toBeNull();

      expect(await claim(store, 30, 'second', true, 10)).toMatchObject({ id: job.id, attempts: 2 });
      const secondExpiry = await store.expireLeases({ now: at(50), ...expiry });
      expect(secondExpiry.requeued).toEqual([]);
      expect(secondExpiry.failed).toEqual([expect.objectContaining({ id: job.id, status: 'failed', error: 'Restarted', resultExpiresAt: LATER })]);
      expect((await store.get(healthy.id))?.status).toBe('running');
    });

    it('finds one active job per caller and counts the queue', async () => {
      const mine = newJob({ callerKey: 'caller-a' });
      const theirs = newJob({ callerKey: 'caller-b' });
      await store.create(mine, at(0));
      await store.create(theirs, at(1));

      expect((await store.findActiveByCaller('caller-a'))?.id).toBe(mine.id);
      expect(await store.countQueued()).toBe(2);
      expect(await store.jobsAhead((await store.get(theirs.id))!)).toBe(1);
      expect(await store.jobsAhead((await store.get(mine.id))!)).toBe(0);

      await claim(store, 2, 'c');
      expect((await store.findActiveByCaller('caller-a'))?.status).toBe('running');
      expect(await store.countQueued()).toBe(1);
      expect(await store.jobsAhead((await store.get(theirs.id))!)).toBe(0);

      await store.cancel(mine.id, at(3), LATER);
      expect(await store.findActiveByCaller('caller-a')).toBeNull();
    });

    it('lists expired results and leftover inputs until their files are forgotten', async () => {
      const job = newJob();
      await store.create(job, at(0));
      await claim(store, 1, 'c');
      await store.finish(job.id, 'c', RESULT, at(2), at(100));

      expect(await store.findExpiredResults(at(99))).toEqual([]);
      expect((await store.findExpiredResults(at(100))).map((j) => j.id)).toEqual([job.id]);
      expect((await store.findLeftoverInputs()).map((j) => j.id)).toEqual([job.id]);

      await store.forgetFiles(job.id, { input: true });
      expect(await store.findLeftoverInputs()).toEqual([]);
      await store.forgetFiles(job.id, { output: true });
      expect(await store.findExpiredResults(at(200))).toEqual([]);
      expect(await store.get(job.id)).toMatchObject({ status: 'done', inputKey: null, outputKey: null });
    });

    it('does not list the inputs of jobs still queued or running', async () => {
      await store.create(newJob(), at(0));
      await store.create(newJob(), at(1));
      await claim(store, 2, 'c');

      expect(await store.findLeftoverInputs()).toEqual([]);
    });
  });
}

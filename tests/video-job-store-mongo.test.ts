import mongoose from 'mongoose';
import { createMongoVideoJobStore, type VideoJobStore } from '@/lib/video/video-job-store';
import { VideoJobSchema } from '@/models/videoJob';
import { describeVideoJobStoreContract, newJob } from './helpers/videoJobStoreContract';

// Runs only against a real MongoDB, which CI does not have: set VELLUM_TEST_MONGODB_URI to
// a server (e.g. mongodb://localhost:27017). Each run uses a database of its own and drops
// it afterwards.
const uri = process.env.VELLUM_TEST_MONGODB_URI;

if (!uri) {
  describe('the video job store on a real MongoDB', () => {
    it.skip('is skipped: set VELLUM_TEST_MONGODB_URI to run it', () => {});
  });
} else {
  jest.setTimeout(60_000);

  const dbName = `vellum_video_jobs_test_${process.pid}_${Date.now()}`;
  // Two connections, each with its own pool, stand in for two worker processes.
  const connections = [mongoose.createConnection(uri, { dbName }), mongoose.createConnection(uri, { dbName })];
  const models = connections.map((connection) => connection.model('VideoJob', VideoJobSchema));
  const stores = models.map((model) =>
    createMongoVideoJobStore({ model, connect: async () => model.db.asPromise() }),
  );

  beforeAll(async () => {
    await Promise.all(connections.map((connection) => connection.asPromise()));
    await models[0].init();
  });

  afterAll(async () => {
    await connections[0].dropDatabase();
    await Promise.all(connections.map((connection) => connection.close()));
  });

  describeVideoJobStoreContract('MongoDB store', () => stores[0], async () => {
    await models[0].deleteMany({});
  });

  describe('the MongoDB video job store under concurrent workers', () => {
    const now = new Date(Date.UTC(2026, 0, 1));
    const lease = (seconds: number) => new Date(now.getTime() + seconds * 1000);

    beforeEach(async () => {
      await models[0].deleteMany({});
    });

    async function claimAll(store: VideoJobStore, worker: string): Promise<string[]> {
      const claimed: string[] = [];
      for (let i = 0; ; i++) {
        const job = await store.claimNext({ now, leaseUntil: lease(60), claimId: `${worker}-${i}`, includeGuests: true });
        if (!job) return claimed;
        claimed.push(job.id);
      }
    }

    it('never lets two workers claim the same job', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 60; i++) {
        const job = newJob();
        ids.push(job.id);
        await stores[0].create(job, new Date(now.getTime() + i));
      }

      const [a, b, c, d] = await Promise.all([
        claimAll(stores[0], 'a'),
        claimAll(stores[1], 'b'),
        claimAll(stores[0], 'c'),
        claimAll(stores[1], 'd'),
      ]);
      const claimed = [...a, ...b, ...c, ...d];

      expect(claimed.sort()).toEqual([...ids].sort());
      expect(new Set(claimed).size).toBe(ids.length);
      const rows = await models[0].find({}).lean<{ status: string; attempts: number }[]>();
      expect(rows.every((row) => row.status === 'running' && row.attempts === 1)).toBe(true);
    });

    it('requeues each expired lease once when two workers expire leases at the same moment', async () => {
      const jobs = Array.from({ length: 20 }, () => newJob());
      for (const [i, job] of jobs.entries()) await stores[0].create(job, new Date(now.getTime() + i));
      await claimAll(stores[0], 'dead');

      const expiry = { now: lease(61), maxAttempts: 2, failMessage: 'Restarted', resultExpiresAt: lease(100_000) };
      const outcomes = await Promise.all([stores[0].expireLeases(expiry), stores[1].expireLeases(expiry)]);
      const requeued = outcomes.flatMap((outcome) => outcome.requeued.map((job) => job.id));

      expect(requeued.sort()).toEqual(jobs.map((job) => job.id).sort());
      expect(await stores[1].countQueued()).toBe(jobs.length);

      const reclaimed = await Promise.all([claimAll(stores[0], 'x'), claimAll(stores[1], 'y')]);
      expect(reclaimed.flat().sort()).toEqual(jobs.map((job) => job.id).sort());
      const rows = await models[0].find({}).lean<{ attempts: number }[]>();
      expect(rows.every((row) => row.attempts === 2)).toBe(true);
    });

    it('lets only the worker holding the claim finish a job that was taken over', async () => {
      const job = newJob();
      await stores[0].create(job, now);
      await stores[0].claimNext({ now, leaseUntil: lease(10), claimId: 'old', includeGuests: true });
      await stores[1].expireLeases({ now: lease(11), maxAttempts: 2, failMessage: 'x', resultExpiresAt: lease(1000) });
      await stores[1].claimNext({ now: lease(12), leaseUntil: lease(72), claimId: 'new', includeGuests: true });

      const result = { outputKey: 'k', outputSize: 1, outputFormat: { extension: 'mp4', contentType: 'video/mp4' }, compressed: true };
      const [late, current] = await Promise.all([
        stores[0].finish(job.id, 'old', result, lease(13), lease(1000)),
        stores[1].finish(job.id, 'new', result, lease(13), lease(1000)),
      ]);

      expect(late).toBeNull();
      expect(current).toMatchObject({ status: 'done', attempts: 2 });
    });

    it('creates the indexes the claim, the caller lookup and the row expiry use', async () => {
      const indexes = await models[0].collection.indexes();
      const keys = indexes.map((index) => JSON.stringify(index.key));

      expect(keys).toEqual(
        expect.arrayContaining([
          JSON.stringify({ status: 1, createdAt: 1, _id: 1 }),
          JSON.stringify({ callerKey: 1, status: 1 }),
          JSON.stringify({ resultExpiresAt: 1 }),
        ]),
      );
      expect(indexes.find((index) => JSON.stringify(index.key) === JSON.stringify({ resultExpiresAt: 1 }))?.expireAfterSeconds).toBe(86_400);
    });
  });
}

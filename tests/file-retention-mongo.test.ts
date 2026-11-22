import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { LocalDiskStorage } from '@/lib/storage/local';

// The index change and the flows around it on a real MongoDB, with a database that has the
// indexes from before #158. It runs only with VELLUM_TEST_MONGODB_URI set, like
// video-job-store-mongo.test.ts, and uses databases of its own, dropped afterwards.

const uri = process.env.VELLUM_TEST_MONGODB_URI;

let mockStorage: LocalDiskStorage;

jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/auth/jwt', () => ({ getAuthUserId: jest.fn(() => Promise.resolve('507f1f77bcf86cd799439011')) }));
jest.mock('next/headers', () => ({ cookies: async () => ({ delete: () => undefined }) }));
jest.mock('@/lib/storage', () => ({ getStorage: () => mockStorage, LocalDiskStorage: class {} }));

import Conversion from '@/models/conversion';
import User from '@/models/user';
import UserDocument from '@/models/userDocument';
import VideoJobModel from '@/models/videoJob';
import { ensurePlainExpiryIndex } from '@/lib/db/expiry-index';
import { sweepExpiredFiles } from '@/lib/retention-sweep';
import { usedStorageBytes } from '@/lib/storage-usage';
import { createMongoVideoJobStore, newVideoJobId } from '@/lib/video/video-job-store';
import { GET as listDocuments } from '../app/api/documents/route';
import { DELETE as deleteAccount } from '../app/api/user/delete/route';
import { newJob } from './helpers/videoJobStoreContract';

if (!uri) {
  describe('file retention on a real MongoDB', () => {
    it.skip('is skipped: set VELLUM_TEST_MONGODB_URI to run it', () => {});
  });
} else {
  jest.setTimeout(120_000);

  const USER = '507f1f77bcf86cd799439011';
  const HOUR_MS = 60 * 60 * 1000;
  const dbName = `vellum_retention_test_${process.pid}_${Date.now()}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-retention-mongo-test-'));
  const OLD_INDEX_COLLECTIONS = ['conversions', 'userdocuments'];

  async function createOldIndexes(db: mongoose.mongo.Db) {
    for (const name of OLD_INDEX_COLLECTIONS) {
      await db.collection(name).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    }
  }

  async function expiryIndexes(db: mongoose.mongo.Db, name: string) {
    const indexes = await db.collection(name).indexes();
    return indexes
      .filter((index) => JSON.stringify(index.key) === JSON.stringify({ expiresAt: 1 }))
      .map((index) => ({ name: index.name, expireAfterSeconds: index.expireAfterSeconds }));
  }

  const PLAIN = [{ name: 'expiresAt_1', expireAfterSeconds: undefined }];
  const stored = (key: string) => fs.existsSync(path.join(root, key));
  const row = (diskFileName: string, expiresAt: Date) => ({
    userId: USER,
    toolUsed: 'Merge PDF',
    fileName: diskFileName,
    diskFileName,
    fileSize: 10,
    mimeType: 'application/pdf',
    status: 'Completed',
    expiresAt,
  });

  beforeAll(async () => {
    mockStorage = new LocalDiskStorage(root);
    // The old indexes are there before the app connects, as on a deployed database.
    const old = await mongoose.createConnection(uri, { dbName }).asPromise();
    await createOldIndexes(old.db!);
    await old.close();
    await mongoose.connect(uri, { dbName });
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    for (const method of ['error', 'info'] as const) jest.spyOn(console, method).mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('a database with the old TTL indexes', () => {
    it('refuses the plain index by itself, so the old one has to be dropped', async () => {
      await expect(mongoose.connection.db!.collection('conversions').createIndex({ expiresAt: 1 })).rejects.toMatchObject({ code: 85 });
    });

    it('has them replaced by the first sweep, and keeps them plain', async () => {
      await sweepExpiredFiles();
      for (const name of OLD_INDEX_COLLECTIONS) expect(await expiryIndexes(mongoose.connection.db!, name)).toEqual(PLAIN);

      await sweepExpiredFiles();
      for (const name of OLD_INDEX_COLLECTIONS) expect(await expiryIndexes(mongoose.connection.db!, name)).toEqual(PLAIN);
      expect(console.error).not.toHaveBeenCalled();
    });

    it('ends plain when two processes replace them at the same moment', async () => {
      const name = `${dbName}_race`;
      const processes = await Promise.all([1, 2].map(() => mongoose.createConnection(uri, { dbName: name, autoIndex: false }).asPromise()));
      const models = processes.map((connection) => connection.model('Conversion', Conversion.schema));
      try {
        for (let round = 0; round < 10; round++) {
          await processes[0].db!.collection('conversions').dropIndexes().catch((error: { code?: number }) => {
            if (error.code !== 26) throw error;
          });
          await createOldIndexes(processes[0].db!);

          // One may lose the race and leave it to its next sweep, which is the last call here.
          const outcomes = await Promise.allSettled(models.map((model) => ensurePlainExpiryIndex(model)));
          if (outcomes.some((outcome) => outcome.status === 'rejected')) await ensurePlainExpiryIndex(models[0]);

          expect(await expiryIndexes(processes[0].db!, 'conversions')).toEqual(PLAIN);
        }
      } finally {
        await processes[0].dropDatabase();
        await Promise.all(processes.map((connection) => connection.close()));
      }
    });

    it('needs nothing on a new database', async () => {
      const fresh = await mongoose.createConnection(uri, { dbName: `${dbName}_new`, autoIndex: false, autoCreate: false }).asPromise();
      try {
        await ensurePlainExpiryIndex(fresh.model('Conversion', Conversion.schema));

        expect(await expiryIndexes(fresh.db!, 'conversions')).toEqual(PLAIN);
      } finally {
        await fresh.dropDatabase();
        await fresh.close();
      }
    });
  });

  describe('with the plain indexes', () => {
    beforeAll(async () => {
      await sweepExpiredFiles();
    });

    beforeEach(async () => {
      await Promise.all([Conversion, UserDocument, User, VideoJobModel].map((model) => model.deleteMany({})));
    });

    it('hides expired rows, and two sweeps at once delete them with their files', async () => {
      const past = new Date(Date.now() - HOUR_MS);
      const future = new Date(Date.now() + HOUR_MS);
      const names = Array.from({ length: 120 }, (_, i) => `expired-${i}.pdf`);
      await Conversion.insertMany(names.map((name) => row(name, past)));
      await UserDocument.insertMany([row('expired.pdf', past), row('live.pdf', future)]);
      for (const key of [...names, 'docs/expired.pdf', 'docs/live.pdf']) await mockStorage.put(key, Buffer.from(key));

      expect(await usedStorageBytes(USER)).toBe(10);
      const listed = await (await listDocuments(new NextRequest('http://localhost:3000/api/documents'))).json();
      expect(listed.map((document: { diskFileName: string }) => document.diskFileName)).toEqual(['live.pdf']);

      await Promise.all([sweepExpiredFiles(), sweepExpiredFiles()]);

      expect(await Conversion.countDocuments()).toBe(0);
      expect(await UserDocument.countDocuments()).toBe(1);
      expect(names.filter(stored)).toEqual([]);
      expect(stored('docs/expired.pdf')).toBe(false);
      expect(stored('docs/live.pdf')).toBe(true);
      expect(console.error).not.toHaveBeenCalled();
    });

    it('deletes an account with its files and its video jobs', async () => {
      await User.create({ _id: USER, email: 'owner@example.com' });
      await Conversion.create(row('mine.pdf', new Date(Date.now() + HOUR_MS)));
      await UserDocument.create(row('mine.pdf', new Date(Date.now() + HOUR_MS)));
      const job = newJob({ id: newVideoJobId(), ownerId: USER });
      await createMongoVideoJobStore().create(job, new Date());
      const keys = ['mine.pdf', 'docs/mine.pdf', job.inputKey!];
      for (const key of keys) await mockStorage.put(key, Buffer.from(key));

      const res = await deleteAccount(new NextRequest('http://localhost:3000/api/user/delete', { method: 'DELETE' }));

      expect(res.status).toBe(200);
      expect(await res.json()).not.toHaveProperty('filesPending');
      for (const model of [User, Conversion, UserDocument, VideoJobModel]) expect(await model.countDocuments()).toBe(0);
      expect(keys.filter(stored)).toEqual([]);
    });

    it('discards a job that is finishing at the same moment, with its output if it got there', async () => {
      const store = createMongoVideoJobStore();
      for (let round = 0; round < 20; round++) {
        const job = newJob({ id: newVideoJobId(), ownerId: USER });
        const now = new Date();
        const resultExpiresAt = new Date(now.getTime() + 24 * HOUR_MS);
        await store.create(job, now);
        await store.claimNext({ now, leaseUntil: resultExpiresAt, claimId: 'claim', includeGuests: true });
        const result = { outputKey: `video-jobs/${job.id}/output.mp4`, outputSize: 1, outputFormat: { extension: 'mp4', contentType: 'video/mp4' }, compressed: true };

        const [finished, discarded] = await Promise.all([
          store.finish(job.id, 'claim', result, now, resultExpiresAt),
          store.discardOwnerJobs(USER, now),
        ]);

        expect(discarded).toEqual([
          expect.objectContaining({
            id: job.id,
            status: finished ? 'done' : 'cancelled',
            outputKey: finished ? result.outputKey : null,
            resultExpiresAt: null,
            claimId: null,
          }),
        ]);
        await VideoJobModel.deleteMany({});
      }
    });
  });
}

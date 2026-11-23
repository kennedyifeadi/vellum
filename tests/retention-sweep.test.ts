import type { StorageDriver } from '@/lib/storage/types';
import type { MemoryModel } from './helpers/memoryModel';
import { STORAGE_DRIVERS, type DriverUnderTest } from './helpers/storageDrivers';

// The server deletes expired files itself, on every driver (#158), from instrumentation.ts.

const MINUTE_MS = 60 * 1000;
const MOST_BETWEEN_SWEEPS_MS = 15 * MINUTE_MS;

let mockStorage: StorageDriver | Error;

jest.mock('@aws-sdk/client-s3', () => jest.requireActual('./helpers/fakeS3').fakeS3Module());
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/lib/storage', () => ({
  getStorage: () => {
    if (mockStorage instanceof Error) throw mockStorage;
    return mockStorage;
  },
  LocalDiskStorage: class {},
}));
jest.mock('@/lib/video/video-job-service', () => ({ startVideoJobWorker: jest.fn() }));
jest.mock('@/models/user', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());
jest.mock('@/models/conversion', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());
jest.mock('@/models/userDocument', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());

import dbConnect from '@/lib/db/mongoose';
import Conversion from '@/models/conversion';
import UserDocument from '@/models/userDocument';
import { register } from '../instrumentation';

const conversions = Conversion as unknown as MemoryModel;
const documents = UserDocument as unknown as MemoryModel;
const connect = dbConnect as jest.Mock;

jest.setTimeout(30_000);

const runtime = process.env.NEXT_RUNTIME;
const mongoUri = process.env.MONGODB_URI;

beforeEach(() => {
  jest.useFakeTimers({ now: Date.UTC(2026, 10, 22) });
  process.env.NEXT_RUNTIME = 'nodejs';
  connect.mockReset().mockResolvedValue(true);
  conversions.reset();
  documents.reset();
  delete (globalThis as { vellumRetentionSweep?: unknown }).vellumRetentionSweep;
  for (const method of ['error', 'warn', 'info'] as const) jest.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  process.env.NEXT_RUNTIME = runtime;
  process.env.MONGODB_URI = mongoUri;
  jest.restoreAllMocks();
});

async function passOneSweep() {
  await jest.advanceTimersByTimeAsync(MOST_BETWEEN_SWEEPS_MS);
}

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * MINUTE_MS);

describe.each(STORAGE_DRIVERS)('retention on %s', (_name, createDriver) => {
  let driver: DriverUnderTest;

  beforeEach(() => {
    driver = createDriver();
    mockStorage = driver.storage;
  });

  afterEach(() => {
    driver.close();
  });

  async function seedConversion(name: string, expiresAt: Date) {
    await driver.storage.put(name, Buffer.from(name));
    conversions.seed({ diskFileName: name, expiresAt });
  }

  async function seedDocument(name: string, expiresAt: Date) {
    await driver.storage.put(`docs/${name}`, Buffer.from(name));
    documents.seed({ diskFileName: name, expiresAt });
  }

  it('deletes what expired while the server was down', async () => {
    await seedConversion('old.pdf', inMinutes(-60));
    await seedDocument('old-doc.pdf', inMinutes(-60));

    await register();
    await passOneSweep();

    expect(driver.keys()).toEqual([]);
    expect(conversions.all()).toEqual([]);
    expect(documents.all()).toEqual([]);
  });

  it('deletes a file that expires later within one sweep, and leaves live ones', async () => {
    await register();
    await jest.advanceTimersByTimeAsync(0);
    await seedConversion('soon.pdf', inMinutes(1));
    await seedDocument('soon-doc.pdf', inMinutes(1));
    await seedConversion('live.pdf', inMinutes(600));
    await seedDocument('live-doc.pdf', inMinutes(600));

    await jest.advanceTimersByTimeAsync(MINUTE_MS);
    await passOneSweep();

    expect(driver.keys()).toEqual(['docs/live-doc.pdf', 'live.pdf']);
    expect(conversions.all().map((row) => row.diskFileName)).toEqual(['live.pdf']);
    expect(documents.all().map((row) => row.diskFileName)).toEqual(['live-doc.pdf']);
  });

  it('keeps the row of a file it could not delete, and deletes both on a later sweep', async () => {
    await seedConversion('stuck.pdf', inMinutes(-1));
    await seedDocument('stuck-doc.pdf', inMinutes(-1));
    await seedConversion('fine.pdf', inMinutes(-1));
    driver.failDeleteOf('stuck.pdf');
    driver.failDeleteOf('docs/stuck-doc.pdf');

    await register();
    await passOneSweep();

    expect(driver.keys()).toEqual(['docs/stuck-doc.pdf', 'stuck.pdf']);
    expect(conversions.all()).toHaveLength(1);
    expect(documents.all()).toHaveLength(1);

    driver.allowDeletes();
    await passOneSweep();

    expect(driver.keys()).toEqual([]);
    expect(conversions.all()).toEqual([]);
    expect(documents.all()).toEqual([]);
  });

  it('gets past failing deletes to every other expired file in a backlog', async () => {
    const names = Array.from({ length: 175 }, (_, i) => `file-${String(i).padStart(3, '0')}.pdf`);
    for (const name of names) await seedConversion(name, inMinutes(-1));
    const stuck = names.slice(0, 60);
    for (const name of stuck) driver.failDeleteOf(name);

    await register();
    await jest.advanceTimersByTimeAsync(0);

    expect(driver.keys()).toEqual(stuck);
    expect(conversions.all().map((row) => row.diskFileName)).toEqual(stuck);
  });

  it('deletes a history row that has no file', async () => {
    conversions.seed({ fileName: 'found.pdf', expiresAt: inMinutes(-1) });

    await register();
    await passOneSweep();

    expect(conversions.all()).toEqual([]);
  });

  it('replaces an old TTL index before it deletes anything', async () => {
    for (const model of [conversions, documents]) {
      model.collection.seedIndex({ name: 'expiresAt_1', key: { expiresAt: 1 }, expireAfterSeconds: 0 });
    }
    await seedConversion('old.pdf', inMinutes(-1));
    let indexAtDelete: unknown;
    const realDelete = driver.storage.delete.bind(driver.storage);
    jest.spyOn(driver.storage, 'delete').mockImplementation(async (key) => {
      indexAtDelete = await conversions.collection.indexes();
      await realDelete(key);
    });

    await register();
    await passOneSweep();

    const plain = [{ name: 'expiresAt_1', key: { expiresAt: 1 } }];
    expect(indexAtDelete).toEqual(plain);
    expect(await conversions.collection.indexes()).toEqual(plain);
    expect(await documents.collection.indexes()).toEqual(plain);
  });

  it('carries on after a sweep that could not reach the database', async () => {
    await seedConversion('old.pdf', inMinutes(-1));
    connect.mockRejectedValueOnce(new Error('server selection timed out'));

    await expect(register()).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(0);
    expect(driver.has('old.pdf')).toBe(true);

    await passOneSweep();
    expect(driver.has('old.pdf')).toBe(false);
  });

  it('still deletes documents when conversions cannot be read', async () => {
    await seedDocument('old-doc.pdf', inMinutes(-1));
    jest.spyOn(conversions, 'find').mockImplementation(() => {
      throw new Error('collection unavailable');
    });

    await register();
    await passOneSweep();

    expect(driver.keys()).toEqual([]);
  });
});

describe('a server that cannot sweep', () => {
  it('still starts without storage, saying why expired files stay', async () => {
    mockStorage = new Error('No storage driver is configured.');

    await expect(register()).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith('Expired files will not be deleted: No storage driver is configured.');
  });

  it('still starts without a database, and touches none', async () => {
    delete process.env.MONGODB_URI;

    await expect(register()).resolves.toBeUndefined();
    await passOneSweep();

    expect(connect).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('Expired files will not be deleted: MONGODB_URI is not set.');
  });
});

import { NextRequest } from 'next/server';
import type { StorageDriver } from '@/lib/storage/types';
import type { MemoryModel } from './helpers/memoryModel';
import { STORAGE_DRIVERS, type DriverUnderTest } from './helpers/storageDrivers';

// A key is never forgotten before its file is deleted (#158).

let mockStorage: StorageDriver;

jest.mock('@aws-sdk/client-s3', () => jest.requireActual('./helpers/fakeS3').fakeS3Module());
jest.mock('@/lib/auth/jwt', () => ({ getAuthUserId: jest.fn(() => Promise.resolve('507f1f77bcf86cd799439011')) }));
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/storage', () => ({ getStorage: () => mockStorage, LocalDiskStorage: class {} }));
jest.mock('@/models/user', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());
jest.mock('@/models/conversion', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());
jest.mock('@/models/userDocument', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());

import Conversion from '@/models/conversion';
import UserDocument from '@/models/userDocument';
import { DELETE as deleteConversion } from '../app/api/conversions/route';
import { DELETE as deleteDocument } from '../app/api/documents/route';

const USER_ID = '507f1f77bcf86cd799439011';

const CASES = [
  { what: 'conversion', model: Conversion as unknown as MemoryModel, key: 'mine.pdf', path: '/api/conversions', remove: deleteConversion },
  { what: 'document', model: UserDocument as unknown as MemoryModel, key: 'docs/mine.pdf', path: '/api/documents', remove: deleteDocument },
];

jest.setTimeout(30_000);

describe.each(STORAGE_DRIVERS)('deleting on %s', (_name, createDriver) => {
  let driver: DriverUnderTest;

  beforeEach(() => {
    driver = createDriver();
    mockStorage = driver.storage;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    driver.close();
  });

  describe.each(CASES)('a $what', ({ model, key, path, remove }) => {
    let id: string;

    beforeEach(async () => {
      model.reset();
      id = model.seed({ userId: USER_ID, diskFileName: 'mine.pdf', expiresAt: new Date(Date.now() + 3_600_000) })._id;
      await driver.storage.put(key, Buffer.from('file'));
    });

    const send = () => remove(new NextRequest(`http://localhost:3000${path}?id=${id}`, { method: 'DELETE' }));

    it('deletes the file and the row', async () => {
      const res = await send();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(driver.has(key)).toBe(false);
      expect(model.all()).toEqual([]);
    });

    it('keeps an expired record of a file it could not delete, and says the file is pending', async () => {
      driver.failDeleteOf(key);

      const res = await send();

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ filesPending: true });
      expect(driver.has(key)).toBe(true);
      const [kept] = model.all();
      expect(kept.diskFileName).toBe('mine.pdf');
      expect(kept.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect((await send()).status).toBe(404);
    });
  });
});

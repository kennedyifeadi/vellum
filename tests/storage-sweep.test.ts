import fs from 'fs';
import os from 'os';
import path from 'path';
import { LocalDiskStorage } from '@/lib/storage/local';

let mockStorage: LocalDiskStorage;
let mockConversionRows: { diskFileName?: string }[] = [];
let mockDocumentRows: { diskFileName: string }[] = [];

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/storage', () => {
  const actual = jest.requireActual('@/lib/storage');
  return { ...actual, getStorage: () => mockStorage };
});

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {
    findById: jest.fn(() => Promise.resolve({ plan: 'Basic', preferences: { autoDelete: false } })),
  },
}));

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: {
    create: jest.fn((data: { diskFileName: string }) => {
      mockConversionRows.push({ diskFileName: data.diskFileName });
      return Promise.resolve(data);
    }),
    find: jest.fn(() => Promise.resolve(mockConversionRows)),
  },
}));

jest.mock('@/models/userDocument', () => ({
  __esModule: true,
  default: { find: jest.fn(() => Promise.resolve(mockDocumentRows)) },
}));

import { cleanupStorage, saveConversionRecord } from '@/lib/conversions';

jest.setTimeout(30_000);

const HOUR_MS = 60 * 60 * 1000;

describe('local storage sweep', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-sweep-test-'));
    mockStorage = new LocalDiskStorage(root);
    mockConversionRows = [];
    mockDocumentRows = [];
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const stored = (key: string) => fs.existsSync(path.join(root, key));

  async function putAged(key: string, ageMs: number) {
    await mockStorage.put(key, Buffer.from(key));
    const mtime = new Date(Date.now() - ageMs);
    fs.utimesSync(path.join(root, key), mtime, mtime);
  }

  it('keeps a live document when a conversion is saved and the storage swept', async () => {
    await putAged('docs/live.pdf', 2 * HOUR_MS);
    mockDocumentRows = [{ diskFileName: 'live.pdf' }];

    const conversion = await saveConversionRecord('507f1f77bcf86cd799439011', 'Merge PDF', 'merged.pdf', Buffer.from('pdf'));
    await cleanupStorage();

    expect(stored('docs/live.pdf')).toBe(true);
    expect(stored(conversion!.diskFileName)).toBe(true);
  });

  it('deletes an expired document and an orphaned conversion, keeping live ones', async () => {
    await putAged('docs/live.pdf', 2 * HOUR_MS);
    await putAged('docs/expired.pdf', 2 * HOUR_MS);
    await putAged('live.pdf', 2 * HOUR_MS);
    await putAged('orphaned.pdf', 2 * HOUR_MS);
    mockDocumentRows = [{ diskFileName: 'live.pdf' }];
    mockConversionRows = [{ diskFileName: 'live.pdf' }];

    await cleanupStorage();

    expect(stored('docs/live.pdf')).toBe(true);
    expect(stored('docs/expired.pdf')).toBe(false);
    expect(stored('live.pdf')).toBe(true);
    expect(stored('orphaned.pdf')).toBe(false);
  });

  it('keeps files just written whose rows do not exist yet', async () => {
    await mockStorage.put('docs/uploading.pdf', Buffer.from('doc'));
    await mockStorage.put('saving.pdf', Buffer.from('conversion'));

    await cleanupStorage();

    expect(stored('docs/uploading.pdf')).toBe(true);
    expect(stored('saving.pdf')).toBe(true);
  });

  it('does nothing when the storage root is empty or missing', async () => {
    await expect(cleanupStorage()).resolves.toBeUndefined();
    expect(fs.readdirSync(root)).toEqual([]);

    mockStorage = new LocalDiskStorage(path.join(root, 'missing'));
    await expect(cleanupStorage()).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(root, 'missing'))).toBe(false);
  });
});

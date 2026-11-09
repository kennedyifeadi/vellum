import fs from 'fs';
import os from 'os';
import path from 'path';
import { LocalDiskStorage, SWEEP_GRACE_MS } from '@/lib/storage/local';

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
import { videoJobInputKey, videoJobOutputKey } from '@/lib/video/video-job-worker';

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

  it('keeps an orphaned file inside the grace period and deletes one just past it', async () => {
    await putAged('docs/young.pdf', SWEEP_GRACE_MS - 60_000);
    await putAged('docs/old.pdf', SWEEP_GRACE_MS + 60_000);
    await putAged('young.pdf', SWEEP_GRACE_MS - 60_000);
    await putAged('old.pdf', SWEEP_GRACE_MS + 60_000);

    await cleanupStorage();

    expect(stored('docs/young.pdf')).toBe(true);
    expect(stored('docs/old.pdf')).toBe(false);
    expect(stored('young.pdf')).toBe(true);
    expect(stored('old.pdf')).toBe(false);
  });

  it('leaves a top-level folder it does not own alone', async () => {
    await putAged('video-jobs/job-1/output.mp4', 2 * HOUR_MS);
    await putAged('unknown/file.pdf', 2 * HOUR_MS);

    await cleanupStorage();

    expect(stored('video-jobs/job-1/output.mp4')).toBe(true);
    expect(stored('unknown/file.pdf')).toBe(true);
  });

  it("keeps Compress Video job files, however old: the job worker's own sweep deletes them", async () => {
    const jobId = '6730a1b2c3d4e5f6a7b8c9d0';
    await putAged(videoJobInputKey(jobId, '.mov'), 3 * 24 * HOUR_MS);
    await putAged(videoJobOutputKey(jobId, 'mp4'), 3 * 24 * HOUR_MS);

    await saveConversionRecord('507f1f77bcf86cd799439011', 'Merge PDF', 'merged.pdf', Buffer.from('%PDF-'));
    await cleanupStorage();

    expect(stored(`video-jobs/${jobId}/input.mov`)).toBe(true);
    expect(stored(`video-jobs/${jobId}/output.mp4`)).toBe(true);
  });

  it('does nothing when the storage root is empty or missing', async () => {
    await expect(cleanupStorage()).resolves.toBeUndefined();
    expect(fs.readdirSync(root)).toEqual([]);

    mockStorage = new LocalDiskStorage(path.join(root, 'missing'));
    await expect(cleanupStorage()).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(root, 'missing'))).toBe(false);
  });
});

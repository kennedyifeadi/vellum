import fs from 'fs';
import os from 'os';
import path from 'path';

const sendMock = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  HeadObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { LocalDiskStorage } from '@/lib/storage/local';
import { S3Storage } from '@/lib/storage/s3';

describe('LocalDiskStorage', () => {
  let root: string;
  let storage: LocalDiskStorage;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-storage-test-'));
    storage = new LocalDiskStorage(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes a buffer and reads it back, creating nested directories as needed', async () => {
    const data = Buffer.from('hello world');
    await storage.put('docs/example.pdf', data);

    expect(await storage.exists('docs/example.pdf')).toBe(true);
    expect(await storage.get('docs/example.pdf')).toEqual(data);
  });

  it('returns null from get() and false from exists() for a missing key', async () => {
    expect(await storage.get('missing.pdf')).toBeNull();
    expect(await storage.exists('missing.pdf')).toBe(false);
  });

  it('deletes a file, and is a no-op deleting a key that does not exist', async () => {
    await storage.put('file.pdf', Buffer.from('data'));
    await storage.delete('file.pdf');
    expect(await storage.exists('file.pdf')).toBe(false);

    await expect(storage.delete('file.pdf')).resolves.not.toThrow();
  });

  describe('sweepOrphaned', () => {
    it('removes files and subdirectories not present in the valid key set', async () => {
      await storage.put('active.pdf', Buffer.from('keep'));
      await storage.put('orphaned.pdf', Buffer.from('stale'));
      await storage.put('docs/nested.pdf', Buffer.from('nested'));

      await storage.sweepOrphaned(new Set(['active.pdf']));

      expect(fs.existsSync(path.join(root, 'active.pdf'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'orphaned.pdf'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'docs'))).toBe(false);
    });

    it('does nothing if the storage root does not exist yet', async () => {
      const missingRoot = path.join(root, 'does-not-exist');
      const emptyStorage = new LocalDiskStorage(missingRoot);
      await expect(emptyStorage.sweepOrphaned(new Set())).resolves.not.toThrow();
    });
  });
});

describe('S3Storage', () => {
  beforeEach(() => {
    sendMock.mockReset();
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
  });

  afterEach(() => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_REGION;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_ENDPOINT;
  });

  it('throws when required env vars are missing', () => {
    delete process.env.S3_BUCKET;
    expect(() => new S3Storage()).toThrow(/S3_BUCKET/);
  });

  it('uploads a buffer via PutObjectCommand', async () => {
    sendMock.mockResolvedValueOnce({});
    const storage = new S3Storage();

    await storage.put('file.pdf', Buffer.from('data'));

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input).toMatchObject({ Bucket: 'test-bucket', Key: 'file.pdf' });
  });

  it('returns the object body as a Buffer on get()', async () => {
    sendMock.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    });
    const storage = new S3Storage();

    expect(await storage.get('file.pdf')).toEqual(Buffer.from([1, 2, 3]));
  });

  it('returns null from get() when the object does not exist', async () => {
    sendMock.mockRejectedValueOnce({ name: 'NoSuchKey' });
    const storage = new S3Storage();

    expect(await storage.get('missing.pdf')).toBeNull();
  });

  it('propagates unexpected client failures from get()', async () => {
    sendMock.mockRejectedValueOnce(new Error('network unreachable'));
    const storage = new S3Storage();

    await expect(storage.get('file.pdf')).rejects.toThrow('network unreachable');
  });

  it('resolves exists() to true when HeadObject succeeds', async () => {
    sendMock.mockResolvedValueOnce({});
    const storage = new S3Storage();

    expect(await storage.exists('file.pdf')).toBe(true);
  });

  it('resolves exists() to false when HeadObject reports NotFound', async () => {
    sendMock.mockRejectedValueOnce({ name: 'NotFound' });
    const storage = new S3Storage();

    expect(await storage.exists('missing.pdf')).toBe(false);
  });

  it('propagates client failures from put()', async () => {
    sendMock.mockRejectedValueOnce(new Error('S3 unavailable'));
    const storage = new S3Storage();

    await expect(storage.put('file.pdf', Buffer.from('data'))).rejects.toThrow('S3 unavailable');
  });

  it('sends a DeleteObjectCommand for delete()', async () => {
    sendMock.mockResolvedValueOnce({});
    const storage = new S3Storage();

    await storage.delete('file.pdf');

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input).toMatchObject({ Bucket: 'test-bucket', Key: 'file.pdf' });
  });
});

describe('getStorage', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('defaults to LocalDiskStorage when STORAGE_DRIVER is unset', () => {
    delete process.env.STORAGE_DRIVER;

    jest.isolateModules(() => {
      const { getStorage } = require('@/lib/storage');
      const { LocalDiskStorage: FreshLocalDiskStorage } = require('@/lib/storage/local');
      expect(getStorage()).toBeInstanceOf(FreshLocalDiskStorage);
    });
  });

  it('returns S3Storage when STORAGE_DRIVER=s3 and its env vars are set', () => {
    process.env.STORAGE_DRIVER = 's3';
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';

    jest.isolateModules(() => {
      const { getStorage } = require('@/lib/storage');
      const { S3Storage: FreshS3Storage } = require('@/lib/storage/s3');
      expect(getStorage()).toBeInstanceOf(FreshS3Storage);
    });
  });
});

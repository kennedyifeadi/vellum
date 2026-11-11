import type { EventEmitter } from 'events';
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

import { LocalDiskStorage, SWEEP_GRACE_MS } from '@/lib/storage/local';
import { S3Storage } from '@/lib/storage/s3';

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

function webStreamOf(bytes: Uint8Array, onCancel = () => {}): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
    cancel: onCancel,
  });
}

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

  describe('openRead', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    function captureOpenedHandles(): fs.promises.FileHandle[] {
      const handles: fs.promises.FileHandle[] = [];
      const open = fs.promises.open;
      jest.spyOn(fs.promises, 'open').mockImplementation(async (...args: Parameters<typeof open>) => {
        const handle = await open(...args);
        handles.push(handle);
        return handle;
      });
      return handles;
    }

    // FileHandle is an EventEmitter at runtime, though @types/node 20 does not declare it.
    const closed = (handle: fs.promises.FileHandle) =>
      new Promise<void>((resolve) => (handle as unknown as EventEmitter).once('close', () => resolve()));

    it('streams a stored file with its size', async () => {
      const data = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
      data.write('start', 0);
      data.write('end', data.length - 3);
      await storage.put('docs/large.bin', data);

      const file = await storage.openRead('docs/large.bin');

      expect(file!.size).toBe(data.length);
      expect((await readAll(file!.stream)).equals(data)).toBe(true);
    });

    it('streams an empty file', async () => {
      await storage.put('empty.bin', Buffer.alloc(0));

      const file = await storage.openRead('empty.bin');

      expect(file!.size).toBe(0);
      expect((await readAll(file!.stream)).length).toBe(0);
    });

    it('returns null for a missing key', async () => {
      await expect(storage.openRead('missing.pdf')).resolves.toBeNull();
      await expect(storage.openRead('docs/missing.pdf')).resolves.toBeNull();
    });

    it('closes the file once it has been read to the end', async () => {
      const handles = captureOpenedHandles();
      await storage.put('file.bin', Buffer.from('data'));

      const file = await storage.openRead('file.bin');
      const wasClosed = closed(handles[0]);
      await readAll(file!.stream);

      await expect(wasClosed).resolves.toBeUndefined();
    });

    it('closes the file when the reader cancels part way', async () => {
      const handles = captureOpenedHandles();
      await storage.put('file.bin', Buffer.alloc(4 * 1024 * 1024));

      const file = await storage.openRead('file.bin');
      const wasClosed = closed(handles[0]);
      const reader = file!.stream.getReader();
      await reader.read();
      await reader.cancel();

      await expect(wasClosed).resolves.toBeUndefined();
    });

    it('rethrows a failure other than a missing file', async () => {
      const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      jest.spyOn(fs.promises, 'open').mockRejectedValue(denied);

      await expect(storage.openRead('file.bin')).rejects.toThrow('permission denied');
    });
  });

  it('deletes a file, and is a no-op deleting a key that does not exist', async () => {
    await storage.put('file.pdf', Buffer.from('data'));
    await storage.delete('file.pdf');
    expect(await storage.exists('file.pdf')).toBe(false);

    await expect(storage.delete('file.pdf')).resolves.not.toThrow();
  });

  describe('keys that resolve outside the storage root', () => {
    const escapingKeys = [
      '../outside.pdf',
      'docs/../../outside.pdf',
      '../../../../../../../../outside.pdf',
      '..',
      '',
      // A backslash is only a separator on Windows; elsewhere it is a plain filename character.
      ...(path.sep === '\\' ? ['..\\outside.pdf', 'docs\\..\\..\\outside.pdf'] : []),
    ];

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it.each(escapingKeys)('rejects %j on every operation without touching the disk', async (key) => {
      // Stubbed so a regression fails the assertions below instead of writing outside the root.
      const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
      const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
      const unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);

      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow(/outside/);
      await expect(storage.get(key)).rejects.toThrow(/outside/);
      await expect(storage.openRead(key)).rejects.toThrow(/outside/);
      await expect(storage.delete(key)).rejects.toThrow(/outside/);
      await expect(storage.exists(key)).rejects.toThrow(/outside/);

      expect(mkdirSpy).not.toHaveBeenCalled();
      expect(writeSpy).not.toHaveBeenCalled();
      expect(unlinkSpy).not.toHaveBeenCalled();
    });

    it('still accepts a key whose dot segments stay inside the root', async () => {
      await storage.put('docs/../kept.pdf', Buffer.from('ok'));

      expect(fs.existsSync(path.join(root, 'kept.pdf'))).toBe(true);
    });
  });

  describe('sweepOrphaned', () => {
    const pastGracePeriod = () => Date.now() + SWEEP_GRACE_MS + 60_000;

    it('removes stale files not in the valid set, only in the folders it is given', async () => {
      await storage.put('active.pdf', Buffer.from('keep'));
      await storage.put('orphaned.pdf', Buffer.from('stale'));
      await storage.put('docs/nested.pdf', Buffer.from('nested'));

      await storage.sweepOrphaned(new Map([['', new Set(['active.pdf'])]]), pastGracePeriod());

      expect(fs.existsSync(path.join(root, 'active.pdf'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'orphaned.pdf'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'docs', 'nested.pdf'))).toBe(true);
    });

    it('sweeps a subfolder against its own valid set', async () => {
      await storage.put('docs/live.pdf', Buffer.from('keep'));
      await storage.put('docs/expired.pdf', Buffer.from('stale'));

      await storage.sweepOrphaned(new Map([['docs', new Set(['live.pdf'])]]), pastGracePeriod());

      expect(fs.existsSync(path.join(root, 'docs', 'live.pdf'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'docs', 'expired.pdf'))).toBe(false);
    });

    it('does nothing if the storage root does not exist yet', async () => {
      const missingRoot = path.join(root, 'does-not-exist');
      const emptyStorage = new LocalDiskStorage(missingRoot);
      await expect(
        emptyStorage.sweepOrphaned(new Map([['', new Set()], ['docs', new Set()]]), pastGracePeriod())
      ).resolves.not.toThrow();
      expect(fs.existsSync(missingRoot)).toBe(false);
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

  it('returns exactly the body bytes from get() when they are a view into a larger buffer', async () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    sendMock.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => backing.subarray(2, 5) },
    });
    const storage = new S3Storage();

    expect(await storage.get('file.pdf')).toEqual(Buffer.from([1, 2, 3]));
  });

  describe('openRead', () => {
    it('streams the object body with its ContentLength as the size', async () => {
      sendMock.mockResolvedValueOnce({
        ContentLength: 3,
        Body: { transformToWebStream: () => webStreamOf(new Uint8Array([1, 2, 3])) },
      });
      const storage = new S3Storage();

      const file = await storage.openRead('docs/file.pdf');

      expect(sendMock.mock.calls[0][0].input).toMatchObject({ Bucket: 'test-bucket', Key: 'docs/file.pdf' });
      expect(file!.size).toBe(3);
      expect(await readAll(file!.stream)).toEqual(Buffer.from([1, 2, 3]));
    });

    it.each(['NoSuchKey', 'NotFound'])('returns null when GetObject reports %s', async (name) => {
      sendMock.mockRejectedValueOnce({ name });
      const storage = new S3Storage();

      await expect(storage.openRead('missing.pdf')).resolves.toBeNull();
    });

    it('propagates other client failures', async () => {
      sendMock.mockRejectedValueOnce(Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }));
      const storage = new S3Storage();

      await expect(storage.openRead('file.pdf')).rejects.toThrow('Access Denied');
    });

    it('releases the body and fails when the response has no ContentLength', async () => {
      const cancelled = jest.fn();
      sendMock.mockResolvedValueOnce({
        Body: { transformToWebStream: () => webStreamOf(new Uint8Array([1]), cancelled) },
      });
      const storage = new S3Storage();

      await expect(storage.openRead('file.pdf')).rejects.toThrow(/ContentLength/);
      expect(cancelled).toHaveBeenCalled();
    });
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

  describe('driver guard', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    function setNodeEnv(value: string) {
      (process.env as Record<string, string | undefined>).NODE_ENV = value;
    }

    function setS3Env() {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.S3_REGION = 'auto';
      process.env.S3_ACCESS_KEY_ID = 'key';
      process.env.S3_SECRET_ACCESS_KEY = 'secret';
    }

    function freshStorage() {
      let result: { storage?: unknown; error?: Error; LocalDiskStorage?: unknown; S3Storage?: unknown } = {};
      jest.isolateModules(() => {
        const { getStorage } = require('@/lib/storage');
        result = {
          LocalDiskStorage: require('@/lib/storage/local').LocalDiskStorage,
          S3Storage: require('@/lib/storage/s3').S3Storage,
        };
        try {
          result.storage = getStorage();
        } catch (error) {
          result.error = error as Error;
        }
      });
      return result;
    }

    it.each(['development', 'test', 'production'])('rejects an unknown STORAGE_DRIVER in %s', (nodeEnv) => {
      setNodeEnv(nodeEnv);
      process.env.STORAGE_DRIVER = 'r2';

      const { storage, error } = freshStorage();

      expect(storage).toBeUndefined();
      expect(error?.message).toContain('STORAGE_DRIVER');
      expect(error?.message).toContain('"r2"');
      expect(error?.message).toMatch(/s3.*local/);
    });

    it('refuses to store in production when STORAGE_DRIVER is unset', () => {
      setNodeEnv('production');
      delete process.env.STORAGE_DRIVER;

      const { storage, error } = freshStorage();

      expect(storage).toBeUndefined();
      expect(error?.message).toContain('Set STORAGE_DRIVER=s3');
      expect(error?.message).toContain('STORAGE_DRIVER=local');
    });

    it('treats an empty STORAGE_DRIVER in production as unset', () => {
      setNodeEnv('production');
      process.env.STORAGE_DRIVER = '';

      const { error } = freshStorage();

      expect(error?.message).toContain('Set STORAGE_DRIVER=s3');
    });

    it('allows an explicit local driver in production with one warning', () => {
      setNodeEnv('production');
      process.env.STORAGE_DRIVER = 'local';

      let first: unknown;
      let second: unknown;
      let LocalCtor: unknown;
      jest.isolateModules(() => {
        const { getStorage } = require('@/lib/storage');
        LocalCtor = require('@/lib/storage/local').LocalDiskStorage;
        first = getStorage();
        second = getStorage();
      });

      expect(first).toBeInstanceOf(LocalCtor as never);
      expect(second).toBe(first);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('STORAGE_DRIVER=local');
    });

    it('uses S3Storage in production with STORAGE_DRIVER=s3 and no warning', () => {
      setNodeEnv('production');
      process.env.STORAGE_DRIVER = 's3';
      setS3Env();

      const { storage, S3Storage: S3Ctor } = freshStorage();

      expect(storage).toBeInstanceOf(S3Ctor as never);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it.each(['development', 'test'])('keeps the local default in %s without a warning', (nodeEnv) => {
      setNodeEnv(nodeEnv);
      delete process.env.STORAGE_DRIVER;

      const { storage, LocalDiskStorage: LocalCtor } = freshStorage();

      expect(storage).toBeInstanceOf(LocalCtor as never);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('uses S3Storage in development with STORAGE_DRIVER=s3', () => {
      setNodeEnv('development');
      process.env.STORAGE_DRIVER = 's3';
      setS3Env();

      const { storage, S3Storage: S3Ctor } = freshStorage();

      expect(storage).toBeInstanceOf(S3Ctor as never);
    });
  });
});

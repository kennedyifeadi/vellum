import fs from 'fs';
import os from 'os';
import path from 'path';
import { LocalDiskStorage } from '@/lib/storage/local';
import { S3Storage } from '@/lib/storage/s3';
import type { StorageDriver } from '@/lib/storage/types';
import { fakeBucket } from './fakeS3';

// Both real drivers, for suites that mock @aws-sdk/client-s3 with fakeS3Module(): local disk
// in a temporary folder, and S3 on the fake bucket.

export interface DriverUnderTest {
  storage: StorageDriver;
  has(key: string): boolean;
  keys(): string[];
  failDeleteOf(key: string): void;
  allowDeletes(): void;
  close(): void;
}

function filesUnder(root: string, folder = ''): string[] {
  return fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const key = folder ? `${folder}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(root, key) : [key];
  });
}

function localDriver(): DriverUnderTest {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-retention-test-'));
  const failing = new Set<string>();
  const unlink = fs.unlinkSync;
  const spy = jest.spyOn(fs, 'unlinkSync').mockImplementation((target) => {
    if (failing.has(String(target))) throw Object.assign(new Error('disk busy'), { code: 'EBUSY' });
    unlink(target);
  });

  return {
    storage: new LocalDiskStorage(root),
    has: (key) => fs.existsSync(path.join(root, key)),
    keys: () => filesUnder(root).sort(),
    failDeleteOf: (key) => failing.add(path.join(root, key)),
    allowDeletes: () => failing.clear(),
    close() {
      spy.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function s3Driver(): DriverUnderTest {
  const variables = { S3_BUCKET: 'test-bucket', S3_REGION: 'auto', S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret' };
  const before = Object.keys(variables).map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, variables);
  const storage = new S3Storage();
  for (const [name, value] of before) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fakeBucket.objects.clear();
  fakeBucket.failingDeletes.clear();

  return {
    storage,
    has: (key) => fakeBucket.objects.has(key),
    keys: () => [...fakeBucket.objects.keys()].sort(),
    failDeleteOf: (key) => fakeBucket.failingDeletes.add(key),
    allowDeletes: () => fakeBucket.failingDeletes.clear(),
    close() {
      fakeBucket.objects.clear();
      fakeBucket.failingDeletes.clear();
    },
  };
}

export const STORAGE_DRIVERS: [string, () => DriverUnderTest][] = [
  ['local disk', localDriver],
  ['S3', s3Driver],
];

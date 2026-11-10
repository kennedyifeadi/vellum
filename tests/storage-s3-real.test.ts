import crypto from 'crypto';
import { loadEnvConfig } from '@next/env';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { S3Storage } from '@/lib/storage/s3';

const S3_VARIABLES = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT'];
const ENABLED = process.env.VELLUM_TEST_R2 === '1';

// Next skips .env.local when NODE_ENV is test, so the variables are loaded the way
// `next dev` loads them, and only when this opt-in test is asked for.
function loadDevelopmentEnv() {
  const env = process.env as Record<string, string | undefined>;
  const nodeEnv = env.NODE_ENV;
  env.NODE_ENV = 'development';
  try {
    loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
  } finally {
    env.NODE_ENV = nodeEnv;
  }
}

if (ENABLED) loadDevelopmentEnv();

const missing = S3_VARIABLES.filter((name) => !process.env[name]);
const RUN = ENABLED && missing.length === 0;

if (!RUN) {
  const reason = ENABLED ? `missing ${missing.join(', ')}` : 'VELLUM_TEST_R2 is not 1';
  console.info(`Skipping the real R2 bucket test (${reason}). It runs only with VELLUM_TEST_R2=1 and the S3_* variables set.`);
}

const MB = 1024 * 1024;
const LARGE_SIZE = 100 * MB;

function report(line: string) {
  process.stdout.write(`[r2] ${line}\n`);
}

function rawClient(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION!,
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}

type Failure = { name: string; status?: number };

async function failureOf(promise: Promise<unknown>): Promise<Failure | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return { name: name ?? 'unnamed', status: $metadata?.httpStatusCode };
  }
}

function describeFailure(failure: Failure | null): string {
  return failure ? `${failure.name} (HTTP ${failure.status ?? '?'})` : 'none';
}

function withSecret<T>(secret: string, build: () => T): T {
  const original = process.env.S3_SECRET_ACCESS_KEY;
  process.env.S3_SECRET_ACCESS_KEY = secret;
  try {
    return build();
  } finally {
    process.env.S3_SECRET_ACCESS_KEY = original;
  }
}

async function measurePeakRss<T>(work: () => Promise<T>): Promise<{ result: T; ms: number; peakRss: number; rssBefore: number }> {
  const rssBefore = process.memoryUsage.rss();
  let peakRss = rssBefore;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage.rss());
  }, 20);
  const started = performance.now();
  try {
    const result = await work();
    peakRss = Math.max(peakRss, process.memoryUsage.rss());
    return { result, ms: performance.now() - started, peakRss, rssBefore };
  } finally {
    clearInterval(sampler);
  }
}

const describeReal = RUN ? describe : describe.skip;

describeReal('S3Storage against a real R2 bucket (VELLUM_TEST_R2=1)', () => {
  const prefix = `vellum-test/${crypto.randomUUID()}/`;
  const key = (name: string) => `${prefix}${name}`;
  let storage: S3Storage;
  let client: S3Client;

  jest.setTimeout(60_000);

  beforeAll(() => {
    storage = new S3Storage();
    client = rawClient();
    report(`run prefix ${prefix}`);
    report(`region is auto: ${process.env.S3_REGION === 'auto'}; endpoint is R2: ${/\.r2\.cloudflarestorage\.com\/?$/.test(process.env.S3_ENDPOINT!)}`);
  });

  afterAll(async () => {
    const bucket = process.env.S3_BUCKET!;
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    const keys = (listed.Contents ?? []).map((object) => ({ Key: object.Key! }));
    if (keys.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
    }
    const after = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    report(`cleanup: deleted ${keys.length} leftover object(s); ${after.KeyCount ?? 0} left under the prefix`);
    client.destroy();
    expect(after.KeyCount ?? 0).toBe(0);
  }, 120_000);

  it('round-trips a small object byte for byte', async () => {
    const data = crypto.randomBytes(4096);

    await storage.put(key('small.bin'), data);
    const read = await storage.get(key('small.bin'));

    expect(read).not.toBeNull();
    expect(read!.equals(data)).toBe(true);
  });

  it('reports exists true for a stored key and false for a missing one', async () => {
    await storage.put(key('exists.txt'), Buffer.from('here'));

    await expect(storage.exists(key('exists.txt'))).resolves.toBe(true);
    await expect(storage.exists(key('never-written.txt'))).resolves.toBe(false);
  });

  it('returns null for a missing key, and R2 uses an error name the driver recognises', async () => {
    const bucket = process.env.S3_BUCKET!;
    const missingKey = key('missing.pdf');

    await expect(storage.get(missingKey)).resolves.toBeNull();
    await expect(storage.exists(missingKey)).resolves.toBe(false);

    const getFailure = await failureOf(client.send(new GetObjectCommand({ Bucket: bucket, Key: missingKey })));
    const headFailure = await failureOf(client.send(new HeadObjectCommand({ Bucket: bucket, Key: missingKey })));
    report(`missing key: GetObject ${describeFailure(getFailure)}; HeadObject ${describeFailure(headFailure)}`);
    expect(['NotFound', 'NoSuchKey']).toContain(getFailure?.name);
    expect(['NotFound', 'NoSuchKey']).toContain(headFailure?.name);
  });

  it('deletes an existing key, and deleting a missing key does not throw', async () => {
    await storage.put(key('to-delete.pdf'), Buffer.from('bye'));

    await storage.delete(key('to-delete.pdf'));

    await expect(storage.exists(key('to-delete.pdf'))).resolves.toBe(false);
    await expect(storage.delete(key('never-written.pdf'))).resolves.toBeUndefined();
  });

  it('stores and reads a key inside a folder', async () => {
    const data = Buffer.from('%PDF-1.7 folder test');

    await storage.put(key('docs/nested.pdf'), data);

    await expect(storage.exists(key('docs/nested.pdf'))).resolves.toBe(true);
    expect((await storage.get(key('docs/nested.pdf')))!.equals(data)).toBe(true);
    await storage.delete(key('docs/nested.pdf'));
    await expect(storage.get(key('docs/nested.pdf'))).resolves.toBeNull();
  });

  it('round-trips a 100 MB object', async () => {
    const data = crypto.randomBytes(LARGE_SIZE);
    const digest = crypto.createHash('sha256').update(data).digest('hex');

    const put = await measurePeakRss(() => storage.put(key('large.bin'), data));
    report(`100 MB put: ${(put.ms / 1000).toFixed(1)} s, ${(LARGE_SIZE / MB / (put.ms / 1000)).toFixed(1)} MB/s; RSS ${Math.round(put.rssBefore / MB)} MB before, ${Math.round(put.peakRss / MB)} MB peak`);

    const get = await measurePeakRss(() => storage.get(key('large.bin')));
    report(`100 MB get: ${(get.ms / 1000).toFixed(1)} s, ${(LARGE_SIZE / MB / (get.ms / 1000)).toFixed(1)} MB/s; RSS ${Math.round(get.rssBefore / MB)} MB before, ${Math.round(get.peakRss / MB)} MB peak`);

    expect(get.result).not.toBeNull();
    expect(get.result!.length).toBe(LARGE_SIZE);
    expect(crypto.createHash('sha256').update(get.result!).digest('hex')).toBe(digest);

    await storage.delete(key('large.bin'));
  }, 600_000);

  it('fails clearly with a wrong secret instead of reporting a missing file', async () => {
    await storage.put(key('auth.txt'), Buffer.from('auth'));
    const wrong = withSecret(crypto.randomBytes(32).toString('hex'), () => new S3Storage());

    const getFailure = await failureOf(wrong.get(key('auth.txt')));
    const existsFailure = await failureOf(wrong.exists(key('auth.txt')));
    const putFailure = await failureOf(wrong.put(key('auth-wrong.txt'), Buffer.from('no')));
    report(`wrong secret: get ${describeFailure(getFailure)}; exists ${describeFailure(existsFailure)}; put ${describeFailure(putFailure)}`);

    for (const failure of [getFailure, existsFailure, putFailure]) {
      expect(failure).not.toBeNull();
      expect(failure!.status).toBe(403);
      expect(['NotFound', 'NoSuchKey']).not.toContain(failure!.name);
    }
  });
});

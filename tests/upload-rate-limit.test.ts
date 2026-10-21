import { NextRequest } from 'next/server';
import { MB, streamedUpload } from './helpers/uploadRequests';

jest.mock('next-auth/jwt', () => ({ getToken: jest.fn().mockResolvedValue(null) }));

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockResolvedValue(null),
  verifyToken: jest.fn().mockResolvedValue(null),
}));

import { proxy } from '../proxy';
import { POST as compressPdf } from '../app/api/convert/compress-pdf/route';
import { POST as htmlToPdf } from '../app/api/convert/html-to-pdf/route';
import { POST as uploadDocuments } from '../app/api/documents/upload/route';
import { RATE_LIMITED_MESSAGE } from '@/lib/http/rate-limit';

const LIMIT = 30;
let nextIp = 1;

beforeEach(() => {
  process.env.CLIENT_IP_HEADER = 'x-real-ip';
});

afterEach(() => {
  delete process.env.CLIENT_IP_HEADER;
});

function freshIp(): string {
  return `203.0.113.${nextIp++}`;
}

function upload(path: string, ip: string, sizeBytes = 1024) {
  const streamed = streamedUpload(`http://localhost:3000${path}`, 'pdf', sizeBytes);
  streamed.request.headers.set('x-real-ip', ip);
  return streamed;
}

async function expectRateLimited(res: Response) {
  expect(res.status).toBe(429);
  expect((await res.json()).error).toBe(RATE_LIMITED_MESSAGE);
}

describe('upload routes outside proxy.ts', () => {
  it.each([
    ['compress-pdf', '/api/convert/compress-pdf', compressPdf],
    ['documents/upload', '/api/documents/upload', uploadDocuments],
  ] as const)('refuse the %s request over the limit before reading its body', async (_name, path, handler) => {
    const ip = freshIp();
    for (let i = 0; i < LIMIT; i++) {
      expect((await handler(upload(path, ip).request)).status).not.toBe(429);
    }

    const over = upload(path, ip, 400 * MB);
    await expectRateLimited(await handler(over.request));
    expect(over.bytesRead()).toBe(0);
  });

  it("counts against the same budget as the proxy's routes", async () => {
    const ip = freshIp();
    for (let i = 0; i < LIMIT; i++) {
      const proxied = new NextRequest('http://localhost:3000/api/documents/abc', { headers: { 'x-real-ip': ip } });
      expect((await proxy(proxied)).status).not.toBe(429);
    }

    await expectRateLimited(await compressPdf(upload('/api/convert/compress-pdf', ip).request));
  });

  it('limits each caller separately', async () => {
    const limited = freshIp();
    for (let i = 0; i <= LIMIT; i++) await compressPdf(upload('/api/convert/compress-pdf', limited).request);

    expect((await compressPdf(upload('/api/convert/compress-pdf', freshIp()).request)).status).not.toBe(429);
  });
});

describe('html-to-pdf URL mode', () => {
  it('refuses an oversized JSON body before reading it', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += MB;
          controller.enqueue(new Uint8Array(MB));
        },
      },
      { highWaterMark: 0 },
    );
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(400 * MB), 'x-real-ip': freshIp() },
      body,
      duplex: 'half',
    };

    const res = await htmlToPdf(new NextRequest('http://localhost:3000/api/convert/html-to-pdf', init as ConstructorParameters<typeof NextRequest>[1]));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('The request is too large. Send JSON with just a "url".');
    expect(pulled).toBe(0);
  });
});

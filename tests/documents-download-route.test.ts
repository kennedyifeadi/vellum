import { NextRequest } from 'next/server';
import type { TrackedFile } from './helpers/storedFileStreams';

const OWNER_ID = '507f1f77bcf86cd799439011';
const STORED_BYTES = Buffer.from('<script>alert(1)</script>');

let mockDocument: Record<string, unknown> | null = null;
let mockStoredKeys = new Set<string>();
let mockOpened: TrackedFile[] = [];
let mockFailAfterChunks: number | undefined;

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockResolvedValue(OWNER_ID),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/userDocument', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn((query: { _id: string; userId: string }) =>
      Promise.resolve(mockDocument && query._id === mockDocument._id && query.userId === mockDocument.userId ? mockDocument : null),
    ),
  },
}));

jest.mock('@/lib/storage', () => ({
  getStorage: () => ({
    openRead: async (key: string) => {
      if (!mockStoredKeys.has(key)) return null;
      const file = require('./helpers/storedFileStreams').trackedFile(STORED_BYTES, { failAfterChunks: mockFailAfterChunks });
      mockOpened.push(file);
      return file;
    },
  }),
}));

import { GET as downloadDocument } from '../app/api/documents/download/[id]/route';

function download(mimeType: unknown, { ownerId = OWNER_ID, signal }: { ownerId?: string; signal?: AbortSignal } = {}) {
  mockDocument = { _id: 'doc1', userId: ownerId, diskFileName: 'abc.bin', fileName: 'upload.bin', mimeType };
  return downloadDocument(new NextRequest('http://localhost:3000/api/documents/download/doc1', { signal }), {
    params: Promise.resolve({ id: 'doc1' }),
  });
}

beforeEach(() => {
  mockStoredKeys = new Set(['docs/abc.bin']);
  mockOpened = [];
  mockFailAfterChunks = undefined;
});

describe('documents/download body', () => {
  it('streams the stored document with its length', async () => {
    const res = await download('application/pdf');

    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(res.headers.get('Content-Length')).toBe(String(STORED_BYTES.length));
    expect(Buffer.from(await res.arrayBuffer()).equals(STORED_BYTES)).toBe(true);
  });

  it("answers 404 for another user's document without opening storage", async () => {
    const res = await download('application/pdf', { ownerId: '507f1f77bcf86cd799439022' });

    expect(res.status).toBe(404);
    expect(mockOpened).toHaveLength(0);
  });

  it('answers 404 when the stored file is gone', async () => {
    mockStoredKeys.clear();

    const res = await download('application/pdf');

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('File removed from storage');
  });

  it('releases the stored file when the client disconnects mid-download', async () => {
    const client = new AbortController();

    const res = await download('application/pdf', { signal: client.signal });
    await res.body!.getReader().read();
    client.abort();

    await expect(mockOpened[0].cancelled).resolves.toBeUndefined();
  });

  it('ends the body without throwing when storage fails mid-download', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFailAfterChunks = 1;

    const res = await download('application/pdf');
    const failure = await res.arrayBuffer().then(
      () => null,
      (error: Error) => error,
    );

    expect(res.status).toBe(200);
    expect(failure?.name).toBe('AbortError');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});

describe('documents/download content type', () => {
  it.each([
    ['application/pdf', 'application/pdf'],
    ['image/png', 'image/png'],
    ['image/jpeg', 'image/jpeg'],
    ['video/mp4', 'video/mp4'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['APPLICATION/PDF', 'application/pdf'],
    ['application/pdf; charset=binary', 'application/pdf'],
  ])('serves a stored %p as %p', async (stored, served) => {
    const res = await download(stored);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(served);
  });

  it.each([
    ['HTML', 'text/html'],
    ['XHTML', 'application/xhtml+xml'],
    ['SVG', 'image/svg+xml'],
    ['XML', 'text/xml'],
    ['JavaScript', 'text/javascript'],
    ['an empty type', ''],
    ['a missing type', undefined],
    ['a header-breaking type', 'text/html\r\nSet-Cookie: x=1'],
  ])('serves %s the uploader claimed as opaque bytes', async (_label, stored) => {
    const res = await download(stored);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('tells browsers not to sniff the content', async () => {
    const res = await download('application/pdf');

    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

import { NextRequest } from 'next/server';

let mockDocument: Record<string, unknown> | null = null;

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockResolvedValue('507f1f77bcf86cd799439011'),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/userDocument', () => ({
  __esModule: true,
  default: { findOne: jest.fn(() => Promise.resolve(mockDocument)) },
}));

jest.mock('@/lib/storage', () => ({
  getStorage: () => ({ get: jest.fn().mockResolvedValue(Buffer.from('<script>alert(1)</script>')) }),
}));

import { GET as downloadDocument } from '../app/api/documents/download/[id]/route';

function download(mimeType: unknown) {
  mockDocument = { _id: 'doc1', diskFileName: 'abc.bin', fileName: 'upload.bin', mimeType };
  return downloadDocument(new NextRequest('http://localhost:3000/api/documents/download/doc1'), {
    params: Promise.resolve({ id: 'doc1' }),
  });
}

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

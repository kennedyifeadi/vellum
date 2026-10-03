import { NextRequest } from 'next/server';

let mockUserId: string | null = null;
let mockResolvedFiles: any[] = [];

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockImplementation(() => Promise.resolve(mockUserId)),
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

const saveConversionRecord = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: (...args: any[]) => saveConversionRecord(...args),
}));

const convertHtmlToPdf = jest.fn();
jest.mock('@/lib/html/to-pdf', () => ({
  convertHtmlToPdf: (...args: any[]) => convertHtmlToPdf(...args),
}));

import { POST as handleHtmlToPdf } from '../app/api/convert/html-to-pdf/route';
import { ClientError } from '../lib/convert/errors';

function urlRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/convert/html-to-pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockResolvedFiles = [];
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('html-to-pdf route', () => {
  it('returns 400 with the safe message when the URL is rejected by the egress policy', async () => {
    convertHtmlToPdf.mockRejectedValueOnce(
      new ClientError('Only http and https URLs can be converted (received "file").'),
    );

    const res = await handleHtmlToPdf(urlRequest({ url: 'file:///etc/passwd' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/http and https/i);
  });

  it('does not leak the underlying error message on a server fault', async () => {
    convertHtmlToPdf.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED at http://127.0.0.1:6379'));

    const res = await handleHtmlToPdf(urlRequest({ url: 'https://example.com' }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to convert HTML to PDF.');
  });

  it('still converts an allowed URL', async () => {
    convertHtmlToPdf.mockResolvedValueOnce(Buffer.from('%PDF-1.7 ok'));

    const res = await handleHtmlToPdf(urlRequest({ url: 'https://example.com/report' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('example.com.pdf');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('rejects a request with no URL', async () => {
    const res = await handleHtmlToPdf(urlRequest({}));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no url/i);
    expect(convertHtmlToPdf).not.toHaveBeenCalled();
  });
});

import { NextRequest } from 'next/server';

const VALID_HEX_BASIC = '507f1f77bcf86cd799439011';
const VALID_HEX_PRO = '507f1f77bcf86cd799439012';
const VALID_HEX_ENTERPRISE = '507f1f77bcf86cd799439014';

const MB = 1024 * 1024;

let mockUserId: string | null = null;
let mockPlan = 'Free';
let mockResolvedFiles: any[] = [];

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockImplementation(() => Promise.resolve(mockUserId)),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {
    findById: jest.fn().mockImplementation(() => Promise.resolve(mockUserId ? { plan: mockPlan } : null)),
  },
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: jest.fn().mockResolvedValue(true),
}));

const convertHtmlToPdf = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 rendered'));
jest.mock('@/lib/html/to-pdf', () => ({
  convertHtmlToPdf: (opts: any) => convertHtmlToPdf(opts),
}));

import { POST as handleHtmlToPdf } from '../app/api/convert/html-to-pdf/route';

function fakeHtmlFile(sizeBytes: number, name = 'page.html') {
  return {
    name,
    type: 'text/html',
    size: sizeBytes,
    text: jest.fn().mockResolvedValue('<h1>hi</h1>'),
  };
}

function multipartRequest() {
  return new NextRequest('http://localhost:3000/api/convert/html-to-pdf', {
    method: 'POST',
    body: new FormData(),
  });
}

function urlRequest(url: unknown) {
  return new NextRequest('http://localhost:3000/api/convert/html-to-pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  convertHtmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.7 rendered'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('html-to-pdf route: auth + per-plan upload cap run before conversion', () => {
  it('rejects a guest upload over 25MB with 400 and never launches a render', async () => {
    mockResolvedFiles = [fakeHtmlFile(26 * MB)];

    const res = await handleHtmlToPdf(multipartRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows HTML files up to 25MB.');
    expect(convertHtmlToPdf).not.toHaveBeenCalled();
    expect(mockResolvedFiles[0].text).not.toHaveBeenCalled();
  });

  it('allows a guest upload within 25MB', async () => {
    mockResolvedFiles = [fakeHtmlFile(24 * MB)];

    const res = await handleHtmlToPdf(multipartRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(convertHtmlToPdf).toHaveBeenCalledTimes(1);
  });

  it('gives Basic a 50MB cap', async () => {
    mockUserId = VALID_HEX_BASIC;
    mockPlan = 'Basic';
    mockResolvedFiles = [fakeHtmlFile(51 * MB)];

    const res = await handleHtmlToPdf(multipartRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows HTML files up to 50MB.');
    expect(convertHtmlToPdf).not.toHaveBeenCalled();
  });

  it('gives Pro a 100MB cap', async () => {
    mockUserId = VALID_HEX_PRO;
    mockPlan = 'Pro';
    mockResolvedFiles = [fakeHtmlFile(101 * MB)];

    const res = await handleHtmlToPdf(multipartRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows HTML files up to 100MB.');
  });

  it('gives Enterprise a 500MB cap and still enforces it', async () => {
    mockUserId = VALID_HEX_ENTERPRISE;
    mockPlan = 'Enterprise';

    mockResolvedFiles = [fakeHtmlFile(400 * MB)];
    expect((await handleHtmlToPdf(multipartRequest())).status).toBe(200);

    mockResolvedFiles = [fakeHtmlFile(501 * MB)];
    const rejected = await handleHtmlToPdf(multipartRequest());
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toBe('Your current plan allows HTML files up to 500MB.');
  });

  it('does not leak an internal error message when the render fails', async () => {
    mockResolvedFiles = [fakeHtmlFile(1 * MB)];
    convertHtmlToPdf.mockRejectedValueOnce(new Error('/var/task/lib/html/to-pdf.ts:41 boom'));

    const res = await handleHtmlToPdf(multipartRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to convert HTML to PDF.');
  });

  it('surfaces a render-deadline timeout as a 4xx, not a 500', async () => {
    mockResolvedFiles = [fakeHtmlFile(1 * MB)];
    const { RenderTimeoutError } = jest.requireActual('@/lib/puppeteer/lifecycle');
    convertHtmlToPdf.mockRejectedValueOnce(new RenderTimeoutError());

    const res = await handleHtmlToPdf(multipartRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too long to render/i);
  });

  it('still serves URL mode, which carries no upload to cap', async () => {
    const res = await handleHtmlToPdf(urlRequest('https://example.com'));

    expect(res.status).toBe(200);
    expect(convertHtmlToPdf).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com' })
    );
  });
});

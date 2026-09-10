import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

const VALID_HEX_BASIC = '507f1f77bcf86cd799439011';
const VALID_HEX_PRO = '507f1f77bcf86cd799439012';
const VALID_HEX_ENTERPRISE = '507f1f77bcf86cd799439014';

const MB = 1024 * 1024;

let mockUserId: string | null = null;
let mockPlan: string = 'Free';
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

import { POST as handleCompressPdf } from '../app/api/convert/compress-pdf/route';

async function realPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 300]);
  page.drawText('Compress me', { x: 20, y: 150, font, size: 18 });
  return Buffer.from(await doc.save());
}

async function realPdfWithImage(): Promise<Buffer> {
  const png = await sharp({
    create: { width: 600, height: 600, channels: 3, background: { r: 180, g: 90, b: 30 } },
  })
    .png()
    .toBuffer();

  const doc = await PDFDocument.create();
  const embedded = await doc.embedPng(png);
  const page = doc.addPage([600, 600]);
  page.drawImage(embedded, { x: 0, y: 0, width: 600, height: 600 });
  return Buffer.from(await doc.save());
}

/**
 * Wraps a genuinely valid PDF in a File-like whose reported `size` can be overridden.
 * The size gate must fire on `file.size` alone, so an oversized case needs a large
 * reported size without allocating hundreds of MB of real bytes. `arrayBuffer` is a
 * spy so tests can assert the heavy read never happens once the gate rejects.
 */
function pdfFile(bytes: Buffer, sizeOverride?: number, name = 'doc.pdf') {
  return {
    name,
    type: 'application/pdf',
    size: sizeOverride ?? bytes.length,
    arrayBuffer: jest.fn().mockResolvedValue(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
  };
}

function compressRequest(level?: string) {
  const body = new FormData();
  if (level !== undefined) body.set('level', level);
  return new NextRequest('http://localhost:3000/api/convert/compress-pdf', {
    method: 'POST',
    body,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
});

describe('compress-pdf per-plan upload size limit', () => {
  it('rejects an oversized guest upload with 400 before reading the file', async () => {
    const file = pdfFile(await realPdf(), 120 * MB);
    mockResolvedFiles = [file];

    const res = await handleCompressPdf(compressRequest('medium'));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Your current plan allows PDFs up to 25MB.');
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it('gives a guest a 25MB cap', async () => {
    mockResolvedFiles = [pdfFile(await realPdf(), 26 * MB)];

    const res = await handleCompressPdf(compressRequest('medium'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows PDFs up to 25MB.');
  });

  it('gives Basic a 50MB cap', async () => {
    mockUserId = VALID_HEX_BASIC;
    mockPlan = 'Basic';
    mockResolvedFiles = [pdfFile(await realPdf(), 51 * MB)];

    const res = await handleCompressPdf(compressRequest('medium'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows PDFs up to 50MB.');
  });

  it('gives Pro a 100MB cap', async () => {
    mockUserId = VALID_HEX_PRO;
    mockPlan = 'Pro';
    mockResolvedFiles = [pdfFile(await realPdf(), 101 * MB)];

    const res = await handleCompressPdf(compressRequest('medium'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows PDFs up to 100MB.');
  });

  it('gives Enterprise a 500MB cap and still enforces it', async () => {
    mockUserId = VALID_HEX_ENTERPRISE;
    mockPlan = 'Enterprise';

    mockResolvedFiles = [pdfFile(await realPdf(), 450 * MB)];
    expect((await handleCompressPdf(compressRequest('medium'))).status).toBe(200);

    const file = pdfFile(await realPdf(), 501 * MB);
    mockResolvedFiles = [file];
    const rejected = await handleCompressPdf(compressRequest('medium'));

    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toBe('Your current plan allows PDFs up to 500MB.');
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it('processes a within-cap upload for a guest (happy path)', async () => {
    mockResolvedFiles = [pdfFile(await realPdf())];

    const res = await handleCompressPdf(compressRequest('low'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('X-Original-Size')).toBeTruthy();
  });

  it('processes a within-cap PDF with an embedded image at medium level', async () => {
    mockResolvedFiles = [pdfFile(await realPdfWithImage())];

    const res = await handleCompressPdf(compressRequest('medium'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });
});

describe('compress-pdf level validation', () => {
  it('rejects an unrecognized non-empty level with 400 before processing', async () => {
    const file = pdfFile(await realPdf());
    mockResolvedFiles = [file];

    const res = await handleCompressPdf(compressRequest('banana'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid compression level/i);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it.each(['5', 'LOW', '  '])('rejects or normalizes ambiguous level %p without silent coercion', async (level) => {
    mockResolvedFiles = [pdfFile(await realPdf())];

    const res = await handleCompressPdf(compressRequest(level));

    if (level.trim() === '') {
      expect(res.status).toBe(200);
    } else {
      expect(res.status).toBe(400);
    }
  });

  it('defaults a missing level to medium and succeeds', async () => {
    mockResolvedFiles = [pdfFile(await realPdf())];

    const res = await handleCompressPdf(compressRequest());

    expect(res.status).toBe(200);
  });

  it('accepts each valid level', async () => {
    for (const level of ['low', 'medium', 'high']) {
      mockResolvedFiles = [pdfFile(await realPdf())];
      const res = await handleCompressPdf(compressRequest(level));
      expect(res.status).toBe(200);
    }
  });
});

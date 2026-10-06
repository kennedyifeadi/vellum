import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const USER_ID = '507f1f77bcf86cd799439011';
const RENDERED_PDF = Buffer.from('%PDF-1.7 rendered');

let mockUserId: string | null = null;
let mockResolvedFiles: any[] = [];
const mockStored = new Map<string, Buffer>();

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
    findById: jest.fn().mockImplementation(() => Promise.resolve(mockUserId ? { plan: 'Basic' } : null)),
  },
}));

const conversionCreate = jest.fn().mockResolvedValue(true);
jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: { create: (...args: any[]) => conversionCreate(...args) },
}));

jest.mock('@/lib/storage', () => ({
  getStorage: () => ({
    put: async (key: string, data: Buffer) => {
      mockStored.set(key, data);
    },
  }),
  LocalDiskStorage: class {},
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

jest.mock('@/lib/html/to-pdf', () => ({
  convertHtmlToPdf: jest.fn().mockImplementation(() => Promise.resolve(RENDERED_PDF)),
}));

import { POST as handleCompressPdf } from '../app/api/convert/compress-pdf/route';
import { POST as handleMergePdf } from '../app/api/convert/merge-pdf/route';
import { POST as handleLockPdf } from '../app/api/convert/lock-pdf/route';
import { POST as handleHtmlToPdf } from '../app/api/convert/html-to-pdf/route';

async function createPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([200, 200]).drawText('page', { x: 10, y: 100, font, size: 12 });
  return Buffer.from(await doc.save());
}

function fakePdfFile(buffer: Buffer, name: string) {
  return {
    name,
    type: 'application/pdf',
    size: buffer.length,
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function fakeHtmlFile(name: string) {
  return { name, type: 'text/html', size: 11, text: jest.fn().mockResolvedValue('<h1>hi</h1>') };
}

function multipartRequest(route: string, fields: Record<string, string> = {}) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  return new NextRequest(`http://localhost:3000/api/convert/${route}`, { method: 'POST', body: formData });
}

async function compress(name: string) {
  mockResolvedFiles = [fakePdfFile(await createPdf(), name)];
  return handleCompressPdf(multipartRequest('compress-pdf'));
}

async function merge(name: string) {
  const pdf = await createPdf();
  mockResolvedFiles = [fakePdfFile(pdf, name), fakePdfFile(pdf, 'second.pdf')];
  return handleMergePdf(multipartRequest('merge-pdf'));
}

async function lock(name: string) {
  mockResolvedFiles = [fakePdfFile(await createPdf(), name)];
  return handleLockPdf(multipartRequest('lock-pdf', { password: 'correct horse' }));
}

async function convertHtml(name: string) {
  mockResolvedFiles = [fakeHtmlFile(name)];
  return handleHtmlToPdf(multipartRequest('html-to-pdf'));
}

async function expectDownloadablePdfRow(res: Response, toolUsed: string, fileName: string) {
  expect(res.status).toBe(200);
  const body = Buffer.from(await res.arrayBuffer());

  expect(conversionCreate).toHaveBeenCalledTimes(1);
  const record = conversionCreate.mock.calls[0][0];
  expect(record).toMatchObject({ userId: USER_ID, toolUsed, fileName, status: 'Completed' });
  expect(record.diskFileName).toMatch(/\.pdf$/);
  expect(record.outputUrl).toBe(`/api/download/${record.diskFileName.replace(/\.pdf$/, '')}`);
  expect(mockStored.get(record.diskFileName)!.equals(body)).toBe(true);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = USER_ID;
  mockResolvedFiles = [];
  mockStored.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('history file names for routes that always produce a PDF', () => {
  describe('compress-pdf', () => {
    it.each([
      ['report', 'compressed_report.pdf'],
      ['invoice.pdf.download', 'compressed_invoice.pdf.download.pdf'],
      ['report.pdf', 'compressed_report.pdf'],
      ['SCAN.PDF', 'compressed_SCAN.PDF'],
    ])('records an upload named %p as %p', async (uploadName, recordedName) => {
      const res = await compress(uploadName);

      await expectDownloadablePdfRow(res, 'Compress PDF', recordedName);
      expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="compressed_${uploadName}"`);
    });
  });

  describe('merge-pdf', () => {
    it.each([
      ['Scan 2026-10-01', 'merged_Scan 2026-10-01.pdf'],
      ['part.pdf', 'merged_part.pdf'],
    ])('records a first upload named %p as %p', async (uploadName, recordedName) => {
      const res = await merge(uploadName);

      await expectDownloadablePdfRow(res, 'Merge PDF', recordedName);
      expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="merged.pdf"');
    });
  });

  describe('lock-pdf', () => {
    it.each([
      ['contract', 'locked_contract.pdf'],
      ['invoice.pdf.download', 'locked_invoice.pdf.download.pdf'],
      ['contract.pdf', 'locked_contract.pdf'],
    ])('records an upload named %p as %p', async (uploadName, recordedName) => {
      const res = await lock(uploadName);

      await expectDownloadablePdfRow(res, 'Lock PDF', recordedName);
      expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="locked.pdf"');
    });
  });

  describe('html-to-pdf file mode', () => {
    it.each([
      ['page.xhtml', 'page.xhtml.pdf'],
      ['page', 'page.pdf'],
      ['page.html', 'page.pdf'],
      ['INDEX.HTM', 'INDEX.pdf'],
    ])('records an upload named %p as %p', async (uploadName, recordedName) => {
      const res = await convertHtml(uploadName);

      await expectDownloadablePdfRow(res, 'HTML to PDF', recordedName);
    });

    it('leaves the response filename as it was for a name it does not recognise as HTML', async () => {
      const res = await convertHtml('page.xhtml');

      expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="page.xhtml"');
    });
  });

  it('records nothing for a guest', async () => {
    mockUserId = null;

    const res = await compress('report');

    expect(res.status).toBe(200);
    expect(conversionCreate).not.toHaveBeenCalled();
    expect(mockStored.size).toBe(0);
  });
});

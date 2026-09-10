import { NextRequest } from 'next/server';
import JSZip from 'jszip';

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

const convertDocxToPdf = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 rendered'));
jest.mock('@/lib/doc/to-pdf', () => ({
  convertDocxToPdf: (opts: any) => convertDocxToPdf(opts),
}));

import { POST as handleDocxToPdf } from '../app/api/convert/docx-to-pdf/route';

async function makeDocx(documentXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', documentXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function fakeFile(buffer: Buffer, opts: { size?: number; name?: string } = {}) {
  return {
    name: opts.name ?? 'doc.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: opts.size ?? buffer.length,
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function docxRequest() {
  return new NextRequest('http://localhost:3000/api/convert/docx-to-pdf', {
    method: 'POST',
    body: new FormData(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  convertDocxToPdf.mockResolvedValue(Buffer.from('%PDF-1.7 rendered'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('docx-to-pdf route: auth + per-plan upload cap run before conversion', () => {
  it('rejects a guest upload over 25MB with 400 and never converts', async () => {
    mockResolvedFiles = [fakeFile(await makeDocx('<doc/>'), { size: 26 * MB })];

    const res = await handleDocxToPdf(docxRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows DOCX files up to 25MB.');
    expect(convertDocxToPdf).not.toHaveBeenCalled();
    expect(mockResolvedFiles[0].arrayBuffer).not.toHaveBeenCalled();
  });

  it('gives Basic a 50MB cap', async () => {
    mockUserId = VALID_HEX_BASIC;
    mockPlan = 'Basic';
    mockResolvedFiles = [fakeFile(await makeDocx('<doc/>'), { size: 51 * MB })];

    const res = await handleDocxToPdf(docxRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows DOCX files up to 50MB.');
  });

  it('gives Pro a 100MB cap', async () => {
    mockUserId = VALID_HEX_PRO;
    mockPlan = 'Pro';
    mockResolvedFiles = [fakeFile(await makeDocx('<doc/>'), { size: 101 * MB })];

    const res = await handleDocxToPdf(docxRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows DOCX files up to 100MB.');
  });

  it('gives Enterprise a 500MB cap and still enforces it', async () => {
    mockUserId = VALID_HEX_ENTERPRISE;
    mockPlan = 'Enterprise';
    mockResolvedFiles = [fakeFile(await makeDocx('<doc/>'), { size: 501 * MB })];

    const res = await handleDocxToPdf(docxRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows DOCX files up to 500MB.');
  });

  it('converts a normal small DOCX', async () => {
    mockResolvedFiles = [fakeFile(await makeDocx('<w:document><w:body/></w:document>'))];

    const res = await handleDocxToPdf(docxRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(convertDocxToPdf).toHaveBeenCalledTimes(1);
  });
});

describe('docx-to-pdf route: decompression-bomb guard', () => {
  it('rejects a small DOCX whose document.xml expands enormously with a 4xx, not a timeout', async () => {
    // ~20MB of highly compressible XML in a file that is only a few KB on disk.
    const bomb = await makeDocx('<a>' + 'A'.repeat(20 * MB) + '</a>');
    expect(bomb.length).toBeLessThan(200 * 1024);
    mockResolvedFiles = [fakeFile(bomb)];

    const res = await handleDocxToPdf(docxRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('This DOCX expands to too much content to process.');
    expect(convertDocxToPdf).not.toHaveBeenCalled();
  });

  it('rejects a corrupt / non-zip payload with a 4xx', async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('this is not a zip'))];

    const res = await handleDocxToPdf(docxRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('The file is not a valid DOCX document.');
    expect(convertDocxToPdf).not.toHaveBeenCalled();
  });

  it('still returns a generic 500 for a genuine renderer fault', async () => {
    mockResolvedFiles = [fakeFile(await makeDocx('<doc/>'))];
    convertDocxToPdf.mockRejectedValueOnce(new Error('/var/task boom'));

    const res = await handleDocxToPdf(docxRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to convert DOCX to PDF.');
  });
});

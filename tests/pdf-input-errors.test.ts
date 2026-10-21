import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { lockPdf as encryptPdf } from '@/lib/pdf/lock';
import { PDFDocument as EncryptablePdf } from 'pdf-lib-plus-encrypt';

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: jest.fn(),
  recordConversionHistory: jest.fn(),
}));

import { POST as pdfToDocx } from '../app/api/convert/pdf-to-docx/route';
import { POST as findPdf } from '../app/api/convert/find-pdf/route';
import { POST as lockPdf } from '../app/api/convert/lock-pdf/route';
import { POST as compressPdf } from '../app/api/convert/compress-pdf/route';
import { POST as splitPdf } from '../app/api/convert/split-pdf/route';
import * as pdfExtraction from '@/lib/convert/pdf-extraction';
import { PdfExtractionError } from '@/lib/convert/pdf-extraction';
import { EXTRACTION_LIMITS as FIND_PDF_LIMITS } from '@/lib/convert/find-pdf-limits';
import { EXTRACTION_LIMITS as PDF_TO_DOCX_LIMITS } from '@/lib/convert/pdf-to-docx-limits';

jest.setTimeout(60_000);

// These tests are about what the parser says, not how long it takes: on a loaded machine
// the production guest deadline can expire first and turn any of them into "too complex".
const GENEROUS_DEADLINES_MS = { guest: 30_000, Basic: 30_000, Pro: 30_000, Enterprise: 30_000 };

beforeEach(() => {
  jest.replaceProperty(FIND_PDF_LIMITS, 'deadlineMs', GENEROUS_DEADLINES_MS);
  jest.replaceProperty(PDF_TO_DOCX_LIMITS, 'deadlineMs', GENEROUS_DEADLINES_MS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const EMPTY = 'The PDF file is empty.';
const CORRUPT = 'The PDF file is not a valid PDF or is corrupted.';
const ENCRYPTED = 'The PDF file is password-protected. Please remove the password before continuing.';
const ALREADY_LOCKED = 'This PDF is already password-protected. Please remove the existing password before adding a new one.';

async function ordinaryPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText('Hello there', { x: 20, y: 150, font, size: 14 });
  return Buffer.from(await doc.save());
}

const INPUTS: [string, () => Promise<Buffer>][] = [
  ['an empty file', async () => Buffer.alloc(0)],
  ['a truncated PDF', async () => (await ordinaryPdf()).subarray(0, 300)],
  ['a PDF header and nothing else', async () => Buffer.from('%PDF-1.7\n')],
  ['plain text', async () => Buffer.from('not a pdf at all')],
  ['a PNG renamed .pdf', async () => Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')],
  ['a password-protected PDF', async () => encryptPdf({ pdfBuffer: await ordinaryPdf(), password: 'correct-Horse-7!' })],
];

function expectedMessage(input: string, tool: string): string {
  if (input === 'an empty file') return EMPTY;
  if (input === 'a password-protected PDF') return tool === 'lock-pdf' ? ALREADY_LOCKED : ENCRYPTED;
  return CORRUPT;
}

function post(path: string, bytes: Buffer, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.set('pdf', new File([bytes as BlobPart], 'input.pdf', { type: 'application/pdf' }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new NextRequest(`http://localhost:3000${path}`, { method: 'POST', body: form });
}

const TOOLS: [string, (bytes: Buffer) => Promise<Response>][] = [
  ['pdf-to-docx', (bytes) => pdfToDocx(post('/api/convert/pdf-to-docx', bytes))],
  ['find-pdf', (bytes) => findPdf(post('/api/convert/find-pdf', bytes, { searchTerm: 'hello' }))],
  ['lock-pdf', (bytes) => lockPdf(post('/api/convert/lock-pdf', bytes, { password: 'secret-1' }))],
];

describe.each(TOOLS)('%s input errors', (tool, call) => {
  it.each(INPUTS)('answers %s with a 400 that says what is wrong', async (input, bytes) => {
    const res = await call(await bytes());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(expectedMessage(input, tool));
  });

  it('still converts an ordinary PDF', async () => {
    expect((await call(await ordinaryPdf())).status).toBe(200);
  });
});

describe('a genuine parser fault', () => {
  it.each([
    ['pdf-to-docx', 'extractPdfPages', (bytes: Buffer) => pdfToDocx(post('/api/convert/pdf-to-docx', bytes))],
  ] as const)('is still a generic 500 on %s', async (_tool, extractor, call) => {
    const parserFault = new Error('Unknown parser failure');
    parserFault.name = 'UnknownErrorException';
    jest
      .spyOn(pdfExtraction, extractor)
      .mockRejectedValueOnce(new PdfExtractionError({ reason: 'parser' }, 'PDF could not be parsed', { cause: parserFault }));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await call(await ordinaryPdf());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to convert PDF to DOCX');
  });
});

describe('a PDF header with no document behind it', () => {
  const headerOnly = () => Buffer.from('%PDF-1.7\n');

  it.each([
    ['compress-pdf', () => compressPdf(post('/api/convert/compress-pdf', headerOnly()))],
    ['split-pdf', () => splitPdf(post('/api/convert/split-pdf', headerOnly(), { startPage: '1', endPage: '1' }))],
  ])('is a 400 on %s', async (_tool, call) => {
    const res = await call();

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(CORRUPT);
  });
});

describe('a PDF with only an owner password', () => {
  it('is a 400 on find-pdf, which highlights with a library that cannot open it', async () => {
    const doc = await EncryptablePdf.load(await ordinaryPdf());
    await doc.encrypt({ userPassword: '', ownerPassword: 'owner-Only-7!' });
    const ownerLocked = Buffer.from(await doc.save());

    const res = await findPdf(post('/api/convert/find-pdf', ownerLocked, { searchTerm: 'hello' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(ENCRYPTED);
  });
});

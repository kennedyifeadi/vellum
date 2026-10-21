import type { NextRequest } from 'next/server';
import { MB, streamedUpload } from './helpers/uploadRequests';

let mockUserId: string | null = null;
let mockPlan = 'Free';
let mockStorageUsed = 0;

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn(() => Promise.resolve(mockUserId)),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

const mockFindUser = jest.fn((id: string) => {
  const user = id ? { plan: mockPlan } : null;
  return Object.assign(Promise.resolve(user), { lean: () => Promise.resolve(user) });
});
jest.mock('@/models/user', () => ({
  __esModule: true,
  default: { findById: (id: string) => mockFindUser(id) },
}));

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: {
    create: jest.fn().mockResolvedValue(true),
    aggregate: jest.fn(() => Promise.resolve([{ total: mockStorageUsed }])),
  },
}));

jest.mock('@/models/userDocument', () => ({
  __esModule: true,
  default: { create: jest.fn().mockResolvedValue({}), aggregate: jest.fn().mockResolvedValue([]) },
}));

jest.mock('@/lib/storage', () => ({
  getStorage: () => ({ put: jest.fn().mockResolvedValue(undefined) }),
  LocalDiskStorage: class {},
}));

// The tool's own work is beside the point here, and HTML to PDF's would start Chromium.
jest.mock('@/lib/html/to-pdf', () => ({
  convertHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7')),
}));

jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: jest.fn().mockResolvedValue(true),
  recordConversionHistory: jest.fn().mockResolvedValue(true),
}));

import { POST as compressPdf } from '../app/api/convert/compress-pdf/route';
import { POST as docxToPdf } from '../app/api/convert/docx-to-pdf/route';
import { POST as findPdf } from '../app/api/convert/find-pdf/route';
import { POST as htmlToPdf } from '../app/api/convert/html-to-pdf/route';
import { POST as imageCompress } from '../app/api/convert/image-compress/route';
import { POST as imageToPdf } from '../app/api/convert/image-to-pdf/route';
import { POST as jpgToPng } from '../app/api/convert/jpg-to-png/route';
import { POST as lockPdf } from '../app/api/convert/lock-pdf/route';
import { POST as mergePdf } from '../app/api/convert/merge-pdf/route';
import { POST as pdfToDocx } from '../app/api/convert/pdf-to-docx/route';
import { POST as splitPdf } from '../app/api/convert/split-pdf/route';
import { POST as videoCompress } from '../app/api/convert/video-compress/route';
import { POST as uploadDocuments } from '../app/api/documents/upload/route';

jest.setTimeout(60_000);

interface UploadRoute {
  name: string;
  handler: (req: NextRequest) => Promise<Response>;
  url: string;
  field: string;
  guestCapMb: number;
  /** The route's own refusal for an over-cap upload. */
  guestRefusal: string;
  proCapMb: number;
  status?: number;
}

const pdfCap = (mb: number) => `Your current plan allows PDFs up to ${mb}MB.`;
const docxRefusal =
  'This PDF is too large; your plan allows converting PDFs up to 5 MB to Word. This limit is specific to PDF to Word and is lower than the general upload limit.';

const ROUTES: UploadRoute[] = [
  { name: 'compress-pdf', handler: compressPdf, url: '/api/convert/compress-pdf', field: 'pdf', guestCapMb: 25, guestRefusal: pdfCap(25), proCapMb: 100 },
  { name: 'split-pdf', handler: splitPdf, url: '/api/convert/split-pdf', field: 'pdf', guestCapMb: 25, guestRefusal: pdfCap(25), proCapMb: 100 },
  { name: 'lock-pdf', handler: lockPdf, url: '/api/convert/lock-pdf', field: 'pdf', guestCapMb: 25, guestRefusal: pdfCap(25), proCapMb: 100 },
  { name: 'find-pdf', handler: findPdf, url: '/api/convert/find-pdf', field: 'pdf', guestCapMb: 25, guestRefusal: pdfCap(25), proCapMb: 100 },
  { name: 'merge-pdf', handler: mergePdf, url: '/api/convert/merge-pdf', field: 'pdfs', guestCapMb: 25, guestRefusal: 'Your current plan allows merges totaling up to 25MB.', proCapMb: 100 },
  { name: 'pdf-to-docx', handler: pdfToDocx, url: '/api/convert/pdf-to-docx', field: 'pdf', guestCapMb: 5, guestRefusal: docxRefusal, proCapMb: 15 },
  { name: 'html-to-pdf', handler: htmlToPdf, url: '/api/convert/html-to-pdf', field: 'html', guestCapMb: 25, guestRefusal: 'Your current plan allows HTML files up to 25MB.', proCapMb: 100 },
  { name: 'docx-to-pdf', handler: docxToPdf, url: '/api/convert/docx-to-pdf', field: 'docx', guestCapMb: 25, guestRefusal: 'Your current plan allows DOCX files up to 25MB.', proCapMb: 100 },
  { name: 'image-to-pdf', handler: imageToPdf, url: '/api/convert/image-to-pdf', field: 'images', guestCapMb: 25, guestRefusal: 'Your current plan allows up to 25MB of images per conversion.', proCapMb: 100 },
  { name: 'image-compress', handler: imageCompress, url: '/api/convert/image-compress', field: 'images', guestCapMb: 25, guestRefusal: 'Your current plan allows up to 25MB of images per compression.', proCapMb: 100 },
  { name: 'jpg-to-png', handler: jpgToPng, url: '/api/convert/jpg-to-png', field: 'images', guestCapMb: 25, guestRefusal: 'Your current plan allows up to 25MB of images per conversion.', proCapMb: 100 },
  { name: 'video-compress', handler: videoCompress, url: '/api/convert/video-compress', field: 'video', guestCapMb: 50, guestRefusal: 'Your current plan allows videos up to 50MB.', proCapMb: 500 },
];

const STORAGE_FULL_MESSAGE = 'Storage limit reached. Cannot upload these files. Upgrade to Pro for more space.';

function upload(route: { url: string; field: string }, sizeBytes: number, declareLength = true) {
  return streamedUpload(`http://localhost:3000${route.url}`, route.field, sizeBytes, { declareLength });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockStorageUsed = 0;
});

describe.each(ROUTES)('$name upload size', (route) => {
  it('refuses an over-cap guest Content-Length with its own message before reading the body', async () => {
    const request = upload(route, 400 * MB);

    const res = await route.handler(request.request);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(route.guestRefusal);
    expect(request.bytesRead()).toBe(0);
  });

  it('cuts off an over-cap guest body that has no Content-Length', async () => {
    const request = upload(route, 400 * MB, false);

    const res = await route.handler(request.request);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(route.guestRefusal);
    expect(request.bytesRead()).toBeLessThan((route.guestCapMb + 4) * MB);
  });

  it("resolves the plan first and refuses against the signed-in plan's cap", async () => {
    mockUserId = '507f1f77bcf86cd799439012';
    mockPlan = 'Pro';
    const request = upload(route, (route.proCapMb + 2) * MB);

    const res = await route.handler(request.request);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(`${route.proCapMb}`);
    expect(mockFindUser).toHaveBeenCalled();
    expect(request.bytesRead()).toBe(0);
  });

  it('reads an in-cap upload through to the tool', async () => {
    const request = upload(route, 1024);

    const res = await route.handler(request.request);

    expect(request.bytesRead()).toBeGreaterThan(1024);
    expect(await res.text()).not.toMatch(/plan allows/);
  });
});

describe('documents/upload size', () => {
  const route = { url: '/api/documents/upload', field: 'files' };

  beforeEach(() => {
    mockUserId = '507f1f77bcf86cd799439011';
    mockPlan = 'Basic';
  });

  it('refuses a Content-Length over the remaining storage before reading the body', async () => {
    mockStorageUsed = 40 * MB;
    const request = upload(route, 20 * MB);

    const res = await uploadDocuments(request.request);

    expect(res.status).toBe(507);
    expect((await res.json()).error).toBe(STORAGE_FULL_MESSAGE);
    expect(request.bytesRead()).toBe(0);
  });

  it('cuts off a body without a Content-Length once it passes the remaining storage', async () => {
    mockStorageUsed = 40 * MB;
    const request = upload(route, 400 * MB, false);

    const res = await uploadDocuments(request.request);

    expect(res.status).toBe(507);
    expect((await res.json()).error).toBe(STORAGE_FULL_MESSAGE);
    expect(request.bytesRead()).toBeLessThan(14 * MB);
  });

  it('stores an upload that fits', async () => {
    const request = upload(route, 1024);

    const res = await uploadDocuments(request.request);

    expect(res.status).toBe(201);
  });
});

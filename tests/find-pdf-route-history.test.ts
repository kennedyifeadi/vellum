import { NextRequest } from 'next/server';

let mockUserId: string | null = null;
let mockUser: any = { plan: 'Basic', preferences: { autoDelete: false } };
const HIGHLIGHTED_PDF = new Uint8Array([1, 2, 3]);

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
    findById: jest.fn().mockImplementation(() => Promise.resolve(mockUserId ? mockUser : null)),
  },
}));

const conversionCreate = jest.fn().mockResolvedValue({ _id: 'c1' });
jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: { create: (...args: any[]) => conversionCreate(...args) },
}));

const mockStoragePut = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/storage', () => ({
  getStorage: () => ({ put: mockStoragePut }),
  LocalDiskStorage: class {},
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() =>
    Promise.resolve([
      {
        name: 'doc.pdf',
        type: 'application/pdf',
        size: 2048,
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(2048)),
      },
    ]),
  ),
}));

jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: jest.fn().mockImplementation(() => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: jest.fn().mockResolvedValue({
        getTextContent: jest.fn().mockResolvedValue({
          items: [{ str: 'quarterly report', hasEOL: false, width: 96, height: 12, transform: [12, 0, 0, 12, 30, 250] }],
        }),
      }),
    }),
  })),
}));

jest.mock('pdf-lib', () => ({
  PDFDocument: {
    load: jest.fn().mockResolvedValue({
      getPage: jest.fn().mockReturnValue({ drawRectangle: jest.fn() }),
      save: jest.fn().mockImplementation(() => Promise.resolve(HIGHLIGHTED_PDF)),
    }),
  },
  rgb: jest.fn().mockReturnValue({}),
}));

import { POST as handleFindPdf } from '../app/api/convert/find-pdf/route';

function findReq(searchTerm: string) {
  const formData = new FormData();
  formData.append('searchTerm', searchTerm);
  return new NextRequest('http://localhost:3000/api/convert/find-pdf', {
    method: 'POST',
    body: formData,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = '507f1f77bcf86cd799439011';
  mockUser = { plan: 'Basic', preferences: { autoDelete: false } };
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('find-pdf route — history', () => {
  it('still returns the highlighted PDF when the history write fails', async () => {
    conversionCreate.mockRejectedValueOnce(new Error('mongo timeout'));

    const res = await handleFindPdf(findReq('quarterly'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matchCount).toBe(1);
    expect(body.pdfBase64).toBe(Buffer.from(HIGHLIGHTED_PDF).toString('base64'));
    expect(conversionCreate).toHaveBeenCalledTimes(1);
  });

  it('records a history-only row: standard status and retention, no stored output', async () => {
    const now = Date.now();

    const res = await handleFindPdf(findReq('Quarterly'));

    expect(res.status).toBe(200);
    expect(conversionCreate).toHaveBeenCalledTimes(1);
    const record = conversionCreate.mock.calls[0][0];
    expect(record).toMatchObject({
      userId: mockUserId,
      toolUsed: 'Find in PDF',
      fileName: 'doc.pdf',
      fileSize: 2048,
      status: 'Completed',
      metadata: { pages: 1, matchesFound: 1, searchTerm: 'quarterly' },
    });
    expect(record.outputUrl).toBeUndefined();
    expect(record.diskFileName).toBeUndefined();
    expect(mockStoragePut).not.toHaveBeenCalled();

    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const retentionMs = new Date(record.expiresAt).getTime() - now;
    expect(retentionMs).toBeGreaterThanOrEqual(threeDaysMs - 5000);
    expect(retentionMs).toBeLessThanOrEqual(threeDaysMs + 5000);
  });

  it('records nothing for a guest', async () => {
    mockUserId = null;

    const res = await handleFindPdf(findReq('quarterly'));

    expect(res.status).toBe(200);
    expect(conversionCreate).not.toHaveBeenCalled();
  });
});

import { NextRequest } from 'next/server';

let mockUserId: string | null = null;
let mockPlan = 'Free';
let mockResolvedFiles: any[] = [];
let mockPageItems: any[][] = [];

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
    findById: jest.fn().mockImplementation(() =>
      Promise.resolve(mockUserId ? { plan: mockPlan } : null),
    ),
  },
}));

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: { create: jest.fn().mockResolvedValue({ _id: 'c1' }) },
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: jest.fn().mockImplementation(() => ({
    promise: Promise.resolve({
      numPages: mockPageItems.length,
      getPage: jest.fn().mockImplementation((n: number) =>
        Promise.resolve({
          getTextContent: jest.fn().mockResolvedValue({ items: mockPageItems[n - 1] }),
        }),
      ),
    }),
  })),
}));

const mockDrawRectangle = jest.fn();
jest.mock('pdf-lib', () => ({
  PDFDocument: {
    load: jest.fn().mockResolvedValue({
      getPage: jest.fn().mockReturnValue({ drawRectangle: mockDrawRectangle }),
      save: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }),
  },
  rgb: jest.fn().mockReturnValue({}),
}));

import { POST as handleFindPdf } from '../app/api/convert/find-pdf/route';

function line(str: string, y: number, hasEOL: boolean) {
  return { str, hasEOL, width: str.length * 6, height: 12, transform: [12, 0, 0, 12, 30, y] };
}

const wrappedPage = [
  line('The board reviewed the integration timeline for the', 250, true),
  line('company highlighted in the quarterly report, noting that', 228, true),
  line('operating margins expand once the twenty-', 206, true),
  line('ninth workstream closes and the multi-', 184, true),
  line('page appendix is finalised.', 162, false),
];

function fakeFile(name = 'doc.pdf') {
  return {
    name,
    type: 'application/pdf',
    size: 2048,
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(2048)),
  };
}

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
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [fakeFile()];
  mockPageItems = [wrappedPage];
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('find-pdf route — cross-item matching', () => {
  it('counts a same-line phrase and highlights its one line', async () => {
    const res = await handleFindPdf(findReq('integration timeline'));

    expect(res.status).toBe(200);
    expect((await res.json()).matchCount).toBe(1);
    expect(mockDrawRectangle).toHaveBeenCalledTimes(1);
  });

  it('counts a phrase that spans a line wrap and highlights each spanned line', async () => {
    const res = await handleFindPdf(findReq('the company'));

    expect(res.status).toBe(200);
    expect((await res.json()).matchCount).toBe(1);
    expect(mockDrawRectangle).toHaveBeenCalledTimes(2);
  });

  it('counts and highlights a hyphenated word broken across a line wrap', async () => {
    const res = await handleFindPdf(findReq('twenty-ninth'));

    expect(res.status).toBe(200);
    expect((await res.json()).matchCount).toBe(1);
    expect(mockDrawRectangle).toHaveBeenCalledTimes(2);
  });

  it('reports zero and draws no highlight for a genuinely absent phrase', async () => {
    const res = await handleFindPdf(findReq('nowhere in the document'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matchCount).toBe(0);
    expect(body.pdfBase64).toBeTruthy();
    expect(mockDrawRectangle).not.toHaveBeenCalled();
  });

  it('fixes the count for the count-only tiers without leaking snippets', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    mockPlan = 'Basic';

    const res = await handleFindPdf(findReq('the company'));

    const body = await res.json();
    expect(body.matchCount).toBe(1);
    expect(body.matches).toEqual([]);
  });

  it('returns snippets around cross-item matches for Pro', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    mockPlan = 'Pro';

    const res = await handleFindPdf(findReq('the company'));

    const body = await res.json();
    expect(body.matchCount).toBe(1);
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].page).toBe(1);
    expect(body.matches[0].snippet).toContain('the company');
  });
});

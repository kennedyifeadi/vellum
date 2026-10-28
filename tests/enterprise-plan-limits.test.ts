import { NextRequest } from 'next/server';

const VALID_HEX_ENTERPRISE = '507f1f77bcf86cd799439021';

let mockUserId: string | null = VALID_HEX_ENTERPRISE;
let mockPlan: string = 'Enterprise';
let mockResolvedFiles: any[] = [];
let mockExistingUsage = 0;
let mockNumPages = 1;

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
    findById: jest.fn().mockImplementation(() => ({
      lean: jest.fn().mockImplementation(() => Promise.resolve({ plan: mockPlan })),
      then: (resolve: any, reject: any) => Promise.resolve({ plan: mockPlan }).then(resolve, reject),
      plan: mockPlan,
    })),
  },
}));

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: {
    aggregate: jest.fn().mockImplementation(() => Promise.resolve([{ total: mockExistingUsage }])),
    create: jest.fn().mockResolvedValue({ _id: 'mock-conversion-id' }),
  },
}));

jest.mock('@/models/userDocument', () => ({
  __esModule: true,
  default: {
    aggregate: jest.fn().mockImplementation(() => Promise.resolve([{ total: 0 }])),
    create: jest.fn().mockImplementation((data: any) => Promise.resolve({ _id: 'mock-doc-id', ...data })),
  },
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/storage', () => ({
  getStorage: jest.fn().mockReturnValue({ put: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock('@/lib/pdf/split', () => ({
  splitPdf: jest.fn().mockResolvedValue(new Map([['split_document_page_1.pdf', Buffer.from('pdf')]])),
}));

jest.mock('@/lib/pdf/merge', () => ({
  mergePdfs: jest.fn().mockResolvedValue(Buffer.from('merged-pdf')),
}));

jest.mock('@/lib/image/to-pdf', () => ({
  convertImagesToPdf: jest.fn().mockResolvedValue(Buffer.from('image-pdf')),
}));

jest.mock('@/lib/video/compress', () => ({
  compressVideo: jest.fn().mockResolvedValue({
    bytes: Buffer.from('compressed-video'),
    compressed: true,
    format: { extension: 'mp4', contentType: 'video/mp4' },
  }),
}));

// Stands in for the extraction worker, which refuses a PDF over the page cap it is given.
jest.mock('@/lib/convert/find-pdf-extraction', () => ({
  extractPdfTextItems: jest.fn().mockImplementation(async (_data: Uint8Array, { maxPages }: { maxPages: number }) => {
    if (mockNumPages > maxPages) {
      const { PdfExtractionError } = jest.requireActual('@/lib/convert/pdf-worker');
      throw new PdfExtractionError({ reason: 'page-limit', pageCount: mockNumPages }, 'over the page limit');
    }
    return Array.from({ length: mockNumPages }, () => []);
  }),
}));

jest.mock('pdf-lib', () => ({
  PDFDocument: {
    load: jest.fn().mockResolvedValue({
      getPage: jest.fn().mockReturnValue({ drawRectangle: jest.fn() }),
      save: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }),
  },
  rgb: jest.fn().mockReturnValue({}),
}));

import { POST as handleSplitPdf } from '../app/api/convert/split-pdf/route';
import { POST as handleMergePdf } from '../app/api/convert/merge-pdf/route';
import { POST as handleImageToPdf } from '../app/api/convert/image-to-pdf/route';
import { POST as handleImageCompress } from '../app/api/convert/image-compress/route';
import { POST as handleJpgToPng } from '../app/api/convert/jpg-to-png/route';
import { POST as handleVideoCompress } from '../app/api/convert/video-compress/route';
import { POST as handleFindPdf } from '../app/api/convert/find-pdf/route';
import { POST as handleDocumentUpload } from '../app/api/documents/upload/route';
import { GET as handleStorage } from '../app/api/storage/route';

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

function fakeFile(size: number, name = 'file.bin') {
  return { name, size, type: 'application/octet-stream', arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) };
}

function postReq(path: string) {
  return new NextRequest(`http://localhost:3000${path}`, { method: 'POST', body: new FormData() });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = VALID_HEX_ENTERPRISE;
  mockPlan = 'Enterprise';
  mockResolvedFiles = [];
  mockExistingUsage = 0;
  mockNumPages = 1;
});

afterEach(() => {
  jest.restoreAllMocks();
});

jest.setTimeout(30_000);

describe('Enterprise plan limits — PDF size (split-pdf)', () => {
  it('accepts an Enterprise PDF of exactly 200MB', async () => {
    mockResolvedFiles = [fakeFile(200 * MB, 'big.pdf')];
    const res = await handleSplitPdf(postReq('/api/convert/split-pdf'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });

  it('refuses an Enterprise PDF one byte past 200MB, naming the cap', async () => {
    mockResolvedFiles = [fakeFile(200 * MB + 1, 'huge.pdf')];
    const res = await handleSplitPdf(postReq('/api/convert/split-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('200MB');
  });

  it('still holds Pro to 100MB', async () => {
    mockPlan = 'Pro';
    mockResolvedFiles = [fakeFile(100 * MB, 'ok.pdf')];
    expect((await handleSplitPdf(postReq('/api/convert/split-pdf'))).status).toBe(200);

    mockResolvedFiles = [fakeFile(100 * MB + 1, 'big.pdf')];
    const res = await handleSplitPdf(postReq('/api/convert/split-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('100MB');
  });

  it('still rejects a guest at the guest cap (25MB) — the fallthrough bug is gone, not universal', async () => {
    mockUserId = null;
    mockPlan = 'Free';
    mockResolvedFiles = [fakeFile(200 * MB, 'big.pdf')];
    const res = await handleSplitPdf(postReq('/api/convert/split-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('25MB');
  });
});

describe('Enterprise plan limits — file count (merge-pdf)', () => {
  it('accepts 100 files from an Enterprise user', async () => {
    mockResolvedFiles = Array(100).fill(fakeFile(MB, 'a.pdf'));
    const res = await handleMergePdf(postReq('/api/convert/merge-pdf'));
    expect(res.status).toBe(200);
  });

  it('refuses a 101st file from an Enterprise user, naming the cap', async () => {
    mockResolvedFiles = Array(101).fill(fakeFile(MB, 'a.pdf'));
    const res = await handleMergePdf(postReq('/api/convert/merge-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows up to 100 files per merge.');
  });

  it('keeps the Enterprise request total at 250MB', async () => {
    const quarter = (250 * MB) / 4;
    mockResolvedFiles = Array(4).fill(fakeFile(quarter, 'a.pdf'));
    expect((await handleMergePdf(postReq('/api/convert/merge-pdf'))).status).toBe(200);

    mockResolvedFiles = [...Array(3).fill(fakeFile(quarter, 'a.pdf')), fakeFile(quarter + 1, 'b.pdf')];
    const res = await handleMergePdf(postReq('/api/convert/merge-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('250MB');
  });

  it('still holds Pro to 50 files', async () => {
    mockPlan = 'Pro';
    mockResolvedFiles = Array(51).fill(fakeFile(MB, 'a.pdf'));
    const res = await handleMergePdf(postReq('/api/convert/merge-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('up to 50 files');
  });

  it('still caps a guest at 3 files', async () => {
    mockUserId = null;
    mockPlan = 'Free';
    mockResolvedFiles = Array(4).fill(fakeFile(MB, 'a.pdf'));
    const res = await handleMergePdf(postReq('/api/convert/merge-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('up to 3 files');
  });
});

describe('Enterprise plan limits — image-to-pdf', () => {
  it('accepts 100 images totalling exactly 200MB from an Enterprise user', async () => {
    mockResolvedFiles = Array(100).fill(fakeFile(2 * MB, 'a.jpg'));
    const res = await handleImageToPdf(postReq('/api/convert/image-to-pdf'));
    expect(res.status).toBe(200);
  });

  it('refuses a 101st image from an Enterprise user, naming the cap', async () => {
    mockResolvedFiles = Array(101).fill(fakeFile(MB, 'a.jpg'));
    const res = await handleImageToPdf(postReq('/api/convert/image-to-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('100 files');
  });

  it('refuses an Enterprise request one byte past 200MB, naming the cap', async () => {
    mockResolvedFiles = [...Array(99).fill(fakeFile(2 * MB, 'a.jpg')), fakeFile(2 * MB + 1, 'b.jpg')];
    const res = await handleImageToPdf(postReq('/api/convert/image-to-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('200MB');
  });

  it('still holds Pro to 50 images', async () => {
    mockPlan = 'Pro';
    mockResolvedFiles = Array(51).fill(fakeFile(MB, 'a.jpg'));
    const res = await handleImageToPdf(postReq('/api/convert/image-to-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('50 files');
  });
});

describe('Enterprise plan limits — file count (image-compress, jpg-to-png)', () => {
  it.each([
    ['image-compress', () => handleImageCompress(postReq('/api/convert/image-compress'))],
    ['jpg-to-png', () => handleJpgToPng(postReq('/api/convert/jpg-to-png'))],
  ])('%s refuses a 101st image from Enterprise and a 51st from Pro', async (_tool, send) => {
    mockResolvedFiles = Array(101).fill(fakeFile(MB, 'a.jpg'));
    let res = await send();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('up to 100 images');

    mockPlan = 'Pro';
    mockResolvedFiles = Array(51).fill(fakeFile(MB, 'a.jpg'));
    res = await send();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('up to 50 images');
  });

  it('still caps image-compress for a guest at 3', async () => {
    mockUserId = null;
    mockPlan = 'Free';
    mockResolvedFiles = Array(4).fill(fakeFile(MB, 'a.jpg'));
    const res = await handleImageCompress(postReq('/api/convert/image-compress'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('up to 3 images');
  });

  it('still caps jpg-to-png for a guest at 3', async () => {
    mockUserId = null;
    mockPlan = 'Free';
    mockResolvedFiles = Array(4).fill(fakeFile(MB, 'a.jpg'));
    const res = await handleJpgToPng(postReq('/api/convert/jpg-to-png'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('up to 3 images');
  });
});

describe('Enterprise plan limits — video size (video-compress)', () => {
  // Enterprise shares Pro's cap: next.config.ts's body limit (520MB) truncates anything larger.
  it('allows an Enterprise user a video at the 500MB cap', async () => {
    mockResolvedFiles = [fakeFile(500 * MB, 'clip.mp4')];
    const res = await handleVideoCompress(postReq('/api/convert/video-compress'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
  });

  it('rejects an Enterprise user past the 500MB cap', async () => {
    mockResolvedFiles = [fakeFile(501 * MB, 'movie.mp4')];
    const res = await handleVideoCompress(postReq('/api/convert/video-compress'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('500MB');
  });

  it('still caps a guest at 50MB', async () => {
    mockUserId = null;
    mockPlan = 'Free';
    mockResolvedFiles = [fakeFile(600 * MB, 'clip.mp4')];
    const res = await handleVideoCompress(postReq('/api/convert/video-compress'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('50MB');
  });
});

describe('Enterprise plan limits — page count (find-pdf)', () => {
  function findReq() {
    const formData = new FormData();
    formData.append('searchTerm', 'term');
    return new NextRequest('http://localhost:3000/api/convert/find-pdf', { method: 'POST', body: formData });
  }

  it('allows an Enterprise user to search more pages than the Pro cap (100)', async () => {
    mockNumPages = 300;
    mockResolvedFiles = [fakeFile(MB, 'doc.pdf')];
    const res = await handleFindPdf(findReq());
    expect(res.status).toBe(200);
  });

  it('rejects an Enterprise user only past the Enterprise cap (500 pages)', async () => {
    mockNumPages = 501;
    mockResolvedFiles = [fakeFile(MB, 'doc.pdf')];
    const res = await handleFindPdf(findReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('500 pages');
  });

  it('still caps a guest at 10 pages', async () => {
    mockUserId = null;
    mockPlan = 'Free';
    mockNumPages = 50;
    mockResolvedFiles = [fakeFile(MB, 'doc.pdf')];
    const res = await handleFindPdf(findReq());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('10 pages');
  });
});

describe('Enterprise plan limits — storage staging quota (documents/upload)', () => {
  function uploadReq(byteSize: number, fileName = 'doc.pdf') {
    const formData = new FormData();
    formData.append('files', new File([new Uint8Array(byteSize)], fileName, { type: 'application/pdf' }));
    return new NextRequest('http://localhost:3000/api/documents/upload', { method: 'POST', body: formData });
  }

  it('lets an Enterprise user stage past the 100MB Pro cap', async () => {
    mockExistingUsage = 150 * MB;
    const res = await handleDocumentUpload(uploadReq(2000));
    expect(res.status).toBe(201);
  });

  it('rejects an Enterprise user only past the 500MB Enterprise cap', async () => {
    mockExistingUsage = 500 * MB - 50;
    const res = await handleDocumentUpload(uploadReq(100, 'over.zip'));
    expect(res.status).toBe(507);
  });
});

describe('Enterprise plan limits — storage total (storage route)', () => {
  it('reports the 100GB Enterprise limit, not the 5GB Basic fallback', async () => {
    const req = new NextRequest('http://localhost:3000/api/storage', { method: 'GET' });
    const res = await handleStorage(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.plan).toBe('Enterprise');
    expect(data.limitBytes).toBe(100 * GB);
  });
});

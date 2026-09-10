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

jest.mock('ffmpeg-static', () => ({ __esModule: true, default: '/fake/ffmpeg' }));

jest.mock('fluent-ffmpeg', () => {
  const chain: any = {
    videoCodec: () => chain,
    outputOptions: () => chain,
    size: () => chain,
    on: (event: string, cb: (...a: any[]) => void) => {
      if (event === 'end') setImmediate(cb);
      return chain;
    },
    save: () => chain,
  };
  const fn: any = jest.fn(() => chain);
  fn.setFfmpegPath = jest.fn();
  return { __esModule: true, default: fn };
});

jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: jest.fn().mockImplementation(() => ({
    promise: Promise.resolve({
      numPages: mockNumPages,
      getPage: jest.fn().mockResolvedValue({
        getTextContent: jest.fn().mockResolvedValue({ items: [] }),
      }),
    }),
  })),
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

import fs from 'fs';
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
  jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined as any);
  jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('compressed-video'));
  jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  jest.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined as any);
  mockUserId = VALID_HEX_ENTERPRISE;
  mockPlan = 'Enterprise';
  mockResolvedFiles = [];
  mockExistingUsage = 0;
  mockNumPages = 1;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Enterprise plan limits — PDF size (split-pdf)', () => {
  it('allows an Enterprise user a PDF larger than the Pro cap (100MB)', async () => {
    mockResolvedFiles = [fakeFile(200 * MB, 'big.pdf')];
    const res = await handleSplitPdf(postReq('/api/convert/split-pdf'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });

  it('rejects an Enterprise user only past the Enterprise cap (500MB), not the guest cap', async () => {
    mockResolvedFiles = [fakeFile(501 * MB, 'huge.pdf')];
    const res = await handleSplitPdf(postReq('/api/convert/split-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('500MB');
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
  it('allows an Enterprise user more files than the Pro cap (50)', async () => {
    mockResolvedFiles = Array(120).fill(fakeFile(MB, 'a.pdf'));
    const res = await handleMergePdf(postReq('/api/convert/merge-pdf'));
    expect(res.status).toBe(200);
  });

  it('rejects an Enterprise user only past the Enterprise cap (250 files)', async () => {
    mockResolvedFiles = Array(251).fill(fakeFile(MB, 'a.pdf'));
    const res = await handleMergePdf(postReq('/api/convert/merge-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('250 files');
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

describe('Enterprise plan limits — file count (image-to-pdf)', () => {
  it('allows an Enterprise user more files than the Pro cap (50)', async () => {
    mockResolvedFiles = Array(120).fill(fakeFile(MB, 'a.jpg'));
    const res = await handleImageToPdf(postReq('/api/convert/image-to-pdf'));
    expect(res.status).toBe(200);
  });

  it('rejects an Enterprise user only past the Enterprise cap (250 files)', async () => {
    mockResolvedFiles = Array(251).fill(fakeFile(MB, 'a.jpg'));
    const res = await handleImageToPdf(postReq('/api/convert/image-to-pdf'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('250 files');
  });
});

describe('Enterprise plan limits — file count (image-compress, jpg-to-png)', () => {
  it('rejects image-compress for an Enterprise user only past the Enterprise cap (250)', async () => {
    mockResolvedFiles = Array(251).fill(fakeFile(MB, 'a.jpg'));
    const res = await handleImageCompress(postReq('/api/convert/image-compress'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('up to 250 images');
  });

  it('still caps image-compress for a guest at 3', async () => {
    mockUserId = null;
    mockPlan = 'Free';
    mockResolvedFiles = Array(4).fill(fakeFile(MB, 'a.jpg'));
    const res = await handleImageCompress(postReq('/api/convert/image-compress'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('up to 3 images');
  });

  it('rejects jpg-to-png for an Enterprise user only past the Enterprise cap (250)', async () => {
    mockResolvedFiles = Array(251).fill(fakeFile(MB, 'a.jpg'));
    const res = await handleJpgToPng(postReq('/api/convert/jpg-to-png'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('up to 250 images');
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
  it('allows an Enterprise user a video larger than the Pro cap (500MB)', async () => {
    mockResolvedFiles = [fakeFile(600 * MB, 'clip.mp4')];
    const res = await handleVideoCompress(postReq('/api/convert/video-compress'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
  });

  it('rejects an Enterprise user only past the Enterprise cap (2500MB)', async () => {
    mockResolvedFiles = [fakeFile(2501 * MB, 'movie.mp4')];
    const res = await handleVideoCompress(postReq('/api/convert/video-compress'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('2500MB');
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

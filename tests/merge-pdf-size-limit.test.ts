import { NextRequest } from 'next/server';

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

const mergePdfs = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 merged'));
jest.mock('@/lib/pdf/merge', () => ({
  mergePdfs: (opts: any) => mergePdfs(opts),
}));

import { POST as handleMergePdf } from '../app/api/convert/merge-pdf/route';

function fakeFile(sizeBytes: number, name = 'part.pdf') {
  return {
    name,
    type: 'application/pdf',
    size: sizeBytes,
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(sizeBytes)),
  };
}

function mergeRequest() {
  return new NextRequest('http://localhost:3000/api/convert/merge-pdf', {
    method: 'POST',
    body: new FormData(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
});

describe('merge-pdf per-plan total size limit', () => {
  it('rejects a guest merge whose combined size exceeds 25MB before reading any buffer', async () => {
    mockResolvedFiles = [fakeFile(13 * MB), fakeFile(13 * MB)];

    const res = await handleMergePdf(mergeRequest());

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Your current plan allows merges totaling up to 25MB.');
    expect(mergePdfs).not.toHaveBeenCalled();
    for (const file of mockResolvedFiles) {
      expect(file.arrayBuffer).not.toHaveBeenCalled();
    }
  });

  it('allows a guest merge whose combined size is within 25MB', async () => {
    mockResolvedFiles = [fakeFile(12 * MB), fakeFile(12 * MB)];

    const res = await handleMergePdf(mergeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(mergePdfs).toHaveBeenCalledTimes(1);
  });

  it('gives Basic plan a 50MB combined limit', async () => {
    mockUserId = VALID_HEX_BASIC;
    mockPlan = 'Basic';
    mockResolvedFiles = [fakeFile(26 * MB), fakeFile(25 * MB)];

    const res = await handleMergePdf(mergeRequest());

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Your current plan allows merges totaling up to 50MB.');
  });

  it('gives Pro plan a 100MB combined limit', async () => {
    mockUserId = VALID_HEX_PRO;
    mockPlan = 'Pro';
    mockResolvedFiles = [fakeFile(60 * MB), fakeFile(41 * MB)];

    const res = await handleMergePdf(mergeRequest());

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Your current plan allows merges totaling up to 100MB.');
  });

  it('gives Enterprise plan a limit above Pro and still enforces it', async () => {
    mockUserId = VALID_HEX_ENTERPRISE;
    mockPlan = 'Enterprise';

    mockResolvedFiles = [fakeFile(120 * MB), fakeFile(120 * MB)];
    const allowed = await handleMergePdf(mergeRequest());
    expect(allowed.status).toBe(200);

    mockResolvedFiles = [fakeFile(130 * MB), fakeFile(130 * MB)];
    const rejected = await handleMergePdf(mergeRequest());
    expect(rejected.status).toBe(400);
    const data = await rejected.json();
    expect(data.error).toBe('Your current plan allows merges totaling up to 250MB.');
  });

  it('still enforces the file-count limit independently of size', async () => {
    mockResolvedFiles = [fakeFile(1 * MB), fakeFile(1 * MB), fakeFile(1 * MB), fakeFile(1 * MB)];

    const res = await handleMergePdf(mergeRequest());

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Your current plan allows up to 3 files per merge.');
  });
});

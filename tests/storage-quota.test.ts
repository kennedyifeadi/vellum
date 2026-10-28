import { NextRequest } from 'next/server';

let mockPlan = 'Basic';
let mockConversionBytes = 0;
let mockDocumentBytes = 0;

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockResolvedValue('507f1f77bcf86cd799439031'),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {
    findById: jest.fn().mockImplementation(() => ({ lean: () => Promise.resolve({ plan: mockPlan }) })),
  },
}));

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: { aggregate: jest.fn().mockImplementation(() => Promise.resolve([{ total: mockConversionBytes }])) },
}));

jest.mock('@/models/userDocument', () => ({
  __esModule: true,
  default: {
    aggregate: jest.fn().mockImplementation(() => Promise.resolve([{ total: mockDocumentBytes }])),
    create: jest.fn().mockImplementation((data: object) => Promise.resolve({ _id: 'doc-id', ...data })),
  },
}));

jest.mock('@/lib/storage', () => ({
  getStorage: jest.fn().mockReturnValue({ put: jest.fn().mockResolvedValue(undefined) }),
}));

import { POST as uploadDocuments } from '../app/api/documents/upload/route';
import { GET as getStorage } from '../app/api/storage/route';

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const DAY_MS = 24 * 60 * 60 * 1000;

jest.setTimeout(30_000);

function uploadReq(byteSize: number, fileName = 'doc.pdf') {
  const formData = new FormData();
  formData.append('files', new File([new Uint8Array(byteSize)], fileName, { type: 'application/pdf' }));
  return new NextRequest('http://localhost:3000/api/documents/upload', { method: 'POST', body: formData });
}

async function reportedStorage() {
  const res = await getStorage(new NextRequest('http://localhost:3000/api/storage'));
  expect(res.status).toBe(200);
  return res.json() as Promise<{ usedBytes: number; limitBytes: number; plan: string }>;
}

/** Splits `usedBytes` between conversion history and stored documents, so both must be counted. */
function setUsage(usedBytes: number) {
  mockConversionBytes = Math.floor(usedBytes / 3);
  mockDocumentBytes = usedBytes - mockConversionBytes;
}

beforeEach(() => {
  mockPlan = 'Basic';
  setUsage(0);
});

describe('/api/storage reports what documents/upload enforces', () => {
  it.each([
    ['Basic', 50 * MB],
    ['Pro', 100 * MB],
    ['Enterprise', GB],
  ])('%s: the reported limit is the quota upload refuses past', async (plan, quota) => {
    mockPlan = plan;
    setUsage(quota - KB);

    const reported = await reportedStorage();
    expect(reported).toEqual({ usedBytes: quota - KB, limitBytes: quota, plan });

    expect((await uploadDocuments(uploadReq(KB))).status).toBe(201);
    expect((await uploadDocuments(uploadReq(KB + 1))).status).toBe(507);
  });

  it('counts conversion history and stored documents once each', async () => {
    mockConversionBytes = 10 * MB;
    mockDocumentBytes = 30 * MB;

    expect((await reportedStorage()).usedBytes).toBe(40 * MB);
  });
});

describe('Enterprise storage quota (1 GB)', () => {
  beforeEach(() => {
    mockPlan = 'Enterprise';
    setUsage(GB - KB);
  });

  it('accepts 1 KB with 1 GB - 1 KB used', async () => {
    const res = await uploadDocuments(uploadReq(KB));
    expect(res.status).toBe(201);
  });

  it('refuses 2 KB with 1 GB - 1 KB used, naming the quota and no larger plan', async () => {
    const res = await uploadDocuments(uploadReq(2 * KB, 'over.zip'));
    expect(res.status).toBe(507);
    const { error } = await res.json();
    expect(error).toContain('1 GB');
    expect(error).toContain('"over.zip"');
    expect(error).not.toMatch(/upgrade/i);
  });
});

describe('the 507 message names the plan\'s quota', () => {
  it.each([
    ['Basic', '50 MB', 'Upgrade to Pro'],
    ['Pro', '100 MB', 'Upgrade to Enterprise'],
  ])('%s: names %s and suggests the next plan', async (plan, quota, upgrade) => {
    mockPlan = plan;
    setUsage(plan === 'Basic' ? 50 * MB : 100 * MB);

    const res = await uploadDocuments(uploadReq(KB, 'full.pdf'));
    expect(res.status).toBe(507);
    const { error } = await res.json();
    expect(error).toContain(quota);
    expect(error).toContain(upgrade);
  });
});

describe('document retention', () => {
  it.each([
    ['Basic', 3],
    ['Pro', 5],
    ['Enterprise', 7],
  ])('keeps a %s document for %d days', async (plan, days) => {
    mockPlan = plan;
    const before = Date.now();

    const res = await uploadDocuments(uploadReq(KB));
    expect(res.status).toBe(201);
    const [doc] = await res.json();

    expect(Math.round((new Date(doc.expiresAt).getTime() - before) / DAY_MS)).toBe(days);
  });
});

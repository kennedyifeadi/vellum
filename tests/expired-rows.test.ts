import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import type { MemoryModel } from './helpers/memoryModel';
import { createMemoryStorage } from './helpers/memoryVideoJobStore';
import { formRequest, MB } from './helpers/uploadRequests';

// Expired means gone to the user (#158): every reader ignores an expired row at once, before
// the sweep has deleted it.

const USER_ID = '507f1f77bcf86cd799439011';
const LIVE_ID = '3f0c1d52-8f5e-4c53-9a44-0b8f1e0c7a11';
const EXPIRED_ID = '9b2e4a10-1c7d-4e2a-8f3b-5d6c7e8f9a22';
const HOUR_MS = 60 * 60 * 1000;

let mockStorage: ReturnType<typeof createMemoryStorage>;

jest.mock('@/lib/auth/jwt', () => ({ getAuthUserId: jest.fn(() => Promise.resolve('507f1f77bcf86cd799439011')) }));
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/storage', () => ({ getStorage: () => mockStorage, LocalDiskStorage: class {} }));
jest.mock('@/models/user', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());
jest.mock('@/models/conversion', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());
jest.mock('@/models/userDocument', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());

import User from '@/models/user';
import Conversion from '@/models/conversion';
import UserDocument from '@/models/userDocument';
import { DELETE as deleteConversion, GET as listConversions } from '../app/api/conversions/route';
import { DELETE as deleteDocument, GET as listDocuments } from '../app/api/documents/route';
import { GET as downloadDocument } from '../app/api/documents/download/[id]/route';
import { POST as uploadDocuments } from '../app/api/documents/upload/route';
import { GET as downloadConversion } from '../app/api/download/[id]/route';
import { GET as readStorage } from '../app/api/storage/route';
import { GET as readBilling } from '../app/api/user/billing/route';
import { POST as exportData } from '../app/api/user/export/route';

const users = User as unknown as MemoryModel;
const conversions = Conversion as unknown as MemoryModel;
const documents = UserDocument as unknown as MemoryModel;

jest.setTimeout(30_000);

let liveConversion: string;
let expiredConversion: string;
let liveDocument: string;
let expiredDocument: string;

const request = (path: string, method = 'GET') => new NextRequest(`http://localhost:3000${path}`, { method });
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  mockStorage = createMemoryStorage();
  users.reset();
  conversions.reset();
  documents.reset();
  users.seed({ _id: USER_ID, plan: 'Basic', email: 'owner@example.com' });

  const live = new Date(Date.now() + HOUR_MS);
  const expired = new Date(Date.now() - HOUR_MS);
  const owned = { userId: USER_ID, status: 'Completed' };
  liveConversion = conversions.seed({ ...owned, fileName: 'live.pdf', diskFileName: `${LIVE_ID}.pdf`, fileSize: 4 * MB, expiresAt: live })._id;
  expiredConversion = conversions.seed({ ...owned, fileName: 'old.pdf', diskFileName: `${EXPIRED_ID}.pdf`, fileSize: 30 * MB, expiresAt: expired })._id;
  liveDocument = documents.seed({ ...owned, fileName: 'live-doc.pdf', diskFileName: 'live.pdf', fileSize: MB, expiresAt: live })._id;
  expiredDocument = documents.seed({ ...owned, fileName: 'old-doc.pdf', diskFileName: 'old.pdf', fileSize: 20 * MB, expiresAt: expired })._id;

  // The sweep has not run yet, so the expired files are still stored.
  for (const key of [`${LIVE_ID}.pdf`, `${EXPIRED_ID}.pdf`, 'docs/live.pdf', 'docs/old.pdf']) {
    await mockStorage.put(key, Buffer.from(key));
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('lists', () => {
  it('Recent Activity lists only unexpired conversions', async () => {
    jest.spyOn(console, 'debug').mockImplementation(() => {});

    const rows = await (await listConversions(request('/api/conversions'))).json();

    expect(rows.map((row: { _id: string }) => row._id)).toEqual([liveConversion]);
  });

  it('My Documents lists only unexpired documents', async () => {
    const rows = await (await listDocuments(request('/api/documents'))).json();

    expect(rows.map((row: { _id: string }) => row._id)).toEqual([liveDocument]);
  });
});

describe('downloads', () => {
  it('serves an unexpired conversion and answers 404 for an expired one', async () => {
    expect((await downloadConversion(request(`/api/download/${LIVE_ID}`), withId(LIVE_ID))).status).toBe(200);
    expect((await downloadConversion(request(`/api/download/${EXPIRED_ID}`), withId(EXPIRED_ID))).status).toBe(404);
  });

  it('serves an unexpired document and answers 404 for an expired one', async () => {
    expect((await downloadDocument(request('/api/documents/download/live'), withId(liveDocument))).status).toBe(200);
    expect((await downloadDocument(request('/api/documents/download/old'), withId(expiredDocument))).status).toBe(404);
  });
});

describe('export and billing', () => {
  it('exports only unexpired history', async () => {
    const res = await exportData(request('/api/user/export', 'POST'));
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const history = JSON.parse(await zip.file('vellum-export/conversion-history.json')!.async('string'));

    expect(history.map((row: { _id: string }) => row._id)).toEqual([liveConversion]);
  });

  it('counts only unexpired conversions', async () => {
    expect(await (await readBilling(request('/api/user/billing'))).json()).toMatchObject({ processedFiles: 1 });
  });
});

describe('quota', () => {
  it('counts only unexpired rows', async () => {
    jest.spyOn(console, 'debug').mockImplementation(() => {});

    expect(await (await readStorage(request('/api/storage'))).json()).toMatchObject({ usedBytes: 5 * MB });
  });

  it('gives the space of expired rows back to uploads', async () => {
    const res = await uploadDocuments(
      formRequest('http://localhost:3000/api/documents/upload', [['files', { name: 'new.pdf', bytes: new Uint8Array(MB) }]]),
    );

    expect(res.status).toBe(201);
  });
});

describe('deleting an expired row', () => {
  it('answers 404 and leaves it to the sweep', async () => {
    expect((await deleteConversion(request(`/api/conversions?id=${expiredConversion}`, 'DELETE'))).status).toBe(404);
    expect((await deleteDocument(request(`/api/documents?id=${expiredDocument}`, 'DELETE'))).status).toBe(404);
    expect(conversions.all()).toHaveLength(2);
    expect(documents.all()).toHaveLength(2);
  });
});

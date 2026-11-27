import { NextRequest } from 'next/server';

const USER_ID = '507f1f77bcf86cd799439011';

// Mongoose fails a query whose _id cannot be cast to an ObjectId, which a route would answer 500.
function castingFindOne() {
  return jest.fn(async (filter: { _id?: unknown }) => {
    if (!/^[0-9a-f]{24}$/i.test(String(filter._id))) {
      throw Object.assign(new Error(`Cast to ObjectId failed for value "${filter._id}"`), { name: 'CastError' });
    }
    return null;
  });
}

jest.mock('@/lib/auth/jwt', () => ({ getAuthUserId: jest.fn().mockResolvedValue('507f1f77bcf86cd799439011') }));
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('@/models/conversion', () => ({ __esModule: true, default: { findOne: castingFindOne() } }));
jest.mock('@/models/userDocument', () => ({ __esModule: true, default: { findOne: castingFindOne() } }));
jest.mock('@/lib/video/video-job-store', () => jest.requireActual('./helpers/videoJobMocks').memoryVideoJobStoreModule());

import Conversion from '@/models/conversion';
import UserDocument from '@/models/userDocument';
import { DELETE as deleteConversion } from '../app/api/conversions/route';
import { DELETE as deleteDocument } from '../app/api/documents/route';
import { GET as downloadDocument } from '../app/api/documents/download/[id]/route';
import { GET as downloadConversion } from '../app/api/download/[id]/route';
import { DELETE as cancelVideoJob, GET as videoJobStatus } from '../app/api/convert/video-compress/jobs/[id]/route';
import { GET as downloadVideoJob } from '../app/api/convert/video-compress/jobs/[id]/download/route';

const MALFORMED_IDS = ['not-an-id', '123', '507f1f77bcf86cd79943901', '507f1f77bcf86cd799439011z', 'zzzzzzzzzzzzzzzzzzzzzzzz'];

type Send = (id: string) => Promise<Response>;

const withId = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (path: string, method = 'GET') => new NextRequest(`http://localhost:3000${path}`, { method });

const ROUTES: [string, Send][] = [
  ['DELETE /api/conversions', (id) => deleteConversion(request(`/api/conversions?id=${encodeURIComponent(id)}`, 'DELETE'))],
  ['DELETE /api/documents', (id) => deleteDocument(request(`/api/documents?id=${encodeURIComponent(id)}`, 'DELETE'))],
  ['GET /api/documents/download/[id]', (id) => downloadDocument(request(`/api/documents/download/${id}`), withId(id))],
  ['GET /api/download/[id]', (id) => downloadConversion(request(`/api/download/${id}`), withId(id))],
  ['GET /api/convert/video-compress/jobs/[id]', (id) => videoJobStatus(request(`/api/convert/video-compress/jobs/${id}`), withId(id))],
  [
    'DELETE /api/convert/video-compress/jobs/[id]',
    (id) => cancelVideoJob(request(`/api/convert/video-compress/jobs/${id}`, 'DELETE'), withId(id)),
  ],
  [
    'GET /api/convert/video-compress/jobs/[id]/download',
    (id) => downloadVideoJob(request(`/api/convert/video-compress/jobs/${id}/download`), withId(id)),
  ],
];

describe.each(ROUTES)('%s', (_name, send) => {
  it.each(MALFORMED_IDS)('answers 404 for the id "%s" without querying', async (id) => {
    const res = await send(id);

    expect(res.status).toBe(404);
    expect((Conversion.findOne as jest.Mock).mock.calls).toHaveLength(0);
    expect((UserDocument.findOne as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('still looks up a well-formed id', async () => {
    expect((await send(USER_ID)).status).toBe(404);
  });
});

beforeEach(() => jest.clearAllMocks());

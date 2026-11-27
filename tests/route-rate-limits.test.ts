import { NextRequest } from 'next/server';

jest.mock('@/lib/auth/jwt', () => ({
  createToken: jest.fn(),
  getAuthUserId: jest.fn().mockResolvedValue(null),
  getAuthSession: jest.fn().mockResolvedValue(null),
  getAuthSessions: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/db/mongodb', () => ({ getMongoClient: jest.fn() }));
jest.mock('@next-auth/mongodb-adapter', () => ({ MongoDBAdapter: () => ({}) }));
jest.mock('next-auth', () => ({
  __esModule: true,
  default: jest.fn(async () => new Response(null, { status: 200 })),
}));
jest.mock('next/headers', () => ({ cookies: async () => ({ set: jest.fn(), delete: jest.fn() }) }));
jest.mock('@/lib/video/video-job-service', () => ({ cancelVideoJob: jest.fn(), videoJobStore: jest.fn() }));
jest.mock('@/lib/video/video-job-access', () => ({
  ...jest.requireActual('@/lib/video/video-job-access'),
  findOwnedVideoJob: jest.fn().mockResolvedValue(null),
}));

import NextAuth from 'next-auth';
import dbConnect from '@/lib/db/mongoose';
import { getAuthSession, getAuthSessions, getAuthUserId } from '@/lib/auth/jwt';
import { findOwnedVideoJob } from '@/lib/video/video-job-access';
import { RATE_LIMITED_MESSAGE } from '@/lib/http/rate-limit';
import * as nextAuthRoute from '../app/api/auth/[...nextauth]/route';
import * as completeProfile from '../app/api/auth/complete-profile/route';
import * as logout from '../app/api/auth/logout/route';
import * as me from '../app/api/auth/me/route';
import * as conversions from '../app/api/conversions/route';
import * as videoJob from '../app/api/convert/video-compress/jobs/[id]/route';
import * as videoJobDownload from '../app/api/convert/video-compress/jobs/[id]/download/route';
import * as documents from '../app/api/documents/route';
import * as documentDownload from '../app/api/documents/download/[id]/route';
import * as conversionDownload from '../app/api/download/[id]/route';
import * as health from '../app/api/health/route';
import * as storage from '../app/api/storage/route';
import * as avatar from '../app/api/user/avatar/route';
import * as billing from '../app/api/user/billing/route';
import * as deleteAccount from '../app/api/user/delete/route';
import * as exportData from '../app/api/user/export/route';
import * as notifications from '../app/api/user/notifications/route';
import * as preferences from '../app/api/user/preferences/route';
import * as profile from '../app/api/user/profile/route';
import * as sessions from '../app/api/user/sessions/route';
import * as starred from '../app/api/user/starred/route';

const READ_LIMIT = 300;
const WRITE_LIMIT = 30;

const OBJECT_ID = '507f1f77bcf86cd799439011';
const FILE_ID = '3f0c1d52-8f5e-4c53-9a44-0b8f1e0c7a11';

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, unknown>> }) => Response | Promise<Response>;

interface Route {
  method: string;
  path: string;
  handler: unknown;
  params?: Record<string, unknown>;
}

const route = (method: string, path: string, handler: unknown, params?: Record<string, unknown>): [string, Route] => [
  `${method} ${path}`,
  { method, path, handler, params },
];

const READS: [string, Route][] = [
  route('GET', '/api/auth/me', me.GET),
  route('GET', '/api/conversions', conversions.GET),
  route('GET', '/api/documents', documents.GET),
  route('GET', `/api/documents/download/${OBJECT_ID}`, documentDownload.GET, { id: OBJECT_ID }),
  route('GET', `/api/download/${FILE_ID}`, conversionDownload.GET, { id: FILE_ID }),
  route('GET', '/api/storage', storage.GET),
  route('GET', `/api/convert/video-compress/jobs/${OBJECT_ID}`, videoJob.GET, { id: OBJECT_ID }),
  route('GET', `/api/convert/video-compress/jobs/${OBJECT_ID}/download`, videoJobDownload.GET, { id: OBJECT_ID }),
  route('GET', '/api/user/billing', billing.GET),
  route('GET', '/api/user/notifications', notifications.GET),
  route('GET', '/api/user/preferences', preferences.GET),
  route('GET', '/api/user/sessions', sessions.GET),
  route('GET', '/api/user/starred', starred.GET),
];

const WRITES: [string, Route][] = [
  route('POST', '/api/auth/complete-profile', completeProfile.POST),
  route('POST', '/api/auth/logout', logout.POST),
  route('POST', '/api/auth/signout', nextAuthRoute.POST, { nextauth: ['signout'] }),
  route('DELETE', `/api/conversions?id=${OBJECT_ID}`, conversions.DELETE),
  route('DELETE', `/api/documents?id=${OBJECT_ID}`, documents.DELETE),
  route('DELETE', `/api/convert/video-compress/jobs/${OBJECT_ID}`, videoJob.DELETE, { id: OBJECT_ID }),
  route('POST', '/api/user/avatar', avatar.POST),
  route('DELETE', '/api/user/delete', deleteAccount.DELETE),
  route('POST', '/api/user/export', exportData.POST),
  route('POST', '/api/user/notifications', notifications.POST),
  route('PATCH', '/api/user/notifications', notifications.PATCH),
  route('PATCH', '/api/user/preferences', preferences.PATCH),
  route('PATCH', '/api/user/profile', profile.PATCH),
  route('DELETE', '/api/user/sessions', sessions.DELETE),
  route('PATCH', '/api/user/starred', starred.PATCH),
];

let nextAddress = 1;
const freshAddress = () => `198.51.${Math.floor(nextAddress / 250)}.${(nextAddress++ % 250) + 1}`;

function send({ method, path, handler, params = {} }: Route, address: string): Promise<Response> {
  const req = new NextRequest(`http://localhost:3000${path}`, { method, headers: { 'x-real-ip': address } });
  return Promise.resolve((handler as Handler)(req, { params: Promise.resolve(params) }));
}

async function spend(target: Route, address: string, count: number) {
  for (let i = 0; i < count; i++) {
    expect((await send(target, address)).status).not.toBe(429);
  }
}

const touchedAnything = () =>
  [dbConnect, getAuthUserId, getAuthSession, getAuthSessions, findOwnedVideoJob, NextAuth].some(
    (fn) => (fn as jest.Mock).mock.calls.length > 0,
  );

async function expectRefusedUntouched(target: Route, address: string) {
  jest.clearAllMocks();
  const res = await send(target, address);
  expect(res.status).toBe(429);
  expect((await res.json()).error).toBe(RATE_LIMITED_MESSAGE);
  expect(touchedAnything()).toBe(false);
}

jest.setTimeout(120_000);

beforeEach(() => {
  process.env.CLIENT_IP_HEADER = 'x-real-ip';
});

afterEach(() => {
  delete process.env.CLIENT_IP_HEADER;
});

describe('read routes', () => {
  it.each(READS)('%s answers 300 reads a minute, then 429 before any query', async (_name, target) => {
    const address = freshAddress();
    await spend(target, address, READ_LIMIT);
    await expectRefusedUntouched(target, address);
  });

  it('share one read budget across routes', async () => {
    const address = freshAddress();
    await spend(READS[0][1], address, READ_LIMIT / 2);
    await spend(READS[1][1], address, READ_LIMIT / 2);
    await expectRefusedUntouched(READS[2][1], address);
  });
});

describe('write routes', () => {
  it.each(WRITES)('%s answers 30 writes a minute, then 429 before any body or query', async (_name, target) => {
    const address = freshAddress();
    await spend(target, address, WRITE_LIMIT);
    await expectRefusedUntouched(target, address);
  });
});

describe('the read and write budgets', () => {
  const [, listDocuments] = READS.find(([name]) => name === 'GET /api/documents')!;
  const [, deleteDocument] = WRITES.find(([name]) => name.startsWith('DELETE /api/documents'))!;

  it('leave reads open once writes are used up', async () => {
    const address = freshAddress();
    await spend(deleteDocument, address, WRITE_LIMIT);
    expect((await send(deleteDocument, address)).status).toBe(429);
    expect((await send(listDocuments, address)).status).not.toBe(429);
  });

  it('leave writes open once reads are used up', async () => {
    const address = freshAddress();
    await spend(listDocuments, address, READ_LIMIT);
    expect((await send(listDocuments, address)).status).toBe(429);
    expect((await send(deleteDocument, address)).status).not.toBe(429);
  });

  it('are kept per caller', async () => {
    const limited = freshAddress();
    await spend(listDocuments, limited, READ_LIMIT);
    expect((await send(listDocuments, limited)).status).toBe(429);
    expect((await send(listDocuments, freshAddress())).status).not.toBe(429);
  });
});

describe('unlimited routes', () => {
  it.each([
    route('GET', '/api/health', health.GET),
    route('GET', '/api/auth/session', nextAuthRoute.GET, { nextauth: ['session'] }),
  ])('%s is never refused', async (_name, target) => {
    const address = freshAddress();
    await spend(target, address, READ_LIMIT + WRITE_LIMIT + 1);
  });
});

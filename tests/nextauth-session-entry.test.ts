import { NextRequest } from 'next/server';
import type { AuthOptions } from 'next-auth';

const USER_ID = '507f1f77bcf86cd799439011';

let mockReceivedOptions: AuthOptions | undefined;

type JwtParams = Parameters<NonNullable<NonNullable<AuthOptions['callbacks']>['jwt']>>[0];

jest.mock('next-auth', () => ({
  __esModule: true,
  default: jest.fn((...args: unknown[]) => {
    mockReceivedOptions = args[args.length - 1] as AuthOptions;
    return args.length === 1 ? async () => new Response() : new Response();
  }),
}));

jest.mock('@/lib/db/mongodb', () => ({ getMongoClient: jest.fn() }));

jest.mock('@next-auth/mongodb-adapter', () => ({ MongoDBAdapter: () => ({}) }));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: { findByIdAndUpdate: jest.fn() },
}));

import User from '@/models/user';
import { GET } from '../app/api/auth/[...nextauth]/route';

async function signInWithGoogle(headers: Record<string, string>) {
  const req = new NextRequest('http://localhost:3000/api/auth/callback/google?code=abc&state=xyz', { headers });
  await GET(req, { params: Promise.resolve({ nextauth: ['callback', 'google'] }) });
  const jwt = mockReceivedOptions!.callbacks!.jwt!;
  return () =>
    jwt({
      token: {},
      user: { id: USER_ID },
      account: { provider: 'google', type: 'oauth', providerAccountId: '1' },
    } as JwtParams);
}

function recordedSessionEntry(call = 0) {
  return (User.findByIdAndUpdate as jest.Mock).mock.calls[call][1].$push.activeSessions;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CLIENT_IP_HEADER = 'x-real-ip';
});

afterEach(() => {
  delete process.env.CLIENT_IP_HEADER;
});

describe('a Google sign-in', () => {
  it('records the device and location from its request', async () => {
    const issueToken = await signInWithGoogle({ 'user-agent': 'Test Browser/1.0', 'x-real-ip': '203.0.113.7' });

    await issueToken();

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(USER_ID, { $push: { activeSessions: expect.any(Object) } });
    expect(recordedSessionEntry()).toMatchObject({ device: 'Test Browser/1.0', location: '203.0.113.7' });
  });

  it('records each sign-in against its own request', async () => {
    const first = await signInWithGoogle({ 'user-agent': 'First Browser', 'x-real-ip': '203.0.113.1' });
    const second = await signInWithGoogle({ 'user-agent': 'Second Browser', 'x-real-ip': '203.0.113.2' });

    await second();
    await first();

    expect(recordedSessionEntry(0)).toMatchObject({ device: 'Second Browser', location: '203.0.113.2' });
    expect(recordedSessionEntry(1)).toMatchObject({ device: 'First Browser', location: '203.0.113.1' });
  });
});

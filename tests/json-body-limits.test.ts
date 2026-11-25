import { NextRequest } from 'next/server';

jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn(),
  getAuthSession: jest.fn(),
  createToken: jest.fn(),
}));
jest.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'b'.repeat(43) }), set: () => undefined, delete: () => undefined }),
}));
jest.mock('@/lib/auth/otp', () => ({ generateOtp: jest.fn().mockResolvedValue('23456789') }));
jest.mock('@/lib/auth/otpRequestLimit', () => ({
  sendWithinOtpLimits: async (_sender: unknown, send: () => Promise<void>) => {
    await send();
    return true;
  },
}));
jest.mock('@/lib/auth/verifyOtp', () => ({ verifyOtp: jest.fn().mockResolvedValue('device-id') }));
jest.mock('@/lib/notifications', () => ({ pushNotification: jest.fn(async (_id: string, fields: object) => fields) }));

import { createToken, getAuthSession, getAuthUserId } from '@/lib/auth/jwt';
import { REQUEST_TOO_LARGE_MESSAGE } from '@/lib/http/read-upload';
import User from '@/models/user';
import { POST as completeProfile } from '../app/api/auth/complete-profile/route';
import { POST as requestOtp } from '../app/api/auth/request-otp/route';
import { POST as verifyOtp } from '../app/api/auth/verify-otp/route';
import { POST as updateAvatar } from '../app/api/user/avatar/route';
import { POST as addNotification } from '../app/api/user/notifications/route';
import { PATCH as updatePreferences } from '../app/api/user/preferences/route';
import { PATCH as updateProfile } from '../app/api/user/profile/route';
import { DELETE as revokeSessions } from '../app/api/user/sessions/route';
import { PATCH as toggleStarred } from '../app/api/user/starred/route';
import { KB, MB, paddedTo, streamedBody } from './helpers/streamedBody';

jest.setTimeout(60_000);

const USER_ID = '6730a1b2c3d4e5f6a7b8c9d0';
const JSON_BODY_LIMIT_BYTES = 16 * KB;
const AVATAR_IMAGE_LIMIT = 3 * MB;
// Room for the rest of the object around an image at the limit.
const AVATAR_BODY_LIMIT_BYTES = AVATAR_IMAGE_LIMIT + JSON_BODY_LIMIT_BYTES;

interface JsonRoute {
  path: string;
  method: string;
  handler: (req: NextRequest) => Promise<Response>;
  body: Record<string, unknown>;
  okStatus: number;
  limit: number;
  invalidJsonMessage: string;
}

const ROUTES: JsonRoute[] = [
  {
    path: '/api/auth/complete-profile', method: 'POST', handler: completeProfile,
    body: { name: 'Ada Lovelace', role: 'Student' }, okStatus: 200, limit: JSON_BODY_LIMIT_BYTES,
    invalidJsonMessage: 'Failed to complete profile',
  },
  {
    path: '/api/auth/request-otp', method: 'POST', handler: requestOtp,
    body: { email: 'user@example.com' }, okStatus: 200, limit: JSON_BODY_LIMIT_BYTES,
    invalidJsonMessage: 'Invalid JSON body.',
  },
  {
    path: '/api/auth/verify-otp', method: 'POST', handler: verifyOtp,
    body: { email: 'user@example.com', code: '2345-6789' }, okStatus: 200, limit: JSON_BODY_LIMIT_BYTES,
    invalidJsonMessage: 'Invalid JSON body.',
  },
  {
    path: '/api/user/avatar', method: 'POST', handler: updateAvatar,
    body: { base64Image: 'data:image/png;base64,iVBORw0KGgo=' }, okStatus: 200, limit: AVATAR_BODY_LIMIT_BYTES,
    invalidJsonMessage: 'Internal Server Error',
  },
  {
    path: '/api/user/notifications', method: 'POST', handler: addNotification,
    body: { type: 'info', title: 'Done', message: 'Your file is ready.' }, okStatus: 201, limit: JSON_BODY_LIMIT_BYTES,
    invalidJsonMessage: 'Internal server error',
  },
  {
    path: '/api/user/preferences', method: 'PATCH', handler: updatePreferences,
    body: { theme: 'dark' }, okStatus: 200, limit: JSON_BODY_LIMIT_BYTES,
    invalidJsonMessage: 'Failed to update preferences',
  },
  {
    path: '/api/user/profile', method: 'PATCH', handler: updateProfile,
    body: { name: 'Ada Lovelace' }, okStatus: 200, limit: JSON_BODY_LIMIT_BYTES,
    invalidJsonMessage: 'Internal Server Error',
  },
  {
    path: '/api/user/sessions', method: 'DELETE', handler: revokeSessions,
    body: { sessionId: 'session-1' }, okStatus: 200, limit: JSON_BODY_LIMIT_BYTES,
    invalidJsonMessage: 'Failed to revoke sessions',
  },
  {
    path: '/api/user/starred', method: 'PATCH', handler: toggleStarred,
    body: { toolId: 'merge-pdf' }, okStatus: 200, limit: JSON_BODY_LIMIT_BYTES,
    invalidJsonMessage: 'Internal server error',
  },
];

function storedUser() {
  return {
    _id: { toString: () => USER_ID },
    email: 'user@example.com',
    isProfileComplete: true,
    tokenVersion: 1,
    starredTools: [] as string[],
    preferences: { theme: 'dark' },
    save: async () => undefined,
  };
}

// Mongoose queries are awaited directly or after .select().
function query<T>(value: T) {
  return Object.assign(Promise.resolve(value), { select: async () => value });
}

function send({ path, method, handler }: JsonRoute, body: string) {
  return handler(new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body,
  }));
}

function sendStreamed({ path, method, handler }: JsonRoute, sizeBytes: number, declaredLength?: number) {
  const streamed = streamedBody(`http://localhost:3000${path}`, sizeBytes, {
    method,
    contentType: 'application/json',
    declaredLength,
  });
  return { response: handler(streamed.request), bytesRead: streamed.bytesRead };
}

beforeEach(() => {
  delete process.env.BREVO_API_KEY;
  jest.mocked(getAuthUserId).mockResolvedValue(USER_ID);
  jest.mocked(getAuthSession).mockResolvedValue({ userId: USER_ID, sessionId: 'test-session', isProfileComplete: false });
  jest.mocked(createToken).mockResolvedValue('new-session');
  jest.spyOn(User, 'findById').mockImplementation((() => query(storedUser())) as never);
  jest.spyOn(User, 'findOne').mockImplementation((() => query(storedUser())) as never);
  jest.spyOn(User, 'findByIdAndUpdate').mockImplementation((() => query(storedUser())) as never);
  jest.spyOn(User, 'findOneAndUpdate').mockImplementation((() => query(storedUser())) as never);
  for (const level of ['log', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ROUTES.map((route) => [`${route.method} ${route.path}`, route] as const))('%s', (_name, route) => {
  const json = JSON.stringify(route.body);

  it('accepts a body at the limit', async () => {
    const res = await send(route, paddedTo(json, route.limit));

    expect(res.status).toBe(route.okStatus);
  });

  it('refuses a body one byte over the limit with a 413', async () => {
    const res = await send(route, paddedTo(json, route.limit + 1));

    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe(REQUEST_TOO_LARGE_MESSAGE);
  });

  it('refuses a declared oversize body without reading it', async () => {
    const { response, bytesRead } = sendStreamed(route, 4 * route.limit, 4 * route.limit);

    expect((await response).status).toBe(413);
    expect(bytesRead()).toBe(0);
  });

  it('stops reading an undeclared oversize body once it passes the limit', async () => {
    const { response, bytesRead } = sendStreamed(route, 4 * route.limit);

    expect((await response).status).toBe(413);
    // Reading stops within one chunk of the limit, not at the end of the body.
    expect(bytesRead()).toBeLessThanOrEqual(route.limit + 64 * KB);
  });

  it('keeps its message for a body that is not JSON', async () => {
    const res = await send(route, 'not-json{{{');

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(route.invalidJsonMessage);
  });
});

describe('POST /api/user/avatar', () => {
  const route = ROUTES.find((r) => r.path === '/api/user/avatar')!;
  const withImage = (length: number) => JSON.stringify({ base64Image: 'A'.repeat(length) });

  it('reaches its own check with an image at the 3 MB image limit', async () => {
    expect((await send(route, withImage(AVATAR_IMAGE_LIMIT))).status).toBe(200);
  });

  it('answers an image just over that limit with its own message', async () => {
    const res = await send(route, withImage(AVATAR_IMAGE_LIMIT + 1));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Image is too large (max 2MB)');
  });
});

describe('authenticated routes', () => {
  it.each(ROUTES.filter((r) => !r.path.startsWith('/api/auth/')).map((r) => [`${r.method} ${r.path}`, r] as const))(
    '%s refuses a signed-out caller without reading the body',
    async (_name, route) => {
      jest.mocked(getAuthUserId).mockResolvedValue(null);
      jest.mocked(getAuthSession).mockResolvedValue(null);

      const { response, bytesRead } = sendStreamed(route, 4 * route.limit);

      expect((await response).status).toBe(401);
      expect(bytesRead()).toBe(0);
    },
  );
});

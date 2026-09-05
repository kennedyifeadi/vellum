import { NextRequest } from 'next/server';

interface MockSession {
  id: string;
  device: string;
  location: string;
  lastActive: Date;
}

interface MockUserRecord {
  _id: string;
  email: string;
  tokenVersion: number;
  activeSessions: MockSession[];
  isProfileComplete?: boolean;
}

let mockUsers: Record<string, MockUserRecord> = {};
let mockAuthUserId: string | null = null;
let mockCookieStore: { get: jest.Mock; set: jest.Mock; delete: jest.Mock };

function createMockUser(id: string, overrides: Partial<MockUserRecord> = {}): MockUserRecord {
  const user: MockUserRecord = {
    _id: id,
    email: `${id}@example.com`,
    tokenVersion: 1,
    activeSessions: [],
    isProfileComplete: true,
    ...overrides,
  };
  mockUsers[id] = user;
  return user;
}

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('@/lib/auth/verifyOtp', () => ({
  verifyOtp: jest.fn().mockResolvedValue(true),
}));

// jose ships ESM-only with no CJS build, which ts-jest's default CommonJS
// transform can't load. We only need createToken/verifyToken's own
// tokenVersion logic under test here, not jose's cryptography, so stand in
// a minimal, non-cryptographic encode/decode pair with the same shape.
jest.mock('jose', () => {
  class SignJWT {
    private payload: Record<string, unknown>;
    constructor(payload: Record<string, unknown>) {
      this.payload = payload;
    }
    setProtectedHeader() {
      return this;
    }
    setIssuedAt() {
      return this;
    }
    setExpirationTime() {
      return this;
    }
    async sign() {
      return Buffer.from(JSON.stringify(this.payload)).toString('base64url');
    }
  }

  async function jwtVerify(token: string) {
    return { payload: JSON.parse(Buffer.from(token, 'base64url').toString('utf-8')) };
  }

  return { SignJWT, jwtVerify };
});

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {
    findById: jest.fn().mockImplementation((id: string) => {
      const record = mockUsers[id] || null;
      const query: any = {};
      query.select = jest.fn().mockReturnValue(query);
      query.lean = jest.fn().mockImplementation(() =>
        Promise.resolve(record ? { tokenVersion: record.tokenVersion } : null)
      );
      // Some call sites await the query directly (no .lean()), e.g. the
      // sessions route reading the full activeSessions/tokenVersion doc.
      query.then = (resolve: (value: unknown) => void, reject: (reason?: unknown) => void) =>
        Promise.resolve(record).then(resolve, reject);
      return query;
    }),
    findOne: jest.fn().mockImplementation(({ email }: { email: string }) =>
      Promise.resolve(Object.values(mockUsers).find((u) => u.email === email) || null)
    ),
    findByIdAndUpdate: jest.fn().mockImplementation((id: string, update: any) => {
      const record = mockUsers[id];
      if (!record) return Promise.resolve(null);
      if (update.$inc?.tokenVersion) {
        record.tokenVersion += update.$inc.tokenVersion;
      }
      if (update.$set && 'activeSessions' in update.$set) {
        record.activeSessions = update.$set.activeSessions;
      }
      if (update.$push?.activeSessions) {
        record.activeSessions.push(update.$push.activeSessions);
      }
      if (update.$pull?.activeSessions?.id) {
        const idToRemove = update.$pull.activeSessions.id;
        record.activeSessions = record.activeSessions.filter((s) => s.id !== idToRemove);
      }
      return Promise.resolve(record);
    }),
    create: jest.fn(),
  },
}));

jest.mock('@/lib/auth/jwt', () => {
  const actual = jest.requireActual('@/lib/auth/jwt');
  return {
    ...actual,
    getAuthUserId: jest.fn().mockImplementation(() => Promise.resolve(mockAuthUserId)),
  };
});

import { createToken, verifyToken } from '../lib/auth/jwt';
import { GET as getSessions, DELETE as deleteSessions } from '../app/api/user/sessions/route';
import { POST as verifyOtpRoute } from '../app/api/auth/verify-otp/route';
import { cookies } from 'next/headers';

describe('Session revocation (issue #26)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsers = {};
    mockAuthUserId = null;
    mockCookieStore = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    };
    (cookies as jest.Mock).mockResolvedValue(mockCookieStore);
  });

  it('rejects a captured token after "log out of all devices" bumps the tokenVersion', async () => {
    const user = createMockUser('u1', { tokenVersion: 1 });
    const capturedToken = await createToken({
      userId: user._id,
      email: user.email,
      tokenVersion: user.tokenVersion,
    });

    // Sanity check: the token authenticates normally before revocation.
    expect(await verifyToken(capturedToken)).not.toBeNull();

    mockAuthUserId = user._id;
    const res = await deleteSessions(
      new NextRequest('http://localhost/api/user/sessions', {
        method: 'DELETE',
        body: JSON.stringify({ all: true }),
      })
    );
    expect(res.status).toBe(200);

    // The captured token must now be rejected even though it hasn't expired.
    expect(await verifyToken(capturedToken)).toBeNull();
  });

  it('clears activeSessions when revoking all sessions', async () => {
    const user = createMockUser('u2', {
      activeSessions: [{ id: 's1', device: 'Chrome', location: '1.2.3.4', lastActive: new Date() }],
    });
    mockAuthUserId = user._id;

    await deleteSessions(
      new NextRequest('http://localhost/api/user/sessions', {
        method: 'DELETE',
        body: JSON.stringify({ all: true }),
      })
    );

    expect(mockUsers['u2'].activeSessions).toEqual([]);
  });

  it('lists active sessions instead of always returning an empty array', async () => {
    createMockUser('u3', {
      activeSessions: [{ id: 's1', device: 'Chrome', location: '1.2.3.4', lastActive: new Date() }],
    });
    mockAuthUserId = 'u3';

    const res = await getSessions(new NextRequest('http://localhost/api/user/sessions'));
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('s1');
  });

  it('records a new session entry on successful OTP login', async () => {
    createMockUser('u4', { activeSessions: [] });

    const req = new NextRequest('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'u4@example.com', code: '123456' }),
      headers: { 'user-agent': 'jest-test-agent' },
    });

    const res = await verifyOtpRoute(req);
    expect(res.status).toBe(200);
    expect(mockUsers['u4'].activeSessions).toHaveLength(1);
    expect(mockUsers['u4'].activeSessions[0].device).toContain('jest-test-agent');
  });

  it('embeds the current tokenVersion in newly issued tokens', async () => {
    createMockUser('u5', { tokenVersion: 3, activeSessions: [] });

    const req = new NextRequest('http://localhost/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'u5@example.com', code: '123456' }),
    });

    await verifyOtpRoute(req);

    const setCall = mockCookieStore.set.mock.calls.find(([name]) => name === 'auth-token');
    expect(setCall).toBeDefined();
    const token = setCall![1];

    const payload = await verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.tokenVersion).toBe(3);
  });
});

import { NextRequest } from 'next/server';

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  }),
}));

jest.mock('@/lib/auth/otp', () => ({
  generateOtp: jest.fn().mockResolvedValue('123456'),
}));

jest.mock('@/lib/auth/verifyOtp', () => ({
  verifyOtp: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/auth/jwt', () => ({
  createToken: jest.fn().mockResolvedValue('fake-token'),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn().mockResolvedValue({
      _id: { toString: () => 'u1' },
      email: 'user@example.com',
      isProfileComplete: true,
      tokenVersion: 1,
    }),
    create: jest.fn(),
    findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  },
}));

import { POST as requestOtp } from '../app/api/auth/request-otp/route';
import { POST as verifyOtp } from '../app/api/auth/verify-otp/route';

function rawRequest(path: string, body: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

function jsonRequest(path: string, body: unknown) {
  return rawRequest(path, JSON.stringify(body));
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BREVO_API_KEY;
});

describe('request-otp input validation (issue #27)', () => {
  it('returns 400 for a malformed JSON body instead of 500', async () => {
    const res = await requestOtp(rawRequest('/api/auth/request-otp', 'not-json{{{'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON body.');
  });

  it('returns 400 when email is missing', async () => {
    const res = await requestOtp(jsonRequest('/api/auth/request-otp', {}));
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is an empty string', async () => {
    const res = await requestOtp(jsonRequest('/api/auth/request-otp', { email: '' }));
    expect(res.status).toBe(400);
  });

  it.each(['not-an-email-at-all', 'foo@', '@bar.com', 'foo@bar', 'foo bar@baz.com'])(
    'returns 400 for obviously-invalid email %p',
    async (email) => {
      const res = await requestOtp(jsonRequest('/api/auth/request-otp', { email }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('A valid email address is required.');
    }
  );

  it('accepts a well-formed email (happy path unchanged)', async () => {
    const res = await requestOtp(
      jsonRequest('/api/auth/request-otp', { email: 'user@example.com' })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe('OTP sent to your email.');
  });
});

describe('verify-otp input validation (issue #27)', () => {
  it('returns 400 for a malformed JSON body instead of 500', async () => {
    const res = await verifyOtp(rawRequest('/api/auth/verify-otp', 'not-json{{{'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON body.');
  });

  it('returns 400 when email or code is missing', async () => {
    const res = await verifyOtp(jsonRequest('/api/auth/verify-otp', { email: 'user@example.com' }));
    expect(res.status).toBe(400);
  });

  it('still verifies a well-formed request (happy path unchanged)', async () => {
    const res = await verifyOtp(
      jsonRequest('/api/auth/verify-otp', { email: 'user@example.com', code: '123456' })
    );
    expect(res.status).toBe(200);
  });
});

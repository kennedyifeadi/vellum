import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

jest.mock('next-auth/jwt', () => ({
  getToken: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/auth/jwt', () => ({
  verifyToken: jest.fn().mockResolvedValue(null),
}));

describe('Rate Limiting System Tests (proxy.ts)', () => {
  function createApiRequest(ip: string, path = '/api/convert/compress-pdf') {
    const url = `http://localhost:3000${path}`;
    return new NextRequest(url, {
      method: 'POST',
      headers: {
        'x-forwarded-for': ip,
      },
    });
  }

  it('should allow up to 30 consecutive requests from the same IP without rate limiting', async () => {
    const testIp = '192.168.1.100';
    for (let i = 1; i <= 30; i++) {
      const res = await proxy(createApiRequest(testIp));
      expect(res.status).not.toBe(429);
    }
  });

  it('should block the 31st request within the 1-minute window with 429 Too Many Requests', async () => {
    const testIp = '192.168.1.101';
    for (let i = 1; i <= 30; i++) {
      await proxy(createApiRequest(testIp));
    }
    const res31 = await proxy(createApiRequest(testIp));
    expect(res31.status).toBe(429);
    const data = await res31.json();
    expect(data.error).toBe('Too many requests. Please try again later.');
  });

  it('should track rate limits per IP independently', async () => {
    const blockedIp = '10.0.0.1';
    const allowedIp = '10.0.0.2';
    for (let i = 1; i <= 30; i++) {
      await proxy(createApiRequest(blockedIp));
    }
    expect((await proxy(createApiRequest(blockedIp))).status).toBe(429);
    expect((await proxy(createApiRequest(allowedIp))).status).not.toBe(429);
  });

  it('should reset the rate limit after the 60-second window expires', async () => {
    jest.useFakeTimers();
    const timerIp = '172.16.0.5';
    for (let i = 1; i <= 30; i++) {
      await proxy(createApiRequest(timerIp));
    }
    expect((await proxy(createApiRequest(timerIp))).status).toBe(429);

    // Advance time by 61 seconds
    jest.advanceTimersByTime(61 * 1000);

    const resAfterReset = await proxy(createApiRequest(timerIp));
    expect(resAfterReset.status).not.toBe(429);

    jest.useRealTimers();
  });

  it('should apply rate limit to /api/documents/ and /api/auth/verify-otp endpoints as well', async () => {
    const docIp = '192.168.2.1';
    const otpIp = '192.168.2.2';
    for (let i = 1; i <= 30; i++) {
      await proxy(createApiRequest(docIp, '/api/documents/upload'));
      await proxy(createApiRequest(otpIp, '/api/auth/verify-otp'));
    }
    expect((await proxy(createApiRequest(docIp, '/api/documents/upload'))).status).toBe(429);
    expect((await proxy(createApiRequest(otpIp, '/api/auth/verify-otp'))).status).toBe(429);
  });
});

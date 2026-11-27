import { NextRequest } from 'next/server';

jest.mock('@/lib/auth/jwt', () => ({
  createToken: jest.fn(),
  getAuthUserId: jest.fn().mockResolvedValue(null),
}));

import { POST as requestOtp } from '../app/api/auth/request-otp/route';
import { POST as verifyOtp } from '../app/api/auth/verify-otp/route';
import { GET as listDocuments } from '../app/api/documents/route';
import { isRateLimited } from '@/lib/http/rate-limit';
import { callerKeyOf } from '@/lib/convert/caller-jobs';

// Each of these routes counts a request against its caller's budget before anything else.
const ROUTES: Record<string, (req: NextRequest) => Promise<Response>> = {
  '/api/auth/request-otp': requestOtp,
  '/api/auth/verify-otp': verifyOtp,
  '/api/documents': listDocuments,
};

const send = (request: NextRequest) => ROUTES[request.nextUrl.pathname](request);

describe('rate limiting of the routes that read a body', () => {
  beforeEach(() => {
    process.env.CLIENT_IP_HEADER = 'x-real-ip';
    delete process.env.CLIENT_IP_HEADER_ENTRY;
  });

  afterEach(() => {
    delete process.env.CLIENT_IP_HEADER;
    delete process.env.CLIENT_IP_HEADER_ENTRY;
  });

  function createApiRequest(ip: string, path = '/api/auth/request-otp', spoofedForwardedFor?: string, method = 'POST') {
    const url = `http://localhost:3000${path}`;
    const headers: Record<string, string> = {
      'x-real-ip': ip,
    };
    if (spoofedForwardedFor !== undefined) {
      headers['x-forwarded-for'] = spoofedForwardedFor;
    }
    return new NextRequest(url, { method, headers });
  }

  function createForwardedForOnlyRequest(forwardedFor: string, path = '/api/auth/request-otp') {
    return new NextRequest(`http://localhost:3000${path}`, {
      method: 'POST',
      headers: { 'x-forwarded-for': forwardedFor },
    });
  }

  it('should allow up to 30 consecutive requests from the same IP without rate limiting', async () => {
    const testIp = '192.168.1.100';
    for (let i = 1; i <= 30; i++) {
      const res = await send(createApiRequest(testIp));
      expect(res.status).not.toBe(429);
    }
  });

  it('should block the 31st request within the 1-minute window with 429 Too Many Requests', async () => {
    const testIp = '192.168.1.101';
    for (let i = 1; i <= 30; i++) {
      await send(createApiRequest(testIp));
    }
    const res31 = await send(createApiRequest(testIp));
    expect(res31.status).toBe(429);
    const data = await res31.json();
    expect(data.error).toBe('Too many requests. Please try again later.');
  });

  it('should track rate limits per IP independently', async () => {
    const blockedIp = '10.0.0.1';
    const allowedIp = '10.0.0.2';
    for (let i = 1; i <= 30; i++) {
      await send(createApiRequest(blockedIp));
    }
    expect((await send(createApiRequest(blockedIp))).status).toBe(429);
    expect((await send(createApiRequest(allowedIp))).status).not.toBe(429);
  });

  it('should reset the rate limit after the 60-second window expires', async () => {
    jest.useFakeTimers();
    const timerIp = '172.16.0.5';
    for (let i = 1; i <= 30; i++) {
      await send(createApiRequest(timerIp));
    }
    expect((await send(createApiRequest(timerIp))).status).toBe(429);

    // Advance time by 61 seconds
    jest.advanceTimersByTime(61 * 1000);

    const resAfterReset = await send(createApiRequest(timerIp));
    expect(resAfterReset.status).not.toBe(429);

    jest.useRealTimers();
  });

  it('should not reset the rate-limit bucket when the untrusted x-forwarded-for header is spoofed per request', async () => {
    const realIp = '203.0.113.7';
    for (let i = 1; i <= 30; i++) {
      await send(createApiRequest(realIp, '/api/auth/verify-otp', `10.0.0.${i}`));
    }
    const blocked = await send(createApiRequest(realIp, '/api/auth/verify-otp', '10.0.0.250'));
    expect(blocked.status).toBe(429);
  });

  it('should key on the rightmost x-forwarded-for entry when configured to', async () => {
    process.env.CLIENT_IP_HEADER = 'x-forwarded-for';
    process.env.CLIENT_IP_HEADER_ENTRY = 'rightmost';
    const trustedHop = '198.51.100.4';
    for (let i = 1; i <= 30; i++) {
      await send(createForwardedForOnlyRequest(`10.0.0.${i}, ${trustedHop}`));
    }
    const blocked = await send(createForwardedForOnlyRequest(`10.0.0.250, ${trustedHop}`));
    expect(blocked.status).toBe(429);
  });

  it('should not let a client choose its key with x-vercel-forwarded-for', async () => {
    const realIp = '203.0.113.9';
    for (let i = 1; i <= 30; i++) {
      const request = createApiRequest(realIp);
      request.headers.set('x-vercel-forwarded-for', `10.1.0.${i}`);
      await send(request);
    }
    const blocked = createApiRequest(realIp);
    blocked.headers.set('x-vercel-forwarded-for', '10.1.0.250');
    expect((await send(blocked)).status).toBe(429);
  });

  it('should apply rate limit to /api/documents and /api/auth/verify-otp as well', async () => {
    const docIp = '192.168.2.1';
    const otpIp = '192.168.2.2';
    for (let i = 1; i <= 30; i++) {
      await send(createApiRequest(docIp, '/api/documents', undefined, 'GET'));
      await send(createApiRequest(otpIp, '/api/auth/verify-otp'));
    }
    expect((await send(createApiRequest(docIp, '/api/documents', undefined, 'GET'))).status).toBe(429);
    expect((await send(createApiRequest(otpIp, '/api/auth/verify-otp'))).status).toBe(429);
  });

  it('should put every caller in one shared bucket when no header is trusted', async () => {
    delete process.env.CLIENT_IP_HEADER;
    for (let i = 1; i <= 30; i++) {
      const request = createApiRequest(`192.0.2.${i}`, '/api/auth/request-otp', `198.18.0.${i}`);
      request.headers.set('x-vercel-forwarded-for', `198.19.0.${i}`);
      expect((await send(request)).status).not.toBe(429);
    }
    expect((await send(createApiRequest('192.0.2.250'))).status).toBe(429);
  });
});

describe('IPv6 callers', () => {
  const from = (address: string) => new Headers({ 'x-real-ip': address });

  beforeEach(() => {
    process.env.CLIENT_IP_HEADER = 'x-real-ip';
  });

  afterEach(() => {
    delete process.env.CLIENT_IP_HEADER;
  });

  it('share one budget across a /64', () => {
    for (let i = 1; i <= 30; i++) {
      expect(isRateLimited(from(`2001:db8:1:2::${i.toString(16)}`))).toBe(false);
    }
    expect(isRateLimited(from('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'))).toBe(true);
  });

  it('have a budget of their own in each /64', () => {
    for (let i = 1; i <= 30; i++) isRateLimited(from(`2001:db8:1:3::${i.toString(16)}`));
    expect(isRateLimited(from('2001:db8:1:3::1'))).toBe(true);
    expect(isRateLimited(from('2001:db8:1:4::1'))).toBe(false);
  });

  it('hold one running guest job per /64', () => {
    const guest = { userId: null, plan: 'Free' };
    const key = (address: string) => callerKeyOf(from(address), guest);

    expect(key('2001:db8:5:6::1')).toBe(key('2001:db8:5:6:abcd::9'));
    expect(key('2001:db8:5:6::1')).not.toBe(key('2001:db8:5:7::1'));
  });
});

import { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/http/client-ip';
import { buildSessionEntry } from '@/lib/auth/session';

const SPOOFABLE_HEADERS = {
  'x-vercel-forwarded-for': '198.51.100.1',
  'x-real-ip': '198.51.100.2',
  'x-forwarded-for': '198.51.100.3, 198.51.100.4',
};

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

function configure(header?: string, entry?: string): void {
  if (header === undefined) delete process.env.CLIENT_IP_HEADER;
  else process.env.CLIENT_IP_HEADER = header;
  if (entry === undefined) delete process.env.CLIENT_IP_HEADER_ENTRY;
  else process.env.CLIENT_IP_HEADER_ENTRY = entry;
}

afterEach(() => configure());

describe('getClientIp', () => {
  it('trusts no forwarding header when CLIENT_IP_HEADER is unset', () => {
    configure();
    expect(getClientIp(headers(SPOOFABLE_HEADERS))).toBeNull();
  });

  it('reads only the configured header', () => {
    configure('x-real-ip');
    expect(getClientIp(headers(SPOOFABLE_HEADERS))).toBe('198.51.100.2');
  });

  it('matches the header name case-insensitively and trims the value', () => {
    configure('X-Real-IP');
    expect(getClientIp(headers({ 'x-real-ip': '  203.0.113.5 ' }))).toBe('203.0.113.5');
  });

  it('returns null when the configured header is missing or empty', () => {
    configure('x-real-ip');
    expect(getClientIp(headers({ 'x-forwarded-for': '203.0.113.5' }))).toBeNull();
    expect(getClientIp(headers({ 'x-real-ip': ' ' }))).toBeNull();
  });

  it('refuses a list in single mode, since a proxy that overwrites leaves one address', () => {
    configure('x-real-ip', 'single');
    expect(getClientIp(headers({ 'x-real-ip': '10.0.0.1, 203.0.113.5' }))).toBeNull();
  });

  it('takes the rightmost entry in rightmost mode', () => {
    configure('x-forwarded-for', 'rightmost');
    expect(getClientIp(headers({ 'x-forwarded-for': '10.0.0.1, 10.0.0.2,203.0.113.5' }))).toBe('203.0.113.5');
  });

  it('takes the leftmost entry in leftmost mode', () => {
    configure('x-forwarded-for', 'leftmost');
    expect(getClientIp(headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.2' }))).toBe('203.0.113.5');
  });

  it('accepts a single address in every mode', () => {
    for (const entry of ['single', 'leftmost', 'rightmost']) {
      configure('x-forwarded-for', entry);
      expect(getClientIp(headers({ 'x-forwarded-for': '203.0.113.5' }))).toBe('203.0.113.5');
    }
  });

  it('fails loudly on an unknown entry mode', () => {
    configure('x-forwarded-for', 'middle');
    expect(() => getClientIp(headers({ 'x-forwarded-for': '203.0.113.5' }))).toThrow(
      'CLIENT_IP_HEADER_ENTRY',
    );
  });
});

describe('buildSessionEntry location', () => {
  function request(values: Record<string, string>): NextRequest {
    return new NextRequest('http://localhost:3000/api/auth/verify-otp', { headers: values });
  }

  it('is unknown when no header is trusted, whatever the client sends', () => {
    configure();
    expect(buildSessionEntry(request(SPOOFABLE_HEADERS)).location).toBe('Unknown Location');
  });

  it('uses the configured header', () => {
    configure('x-real-ip');
    expect(buildSessionEntry(request(SPOOFABLE_HEADERS)).location).toBe('198.51.100.2');
  });

  it('is unknown without a request', () => {
    configure('x-real-ip');
    expect(buildSessionEntry().location).toBe('Unknown Location');
  });
});

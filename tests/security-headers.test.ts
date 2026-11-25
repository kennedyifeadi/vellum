import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server';
import nextConfig from '../next.config';

const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob: https://images.unsplash.com",
  "connect-src 'self' data: blob: https://accounts.google.com/gsi/",
  'frame-src https://accounts.google.com/gsi/ https://docs.google.com',
  "worker-src 'self'",
  "media-src 'self' https://assets.mixkit.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
].join('; ');

const DEVELOPMENT_CSP = PRODUCTION_CSP.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'");

const PERMISSIONS_POLICY =
  'accelerometer=(), bluetooth=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), serial=(), usb=()';

const PATHS = ['/', '/login', '/dashboard/documents', '/api/health', '/pdfjs/pdf.worker-5.4.296.min.mjs', '/_next/static/chunks/main.js'];

const env = process.env as Record<string, string | undefined>;
const originalNodeEnv = env.NODE_ENV;

async function responseHeaders(nodeEnv: string, path: string): Promise<Headers> {
  env.NODE_ENV = nodeEnv;
  const response = await unstable_getResponseFromNextConfig({ url: `http://localhost:3000${path}`, nextConfig });
  return response.headers;
}

afterEach(() => {
  env.NODE_ENV = originalNodeEnv;
});

describe('security headers in production', () => {
  it.each(PATHS)('sends every security header on %s', async (path) => {
    const headers = await responseHeaders('production', path);

    expect(headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP);
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Permissions-Policy')).toBe(PERMISSIONS_POLICY);
    expect(headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
  });

  it('does not allow eval', async () => {
    const headers = await responseHeaders('production', '/');

    expect(headers.get('Content-Security-Policy')).not.toContain('unsafe-eval');
  });

  it('turns off the X-Powered-By header', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe('security headers outside production', () => {
  it.each(['development', 'test'])('sends no Strict-Transport-Security in %s', async (nodeEnv) => {
    const headers = await responseHeaders(nodeEnv, '/');

    expect(headers.get('Strict-Transport-Security')).toBeNull();
    expect(headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('allows eval in development only', async () => {
    expect((await responseHeaders('development', '/')).get('Content-Security-Policy')).toBe(DEVELOPMENT_CSP);
    expect((await responseHeaders('test', '/')).get('Content-Security-Policy')).toBe(PRODUCTION_CSP);
  });
});

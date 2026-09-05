import nextConfig from '../next.config';

// The largest single-request upload limit advertised anywhere in the app today
// (video-compress's Pro plan, app/api/convert/video-compress/route.ts).
const LARGEST_ADVERTISED_PLAN_LIMIT_BYTES = 500 * 1024 * 1024;

describe('next.config.ts proxyClientMaxBodySize', () => {
  it('is raised above Next.js\'s 10MB default so proxy.ts-matched routes can receive the app\'s largest advertised upload size', () => {
    const configuredLimit = nextConfig.experimental?.proxyClientMaxBodySize;

    expect(configuredLimit).toBeDefined();
    expect(typeof configuredLimit).toBe('number');
    expect(configuredLimit as number).toBeGreaterThanOrEqual(LARGEST_ADVERTISED_PLAN_LIMIT_BYTES);
  });
});

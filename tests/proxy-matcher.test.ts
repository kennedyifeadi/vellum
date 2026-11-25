import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';

jest.mock('@/lib/auth/jwt', () => ({ getAuthSession: jest.fn().mockResolvedValue(null) }));

import { config } from '../proxy';
import nextConfig from '../next.config';

const matches = (path: string) => unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${path}` });

// Next reads and holds the whole body of every request proxy.ts matches before the route
// runs, so an API route behind it buffers an over-cap body however early it refuses.
const API_ROUTES = [
  '/api/auth/request-otp',
  '/api/auth/verify-otp',
  '/api/auth/complete-profile',
  '/api/auth/logout',
  '/api/documents',
  '/api/documents/652f1c0e9b1e8a3d4c5b6a71',
  '/api/documents/download/652f1c0e9b1e8a3d4c5b6a71',
  '/api/documents/uploads-history',
  '/api/convert/compress-pdf',
  '/api/convert/docx-to-pdf',
  '/api/convert/find-pdf',
  '/api/convert/html-to-pdf',
  '/api/convert/image-compress',
  '/api/convert/image-to-pdf',
  '/api/convert/jpg-to-png',
  '/api/convert/lock-pdf',
  '/api/convert/merge-pdf',
  '/api/convert/pdf-to-docx',
  '/api/convert/split-pdf',
  '/api/convert/video-compress',
  '/api/documents/upload',
];

describe('proxy.ts matcher', () => {
  it.each(API_ROUTES)('leaves the API route %s to read its own body', (path) => {
    expect(matches(path)).toBe(false);
  });

  it.each([
    '/dashboard',
    '/dashboard/library',
    '/login',
    '/verify',
    '/signup-details',
  ])('still guards %s', (path) => {
    expect(matches(path)).toBe(true);
  });

  it("keeps Next's default limit on the bodies it does clone", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBeUndefined();
  });
});

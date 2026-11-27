import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern';
import nextConfig from '../next.config';

const allowed = (url: string) => hasRemoteMatch([], nextConfig.images?.remotePatterns ?? [], new URL(url));

describe('next/image remote hosts', () => {
  it("serves a Google account's profile picture", () => {
    expect(allowed('https://lh3.googleusercontent.com/a/ACg8ocJ-example=s96-c')).toBe(true);
  });

  it('still serves Unsplash images', () => {
    expect(allowed('https://images.unsplash.com/photo-1?w=800')).toBe(true);
  });

  it('serves no other host, nor Google pictures over plain http', () => {
    expect(allowed('http://lh3.googleusercontent.com/a/photo')).toBe(false);
    expect(allowed('https://lh4.googleusercontent.com/a/photo')).toBe(false);
    expect(allowed('https://example.com/photo.png')).toBe(false);
  });
});

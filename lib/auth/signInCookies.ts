import { randomBytes } from 'crypto';
import type { cookies } from 'next/headers';

type CookieStore = Awaited<ReturnType<typeof cookies>>;

const BROWSER_COOKIE = 'sign-in-browser';
const BROWSER_MAX_AGE_SECONDS = 60 * 60;
// 32 bytes in base64url.
const BROWSER_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge,
  } as const;
}

export function isValidBrowserId(value: unknown): value is string {
  return typeof value === 'string' && BROWSER_ID_PATTERN.test(value);
}

export function createBrowserId(): string {
  return randomBytes(32).toString('base64url');
}

export function readBrowserId(store: CookieStore): string | null {
  const value = store.get(BROWSER_COOKIE)?.value;
  return isValidBrowserId(value) ? value : null;
}

export function setBrowserId(store: CookieStore, browserId: string) {
  store.set(BROWSER_COOKIE, browserId, cookieOptions(BROWSER_MAX_AGE_SECONDS));
}

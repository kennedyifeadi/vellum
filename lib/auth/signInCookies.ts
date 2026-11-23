import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { cookies } from 'next/headers';

type CookieStore = Awaited<ReturnType<typeof cookies>>;

const BROWSER_COOKIE = 'sign-in-browser';
const BROWSER_MAX_AGE_SECONDS = 60 * 60;
// 32 bytes in base64url.
const BROWSER_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const KNOWN_COOKIE_PREFIX = 'known-browser-';
const KNOWN_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
// Derives a key of its own from the session secret, so neither signature passes for the other.
const KNOWN_KEY_PURPOSE = 'vellum known sign-in browser v1';

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

function sign(message: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set.');
  const key = createHmac('sha256', secret).update(KNOWN_KEY_PURPOSE).digest();
  return createHmac('sha256', key).update(message).digest('base64url');
}

// One cookie per email, named without showing which.
function knownCookieName(email: string): string {
  return KNOWN_COOKIE_PREFIX + sign(`email:${email}`).slice(0, 22);
}

function signDevice(name: string, deviceId: string, expiresAt: string): string {
  return sign(`device:${name}.${deviceId}.${expiresAt}`);
}

function isSameSignature(given: string, expected: string): boolean {
  const [a, b] = [Buffer.from(given), Buffer.from(expected)];
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The device this browser is known as for this email. It picks a send allowance and proves no identity. */
export function readKnownDevice(store: CookieStore, email: string): string | null {
  const name = knownCookieName(email);
  const parts = store.get(name)?.value.split('.');
  if (parts?.length !== 3) return null;
  const [deviceId, expiresAt, signature] = parts;
  if (!isSameSignature(signature, signDevice(name, deviceId, expiresAt))) return null;
  return Number(expiresAt) > Date.now() ? deviceId : null;
}

export function setKnownDevice(store: CookieStore, email: string, deviceId: string) {
  const name = knownCookieName(email);
  const expiresAt = String(Date.now() + KNOWN_MAX_AGE_SECONDS * 1000);
  const value = `${deviceId}.${expiresAt}.${signDevice(name, deviceId, expiresAt)}`;
  store.set(name, value, cookieOptions(KNOWN_MAX_AGE_SECONDS));
}

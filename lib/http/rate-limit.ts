import { NextResponse } from 'next/server';
import { ClientError } from '@/lib/convert/errors';
import { countedClientAddress } from '@/lib/http/client-ip';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 30;
// The dashboard reads several routes on every load and again after every conversion, so
// reads get a larger budget of their own, which writes neither spend nor are refused by.
const MAX_READS = 300;

const SUPPORT_WINDOW_MS = 10 * 60 * 1000;
const MAX_SUPPORT_SUBMISSIONS = 5;

const MAX_TRACKED_CALLERS = 10_000;

// Next.js does not expose the connection's address to the proxy, so without a trusted
// header every caller shares this one bucket: the limit becomes site-wide, never bypassable.
const SHARED_RATE_LIMIT_KEY = 'unknown';

export const RATE_LIMITED_MESSAGE = 'Too many requests. Please try again later.';

interface RateLimitRecord {
  count: number;
  timestamp: number;
}

// The routes that count requests are bundled separately but run in one server process, so
// the counts live on globalThis for them to share one budget per caller.
const globalForRateLimits = globalThis as typeof globalThis & {
  vellumRateLimits?: Map<string, RateLimitRecord>;
  vellumReadRateLimits?: Map<string, RateLimitRecord>;
  vellumSupportRateLimits?: Map<string, RateLimitRecord>;
};
const rateLimits = (globalForRateLimits.vellumRateLimits ??= new Map<string, RateLimitRecord>());
const readRateLimits = (globalForRateLimits.vellumReadRateLimits ??= new Map<string, RateLimitRecord>());
const supportRateLimits = (globalForRateLimits.vellumSupportRateLimits ??= new Map<string, RateLimitRecord>());

/** The key a caller's address is counted under, here and by the per-caller job limit. */
export function clientAddressKey(headers: Headers): string {
  return countedClientAddress(headers) ?? SHARED_RATE_LIMIT_KEY;
}

// A record is inserted afresh whenever its window starts, so a map runs from the oldest
// window to the newest: the expired records, and the oldest one, are at its front.
function forgetExpired(records: Map<string, RateLimitRecord>, now: number, windowMs: number): void {
  for (const [key, record] of records) {
    if (now - record.timestamp <= windowMs) return;
    records.delete(key);
  }
}

function startWindow(records: Map<string, RateLimitRecord>, key: string, now: number): void {
  records.delete(key);
  records.set(key, { count: 1, timestamp: now });
  if (records.size > MAX_TRACKED_CALLERS) {
    records.delete(records.keys().next().value!);
  }
}

function isOverBudget(
  records: Map<string, RateLimitRecord>,
  headers: Headers,
  windowMs: number,
  maxRequests: number,
): boolean {
  const key = clientAddressKey(headers);
  const now = Date.now();
  forgetExpired(records, now, windowMs);
  const record = records.get(key);
  if (!record || now - record.timestamp > windowMs) {
    startWindow(records, key, now);
    return false;
  }
  if (record.count >= maxRequests) {
    return true;
  }
  record.count += 1;
  return false;
}

/** Counts this request against its caller's write budget and says whether it is over it. */
export function isRateLimited(headers: Headers): boolean {
  return isOverBudget(rateLimits, headers, RATE_LIMIT_WINDOW_MS, MAX_REQUESTS);
}

/** Counts this request against its caller's read budget and says whether it is over it. */
export function isReadRateLimited(headers: Headers): boolean {
  return isOverBudget(readRateLimits, headers, RATE_LIMIT_WINDOW_MS, MAX_READS);
}

export function tooManyRequests(): NextResponse {
  return NextResponse.json({ error: RATE_LIMITED_MESSAGE }, { status: 429 });
}

/** The contact and help forms' own budget, which neither spends nor is spent by the shared one. */
export function assertWithinSupportRateLimit(req: Request): void {
  if (isOverBudget(supportRateLimits, req.headers, SUPPORT_WINDOW_MS, MAX_SUPPORT_SUBMISSIONS)) {
    throw new ClientError(RATE_LIMITED_MESSAGE, 429);
  }
}

/** Rate limits a route before it reads its body: proxy.ts matches no API route. */
export function assertWithinRateLimit(req: Request): void {
  if (isRateLimited(req.headers)) {
    throw new ClientError(RATE_LIMITED_MESSAGE, 429);
  }
}

/** Rate limits a read against the read budget, before it touches the database. */
export function assertWithinReadRateLimit(req: Request): void {
  if (isReadRateLimited(req.headers)) {
    throw new ClientError(RATE_LIMITED_MESSAGE, 429);
  }
}

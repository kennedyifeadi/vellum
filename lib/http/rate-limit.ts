import { ClientError } from '@/lib/convert/errors';
import { getClientIp } from '@/lib/http/client-ip';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 30;

const SUPPORT_WINDOW_MS = 10 * 60 * 1000;
const MAX_SUPPORT_SUBMISSIONS = 5;

// Next.js does not expose the connection's address to the proxy, so without a trusted
// header every caller shares this one bucket: the limit becomes site-wide, never bypassable.
const SHARED_RATE_LIMIT_KEY = 'unknown';

export const RATE_LIMITED_MESSAGE = 'Too many requests. Please try again later.';

interface RateLimitRecord {
  count: number;
  timestamp: number;
}

// proxy.ts and the upload routes are bundled separately but run in one server process, so
// the counts live on globalThis for both to share one budget per caller.
const globalForRateLimits = globalThis as typeof globalThis & {
  vellumRateLimits?: Map<string, RateLimitRecord>;
  vellumSupportRateLimits?: Map<string, RateLimitRecord>;
};
const rateLimits = (globalForRateLimits.vellumRateLimits ??= new Map<string, RateLimitRecord>());
const supportRateLimits = (globalForRateLimits.vellumSupportRateLimits ??= new Map<string, RateLimitRecord>());

/** The key a caller's address is counted under, here and by the per-caller job limit. */
export function clientAddressKey(headers: Headers): string {
  return getClientIp(headers) ?? SHARED_RATE_LIMIT_KEY;
}

function isOverBudget(
  records: Map<string, RateLimitRecord>,
  headers: Headers,
  windowMs: number,
  maxRequests: number,
): boolean {
  const key = clientAddressKey(headers);
  const now = Date.now();
  const record = records.get(key);
  if (!record || now - record.timestamp > windowMs) {
    records.set(key, { count: 1, timestamp: now });
    return false;
  }
  if (record.count >= maxRequests) {
    return true;
  }
  record.count += 1;

  // Basic cleanup to prevent memory leaks in long-running instances
  if (records.size > 10000) {
    records.clear();
  }

  return false;
}

/** Counts this request against its caller's budget and says whether it is over it. */
export function isRateLimited(headers: Headers): boolean {
  return isOverBudget(rateLimits, headers, RATE_LIMIT_WINDOW_MS, MAX_REQUESTS);
}

/** The contact and help forms' own budget, which neither spends nor is spent by the shared one. */
export function assertWithinSupportRateLimit(req: Request): void {
  if (isOverBudget(supportRateLimits, req.headers, SUPPORT_WINDOW_MS, MAX_SUPPORT_SUBMISSIONS)) {
    throw new ClientError(RATE_LIMITED_MESSAGE, 429);
  }
}

/** For a route proxy.ts does not match, so it is rate limited before reading its body. */
export function assertWithinRateLimit(req: Request): void {
  if (isRateLimited(req.headers)) {
    throw new ClientError(RATE_LIMITED_MESSAGE, 429);
  }
}

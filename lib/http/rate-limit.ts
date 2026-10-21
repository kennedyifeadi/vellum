import { ClientError } from '@/lib/convert/errors';
import { getClientIp } from '@/lib/http/client-ip';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 30;

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
const globalForRateLimits = globalThis as typeof globalThis & { vellumRateLimits?: Map<string, RateLimitRecord> };
const rateLimits = (globalForRateLimits.vellumRateLimits ??= new Map<string, RateLimitRecord>());

/** Counts this request against its caller's budget and says whether it is over it. */
export function isRateLimited(headers: Headers): boolean {
  const key = getClientIp(headers) ?? SHARED_RATE_LIMIT_KEY;
  const now = Date.now();
  const record = rateLimits.get(key);
  if (!record || now - record.timestamp > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(key, { count: 1, timestamp: now });
    return false;
  }
  if (record.count >= MAX_REQUESTS) {
    return true;
  }
  record.count += 1;

  // Basic cleanup to prevent memory leaks in long-running instances
  if (rateLimits.size > 10000) {
    rateLimits.clear();
  }

  return false;
}

/** For a route proxy.ts does not match, so it is rate limited before reading its body. */
export function assertWithinRateLimit(req: Request): void {
  if (isRateLimited(req.headers)) {
    throw new ClientError(RATE_LIMITED_MESSAGE, 429);
  }
}

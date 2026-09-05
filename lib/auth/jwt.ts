import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import dbConnect from '@/lib/db/mongoose';
import User from '@/models/user';

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

// verifyToken runs on every authenticated request (including proxy.ts, which
// runs on every matched page/API request), so a naive implementation would
// mean a tokenVersion lookup hits the DB on every single request. Instead we
// cache each user's tokenVersion in-process for a short window: a revocation
// clears that user's entry immediately (see invalidateTokenVersionCache), so
// the instance that handled the revoke-all request enforces it right away,
// and every other instance picks it up within TOKEN_VERSION_CACHE_TTL_MS.
// The tradeoff is a bounded staleness window across other instances/processes
// in exchange for avoiding a DB round trip per request; if this ever needs to
// be instant everywhere (multi-instance deployment with no shared cache),
// swap this for a shared cache like Redis.
const TOKEN_VERSION_CACHE_TTL_MS = 60_000;
const tokenVersionCache = new Map<string, { version: number; expiresAt: number }>();

export async function createToken(payload: JWTPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h') // Token expires in 2 hours
    .sign(secret);
}

export function invalidateTokenVersionCache(userId: string) {
  tokenVersionCache.delete(userId);
}

async function getCurrentTokenVersion(userId: string): Promise<number | null> {
  const cached = tokenVersionCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.version;
  }

  await dbConnect();
  const user = await User.findById(userId).select('tokenVersion').lean<{ tokenVersion: number }>();
  if (!user) {
    tokenVersionCache.delete(userId);
    return null;
  }

  tokenVersionCache.set(userId, { version: user.tokenVersion, expiresAt: Date.now() + TOKEN_VERSION_CACHE_TTL_MS });
  return user.tokenVersion;
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret);

    const userId = payload.userId;
    if (typeof userId !== 'string') {
      return null;
    }

    // Reject tokens whose tokenVersion doesn't match the user's current one.
    // This is what makes "sign out of all devices" actually revoke tokens:
    // bumping tokenVersion invalidates every previously issued token at once,
    // regardless of the JWT's own signature/expiry.
    const currentVersion = await getCurrentTokenVersion(userId);
    if (currentVersion === null || payload.tokenVersion !== currentVersion) {
      return null;
    }

    return payload;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

export async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get('auth-token')?.value;
  if (token) {
    const payload = await verifyToken(token);
    if (payload?.userId) return payload.userId as string;
  }
  
  const nextAuthToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (nextAuthToken?.id) return nextAuthToken.id as string;
  if (nextAuthToken?.sub) return nextAuthToken.sub as string;

  return null;
}
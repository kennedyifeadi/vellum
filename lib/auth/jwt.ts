import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { EMAIL_SESSION_COOKIE, isLiveSession } from '@/lib/auth/session';

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

/** A sign-in session the request holds, still live on its account. */
export interface AuthSession {
  userId: string;
  sessionId: string;
  isProfileComplete: boolean;
}

type SessionClaims = Record<string, unknown>;

export async function createToken(payload: JWTPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h') // Token expires in 2 hours
    .sign(secret);
}

// A signature alone is not enough: the token must also name a session its account still has,
// at the account's current tokenVersion, so revoking a session, signing out, signing out of all
// devices and deleting the account each end the sessions they name.
async function liveSession({ userId, sessionId, tokenVersion, isProfileComplete }: SessionClaims): Promise<AuthSession | null> {
  if (typeof userId !== 'string' || typeof sessionId !== 'string') return null;
  if (!(await isLiveSession(userId, sessionId, tokenVersion))) return null;
  return { userId, sessionId, isProfileComplete: !!isProfileComplete };
}

async function verifiedPayload(token: string): Promise<JWTPayload | null> {
  try {
    return (await jwtVerify(token, secret)).payload;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

async function emailSession(req: NextRequest): Promise<AuthSession | null> {
  const token = req.cookies.get(EMAIL_SESSION_COOKIE)?.value;
  const payload = token ? await verifiedPayload(token) : null;
  return payload && liveSession(payload);
}

async function googleSession(req: NextRequest): Promise<AuthSession | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  return token && liveSession({ ...token, userId: token.id ?? token.sub });
}

/** The request's session: its email sign-in cookie's, or else its Google sign-in cookie's. */
export async function getAuthSession(req: NextRequest): Promise<AuthSession | null> {
  return (await emailSession(req)) ?? (await googleSession(req));
}

/** Every live session the request's cookies hold, for signing all of them out. */
export async function getAuthSessions(req: NextRequest): Promise<AuthSession[]> {
  const sessions = await Promise.all([emailSession(req), googleSession(req)]);
  return sessions.filter((session) => session !== null);
}

export async function getAuthUserId(req: NextRequest): Promise<string | null> {
  return (await getAuthSession(req))?.userId ?? null;
}

import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import type { cookies } from 'next/headers';
import { getClientIp } from '@/lib/http/client-ip';
import dbConnect from '@/lib/db/mongoose';
import User from '@/models/user';

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export const EMAIL_SESSION_COOKIE = 'auth-token';
const SESSION_COOKIES = [EMAIL_SESSION_COOKIE, 'next-auth.session-token', '__Secure-next-auth.session-token'];

/** An account keeps this many of its most recent sessions; starting another ends the oldest. */
export const MAX_ACTIVE_SESSIONS = 20;

// Every authenticated request checks its session, the proxy's included, so each account's
// session ids and tokenVersion are cached instead of read each time. A change made in this
// process clears the account's entry at once; one made elsewhere is seen within the TTL. The
// app runs as one replica: with more, this needs a cache they share.
const SESSION_STATE_TTL_MS = 60_000;

interface SessionState {
  tokenVersion: number;
  sessionIds: Set<string>;
  expiresAt: number;
}

// proxy.ts and the routes are bundled separately but run in one server process, so the cache
// lives on globalThis for a route's change to reach the proxy's copy of this module too.
const globalForSessions = globalThis as typeof globalThis & { vellumSessionStates?: Map<string, SessionState> };
const sessionStates = (globalForSessions.vellumSessionStates ??= new Map<string, SessionState>());

export interface SessionEntry {
  id: string;
  device: string;
  location: string;
  lastActive: Date;
}

export function buildSessionEntry(req?: NextRequest): SessionEntry {
  return {
    id: randomUUID(),
    device: req?.headers.get('user-agent') ?? 'Unknown Device',
    location: (req && getClientIp(req.headers)) ?? 'Unknown Location',
    lastActive: new Date(),
  };
}

export function forgetSessions(userId: string) {
  sessionStates.delete(userId);
}

async function sessionStateOf(userId: string): Promise<SessionState | null> {
  const cached = sessionStates.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  await dbConnect();
  // Not lean: an account Google sign-in created has no stored tokenVersion, and its tokens carry
  // the schema's default, which only a hydrated document fills in.
  const user = await User.findById(userId).select('tokenVersion activeSessions.id');
  if (!user) {
    sessionStates.delete(userId);
    return null;
  }

  const state = {
    tokenVersion: user.tokenVersion,
    sessionIds: new Set<string>(user.activeSessions.map((session: SessionEntry) => session.id)),
    expiresAt: Date.now() + SESSION_STATE_TTL_MS,
  };
  sessionStates.set(userId, state);
  return state;
}

/** Whether the account still has this session, and the token was issued at its current tokenVersion. */
export async function isLiveSession(userId: string, sessionId: string, tokenVersion: unknown): Promise<boolean> {
  const state = await sessionStateOf(userId);
  return !!state && state.sessionIds.has(sessionId) && state.tokenVersion === tokenVersion;
}

/** Adds a session to the account and returns the account's tokenVersion for its token. */
export async function recordSession(userId: string, session: SessionEntry): Promise<number | undefined> {
  await dbConnect();
  const user = await User.findByIdAndUpdate(
    userId,
    { $push: { activeSessions: { $each: [session], $slice: -MAX_ACTIVE_SESSIONS } } },
    { returnDocument: 'after' },
  );
  forgetSessions(userId);
  return user?.tokenVersion;
}

export async function endSession(userId: string, sessionId: string) {
  await dbConnect();
  await User.findByIdAndUpdate(userId, { $pull: { activeSessions: { id: sessionId } } });
  forgetSessions(userId);
}

export async function endAllSessions(userId: string) {
  await dbConnect();
  await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 }, $set: { activeSessions: [] } });
  forgetSessions(userId);
}

/** Deletes the email and Google session cookies. A browser ignores a __Secure- deletion that is not Secure. */
export function clearSessionCookies(store: CookieStore) {
  for (const name of SESSION_COOKIES) {
    store.delete({ name, path: '/', secure: name.startsWith('__Secure-') });
  }
}

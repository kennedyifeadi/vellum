import { AsyncLocalStorage } from 'async_hooks';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { encode, type JWT } from 'next-auth/jwt';
import { createToken } from '@/lib/auth/jwt';
import User from '@/models/user';
import { proxy } from '@/proxy';
import { authOptionsFor } from '@/app/api/auth/[...nextauth]/route';
import { POST as verifyOtpRoute } from '@/app/api/auth/verify-otp/route';
import { POST as completeProfileRoute } from '@/app/api/auth/complete-profile/route';
import { POST as logoutRoute } from '@/app/api/auth/logout/route';
import { GET as meRoute } from '@/app/api/auth/me/route';
import { GET as listSessionsRoute, DELETE as revokeSessionsRoute } from '@/app/api/user/sessions/route';
import { DELETE as deleteAccountRoute } from '@/app/api/user/delete/route';
import { controlClock } from './signInBrowsers';

// The cases that end a sign-in session, for email and Google sign-in, on any database. The
// test file that calls this mocks next/headers, @/lib/db/mongoose, @/lib/auth/verifyOtp,
// jose and @/lib/storage, and provides the database.

const EMAIL_COOKIE = 'auth-token';
const GOOGLE_COOKIE = 'next-auth.session-token';
const SESSION_COOKIES = [EMAIL_COOKIE, GOOGLE_COOKIE, `__Secure-${GOOGLE_COOKIE}`];
const SIGN_IN_BROWSER_ID = 'b'.repeat(43);
const MAX_SESSIONS = 20;

type Route = (req: NextRequest) => Promise<Response>;

/** Stores an account as Google sign-in's adapter does: without the schema's defaults. */
export type InsertAccount = (email: string, fields: { isProfileComplete: boolean }) => Promise<string>;

interface CookieChange {
  name: string;
  secure?: boolean;
}

/** A browser: the cookies it holds, and those the app told it to delete. */
export class Device {
  readonly jar = new Map<string, string>([['sign-in-browser', SIGN_IN_BROWSER_ID]]);
  readonly deleted: CookieChange[] = [];

  constructor(readonly accountId: string, readonly email: string) {}

  /** Another browser holding this one's cookies as they are now. */
  copy() {
    const copied = new Device(this.accountId, this.email);
    for (const [name, value] of this.jar) copied.jar.set(name, value);
    return copied;
  }
}

const calling = new AsyncLocalStorage<Device>();
let accounts = 0;

export function installCookieJars() {
  jest.mocked(cookies).mockImplementation(async () => {
    const device = calling.getStore()!;
    const remove = (change: CookieChange) => {
      device.jar.delete(change.name);
      device.deleted.push(change);
    };
    return {
      get: (name: string) => (device.jar.has(name) ? { name, value: device.jar.get(name)! } : undefined),
      set: (name: string, value: string, options: { maxAge?: number; secure?: boolean } = {}) => {
        if (options.maxAge === 0) remove({ name, secure: options.secure });
        else device.jar.set(name, value);
      },
      delete: (target: string | CookieChange) => remove(typeof target === 'string' ? { name: target } : target),
    } as unknown as Awaited<ReturnType<typeof cookies>>;
  });
}

function requestFrom(device: Device, path: string, method = 'GET', body?: unknown) {
  const headers = new Headers({ cookie: [...device.jar].map(([name, value]) => `${name}=${value}`).join('; ') });
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function call(device: Device, route: Route, path: string, method = 'GET', body?: unknown) {
  return calling.run(device, () => route(requestFrom(device, path, method, body)));
}

export async function signInWithEmail(device: Device) {
  const res = await call(device, verifyOtpRoute, '/api/auth/verify-otp', 'POST', { email: device.email, code: '2345-6789' });
  expect(res.status).toBe(200);
  return device;
}

/** What NextAuth does when Google signs someone in: its jwt callback, then the cookie. */
export async function signInWithGoogle(device: Device, isProfileComplete = true) {
  const req = requestFrom(device, '/api/auth/callback/google');
  const jwt = authOptionsFor(req).callbacks!.jwt!;
  const token = await jwt({
    token: { sub: device.accountId, email: device.email, name: 'Ada Lovelace' },
    user: { id: device.accountId, email: device.email, isProfileComplete },
    account: null,
  });
  device.jar.set(GOOGLE_COOKIE, await encode({ token, secret: process.env.NEXTAUTH_SECRET! }));
  return device;
}

/** Where the proxy sends this device when it opens the dashboard; null when it lets it in. */
export async function dashboardRedirect(device: Device, guard: typeof proxy = proxy) {
  const res = await guard(requestFrom(device, '/dashboard'));
  const location = res.headers.get('location');
  return location && new URL(location).pathname;
}

export async function expectSignedIn(device: Device, guard?: typeof proxy) {
  expect((await call(device, meRoute, '/api/auth/me')).status).toBe(200);
  expect((await call(device, listSessionsRoute, '/api/user/sessions')).status).toBe(200);
  expect(await dashboardRedirect(device, guard)).toBeNull();
}

export async function expectSignedOut(device: Device, guard?: typeof proxy) {
  expect((await call(device, meRoute, '/api/auth/me')).status).toBe(401);
  expect((await call(device, listSessionsRoute, '/api/user/sessions')).status).toBe(401);
  expect(await dashboardRedirect(device, guard)).toBe('/login');
}

interface ListedSession {
  id: string;
  current: boolean;
}

async function listSessions(device: Device): Promise<ListedSession[]> {
  const res = await call(device, listSessionsRoute, '/api/user/sessions');
  expect(res.status).toBe(200);
  return res.json();
}

async function currentSessionId(device: Device) {
  const current = (await listSessions(device)).filter((session) => session.current);
  expect(current).toHaveLength(1);
  return current[0].id;
}

const signInKinds = [
  ['email', signInWithEmail],
  ['Google', signInWithGoogle],
] as const;

export function describeSessionRevocation(database: string, insertAccount: InsertAccount) {
  async function newAccount(isProfileComplete = true) {
    const email = `person${++accounts}@sessions.test`;
    return { id: await insertAccount(email, { isProfileComplete }), email };
  }

  async function devicesOfOneAccount(count: number, signIn: (device: Device) => Promise<Device>) {
    const { id, email } = await newAccount();
    const devices: Device[] = [];
    for (let i = 0; i < count; i++) devices.push(await signIn(new Device(id, email)));
    return devices;
  }

  describe(`ending sign-in sessions on ${database}`, () => {
    beforeEach(() => {
      installCookieJars();
      jest.spyOn(console, 'log').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    describe.each(signInKinds)('a session from %s sign-in', (_kind, signIn) => {
      it('ends when another session revokes it, and the account’s other sessions keep working', async () => {
        const [laptop, phone] = await devicesOfOneAccount(2, signIn);
        await expectSignedIn(laptop);
        await expectSignedIn(phone);

        const res = await call(laptop, revokeSessionsRoute, '/api/user/sessions', 'DELETE', {
          sessionId: await currentSessionId(phone),
        });

        expect(res.status).toBe(200);
        await expectSignedOut(phone);
        await expectSignedIn(laptop);
      });

      it('ends when it signs out, even for a copy of its cookies, and clears them', async () => {
        const [laptop, phone] = await devicesOfOneAccount(2, signIn);
        await expectSignedIn(laptop);
        const copied = laptop.copy();

        expect((await call(laptop, logoutRoute, '/api/auth/logout', 'POST')).status).toBe(200);

        expect(laptop.deleted.map((cookie) => cookie.name)).toEqual(expect.arrayContaining(SESSION_COOKIES));
        expect(laptop.deleted.find((cookie) => cookie.name.startsWith('__Secure-'))?.secure).toBe(true);
        await expectSignedOut(copied);
        await expectSignedOut(laptop);
        await expectSignedIn(phone);
      });

      it('ends with every other session when the account signs out of all devices', async () => {
        const [laptop, phone] = await devicesOfOneAccount(2, signIn);
        await expectSignedIn(laptop);
        await expectSignedIn(phone);
        const copied = laptop.copy();

        const res = await call(laptop, revokeSessionsRoute, '/api/user/sessions', 'DELETE', { all: true });

        expect(res.status).toBe(200);
        await expectSignedOut(copied);
        await expectSignedOut(phone);
      });

      it('ends with every other session when the account is deleted', async () => {
        const [laptop, phone] = await devicesOfOneAccount(2, signIn);
        await expectSignedIn(laptop);
        await expectSignedIn(phone);
        const copied = laptop.copy();

        expect((await call(laptop, deleteAccountRoute, '/api/user/delete', 'DELETE')).status).toBe(200);

        await expectSignedOut(copied);
        await expectSignedOut(phone);
      });

      it('works at once when it starts while the account’s sessions are cached', async () => {
        const [laptop] = await devicesOfOneAccount(1, signIn);
        await expectSignedIn(laptop);

        const phone = await signIn(new Device(laptop.accountId, laptop.email));

        await expectSignedIn(phone);
      });

      it(`ends when the account starts its ${MAX_SESSIONS + 1}st session, being the oldest`, async () => {
        const devices = await devicesOfOneAccount(MAX_SESSIONS + 1, signIn);

        await expectSignedOut(devices[0]);
        await expectSignedIn(devices[1]);
        await expectSignedIn(devices[MAX_SESSIONS]);
        expect(await listSessions(devices[MAX_SESSIONS])).toHaveLength(MAX_SESSIONS);
      });

      it('is listed as the current session to itself only', async () => {
        const [laptop, phone] = await devicesOfOneAccount(2, signIn);

        const laptopId = await currentSessionId(laptop);
        const phoneId = await currentSessionId(phone);

        expect(laptopId).not.toBe(phoneId);
        expect((await listSessions(laptop)).map((session) => session.id).sort()).toEqual([laptopId, phoneId].sort());
      });

      it('ends within a minute when its entry is removed outside this process', async () => {
        const advanceTo = controlClock();
        const [laptop] = await devicesOfOneAccount(1, signIn);
        await expectSignedIn(laptop);

        await User.updateOne({ _id: laptop.accountId }, { $set: { activeSessions: [] } });
        advanceTo(61_000);

        await expectSignedOut(laptop);
      });
    });

    describe('a token without a session id', () => {
      async function tokenVersionOf(accountId: string) {
        return (await User.findById(accountId).select('tokenVersion'))?.tokenVersion;
      }

      it('is refused from email sign-in', async () => {
        const { id, email } = await newAccount();
        const device = new Device(id, email);
        const token = await createToken({ userId: id, email, isProfileComplete: true, tokenVersion: await tokenVersionOf(id) });
        device.jar.set(EMAIL_COOKIE, token);

        await expectSignedOut(device);
      });

      it('is refused from Google sign-in', async () => {
        const { id, email } = await newAccount();
        const device = new Device(id, email);
        const token: JWT = { sub: id, id, email, isProfileComplete: true, tokenVersion: await tokenVersionOf(id) };
        device.jar.set(GOOGLE_COOKIE, await encode({ token, secret: process.env.NEXTAUTH_SECRET! }));

        await expectSignedOut(device);
      });
    });

    describe('a Google session that completes its profile', () => {
      async function completedProfile() {
        const { id, email } = await newAccount(false);
        const device = await signInWithGoogle(new Device(id, email), false);
        const res = await call(device, completeProfileRoute, '/api/auth/complete-profile', 'POST', {
          name: 'Ada Lovelace',
          role: 'Student',
        });
        expect(res.status).toBe(200);
        expect(device.jar.has(EMAIL_COOKIE)).toBe(true);
        return device;
      }

      it('carries its session into the email cookie it is given, so revoking it ends both', async () => {
        const laptop = await completedProfile();
        const phone = await signInWithGoogle(new Device(laptop.accountId, laptop.email));
        await expectSignedIn(laptop);

        await call(phone, revokeSessionsRoute, '/api/user/sessions', 'DELETE', { sessionId: await currentSessionId(laptop) });

        await expectSignedOut(laptop);
        const googleCookieOnly = laptop.copy();
        googleCookieOnly.jar.delete(EMAIL_COOKIE);
        await expectSignedOut(googleCookieOnly);
        await expectSignedIn(phone);
      });

      it('ends both cookies when it signs out', async () => {
        const laptop = await completedProfile();
        const copied = laptop.copy();

        await call(laptop, logoutRoute, '/api/auth/logout', 'POST');

        await expectSignedOut(copied);
      });
    });

    it('signs in with an email code an account that Google sign-in created', async () => {
      const { id, email } = await newAccount();

      await expectSignedIn(await signInWithEmail(new Device(id, email)));
    });

    it('signs in a new account with an email code, which then completes its profile', async () => {
      const device = new Device('', `new${++accounts}@sessions.test`);
      await signInWithEmail(device);

      expect((await call(device, meRoute, '/api/auth/me')).status).toBe(200);
      expect(await dashboardRedirect(device)).toBe('/signup-details');
    });
  });
}

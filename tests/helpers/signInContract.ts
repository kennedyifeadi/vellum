import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/db/mongoose';
import { verifyOtp } from '@/lib/auth/verifyOtp';
import { POST as requestRoute } from '@/app/api/auth/request-otp/route';
import { POST as verifyRoute } from '@/app/api/auth/verify-otp/route';

// The cases email-code sign-in must pass on any database. The test file that calls this
// mocks next/headers, @/lib/db/mongoose and @/lib/auth/jwt, and provides the database.

const MINUTE_MS = 60_000;

let addresses = 0;
const newEmail = () => `person${++addresses}@example.com`;

const setCookie = jest.fn();
let sentCodes: { email: string; code: string }[] = [];

function post(route: (req: NextRequest) => Promise<Response>, body: unknown) {
  return route(
    new NextRequest('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

const requestCode = (email: string) => post(requestRoute, { email });
const signIn = (email: string, code: string) => post(verifyRoute, { email, code });

async function receiveCode(email: string) {
  expect((await requestCode(email)).status).toBe(200);
  return sentCodes.filter((sent) => sent.email === email).at(-1)!.code;
}

const otherCode = (code: string, offset: number) => String((Number(code) + offset) % 1_000_000).padStart(6, '0');

async function enterWrongCodes(email: string, code: string, times: number) {
  for (let i = 1; i <= times; i++) {
    expect((await signIn(email, otherCode(code, i))).status).toBe(401);
  }
}

function setNodeEnv(value: string | undefined) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

// Only the clock is faked: the database driver needs working timers.
function controlClock() {
  const start = Date.now();
  jest.useFakeTimers({
    now: start,
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate',
      'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
    ],
  });
  return (msFromStart: number) => jest.setSystemTime(start + msFromStart);
}

export function describeSignInContract(database: string) {
  describe(`email-code sign-in on ${database}`, () => {
    const { NODE_ENV, BREVO_API_KEY, EMAIL_USER } = process.env;

    beforeEach(() => {
      jest.clearAllMocks();
      sentCodes = [];
      (cookies as jest.Mock).mockResolvedValue({ set: setCookie });
      process.env.BREVO_API_KEY = 'test-placeholder';
      process.env.EMAIL_USER = 'no-reply@example.com';
      jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
        const { to, htmlContent } = JSON.parse(String(init?.body));
        sentCodes.push({ email: to[0].email, code: /\b\d{6}\b/.exec(htmlContent)![0] });
        return new Response('{}', { status: 201 });
      });
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
      setNodeEnv(NODE_ENV);
      for (const [name, value] of Object.entries({ BREVO_API_KEY, EMAIL_USER })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    describe('input', () => {
      const invalidEmails: [string, unknown][] = [
        ['missing', undefined],
        ['null', null],
        ['a number', 42],
        ['a boolean', true],
        ['an array', []],
        ['an object', {}],
        ['empty', ''],
        ['malformed', 'not-an-email'],
        ['255 characters', `${'a'.repeat(243)}@example.com`],
      ];

      it.each(invalidEmails)('does not send a code when the email is %s', async (_kind, email) => {
        const res = await post(requestRoute, { email });

        expect(res.status).toBe(400);
        expect(dbConnect).not.toHaveBeenCalled();
        expect(sentCodes).toEqual([]);
      });

      it.each(invalidEmails)('does not sign in when the email is %s', async (_kind, email) => {
        const res = await post(verifyRoute, { email, code: '123456' });

        expect(res.status).toBe(400);
        expect(dbConnect).not.toHaveBeenCalled();
        expect(setCookie).not.toHaveBeenCalled();
      });

      it.each([
        ['missing', undefined],
        ['null', null],
        ['a boolean', true],
        ['an array', []],
        ['an object', {}],
        ['empty', ''],
        ['five digits', '12345'],
        ['seven digits', '1234567'],
        ['not all digits', '12345a'],
        ['padded with a space', ' 123456'],
        ['followed by a newline', '123456\n'],
        ['in full-width digits', '１２３４５６'],
      ])('does not sign in when the code is %s', async (_kind, code) => {
        const res = await post(verifyRoute, { email: newEmail(), code });

        expect(res.status).toBe(400);
        expect(dbConnect).not.toHaveBeenCalled();
        expect(setCookie).not.toHaveBeenCalled();
      });

      it('does not sign in when the code is a number', async () => {
        const email = newEmail();
        const code = await receiveCode(email);
        jest.mocked(dbConnect).mockClear();

        const res = await post(verifyRoute, { email, code: Number(code) });

        expect(res.status).toBe(400);
        expect(dbConnect).not.toHaveBeenCalled();
        expect(setCookie).not.toHaveBeenCalled();
      });

      it.each([
        ['null', null],
        ['an array', []],
        ['a string', 'text'],
        ['a number', 7],
      ])('refuses a body that is %s', async (_kind, body) => {
        expect((await post(requestRoute, body)).status).toBe(400);
        expect((await post(verifyRoute, body)).status).toBe(400);
        expect(dbConnect).not.toHaveBeenCalled();
      });

      it('validates in verifyOtp itself', async () => {
        const email = newEmail();
        const code = await receiveCode(email);

        expect(await verifyOtp(email, Number(code))).toBe(false);
        expect(await verifyOtp({}, code)).toBe(false);
        expect(await verifyOtp(email, code)).toBe(true);
      });

      it('accepts an email of 254 characters', async () => {
        const email = `${'a'.repeat(242)}@example.com`;

        expect((await signIn(email, await receiveCode(email))).status).toBe(200);
      });

      it('signs a new address in and sets the session cookie', async () => {
        const email = newEmail();

        const res = await signIn(email, await receiveCode(email));

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ isNewUser: true, user: { email } });
        expect(setCookie).toHaveBeenCalledWith('auth-token', 'test-token', expect.any(Object));
      });
    });

    describe('codes', () => {
      it('accepts the code after four wrong attempts', async () => {
        const email = newEmail();
        const code = await receiveCode(email);
        await enterWrongCodes(email, code, 4);

        expect((await signIn(email, code)).status).toBe(200);
      });

      it('refuses the code after five wrong attempts', async () => {
        const email = newEmail();
        const code = await receiveCode(email);
        await enterWrongCodes(email, code, 5);

        expect((await signIn(email, code)).status).toBe(401);
        expect(setCookie).not.toHaveBeenCalled();
      });

      it.each([
        [4, 200],
        [5, 401],
        [20, 401],
      ])('after %i simultaneous wrong attempts answers the code with %i', async (times, status) => {
        const email = newEmail();
        const code = await receiveCode(email);
        await Promise.all(Array.from({ length: times }, (_, i) => signIn(email, otherCode(code, i + 1))));

        expect((await signIn(email, code)).status).toBe(status);
      });

      it('resets the count with a new code', async () => {
        const email = newEmail();
        await enterWrongCodes(email, await receiveCode(email), 5);

        const code = await receiveCode(email);
        await enterWrongCodes(email, code, 4);

        expect((await signIn(email, code)).status).toBe(200);
      });

      it('counts attempts for each address separately', async () => {
        const [first, second] = [newEmail(), newEmail()];
        const firstCode = await receiveCode(first);
        const secondCode = await receiveCode(second);
        await enterWrongCodes(first, firstCode, 5);

        expect((await signIn(second, secondCode)).status).toBe(200);
      });

      it('accepts a code once', async () => {
        const email = newEmail();
        const code = await receiveCode(email);

        expect((await signIn(email, code)).status).toBe(200);
        expect((await signIn(email, code)).status).toBe(401);
      });

      it('accepts a code once when two requests race', async () => {
        for (let round = 0; round < 10; round++) {
          const email = newEmail();
          const code = await receiveCode(email);
          setCookie.mockClear();

          const responses = await Promise.all([signIn(email, code), signIn(email, code)]);

          expect(responses.map((res) => res.status).sort()).toEqual([200, 401]);
          expect(setCookie).toHaveBeenCalledTimes(1);
        }
      });

      it('replaces the previous code', async () => {
        const email = newEmail();
        const previous = await receiveCode(email);
        let latest = await receiveCode(email);
        while (latest === previous) latest = await receiveCode(email);

        expect((await signIn(email, previous)).status).toBe(401);
        expect((await signIn(email, latest)).status).toBe(200);
      });

      it('keeps one usable code when requests for a new address race', async () => {
        const email = newEmail();
        await Promise.all(Array.from({ length: 4 }, () => requestCode(email)));

        const statuses: number[] = [];
        for (const code of new Set(sentCodes.map((sent) => sent.code))) {
          statuses.push((await signIn(email, code)).status);
        }

        expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      });

      it('accepts a code until just before its 10 minutes end', async () => {
        const moveTo = controlClock();
        const email = newEmail();
        const code = await receiveCode(email);

        moveTo(10 * MINUTE_MS - 1);

        expect((await signIn(email, code)).status).toBe(200);
      });

      it('refuses a code once its 10 minutes end', async () => {
        const moveTo = controlClock();
        const email = newEmail();
        const code = await receiveCode(email);

        moveTo(10 * MINUTE_MS);

        expect((await signIn(email, code)).status).toBe(401);
      });
    });

    describe('code requests', () => {
      it('sends five codes to an address, then refuses without replacing the last', async () => {
        const email = newEmail();
        let code = '';
        for (let i = 0; i < 5; i++) code = await receiveCode(email);

        expect((await requestCode(email)).status).toBe(429);
        expect(sentCodes).toHaveLength(5);
        expect((await signIn(email, code)).status).toBe(200);
      });

      it('keeps the limit after a successful sign-in', async () => {
        const email = newEmail();
        for (let i = 0; i < 5; i++) await signIn(email, await receiveCode(email));

        expect((await requestCode(email)).status).toBe(429);
      });

      it('sends five codes when twelve requests race', async () => {
        const email = newEmail();

        const responses = await Promise.all(Array.from({ length: 12 }, () => requestCode(email)));

        expect(responses.map((res) => res.status).sort()).toEqual([...Array(5).fill(200), ...Array(7).fill(429)]);
        expect(sentCodes).toHaveLength(5);
      });

      it('limits each address separately', async () => {
        const email = newEmail();
        for (let i = 0; i < 5; i++) await receiveCode(email);

        expect((await requestCode(newEmail())).status).toBe(200);
      });

      it('counts an address once whatever its letter case', async () => {
        const email = newEmail();
        for (let i = 0; i < 5; i++) await receiveCode(email);

        expect((await requestCode(email.toUpperCase())).status).toBe(429);
      });

      it('allows five in any 15 minutes', async () => {
        const moveTo = controlClock();
        const email = newEmail();
        await receiveCode(email);
        moveTo(14 * MINUTE_MS);
        for (let i = 0; i < 4; i++) await receiveCode(email);

        moveTo(15 * MINUTE_MS - 1);
        expect((await requestCode(email)).status).toBe(429);

        moveTo(15 * MINUTE_MS);
        expect((await requestCode(email)).status).toBe(200);
        expect((await requestCode(email)).status).toBe(429);
      });
    });
  });
}

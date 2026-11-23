import crypto, { createHash } from 'crypto';
import dbConnect from '@/lib/db/mongoose';
import { verifyOtp } from '@/lib/auth/verifyOtp';
import { POST as requestRoute } from '@/app/api/auth/request-otp/route';
import { POST as verifyRoute } from '@/app/api/auth/verify-otp/route';
import Otp from '@/models/otp';
import OtpRequest from '@/models/otpRequest';
import User from '@/models/user';
import {
  ALPHABET,
  Browser,
  DAY_MS,
  EMAILED_CODE,
  KNOWN_BROWSER_SECONDS,
  MINUTE_MS,
  codesSentTo,
  controlClock,
  installBrowsers,
  knownBrowser,
  newEmail,
  post,
  receiveCode,
  repeated,
  requestAtOnce,
  requestCode,
  requestInTurn,
  sentCount,
  signIn,
} from './signInBrowsers';
import { describeSendLimits } from './signInLimitsContract';

// The cases email-code sign-in must pass on any database. The test file that calls this
// mocks next/headers, @/lib/db/mongoose and @/lib/auth/jwt, and provides the database.

const BROWSER_SECONDS = 60 * 60;
const USE_SAME_BROWSER = 'Enter the code in the browser that requested it, or request a new code.';
const VALID_CODE = '2345-6789';

function otherCode(code: string, offset: number) {
  const last = ALPHABET.indexOf(code.slice(-1));
  return code.slice(0, -1) + ALPHABET[(last + offset) % ALPHABET.length];
}

async function enterWrongCodes(browser: Browser, email: string, code: string, times: number) {
  for (let i = 1; i <= times; i++) {
    expect((await signIn(browser, email, otherCode(code, i))).status).toBe(401);
  }
}

function setNodeEnv(value: string | undefined) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

function describeInput() {
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
      const res = await requestCode(new Browser(), email);

      expect(res.status).toBe(400);
      expect(dbConnect).not.toHaveBeenCalled();
      expect(sentCount()).toBe(0);
    });

    it.each(invalidEmails)('does not sign in when the email is %s', async (_kind, email) => {
      const browser = new Browser();
      const res = await signIn(browser, email, VALID_CODE);

      expect(res.status).toBe(400);
      expect(dbConnect).not.toHaveBeenCalled();
      expect(browser.signedIn).toBe(false);
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['a boolean', true],
      ['a number', 23456789],
      ['an array', [VALID_CODE]],
      ['an object', { $ne: null }],
      ['empty', ''],
      ['only separators', ' - '],
      ['seven characters', '2345-678'],
      ['nine characters', '2345-67892'],
      ['with a zero', '2345-6780'],
      ['with a one', '2345-6781'],
      ['with an I', '2345-678I'],
      ['with a lower-case L', '2345-678l'],
      ['with an O', '2345-678O'],
      ['with a long s', '2345-678ſ'],
      ['with a symbol', '2345_6789'],
      ['in full-width digits', '２３４５６７８９'],
      ['over 32 characters as typed', VALID_CODE + ' '.repeat(24)],
    ])('does not sign in when the code is %s', async (_kind, code) => {
      const browser = new Browser();
      const email = newEmail();
      await receiveCode(browser, email);
      jest.mocked(dbConnect).mockClear();

      const res = await signIn(browser, email, code);

      expect(res.status).toBe(400);
      expect(dbConnect).not.toHaveBeenCalled();
      expect(browser.signedIn).toBe(false);
    });

    it.each([
      ['as emailed', (code: string) => code],
      ['in lower case', (code: string) => code.toLowerCase()],
      ['without the hyphen', (code: string) => code.replace('-', '')],
      ['with spaces', (code: string) => ` ${code.replace('-', ' ')} `],
      ['with a space between each character', (code: string) => code.split('').join(' ')],
      ['followed by a line break', (code: string) => `${code}\r\n`],
      ['32 characters long as typed', (code: string) => code + ' '.repeat(23)],
    ])('accepts the code %s', async (_kind, typed) => {
      const [browser, email] = [new Browser(), newEmail()];

      expect((await signIn(browser, email, typed(await receiveCode(browser, email)))).status).toBe(200);
    });

    it.each([
      ['null', null],
      ['an array', []],
      ['a string', 'text'],
      ['a number', 7],
    ])('refuses a body that is %s', async (_kind, body) => {
      expect((await post(requestRoute, new Browser(), body)).status).toBe(400);
      expect((await post(verifyRoute, new Browser(), body)).status).toBe(400);
      expect(dbConnect).not.toHaveBeenCalled();
    });

    it.each([
      null,
      '',
      'text/plain',
      'text/plain; application/json',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'application/jsonp',
      'application/json-patch+json',
      'application/json, text/plain',
    ])('answers 415 to the content type %p', async (contentType) => {
      const browser = new Browser();

      expect((await requestCode(browser, newEmail(), { contentType })).status).toBe(415);
      expect((await signIn(browser, newEmail(), VALID_CODE, { contentType })).status).toBe(415);
      expect(dbConnect).not.toHaveBeenCalled();
      expect(sentCount()).toBe(0);
      expect(browser.jar.size).toBe(0);
    });

    it.each(['application/json; charset=utf-8', 'Application/JSON', 'application/json ;charset=UTF-8'])(
      'accepts the content type %p',
      async (contentType) => {
        const [browser, email] = [new Browser(), newEmail()];
        expect((await requestCode(browser, email, { contentType })).status).toBe(200);

        expect((await signIn(browser, email, codesSentTo(email)[0], { contentType })).status).toBe(200);
      },
    );

    it('validates in verifyOtp itself', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      const code = await receiveCode(browser, email);
      const browserId = browser.cookieLasting(BROWSER_SECONDS)!.value;

      expect(await verifyOtp(browserId, email, 23456789)).toBeNull();
      expect(await verifyOtp(browserId, {}, code)).toBeNull();
      expect(await verifyOtp({}, email, code)).toBeNull();
      expect(await verifyOtp(browserId, email, code)).toEqual(expect.any(String));
    });

    it('accepts an email of 254 characters', async () => {
      const [browser, email] = [new Browser(), `${'a'.repeat(242)}@example.com`];

      expect((await signIn(browser, email, await receiveCode(browser, email))).status).toBe(200);
    });

    it('signs a new address in and sets the session cookie', async () => {
      const [browser, email] = [new Browser(), newEmail()];

      const res = await signIn(browser, email, await receiveCode(browser, email));

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ isNewUser: true, user: { email } });
      expect(browser.jar.get('auth-token')?.value).toBe('test-token');
    });
  });
}

function describeCodes() {
  describe('codes', () => {
    it('emails eight characters as two groups of four', async () => {
      const code = await receiveCode(new Browser(), newEmail());

      expect(code).toMatch(new RegExp(`^${EMAILED_CODE.source}$`));
    });

    it('draws each character from the 31 with crypto.randomInt', async () => {
      const randomInt = jest.spyOn(crypto, 'randomInt') as unknown as jest.Mock;
      let next = 0;
      randomInt.mockImplementation(() => next++ % ALPHABET.length);

      let drawn = '';
      for (let i = 0; i < 4; i++) drawn += (await receiveCode(new Browser(), newEmail())).replace('-', '');

      expect(drawn.slice(0, 31)).toBe(ALPHABET);
      expect(randomInt.mock.calls).toEqual(Array(32).fill([ALPHABET.length]));
    });

    it('accepts the code after four wrong attempts', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      const code = await receiveCode(browser, email);
      await enterWrongCodes(browser, email, code, 4);

      expect((await signIn(browser, email, code)).status).toBe(200);
    });

    it('refuses the code after five wrong attempts', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      const code = await receiveCode(browser, email);
      await enterWrongCodes(browser, email, code, 5);

      expect((await signIn(browser, email, code)).status).toBe(401);
      expect(browser.signedIn).toBe(false);
    });

    it.each([
      [4, 200],
      [5, 401],
      [20, 401],
    ])('after %i simultaneous wrong attempts answers the code with %i', async (times, status) => {
      const [browser, email] = [new Browser(), newEmail()];
      const code = await receiveCode(browser, email);
      await requestAtOnce(times, (i) => signIn(browser, email, otherCode(code, i + 1)));

      expect((await signIn(browser, email, code)).status).toBe(status);
    });

    it('resets the count with a new code', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      await enterWrongCodes(browser, email, await receiveCode(browser, email), 5);

      const code = await receiveCode(browser, email);
      await enterWrongCodes(browser, email, code, 4);

      expect((await signIn(browser, email, code)).status).toBe(200);
    });

    it('counts attempts for each email separately', async () => {
      const [browser, first, second] = [new Browser(), newEmail(), newEmail()];
      const firstCode = await receiveCode(browser, first);
      const secondCode = await receiveCode(browser, second);
      await enterWrongCodes(browser, first, firstCode, 5);

      expect((await signIn(browser, second, secondCode)).status).toBe(200);
    });

    it('accepts a code once', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      const code = await receiveCode(browser, email);

      expect((await signIn(browser, email, code)).status).toBe(200);
      expect((await signIn(browser, email, code)).status).toBe(401);
    });

    it('accepts a code once when two requests race', async () => {
      for (let round = 0; round < 10; round++) {
        const [browser, email] = [new Browser(), newEmail()];
        const code = await receiveCode(browser, email);

        expect(await requestAtOnce(2, () => signIn(browser, email, code))).toEqual([200, 401]);
      }
    });

    it('replaces the previous code', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      const previous = await receiveCode(browser, email);
      const latest = await receiveCode(browser, email);

      expect((await signIn(browser, email, previous)).status).toBe(401);
      expect((await signIn(browser, email, latest)).status).toBe(200);
    });

    it('keeps one usable code when requests from one browser race', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      await receiveCode(browser, newEmail());
      expect(await requestAtOnce(3, () => requestCode(browser, email))).toEqual(repeated(3, 200));

      const codes = codesSentTo(email);
      const statuses = await requestInTurn(codes.length, (i) => signIn(browser, email, codes[i]));

      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    });

    it('accepts a code until just before its 10 minutes end', async () => {
      const moveTo = controlClock();
      const [browser, email] = [new Browser(), newEmail()];
      const code = await receiveCode(browser, email);

      moveTo(10 * MINUTE_MS - 1);

      expect((await signIn(browser, email, code)).status).toBe(200);
    });

    it('refuses a code once its 10 minutes end', async () => {
      const moveTo = controlClock();
      const [browser, email] = [new Browser(), newEmail()];
      const code = await receiveCode(browser, email);

      moveTo(10 * MINUTE_MS);

      expect((await signIn(browser, email, code)).status).toBe(401);
    });

    it('does not accept a code stored under the email alone', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      await receiveCode(browser, newEmail());
      const expiresAt = new Date(Date.now() + 10 * MINUTE_MS);
      await Otp.create({ _id: email, code: '23456789', deviceId: 'device', attempts: 0, expiresAt });

      expect((await signIn(browser, email, VALID_CODE)).status).toBe(401);
    });
  });
}

function describeBrowserBinding() {
  describe('requesting browser', () => {
    it.each([
      ['test', false],
      ['production', true],
    ])('gets a random 32-byte cookie in %s, with secure %p', async (env, secure) => {
      setNodeEnv(env);
      const [first, second] = [new Browser(), new Browser()];
      await receiveCode(first, newEmail());
      await receiveCode(second, newEmail());

      const cookie = first.cookieLasting(BROWSER_SECONDS)!;
      expect(Buffer.from(cookie.value, 'base64url')).toHaveLength(32);
      expect(cookie.value).not.toBe(second.cookieLasting(BROWSER_SECONDS)!.value);
      expect(cookie.options).toEqual({
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: BROWSER_SECONDS,
      });
    });

    it('keeps its cookie from one request to the next', async () => {
      const browser = new Browser();
      await receiveCode(browser, newEmail());
      const { value } = browser.cookieLasting(BROWSER_SECONDS)!;

      await receiveCode(browser, newEmail());

      expect(browser.cookieLasting(BROWSER_SECONDS)!.value).toBe(value);
    });

    it.each([
      ['empty', ''],
      ['short', 'a'.repeat(42)],
      ['long', 'a'.repeat(44)],
      ['not base64url', '+'.repeat(43)],
    ])('gets a new cookie for one that is %s', async (_kind, malformed) => {
      const [browser, email] = [new Browser(), newEmail()];
      await receiveCode(browser, email);
      const { name, options } = browser.cookieLasting(BROWSER_SECONDS)!;
      browser.jar.set(name, { value: malformed, options });

      const code = await receiveCode(browser, email);

      expect(browser.jar.get(name)!.value).not.toBe(malformed);
      expect((await signIn(browser, email, code)).status).toBe(200);
    });

    it('keys the code by the SHA-256 of its cookie and the exact email', async () => {
      const [browser, email] = [new Browser(), `Mixed.${newEmail()}`];
      await receiveCode(browser, email);
      const { value } = browser.cookieLasting(BROWSER_SECONDS)!;

      const _id = createHash('sha256').update(value + email).digest('hex');

      expect(await Otp.findOne({ _id })).not.toBeNull();
      expect(await Otp.findOne({ _id: email })).toBeNull();
    });

    it('needs the exact email', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      const code = await receiveCode(browser, email);

      expect((await signIn(browser, email.toUpperCase(), code)).status).toBe(401);
      expect((await signIn(browser, email, code)).status).toBe(200);
    });

    it('another browser cannot use the code', async () => {
      const [first, second, email] = [new Browser(), new Browser(), newEmail()];
      const code = await receiveCode(first, email);
      await receiveCode(second, newEmail());

      expect((await signIn(second, email, code)).status).toBe(401);
      expect(second.signedIn).toBe(false);
      expect((await signIn(first, email, code)).status).toBe(200);
    });

    it('another browser cannot spend the attempts', async () => {
      const [first, second, email] = [new Browser(), new Browser(), newEmail()];
      const code = await receiveCode(first, email);
      await receiveCode(second, newEmail());
      await enterWrongCodes(second, email, code, 20);

      expect((await signIn(first, email, code)).status).toBe(200);
    });

    it('another browser cannot replace the code', async () => {
      const [first, second, email] = [new Browser(), new Browser(), newEmail()];
      const firstCode = await receiveCode(first, email);
      const secondCode = await receiveCode(second, email);

      expect((await signIn(first, email, secondCode)).status).toBe(401);
      expect((await signIn(first, email, firstCode)).status).toBe(200);
      expect((await signIn(second, email, secondCode)).status).toBe(200);
    });

    it('another browser asking again and again cannot replace the code', async () => {
      const [first, second, email] = [new Browser(), new Browser(), newEmail()];
      const code = await receiveCode(first, email);
      await requestInTurn(10, () => requestCode(second, email));

      expect((await signIn(first, email, code)).status).toBe(200);
    });

    it.each([
      ['no cookie', () => {}],
      ['a malformed cookie', (browser: Browser, name: string) => browser.jar.set(name, { value: 'x', options: {} })],
    ])('a browser with %s is told to use the one that asked', async (_kind, prepare) => {
      const [first, second, email] = [new Browser(), new Browser(), newEmail()];
      const code = await receiveCode(first, email);
      prepare(second, first.cookieLasting(BROWSER_SECONDS)!.name);
      jest.mocked(dbConnect).mockClear();

      const res = await signIn(second, email, code);

      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe(USE_SAME_BROWSER);
      expect(dbConnect).not.toHaveBeenCalled();
      expect((await signIn(first, email, code)).status).toBe(200);
    });
  });
}

function describeKnownBrowser() {
  describe('known browser', () => {
    it.each([
      ['test', false],
      ['production', true],
    ])('is remembered for 90 days in %s, with secure %p', async (env, secure) => {
      setNodeEnv(env);
      const browser = await knownBrowser(newEmail());

      expect(browser.cookieLasting(KNOWN_BROWSER_SECONDS)!.options).toEqual({
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: KNOWN_BROWSER_SECONDS,
      });
    });

    it('is not remembered before a successful sign-in', async () => {
      const [browser, email] = [new Browser(), newEmail()];
      const code = await receiveCode(browser, email);
      await enterWrongCodes(browser, email, code, 1);

      expect(browser.cookieLasting(KNOWN_BROWSER_SECONDS)).toBeUndefined();
    });

    it('does not show the email', async () => {
      const email = newEmail();
      const { name, value } = (await knownBrowser(email)).cookieLasting(KNOWN_BROWSER_SECONDS)!;

      const readable = [name, value, ...value.split('.').map((part) => Buffer.from(part, 'base64url').toString())];
      const hashes = (['hex', 'base64url'] as const).map((encoding) =>
        createHash('sha256').update(email).digest(encoding).slice(0, 16),
      );
      for (const part of readable) {
        for (const giveaway of [email.split('@')[0], 'example.com', ...hashes]) expect(part).not.toContain(giveaway);
      }
    });

    it('has a random id for each browser', async () => {
      const email = newEmail();
      const [first, second] = [await knownBrowser(email), await knownBrowser(email)];

      const deviceOf = (browser: Browser) => browser.cookieLasting(KNOWN_BROWSER_SECONDS)!.value.split('.')[0];

      expect(deviceOf(first)).not.toBe(deviceOf(second));
    });

    it('stays known for several emails at once', async () => {
      const [browser, first, second] = [new Browser(), newEmail(), newEmail()];
      for (const email of [first, second]) await signIn(browser, email, await receiveCode(browser, email));

      for (const email of [first, second]) {
        expect(await requestInTurn(5, () => requestCode(browser, email))).toEqual(repeated(5, 200));
      }
    });

    const altered: [string, (value: string) => string][] = [
      ['an altered device id', (value) => (value[0] === 'a' ? 'b' : 'a') + value.slice(1)],
      ['a later expiry', (value) => value.replace(/\.(\d+)\./, (_, at) => `.${Number(at) + DAY_MS}.`)],
      ['an altered signature', (value) => value.replace(/[^.]+$/, (mac) => [...mac].reverse().join(''))],
      ['no signature', (value) => value.slice(0, value.lastIndexOf('.'))],
      ['an extra part', (value) => `${value}.x`],
      ['nothing in it', () => ''],
      ['a session token in it', () => 'test-token'],
    ];

    it.each(altered)('is not known with %s', async (_kind, alter) => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      const { name, value, options } = browser.cookieLasting(KNOWN_BROWSER_SECONDS)!;
      browser.jar.set(name, { value: alter(value), options });

      expect(await requestInTurn(4, () => requestCode(browser, email))).toEqual([200, 200, 200, 429]);
    });

    it('is not known with the cookie of another email', async () => {
      const [email, other] = [newEmail(), newEmail()];
      const browser = await knownBrowser(email);
      const { name, options } = browser.cookieLasting(KNOWN_BROWSER_SECONDS)!;
      const { value } = (await knownBrowser(other)).cookieLasting(KNOWN_BROWSER_SECONDS)!;
      browser.jar.set(name, { value, options });

      expect(await requestInTurn(4, () => requestCode(browser, email))).toEqual([200, 200, 200, 429]);
    });

    it('is not known under another secret', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      process.env.JWT_SECRET = 'another-test-secret';

      expect(await requestInTurn(4, () => requestCode(browser, email))).toEqual([200, 200, 200, 429]);
    });

    it.each([
      ['just before', 90 * DAY_MS - 1, [200, 200, 200, 200]],
      ['when', 90 * DAY_MS, [200, 200, 200, 429]],
    ])('%s its 90 days end, answers four requests with %p', async (_kind, at, expected) => {
      const moveTo = controlClock();
      const email = newEmail();
      const browser = await knownBrowser(email);

      moveTo(at as number);

      expect(await requestInTurn(4, () => requestCode(browser, email))).toEqual(expected);
    });

    it('starts another 90 days with each sign-in', async () => {
      const moveTo = controlClock();
      const email = newEmail();
      const browser = await knownBrowser(email);
      moveTo(60 * DAY_MS);
      await signIn(browser, email, await receiveCode(browser, email));

      moveTo(120 * DAY_MS);

      expect(await requestInTurn(4, () => requestCode(browser, email))).toEqual(repeated(4, 200));
    });

    it('cannot sign in without a code', async () => {
      const email = newEmail();
      const browser = await knownBrowser(email);
      browser.jar.delete('auth-token');

      expect((await signIn(browser, email, VALID_CODE)).status).toBe(401);
      expect(browser.signedIn).toBe(false);
    });

    it('cannot use a code another browser asked for', async () => {
      const [first, email] = [new Browser(), newEmail()];
      const second = await knownBrowser(email);
      second.jar.delete('auth-token');
      const code = await receiveCode(first, email);

      expect((await signIn(second, email, code)).status).toBe(401);
      expect(second.signedIn).toBe(false);
    });
  });
}

function describeDelivery() {
  describe('delivery', () => {
    it.each([
      ['unset', undefined],
      ['empty', ''],
      ['the placeholder', 'YOUR_BREVO_API_KEY'],
    ])('refuses in production when the Brevo key is %s', async (_kind, key) => {
      const [browser, email] = [new Browser(), newEmail()];
      const earlierCode = await receiveCode(browser, email);
      setNodeEnv('production');
      if (key === undefined) delete process.env.BREVO_API_KEY;
      else process.env.BREVO_API_KEY = key;
      jest.mocked(dbConnect).mockClear();
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});

      const res = await requestCode(browser, email);

      expect(res.status).toBe(503);
      expect(dbConnect).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(JSON.stringify(error.mock.calls)).not.toMatch(EMAILED_CODE);
      expect((await signIn(browser, email, earlierCode)).status).toBe(200);
    });

    it('sends without logging the code in production', async () => {
      setNodeEnv('production');
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});

      await receiveCode(new Browser(), newEmail());

      expect(log).not.toHaveBeenCalled();
    });

    it('logs the code outside production when Brevo is not configured', async () => {
      delete process.env.BREVO_API_KEY;
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      const [browser, email] = [new Browser(), newEmail()];

      expect((await requestCode(browser, email)).status).toBe(200);

      const code = EMAILED_CODE.exec(String(log.mock.calls[0][0]))![0];
      expect(sentCount()).toBe(0);
      expect((await signIn(browser, email, code)).status).toBe(200);
    });
  });
}

export function describeSignInContract(database: string) {
  describe(`email-code sign-in on ${database}`, () => {
    const { NODE_ENV, BREVO_API_KEY, EMAIL_USER, JWT_SECRET, CLIENT_IP_HEADER, CLIENT_IP_HEADER_ENTRY } = process.env;

    beforeEach(async () => {
      // The site-wide count is shared, so no test may inherit another's sends.
      await Promise.all([Otp.deleteMany({}), OtpRequest.deleteMany({}), User.deleteMany({})]);
      jest.clearAllMocks();
      installBrowsers();
      process.env.BREVO_API_KEY = 'test-placeholder';
      process.env.EMAIL_USER = 'no-reply@example.com';
      process.env.JWT_SECRET = 'test-secret-for-sign-in';
      process.env.CLIENT_IP_HEADER = 'x-real-ip';
      delete process.env.CLIENT_IP_HEADER_ENTRY;
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
      setNodeEnv(NODE_ENV);
      const restored = { BREVO_API_KEY, EMAIL_USER, JWT_SECRET, CLIENT_IP_HEADER, CLIENT_IP_HEADER_ENTRY };
      for (const [name, value] of Object.entries(restored)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    describeInput();
    describeCodes();
    describeBrowserBinding();
    describeKnownBrowser();
    describeSendLimits();
    describeDelivery();
  });
}

import { AsyncLocalStorage } from 'async_hooks';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { POST as requestRoute } from '@/app/api/auth/request-otp/route';
import { POST as verifyRoute } from '@/app/api/auth/verify-otp/route';

// Browsers for tests/helpers/signInContract.ts: each keeps its own cookies and has a client
// address of its own, and any number of them can call the sign-in routes at the same time.

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const KNOWN_BROWSER_SECONDS = 90 * 24 * 60 * 60;

export const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const EMAILED_CODE = new RegExp(`\\b[${ALPHABET}]{4}-[${ALPHABET}]{4}\\b`);

let emails = 0;
let addresses = 0;

export const newEmail = () => `person${++emails}@example.com`;
export function newAddress() {
  addresses++;
  return `10.${(addresses >> 16) & 255}.${(addresses >> 8) & 255}.${addresses & 255}`;
}

interface StoredCookie {
  value: string;
  options: Record<string, unknown>;
}

export class Browser {
  readonly jar = new Map<string, StoredCookie>();

  constructor(public address: string | null = newAddress()) {}

  cookieLasting(seconds: number) {
    const found = [...this.jar].find(([, cookie]) => cookie.options.maxAge === seconds);
    return found && { name: found[0], ...found[1] };
  }

  get signedIn() {
    return this.jar.has('auth-token');
  }
}

export const newBrowsers = (count: number) => Array.from({ length: count }, () => new Browser());

const requesting = new AsyncLocalStorage<Browser>();
let sentCodes: { email: string; code: string }[] = [];

export const codesSentTo = (email: string) =>
  sentCodes.filter((sent) => sent.email === email).map((sent) => sent.code);
export const sentCount = () => sentCodes.length;

function deliver() {
  return async (_url: unknown, init?: RequestInit) => {
    const { to, htmlContent } = JSON.parse(String(init?.body));
    sentCodes.push({ email: to[0].email, code: EMAILED_CODE.exec(htmlContent)![0] });
    return new Response('{}', { status: 201 });
  };
}

export function installBrowsers() {
  sentCodes = [];
  jest.mocked(cookies).mockImplementation(async () => {
    const { jar } = requesting.getStore()!;
    return {
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
      set: (name: string, value: string, options: Record<string, unknown>) => jar.set(name, { value, options }),
    } as unknown as Awaited<ReturnType<typeof cookies>>;
  });
  jest.spyOn(global, 'fetch').mockImplementation(deliver());
}

export function restoreDelivery() {
  jest.mocked(global.fetch).mockImplementation(deliver());
}

export interface PostOptions {
  contentType?: string | null;
}

export function post(
  route: (req: NextRequest) => Promise<Response>,
  browser: Browser,
  body: unknown,
  { contentType = 'application/json' }: PostOptions = {},
) {
  const headers = new Headers();
  if (contentType !== null) headers.set('content-type', contentType);
  if (browser.address !== null) headers.set('x-real-ip', browser.address);
  // Bytes, unlike a string, get no content type of their own.
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const req = new NextRequest('http://localhost/api/auth', { method: 'POST', headers, body: bytes });

  return requesting.run(browser, () => route(req));
}

export const requestCode = (browser: Browser, email: unknown, options?: PostOptions) =>
  post(requestRoute, browser, { email }, options);
export const signIn = (browser: Browser, email: unknown, code: unknown, options?: PostOptions) =>
  post(verifyRoute, browser, { email, code }, options);

export async function receiveCode(browser: Browser, email: string) {
  expect((await requestCode(browser, email)).status).toBe(200);
  return codesSentTo(email).at(-1)!;
}

/** A browser that has signed in as `email`, now at an address that has sent nothing. */
export async function knownBrowser(email: string) {
  const browser = new Browser();
  expect((await signIn(browser, email, await receiveCode(browser, email))).status).toBe(200);
  browser.address = newAddress();
  return browser;
}

/** The statuses of `times` requests made one after another. */
export async function requestInTurn(times: number, request: (index: number) => Promise<Response>) {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) statuses.push((await request(i)).status);
  return statuses;
}

/** The statuses of `times` requests made at once, sorted. */
export async function requestAtOnce(times: number, request: (index: number) => Promise<Response>) {
  const responses = await Promise.all(Array.from({ length: times }, (_, i) => request(i)));
  return responses.map((res) => res.status).sort();
}

export const repeated = (times: number, status: number) => Array<number>(times).fill(status);

// Only the clock is faked: the database driver needs working timers.
export function controlClock() {
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

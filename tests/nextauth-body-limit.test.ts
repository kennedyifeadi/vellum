import { NextRequest } from 'next/server';
import { Issuer } from 'openid-client';

let mockRequest: NextRequest;

// Next resolves these from the request being served; NextAuth reads its cookies and headers
// here rather than from the request it is handed.
jest.mock('next/headers', () => ({
  headers: async () => mockRequest.headers,
  cookies: async () => mockRequest.cookies,
}));
jest.mock('@/lib/db/mongodb', () => ({ getMongoClient: () => ({}) }));
jest.mock('@next-auth/mongodb-adapter', () => ({ MongoDBAdapter: () => ({}) }));

import { REQUEST_TOO_LARGE_MESSAGE } from '@/lib/http/read-upload';
import { GET, POST } from '../app/api/auth/[...nextauth]/route';
import { KB, MB, streamedBody } from './helpers/streamedBody';

jest.setTimeout(60_000);

const BASE_URL = 'http://localhost:3000';
const SIGN_IN_URL = `${BASE_URL}/api/auth/signin/google`;
const FORM = 'application/x-www-form-urlencoded';
const AUTH_BODY_LIMIT_BYTES = 64 * KB;
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

const env = process.env as Record<string, string | undefined>;
const originalEnv = { ...env };

function serve(handler: typeof GET, req: NextRequest, path: string[]) {
  mockRequest = req;
  return handler(req, { params: Promise.resolve({ nextauth: path }) });
}

const signInWithGoogle = (req: NextRequest) => serve(POST, req, ['signin', 'google']);

async function csrf() {
  const res = await serve(GET, new NextRequest(`${BASE_URL}/api/auth/csrf`), ['csrf']);
  const { csrfToken } = await res.json();
  const cookie = res.headers.getSetCookie().map((c: string) => c.split(';')[0]).join('; ');
  return { csrfToken: csrfToken as string, cookie };
}

function signInForm(csrfToken: string) {
  return new URLSearchParams({ csrfToken, callbackUrl: `${BASE_URL}/dashboard`, json: 'true' }).toString();
}

/** The sign-in form with a field of its own that brings it to exactly `sizeBytes`. */
function paddedSignInForm(csrfToken: string, sizeBytes: number) {
  const form = signInForm(csrfToken);
  return `padding=${'x'.repeat(sizeBytes - form.length - 'padding=&'.length)}&${form}`;
}

function formRequest(body: string, cookie = '') {
  return new NextRequest(SIGN_IN_URL, { method: 'POST', headers: { 'content-type': FORM, cookie }, body });
}

async function expectRedirectedToGoogle(res: Response) {
  expect(res.status).toBe(200);
  const { url } = await res.json();
  expect(url.startsWith(`${GOOGLE_AUTHORIZE_URL}?`)).toBe(true);
  expect(new URL(url).searchParams.get('client_id')).toBe('test-client-id');
}

async function expectTooLarge(res: Response) {
  expect(res.status).toBe(413);
  expect((await res.json()).error).toBe(REQUEST_TOO_LARGE_MESSAGE);
}

beforeEach(() => {
  env.NEXTAUTH_URL = BASE_URL;
  env.NEXTAUTH_SECRET = 'test-secret';
  env.GOOGLE_CLIENT_ID = 'test-client-id';
  env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  // Google's discovery document, so that signing in needs no network.
  jest.spyOn(Issuer, 'discover').mockResolvedValue(new Issuer({
    issuer: 'https://accounts.google.com',
    authorization_endpoint: GOOGLE_AUTHORIZE_URL,
    token_endpoint: 'https://oauth2.googleapis.com/token',
    jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const name of ['NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
    if (originalEnv[name] === undefined) delete env[name];
    else env[name] = originalEnv[name];
  }
});

describe('Google sign-in', () => {
  it('still redirects to Google', async () => {
    const { csrfToken, cookie } = await csrf();

    await expectRedirectedToGoogle(await signInWithGoogle(formRequest(signInForm(csrfToken), cookie)));
  });

  it('still redirects to Google from a body sent without a Content-Length', async () => {
    const { csrfToken, cookie } = await csrf();
    const form = new TextEncoder().encode(signInForm(csrfToken));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(form);
        controller.close();
      },
    });
    const init = { method: 'POST', headers: { 'content-type': FORM, cookie }, body, duplex: 'half' };

    const req = new NextRequest(SIGN_IN_URL, init as ConstructorParameters<typeof NextRequest>[1]);

    expect(req.headers.get('content-length')).toBeNull();
    await expectRedirectedToGoogle(await signInWithGoogle(req));
  });

  it('still refuses a sign-in without the CSRF token', async () => {
    const res = await signInWithGoogle(formRequest(signInForm('wrong-token')));

    expect(new URL((await res.json()).url).searchParams.get('csrf')).toBe('true');
    expect(Issuer.discover).not.toHaveBeenCalled();
  });
});

describe('the size of a POST body', () => {
  it('accepts a body at the limit', async () => {
    const { csrfToken, cookie } = await csrf();

    const res = await signInWithGoogle(formRequest(paddedSignInForm(csrfToken, AUTH_BODY_LIMIT_BYTES), cookie));

    await expectRedirectedToGoogle(res);
  });

  it('refuses a body one byte over the limit with a 413', async () => {
    const { csrfToken, cookie } = await csrf();

    const res = await signInWithGoogle(formRequest(paddedSignInForm(csrfToken, AUTH_BODY_LIMIT_BYTES + 1), cookie));

    await expectTooLarge(res);
    expect(Issuer.discover).not.toHaveBeenCalled();
  });

  it('refuses a declared oversize body without reading it', async () => {
    const upload = streamedBody(SIGN_IN_URL, 400 * MB, { contentType: FORM, declaredLength: 400 * MB });

    await expectTooLarge(await signInWithGoogle(upload.request));
    expect(upload.bytesRead()).toBe(0);
  });

  it('stops reading an undeclared oversize body once it passes the limit', async () => {
    const upload = streamedBody(SIGN_IN_URL, 400 * MB, { contentType: FORM });

    await expectTooLarge(await signInWithGoogle(upload.request));
    // Reading stops within one chunk of the limit, not at the end of the body.
    expect(upload.bytesRead()).toBeLessThanOrEqual(AUTH_BODY_LIMIT_BYTES + 64 * KB);
  });

  it('applies to every POST, whatever the action', async () => {
    const upload = streamedBody(`${BASE_URL}/api/auth/signout`, 400 * MB, { contentType: FORM, declaredLength: 400 * MB });

    await expectTooLarge(await serve(POST, upload.request, ['signout']));
    expect(upload.bytesRead()).toBe(0);
  });
});

describe('a GET', () => {
  it('still reaches NextAuth', async () => {
    const res = await serve(GET, new NextRequest(`${BASE_URL}/api/auth/providers`), ['providers']);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ google: { id: 'google', signinUrl: SIGN_IN_URL } });
  });
});

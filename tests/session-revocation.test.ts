import type { proxy as Proxy } from '../proxy';
import type { MemoryModel } from './helpers/memoryModel';
import {
  Device,
  call,
  describeSessionRevocation,
  expectSignedIn,
  expectSignedOut,
  installCookieJars,
  signInWithEmail,
  signInWithGoogle,
} from './helpers/sessionRevocationContract';

jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('@/lib/auth/verifyOtp', () => ({ verifyOtp: jest.fn(async () => 'device-id') }));
jest.mock('@/lib/storage', () => ({ getStorage: () => ({}), LocalDiskStorage: class {} }));

// jose ships ESM-only, which ts-jest's CommonJS transform can't load, so the email token is
// signed by a stand-in. Google's token is encrypted for real by next-auth's own copy of jose.
jest.mock('jose', () => {
  class SignJWT {
    constructor(private payload: Record<string, unknown>) {}
    setProtectedHeader() {
      return this;
    }
    setIssuedAt() {
      return this;
    }
    setExpirationTime() {
      return this;
    }
    async sign() {
      return Buffer.from(JSON.stringify(this.payload)).toString('base64url');
    }
  }
  const jwtVerify = async (token: string) => ({ payload: JSON.parse(Buffer.from(token, 'base64url').toString()) });
  return { SignJWT, jwtVerify };
});

// The accounts live on globalThis, so a copy of the app loaded in a registry of its own (as
// Next bundles proxy.ts apart from the routes) reads the same rows.
jest.mock('@/models/user', () => {
  const shared = globalThis as { vellumTestUsers?: unknown };
  return (shared.vellumTestUsers ??= jest.requireActual('./helpers/memoryModel').memoryModelModule());
});
jest.mock('@/models/conversion', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());
jest.mock('@/models/userDocument', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());
jest.mock('@/lib/video/video-job-store', () => ({
  ...jest.requireActual('@/lib/video/video-job-store'),
  createMongoVideoJobStore: () => jest.requireActual('./helpers/memoryVideoJobStore').createMemoryVideoJobStore(),
}));

import User from '@/models/user';
import { DELETE as revokeSessionsRoute } from '../app/api/user/sessions/route';

const users = User as unknown as MemoryModel;

jest.setTimeout(60_000);

describeSessionRevocation('an in-memory database', async (email, fields) => users.seed({ email, plan: 'Basic', ...fields })._id);

describe('the proxy, bundled apart from the routes', () => {
  let separatelyBundled: typeof Proxy;

  beforeAll(() => {
    jest.isolateModules(() => {
      separatelyBundled = jest.requireActual('../proxy').proxy;
    });
  });

  beforeEach(() => {
    installCookieJars();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['email', signInWithEmail],
    ['Google', signInWithGoogle],
  ] as const)('refuses the %s session another route ended, at once', async (kind, signIn) => {
    const email = `bundled-${kind}@sessions.test`;
    const { _id } = users.seed({ email, plan: 'Basic', isProfileComplete: true });
    const [laptop, phone] = [await signIn(new Device(_id, email)), await signIn(new Device(_id, email))];
    await expectSignedIn(phone, separatelyBundled);

    await call(laptop, revokeSessionsRoute, '/api/user/sessions', 'DELETE', { all: true });

    await expectSignedOut(phone, separatelyBundled);
  });
});

import mongoose from 'mongoose';
import { describeSessionRevocation } from './helpers/sessionRevocationContract';

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

// Runs only against a real MongoDB, which CI does not have: set VELLUM_TEST_MONGODB_URI to
// a server (e.g. mongodb://127.0.0.1:27017). Each run uses a database of its own and drops
// it afterwards.
const uri = process.env.VELLUM_TEST_MONGODB_URI;

if (!uri) {
  describe('ending sign-in sessions on a real MongoDB', () => {
    it.skip('is skipped: set VELLUM_TEST_MONGODB_URI to run it', () => {});
  });
} else {
  jest.setTimeout(120_000);

  const dbName = `vellum_sessions_test_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    await mongoose.connect(uri, { dbName });
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  describeSessionRevocation('a real MongoDB', async (email, fields) => {
    const { insertedId } = await mongoose.connection.collection('users').insertOne({ email, plan: 'Basic', ...fields });
    return insertedId.toString();
  });
}

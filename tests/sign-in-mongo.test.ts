import mongoose from 'mongoose';
import { describeSignInContract } from './helpers/signInContract';

jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('@/lib/auth/jwt', () => ({ createToken: jest.fn(async () => 'test-token') }));

// Runs only against a real MongoDB, which CI does not have: set VELLUM_TEST_MONGODB_URI to
// a server (e.g. mongodb://127.0.0.1:27017). Each run uses a database of its own and drops
// it afterwards.
const uri = process.env.VELLUM_TEST_MONGODB_URI;

if (!uri) {
  describe('email-code sign-in on a real MongoDB', () => {
    it.skip('is skipped: set VELLUM_TEST_MONGODB_URI to run it', () => {});
  });
} else {
  jest.setTimeout(120_000);

  const dbName = `vellum_sign_in_test_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    await mongoose.connect(uri, { dbName });
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  describeSignInContract('a real MongoDB');

  it.each(['otps'])('expires rows in %s by their expiresAt', async (collection) => {
    const indexes = await mongoose.connection.collection(collection).indexes();

    expect(indexes).toContainEqual(expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }));
  });
}

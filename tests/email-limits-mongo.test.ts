import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import SupportTicket from '@/models/supportTicket';
import { reserveWelcomeEmail } from '@/lib/email/daily-limits';
import { describeEmailLimitsContract } from './helpers/emailLimitsContract';

jest.mock('@getbrevo/brevo', () => jest.requireActual('./helpers/brevoMock'));
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
jest.mock('next-auth/jwt', () => ({
  getToken: jest.fn(async ({ req }: { req: NextRequest }) => ({ email: req.headers.get('x-test-email') })),
}));
jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn(async (req: NextRequest) => req.headers.get('x-test-account')),
  verifyToken: jest.fn(async () => null),
  createToken: jest.fn(async () => 'test-token'),
}));

// Runs only against a real MongoDB, which CI does not have: set VELLUM_TEST_MONGODB_URI to
// a server (e.g. mongodb://127.0.0.1:27017). Each run uses a database of its own and drops
// it afterwards.
const uri = process.env.VELLUM_TEST_MONGODB_URI;

if (!uri) {
  describe('daily email limits on a real MongoDB', () => {
    it.skip('is skipped: set VELLUM_TEST_MONGODB_URI to run it', () => {});
  });
} else {
  jest.setTimeout(120_000);

  const dbName = `vellum_email_limits_test_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    await mongoose.connect(uri, { dbName });
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  });

  beforeEach(async () => {
    await Promise.all(['users', 'supporttickets', 'emailallowances'].map((name) => mongoose.connection.collection(name).deleteMany({})));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  describeEmailLimitsContract('a real MongoDB', () => SupportTicket.countDocuments());

  // Mongoose's own build, when the model is compiled, gives up if the connection is still
  // opening, as it is when Next loads the routes at startup.
  it('expires rows in emailallowances by their expiresAt, even without the model build', async () => {
    const collection = mongoose.connection.collection('emailallowances');
    await collection.drop().catch(() => undefined);

    expect(await reserveWelcomeEmail()).toBe(true);

    expect(await collection.indexes()).toContainEqual(expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }));
  });
}

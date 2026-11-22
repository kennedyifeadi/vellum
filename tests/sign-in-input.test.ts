import { describeSignInContract } from './helpers/signInContract';

jest.mock('mongoose', () =>
  jest.requireActual<typeof import('./helpers/memoryMongoose')>('./helpers/memoryMongoose').createMemoryMongoose(),
);
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('@/lib/auth/jwt', () => ({ createToken: jest.fn(async () => 'test-token') }));

jest.setTimeout(60_000);

describeSignInContract('an in-memory database');

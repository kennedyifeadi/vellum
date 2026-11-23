import { generateOtp } from '@/lib/auth/otp';
import { verifyOtp } from '@/lib/auth/verifyOtp';
import { ALPHABET } from './helpers/signInBrowsers';
import { describeSignInContract } from './helpers/signInContract';

jest.mock('mongoose', () =>
  jest.requireActual<typeof import('./helpers/memoryMongoose')>('./helpers/memoryMongoose').createMemoryMongoose(),
);
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('@/lib/auth/jwt', () => ({ createToken: jest.fn(async () => 'test-token') }));

jest.setTimeout(60_000);

describeSignInContract('an in-memory database');

// The in-memory database serves simultaneous calls in the order they were made, which a real
// one does not promise, so this case runs only here.
it('counts an attempt before comparing its code', async () => {
  const email = 'ordered@example.com';
  const browserId = 'b'.repeat(43);
  const code = await generateOtp(browserId, email, null);
  const last = ALPHABET.indexOf(code.slice(-1));
  const wrong = Array.from({ length: 5 }, (_, i) => code.slice(0, -1) + ALPHABET[(last + i + 1) % ALPHABET.length]);

  const results = await Promise.all([...wrong, code].map((attempt) => verifyOtp(browserId, email, attempt)));

  expect(results).toEqual(Array(6).fill(null));
});

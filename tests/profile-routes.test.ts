import { NextRequest } from 'next/server';

jest.mock('@getbrevo/brevo', () => jest.requireActual('./helpers/brevoMock'));
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));
jest.mock('@/lib/auth/jwt', () => ({ verifyToken: jest.fn(), createToken: jest.fn() }));
jest.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'session' }), set: () => undefined }),
}));

import * as brevo from '@getbrevo/brevo';
import { createToken, verifyToken } from '@/lib/auth/jwt';
import User from '@/models/user';
import { POST as completeProfile } from '../app/api/auth/complete-profile/route';
import { PATCH as updateProfile } from '../app/api/user/profile/route';
import type * as BrevoMock from './helpers/brevoMock';

const { sendTransacEmail, sentEmails, visibleText, BrevoError } = brevo as unknown as typeof BrevoMock;

jest.setTimeout(30_000);

const USER_ID = '6730a1b2c3d4e5f6a7b8c9d0';
const PROFILE = { name: 'Ada Lovelace', role: 'Student', currentGoal: 'Merge PDFs' };

const env = process.env as Record<string, string | undefined>;
const originalEnv = { ...env };
let stored: Record<string, unknown> | null;
let logged: jest.SpyInstance[];

// One stored user, behind updates that are atomic and reads that can be stale by the time
// they are used, as with MongoDB.
function storeOneUser() {
  const snapshot = () => stored && { ...stored, save: async function save(this: object) { Object.assign(stored!, this); } };
  const update = async (fields: object) => {
    if (!stored) return null;
    Object.assign(stored, fields);
    return snapshot();
  };

  jest.spyOn(User, 'findById').mockImplementation((async () => snapshot()) as never);
  jest.spyOn(User, 'findByIdAndUpdate').mockImplementation((async (_id: string, fields: object) => update(fields)) as never);
  jest.spyOn(User, 'findOneAndUpdate').mockImplementation((async (
    filter: { isProfileComplete?: { $ne: boolean } },
    fields: object,
  ) => {
    const excluded = filter.isProfileComplete?.$ne;
    if (excluded !== undefined && stored?.isProfileComplete === excluded) return null;
    return update(fields);
  }) as never);
}

function request(method: string, path: string, body: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const complete = (body: unknown = PROFILE) => completeProfile(request('POST', '/api/auth/complete-profile', body));
const update = (body: unknown) => updateProfile(request('PATCH', '/api/user/profile', body));

beforeEach(() => {
  env.BREVO_API_KEY = 'test-key';
  env.EMAIL_USER = 'no-reply@vellum.test';
  sendTransacEmail.mockReset().mockResolvedValue({ messageId: 'test' });
  jest.mocked(verifyToken).mockResolvedValue({ userId: USER_ID });
  jest.mocked(createToken).mockResolvedValue('new-session');

  stored = { _id: USER_ID, email: 'ada@account.test', isProfileComplete: false, tokenVersion: 1 };
  storeOneUser();
  logged = (['log', 'error'] as const).map((level) => jest.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const name of ['BREVO_API_KEY', 'EMAIL_USER']) {
    if (originalEnv[name] === undefined) delete env[name];
    else env[name] = originalEnv[name];
  }
});

describe('welcome email', () => {
  it("goes to the account's email on first completion", async () => {
    expect((await complete()).status).toBe(200);

    expect(sentEmails()).toHaveLength(1);
    expect(sentEmails()[0].to).toEqual([{ email: 'ada@account.test' }]);
  });

  it('goes to an account saved before isProfileComplete existed', async () => {
    delete stored!.isProfileComplete;

    await complete();

    expect(sentEmails()).toHaveLength(1);
  });

  it('is sent once when completion is repeated, which still saves', async () => {
    await complete();

    expect((await complete({ ...PROFILE, name: 'Countess Lovelace' })).status).toBe(200);

    expect(sentEmails()).toHaveLength(1);
    expect(stored!.name).toBe('Countess Lovelace');
  });

  it.each([2, 10])('is sent once when %i completions race', async (count) => {
    const responses = await Promise.all(Array.from({ length: count }, () => complete()));

    expect(responses.map((res) => res.status)).toEqual(Array(count).fill(200));
    expect(sentEmails()).toHaveLength(1);
  });

  it('is not sent to an account that was already complete', async () => {
    stored!.isProfileComplete = true;

    expect((await complete()).status).toBe(200);
    expect(sendTransacEmail).not.toHaveBeenCalled();
  });

  it('shows a hostile name as text', async () => {
    const name = `<a href="https://evil.test">Click</a> & 'co' {{contact.EMAIL}}`;

    await complete({ ...PROFILE, name });

    const [{ htmlContent, subject }] = sentEmails();
    expect(visibleText(htmlContent)).toContain(name);
    expect(htmlContent).not.toContain('evil.test">');
    expect(htmlContent).not.toContain('{{');
    expect(subject).not.toContain('{{');
  });

  it('does not fail completion when it cannot be sent', async () => {
    sendTransacEmail.mockRejectedValue(new BrevoError({ statusCode: 500 }));

    expect((await complete()).status).toBe(200);
    expect(stored!.isProfileComplete).toBe(true);
  });

  it('does not log the address when Brevo is not set up', async () => {
    delete env.BREVO_API_KEY;

    expect((await complete()).status).toBe(200);

    expect(sendTransacEmail).not.toHaveBeenCalled();
    expect(logged.flatMap((spy) => spy.mock.calls.flat()).join('\n')).not.toContain('ada@account.test');
  });

  it('answers 404 for an account that is gone', async () => {
    stored = null;

    expect((await complete()).status).toBe(404);
    expect(sendTransacEmail).not.toHaveBeenCalled();
  });
});

describe.each([
  ['complete-profile', (name: unknown) => complete({ ...PROFILE, name })],
  ['profile', (name: unknown) => update({ name })],
])('the name bound in %s', (_route, setName) => {
  it('accepts 100 characters', async () => {
    expect((await setName('n'.repeat(100))).status).toBe(200);
    expect(stored!.name).toBe('n'.repeat(100));
  });

  it.each([
    ['101 characters', 'n'.repeat(101)],
    ['two lines', 'Ada\nLovelace'],
    ['a number', 42],
    ['an array', ['Ada']],
    ['an object', { $ne: null }],
    ['only spaces', '   '],
  ])('refuses %s', async (_label, name) => {
    expect((await setName(name)).status).toBe(400);
    expect(stored!.name).toBeUndefined();
    expect(sendTransacEmail).not.toHaveBeenCalled();
  });
});

it.each([undefined, null, ''])('profile leaves the name alone when it is %p', async (name) => {
  stored!.name = 'Ada';

  expect((await update({ name, currentGoal: 'Split PDFs' })).status).toBe(200);

  expect(stored!.name).toBe('Ada');
  expect(stored!.currentGoal).toBe('Split PDFs');
});

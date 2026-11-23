import { NextRequest } from 'next/server';
import * as brevo from '@getbrevo/brevo';
import User from '@/models/user';
import { reserveAcknowledgement } from '@/lib/email/daily-limits';
import { POST as submitTicket } from '@/app/api/support/ticket/route';
import { POST as completeProfile } from '@/app/api/auth/complete-profile/route';
import type * as BrevoMock from './brevoMock';

// The cases the daily email limits must pass on any database. The test file that calls this
// mocks @getbrevo/brevo with ./brevoMock, @/lib/db/mongoose, next/headers (no session cookie),
// next-auth/jwt (getToken reads x-test-email) and @/lib/auth/jwt (getAuthUserId reads
// x-test-account), and provides the database.

const { sendTransacEmail, sentEmails } = brevo as unknown as typeof BrevoMock;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const INBOX = 'owner@vellum.test';
const TICKET = {
  guestName: 'Grace Guest',
  guestEmail: 'grace@guest.test',
  subject: 'Merge is stuck',
  category: 'technical',
  message: 'The spinner never stops.',
};

let addresses = 0;
let accounts = 0;

const newAddress = () => `10.0.${Math.floor(++addresses / 250)}.${(addresses % 250) + 1}`;

async function newAccount(isProfileComplete = true) {
  const n = ++accounts;
  const user = await User.create({ email: `member${n}@example.com`, name: `Member ${n}`, isProfileComplete });
  return { id: String(user._id), email: user.email as string };
}

interface TicketOptions {
  account?: string;
  address?: string;
  contentType?: string;
  body?: unknown;
}

function ticket({ account, address, contentType = 'application/json', body = TICKET }: TicketOptions = {}) {
  // The 5-per-10-minutes limit is tested on its own; here it would refuse before the daily ones.
  (globalThis as { vellumSupportRateLimits?: Map<string, unknown> }).vellumSupportRateLimits?.clear();
  const headers: Record<string, string> = { 'content-type': contentType };
  if (account) headers['x-test-account'] = account;
  if (address) headers['x-real-ip'] = address;
  return submitTicket(
    new NextRequest('http://localhost/api/support/ticket', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

const complete = (email: string) =>
  completeProfile(
    new NextRequest('http://localhost/api/auth/complete-profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-email': email },
      body: JSON.stringify({ name: 'New Member', role: 'Student' }),
    }),
  );

async function statusesOf(responses: Promise<Response>[]) {
  return (await Promise.all(responses)).map((res) => res.status);
}

async function expectStatuses(responses: Promise<Response>[], expected: Record<number, number>) {
  const statuses = await statusesOf(responses);
  const counts: Record<number, number> = {};
  for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
  expect(counts).toEqual(expected);
}

async function expectRefusedForToday(response: Promise<Response>) {
  const res = await response;
  expect(res.status).toBe(429);
  expect((await res.json()).error).toMatch(/tomorrow/i);
}

const emailsTo = (address: string) => sentEmails().filter((email) => email.to[0].email === address).length;
const welcomeEmails = () => sentEmails().filter((email) => email.subject.startsWith('Welcome')).length;

// Only the clock is faked: the database driver needs working timers.
function controlClock() {
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

export function describeEmailLimitsContract(database: string, savedTickets: () => Promise<number>) {
  describe(`daily email limits on ${database}`, () => {
    const env = process.env as Record<string, string | undefined>;
    const names = ['BREVO_API_KEY', 'EMAIL_USER', 'SUPPORT_INBOX_EMAIL', 'CLIENT_IP_HEADER', 'NODE_ENV'];
    const original = Object.fromEntries(names.map((name) => [name, env[name]]));

    beforeEach(() => {
      env.BREVO_API_KEY = 'test-key';
      env.EMAIL_USER = 'no-reply@vellum.test';
      env.SUPPORT_INBOX_EMAIL = INBOX;
      env.CLIENT_IP_HEADER = 'x-real-ip';
      sendTransacEmail.mockReset().mockResolvedValue({ messageId: 'test' });
      for (const level of ['log', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
    });

    afterEach(() => {
      jest.useRealTimers();
      for (const name of names) {
        if (original[name] === undefined) delete env[name];
        else env[name] = original[name];
      }
    });

    describe('tickets', () => {
      it('takes five from an address, then refuses for today, saving and sending nothing', async () => {
        const address = newAddress();
        await expectStatuses(Array.from({ length: 5 }, () => ticket({ address })), { 201: 5 });

        await expectRefusedForToday(ticket({ address }));

        expect(await savedTickets()).toBe(5);
        expect(emailsTo(INBOX)).toBe(5);
      });

      it('takes five from an account, from any address', async () => {
        const { id } = await newAccount();
        for (let i = 0; i < 5; i++) expect((await ticket({ account: id, address: newAddress() })).status).toBe(201);

        await expectRefusedForToday(ticket({ account: id, address: newAddress() }));
      });

      it('counts an address for guests and accounts together', async () => {
        const address = newAddress();
        for (let i = 0; i < 3; i++) expect((await ticket({ address })).status).toBe(201);
        for (let i = 0; i < 2; i++) expect((await ticket({ account: (await newAccount()).id, address })).status).toBe(201);

        await expectRefusedForToday(ticket({ address }));
        await expectRefusedForToday(ticket({ account: (await newAccount()).id, address }));
      });

      it('treats an address as text', async () => {
        for (let i = 0; i < 5; i++) expect((await ticket({ address: '$where' })).status).toBe(201);

        await expectRefusedForToday(ticket({ address: '$where' }));
        expect((await ticket({ address: 'sends.keys' })).status).toBe(201);
      });

      it('has no limit per address when no address is trusted', async () => {
        delete env.CLIENT_IP_HEADER;
        const address = newAddress();
        for (let i = 0; i < 12; i++) expect((await ticket({ address })).status).toBe(201);

        await expectRefusedForToday(ticket({ address }));
      });

      it('takes twelve from guests site-wide', async () => {
        for (let i = 0; i < 12; i++) expect((await ticket({ address: newAddress() })).status).toBe(201);

        await expectRefusedForToday(ticket({ address: newAddress() }));
      });

      it('takes eight from accounts site-wide', async () => {
        for (let i = 0; i < 8; i++) expect((await ticket({ account: (await newAccount()).id, address: newAddress() })).status).toBe(201);

        await expectRefusedForToday(ticket({ account: (await newAccount()).id, address: newAddress() }));
      });

      it("keeps the guests' and the accounts' shares apart", async () => {
        for (let i = 0; i < 12; i++) await ticket({ address: newAddress() });
        await expectRefusedForToday(ticket({ address: newAddress() }));

        for (let i = 0; i < 8; i++) expect((await ticket({ account: (await newAccount()).id, address: newAddress() })).status).toBe(201);
        await expectRefusedForToday(ticket({ account: (await newAccount()).id, address: newAddress() }));
      });

      it('counts nothing for a refused body or content type', async () => {
        const address = newAddress();
        for (let i = 0; i < 5; i++) {
          expect((await ticket({ address, body: { ...TICKET, category: 'urgent' } })).status).toBe(400);
          expect((await ticket({ address, contentType: 'text/plain' })).status).toBe(415);
        }

        for (let i = 0; i < 5; i++) expect((await ticket({ address })).status).toBe(201);
      });

      it('takes nothing from the shares for a ticket refused for its address', async () => {
        const address = newAddress();
        for (let i = 0; i < 5; i++) await ticket({ address });
        for (let i = 0; i < 7; i++) await expectRefusedForToday(ticket({ address }));

        for (let i = 0; i < 7; i++) expect((await ticket({ address: newAddress() })).status).toBe(201);
        await expectRefusedForToday(ticket({ address: newAddress() }));
      });

      it('takes nothing from the share or the address for a ticket refused for its account', async () => {
        const { id } = await newAccount();
        const address = newAddress();
        for (let i = 0; i < 5; i++) await ticket({ account: id, address: newAddress() });
        for (let i = 0; i < 3; i++) await expectRefusedForToday(ticket({ account: id, address }));

        for (let i = 0; i < 3; i++) expect((await ticket({ account: (await newAccount()).id, address })).status).toBe(201);
        await expectRefusedForToday(ticket({ account: (await newAccount()).id, address: newAddress() }));
        expect((await ticket({ address })).status).toBe(201);
        expect((await ticket({ address })).status).toBe(201);
        await expectRefusedForToday(ticket({ address }));
      });

      it('takes nothing from the address or account for a ticket refused for its share', async () => {
        const moveTo = controlClock();
        for (let i = 0; i < 12; i++) await ticket({ address: newAddress() });
        for (let i = 0; i < 8; i++) await ticket({ account: (await newAccount()).id, address: newAddress() });
        const address = newAddress();
        const { id } = await newAccount();
        for (let i = 0; i < 3; i++) await expectRefusedForToday(ticket({ address }));
        for (let i = 0; i < 3; i++) await expectRefusedForToday(ticket({ account: id, address: newAddress() }));

        moveTo(DAY_MS);

        for (let i = 0; i < 5; i++) expect((await ticket({ address })).status).toBe(201);
        for (let i = 0; i < 5; i++) expect((await ticket({ account: id, address: newAddress() })).status).toBe(201);
        await expectRefusedForToday(ticket({ account: id, address: newAddress() }));
      });

      it('counts a saved ticket whose delivery failed', async () => {
        sendTransacEmail.mockRejectedValue(new Error('Brevo is down'));
        const address = newAddress();
        for (let i = 0; i < 5; i++) expect((await ticket({ address })).status).toBe(502);

        await expectRefusedForToday(ticket({ address }));
        expect(await savedTickets()).toBe(5);
      });

      it('counts tickets in development without Brevo', async () => {
        delete env.BREVO_API_KEY;
        const address = newAddress();
        for (let i = 0; i < 5; i++) expect((await ticket({ address })).status).toBe(201);

        await expectRefusedForToday(ticket({ address }));
        expect(sendTransacEmail).not.toHaveBeenCalled();
      });

      it('allows another ticket 24 hours after the oldest', async () => {
        const moveTo = controlClock();
        const address = newAddress();
        await ticket({ address });
        moveTo(HOUR_MS);
        for (let i = 0; i < 4; i++) await ticket({ address });

        moveTo(DAY_MS - 1);
        await expectRefusedForToday(ticket({ address }));

        moveTo(DAY_MS);
        expect((await ticket({ address })).status).toBe(201);
        await expectRefusedForToday(ticket({ address }));
      });

      it('takes twelve of thirty guests at once', async () => {
        await expectStatuses(Array.from({ length: 30 }, () => ticket({ address: newAddress() })), { 201: 12, 429: 18 });

        expect(await savedTickets()).toBe(12);
        expect(emailsTo(INBOX)).toBe(12);
      });

      it('takes five of twelve at once from one address', async () => {
        const address = newAddress();

        await expectStatuses(Array.from({ length: 12 }, () => ticket({ address })), { 201: 5, 429: 7 });
        expect(await savedTickets()).toBe(5);
      });

      it('takes five of twelve at once from one account', async () => {
        const { id } = await newAccount();

        await expectStatuses(Array.from({ length: 12 }, () => ticket({ account: id, address: newAddress() })), { 201: 5, 429: 7 });
        expect(await savedTickets()).toBe(5);
      });

      it('fills each share once when guests and accounts race', async () => {
        const members = await Promise.all(Array.from({ length: 30 }, () => newAccount()));

        const [guestStatuses, memberStatuses] = await Promise.all([
          statusesOf(Array.from({ length: 30 }, () => ticket({ address: newAddress() }))),
          statusesOf(members.map(({ id }) => ticket({ account: id, address: newAddress() }))),
        ]);

        expect(guestStatuses.filter((status) => status === 201)).toHaveLength(12);
        expect(memberStatuses.filter((status) => status === 201)).toHaveLength(8);
        expect(await savedTickets()).toBe(20);
      });
    });

    describe('acknowledgements', () => {
      it('sends one a day to an account', async () => {
        const { id, email } = await newAccount();

        expect((await ticket({ account: id, address: newAddress() })).status).toBe(201);
        expect((await ticket({ account: id, address: newAddress() })).status).toBe(201);

        expect(emailsTo(INBOX)).toBe(2);
        expect(emailsTo(email)).toBe(1);
      });

      it('sends eight site-wide, then skips them while the ticket still succeeds', async () => {
        for (let i = 0; i < 8; i++) expect(await reserveAcknowledgement(`other-account-${i}`)).toBe(true);
        expect(await reserveAcknowledgement('other-account-8')).toBe(false);
        const { id, email } = await newAccount();

        expect((await ticket({ account: id, address: newAddress() })).status).toBe(201);

        expect(emailsTo(INBOX)).toBe(1);
        expect(emailsTo(email)).toBe(0);
      });

      it('counts one that Brevo refused', async () => {
        const { id, email } = await newAccount();
        sendTransacEmail.mockImplementation(async (request: BrevoMock.SentEmail) => {
          if (request.to[0].email === email) throw new Error('Brevo is down');
        });

        await ticket({ account: id, address: newAddress() });
        await ticket({ account: id, address: newAddress() });

        expect(emailsTo(email)).toBe(1);
      });

      it('is not spent by a ticket that was not delivered', async () => {
        const { id, email } = await newAccount();
        sendTransacEmail.mockRejectedValueOnce(new Error('Brevo is down'));

        expect((await ticket({ account: id, address: newAddress() })).status).toBe(502);
        expect((await ticket({ account: id, address: newAddress() })).status).toBe(201);

        expect(emailsTo(email)).toBe(1);
      });

      it('sends one when an account races five tickets', async () => {
        const { id, email } = await newAccount();

        await expectStatuses(Array.from({ length: 5 }, () => ticket({ account: id, address: newAddress() })), { 201: 5 });
        expect(emailsTo(email)).toBe(1);
      });
    });

    describe('welcome emails', () => {
      it('sends twenty a day, then completes without one', async () => {
        for (let i = 0; i < 21; i++) expect((await complete((await newAccount(false)).email)).status).toBe(200);

        expect(welcomeEmails()).toBe(20);
      });

      it('sends twenty when thirty completions race', async () => {
        const fresh = await Promise.all(Array.from({ length: 30 }, () => newAccount(false)));

        await expectStatuses(fresh.map(({ email }) => complete(email)), { 200: 30 });
        expect(welcomeEmails()).toBe(20);
      });

      it('sends again 24 hours after the oldest', async () => {
        const moveTo = controlClock();
        for (let i = 0; i < 20; i++) await complete((await newAccount(false)).email);

        moveTo(DAY_MS - 1);
        await complete((await newAccount(false)).email);
        moveTo(DAY_MS);
        await complete((await newAccount(false)).email);

        expect(welcomeEmails()).toBe(21);
      });

      it('counts none while Brevo is not set up', async () => {
        delete env.BREVO_API_KEY;
        for (let i = 0; i < 21; i++) await complete((await newAccount(false)).email);
        env.BREVO_API_KEY = 'test-key';

        await complete((await newAccount(false)).email);

        expect(welcomeEmails()).toBe(1);
      });
    });
  });
}

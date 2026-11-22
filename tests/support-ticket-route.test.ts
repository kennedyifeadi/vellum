import { NextRequest } from 'next/server';

jest.mock('@getbrevo/brevo', () => jest.requireActual('./helpers/brevoMock'));
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/lib/auth/jwt', () => ({ getAuthUserId: jest.fn() }));

import * as brevo from '@getbrevo/brevo';
import { getAuthUserId } from '@/lib/auth/jwt';
import { isRateLimited } from '@/lib/http/rate-limit';
import SupportTicket from '@/models/supportTicket';
import User from '@/models/user';
import { POST } from '../app/api/support/ticket/route';
import type * as BrevoMock from './helpers/brevoMock';

const { sendTransacEmail, sentEmails, visibleText, BrevoError } = brevo as unknown as typeof BrevoMock;

jest.setTimeout(30_000);

const ROUTE_URL = 'http://localhost:3000/api/support/ticket';
const INBOX = 'owner@vellum.test';
const SENDER = 'no-reply@vellum.test';
const USER_ID = '6730a1b2c3d4e5f6a7b8c9d0';
const ACCOUNT = { name: 'Ada Account', email: 'ada@account.test' };
const GUEST = {
  guestName: 'Grace Guest',
  guestEmail: 'grace@guest.test',
  subject: 'Merge is stuck',
  category: 'technical',
  message: 'The spinner never stops.',
};
const HOSTILE = `<img src=x onerror="alert(1)"> & 'quoted' </div> &lt; {{contact.EMAIL}} {% if 1 %}`;
const MAX_BODY_BYTES = 16 * 1024;
const TEN_MINUTES_MS = 10 * 60 * 1000;

const env = process.env as Record<string, string | undefined>;
const originalEnv = { ...env };
let savedTickets: Record<string, unknown>[];
let logged: jest.SpyInstance[];

function submit(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest(ROUTE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

function streamedRequest(kilobytes: number, headers: Record<string, string> = {}) {
  let bytesRead = 0;
  // No high-water mark, so nothing is produced before the route asks for it.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (bytesRead >= kilobytes * 1024) return controller.close();
      bytesRead += 1024;
      controller.enqueue(new Uint8Array(1024).fill(32));
    },
  }, { highWaterMark: 0 });
  const init = { method: 'POST', headers, body, duplex: 'half' };
  const request = new NextRequest(ROUTE_URL, init as ConstructorParameters<typeof NextRequest>[1]);
  return { request, bytesRead: () => bytesRead };
}

function signIn(account: { name?: string; email: string } | null = ACCOUNT) {
  jest.mocked(getAuthUserId).mockResolvedValue(USER_ID);
  jest.mocked(User.findById).mockResolvedValue(account);
}

function emailsTo(address: string) {
  return sentEmails().filter((email) => email.to.some((recipient) => recipient.email === address));
}

function logOutput() {
  return logged
    .flatMap((spy) => spy.mock.calls.flat())
    .map((part) => (part instanceof Error ? part.message : String(part)))
    .join('\n');
}

async function expectRefused(body: unknown) {
  const res = await submit(body);

  expect(res.status).toBe(400);
  expect((await res.json()).error).toEqual(expect.any(String));
  expect(savedTickets).toEqual([]);
  expect(sendTransacEmail).not.toHaveBeenCalled();
}

beforeEach(() => {
  env.BREVO_API_KEY = 'test-key';
  env.EMAIL_USER = SENDER;
  env.SUPPORT_INBOX_EMAIL = INBOX;
  delete env.CLIENT_IP_HEADER;
  delete env.CLIENT_IP_HEADER_ENTRY;

  sendTransacEmail.mockReset().mockResolvedValue({ messageId: 'test' });
  jest.mocked(getAuthUserId).mockReset().mockResolvedValue(null);

  savedTickets = [];
  jest.spyOn(SupportTicket, 'create').mockImplementation((async (fields: Record<string, unknown>) => {
    const ticket = new SupportTicket(fields);
    await ticket.validate();
    savedTickets.push(ticket);
    return ticket;
  }) as never);
  jest.spyOn(User, 'findById').mockResolvedValue(null);
  logged = (['log', 'warn', 'error'] as const).map((level) => jest.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const name of ['BREVO_API_KEY', 'EMAIL_USER', 'SUPPORT_INBOX_EMAIL', 'CLIENT_IP_HEADER', 'CLIENT_IP_HEADER_ENTRY', 'NODE_ENV']) {
    if (originalEnv[name] === undefined) delete env[name];
    else env[name] = originalEnv[name];
  }
});

describe('who receives a ticket', () => {
  it("delivers a guest's message to the owner, with reply-to the guest", async () => {
    const res = await submit(GUEST);

    expect(res.status).toBe(201);
    const [email] = sentEmails();
    expect(email.to).toEqual([{ email: INBOX }]);
    expect(email.replyTo).toEqual({ email: GUEST.guestEmail });
    expect(email.sender.email).toBe(SENDER);

    const text = visibleText(email.htmlContent);
    for (const value of [...Object.values(GUEST), (await res.json()).ticketId]) {
      expect(text.toLowerCase()).toContain(value.toLowerCase());
    }
  });

  it('sends nothing to the address a guest typed', async () => {
    await submit(GUEST);

    expect(emailsTo(GUEST.guestEmail)).toEqual([]);
    expect(sentEmails()).toHaveLength(1);
  });

  it("replies to the account's email for a signed-in user, whatever address was typed", async () => {
    signIn();

    expect((await submit(GUEST)).status).toBe(201);

    const [email] = emailsTo(INBOX);
    expect(email.replyTo).toEqual({ email: ACCOUNT.email });
    expect(visibleText(email.htmlContent)).toContain(ACCOUNT.name);
    expect(emailsTo(GUEST.guestEmail)).toEqual([]);
    expect(savedTickets[0].guestEmail).toBeUndefined();
    expect(String(savedTickets[0].userId)).toBe(USER_ID);
  });

  it('acknowledges a signed-in user with the ticket id and none of the submitted text', async () => {
    signIn();

    const { ticketId } = await (await submit({ ...GUEST, category: 'feature_request' })).json();

    const acknowledgements = emailsTo(ACCOUNT.email);
    expect(acknowledgements).toHaveLength(1);
    const content = `${acknowledgements[0].subject}\n${acknowledgements[0].htmlContent}`;
    expect(content).toContain(ticketId);
    for (const submitted of [GUEST.guestName, GUEST.guestEmail, GUEST.subject, GUEST.message, 'feature_request']) {
      expect(content.toLowerCase()).not.toContain(submitted.toLowerCase());
    }
  });

  it('needs only a subject, category and message from a signed-in user', async () => {
    signIn();

    const { subject, category, message } = GUEST;
    expect((await submit({ subject, category, message })).status).toBe(201);
  });

  it('treats a session whose account is gone as a guest', async () => {
    signIn(null);

    expect((await submit(GUEST)).status).toBe(201);

    expect(emailsTo(INBOX)[0].replyTo).toEqual({ email: GUEST.guestEmail });
    expect(emailsTo(GUEST.guestEmail)).toEqual([]);
    expect(savedTickets[0].userId).toBeUndefined();
  });

  it('accepts a guest without a name', async () => {
    expect((await submit({ ...GUEST, guestName: undefined })).status).toBe(201);
    expect(savedTickets[0].guestName).toBe('Guest');
  });
});

describe('values in the emails', () => {
  it.each(['guestName', 'subject', 'message'])('shows a hostile %s as text', async (field) => {
    expect((await submit({ ...GUEST, [field]: HOSTILE })).status).toBe(201);

    const [{ htmlContent }] = emailsTo(INBOX);
    expect(visibleText(htmlContent)).toContain(HOSTILE);
    expect(htmlContent).not.toContain('<img');
    expect(htmlContent).not.toContain('{{');
    expect(htmlContent).not.toContain('{%');
  });

  it('shows a hostile account name as text in both emails', async () => {
    signIn({ ...ACCOUNT, name: HOSTILE });

    await submit(GUEST);

    expect(sentEmails()).toHaveLength(2);
    for (const { htmlContent } of sentEmails()) {
      expect(visibleText(htmlContent)).toContain(HOSTILE);
      expect(htmlContent).not.toContain('<img');
      expect(htmlContent).not.toContain('{{');
    }
  });

  it('shows a guest email as text', async () => {
    const guestEmail = "o'brien&sons@guest.test";

    expect((await submit({ ...GUEST, guestEmail })).status).toBe(201);

    const [{ htmlContent }] = emailsTo(INBOX);
    expect(visibleText(htmlContent)).toContain(guestEmail);
    expect(htmlContent).toContain('&amp;sons');
  });

  it("keeps the visitor's text out of the subject line, where Brevo would evaluate it", async () => {
    await submit({ ...GUEST, subject: '{{contact.EMAIL}}' });

    expect(emailsTo(INBOX)[0].subject).not.toContain('contact.EMAIL');
  });

  it.each([['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r']])('keeps the %s line breaks of a message', async (_name, newline) => {
    await submit({ ...GUEST, message: `first line${newline}second line` });

    expect(visibleText(emailsTo(INBOX)[0].htmlContent)).toContain('first line\nsecond line');
  });
});

describe('validation', () => {
  it.each([
    ['not JSON', 'not-json{{{'],
    ['empty', ''],
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"hello"'],
  ])('refuses a body that is %s', async (_label, body) => {
    await expectRefused(body);
  });

  it.each(['subject', 'category', 'message', 'guestEmail'])('requires %s', async (field) => {
    await expectRefused({ ...GUEST, [field]: undefined });
  });

  it.each(['subject', 'message', 'guestEmail'])('refuses a blank %s', async (field) => {
    await expectRefused({ ...GUEST, [field]: '   ' });
  });

  describe.each(['guestName', 'guestEmail', 'subject', 'category', 'message'])('%s', (field) => {
    it.each([[42], [true], [['text']], [{ $ne: null }]])('refuses %p', async (value) => {
      await expectRefused({ ...GUEST, [field]: value });
    });
  });

  const emailOfLength = (length: number) =>
    `${'l'.repeat(64)}@${'d'.repeat(63)}.${'d'.repeat(63)}.${'d'.repeat(length - 64 - 1 - 128)}`;

  it.each([
    ['guestName', 100, (length: number) => 'n'.repeat(length)],
    ['guestEmail', 254, emailOfLength],
    ['subject', 150, (length: number) => 's'.repeat(length)],
    ['message', 5000, (length: number) => 'm'.repeat(length)],
  ])('accepts %s at %i characters and refuses one more', async (field, max, valueOfLength) => {
    expect(valueOfLength(max)).toHaveLength(max);
    await expectRefused({ ...GUEST, [field]: valueOfLength(max + 1) });

    expect((await submit({ ...GUEST, [field]: valueOfLength(max) })).status).toBe(201);
  });

  it('fits every field at its limit in three-byte characters', async () => {
    const res = await submit({
      ...GUEST,
      guestName: '名'.repeat(100),
      guestEmail: emailOfLength(254),
      subject: '題'.repeat(150),
      message: '文'.repeat(5000),
    });

    expect(res.status).toBe(201);
  });

  it.each(['\n', '\r', '\u0000', '\u0085', '\u2028', '\u2029'])('refuses %j inside a subject', async (character) => {
    await expectRefused({ ...GUEST, subject: `one${character}two` });
  });

  it.each([
    'no-at-sign',
    'a@',
    '@guest.test',
    'a@localhost',
    '{{contact.EMAIL}}@guest.test',
    'a b@guest.test',
    'a@guest.test,b@other.test',
    'Name <a@guest.test>',
    'a@guest.test\r\nBcc: b@other.test',
  ])('refuses the email %j', async (guestEmail) => {
    await expectRefused({ ...GUEST, guestEmail });
  });

  it.each(['general', 'technical', 'billing', 'feature_request', 'other'])('accepts the category %s', async (category) => {
    expect((await submit({ ...GUEST, category })).status).toBe(201);
  });

  it.each(['urgent', 'General', 'toString', ''])('refuses the category %j', async (category) => {
    await expectRefused({ ...GUEST, category });
  });

  it('accepts a body of 16 KB and refuses one byte more', async () => {
    const json = JSON.stringify(GUEST);
    const padded = (bytes: number) => json + ' '.repeat(bytes - Buffer.byteLength(json));

    await expectRefused(padded(MAX_BODY_BYTES + 1));
    expect((await submit(padded(MAX_BODY_BYTES))).status).toBe(201);
  });

  it('refuses a declared oversize body without reading it', async () => {
    const { request, bytesRead } = streamedRequest(1024, { 'content-length': String(1024 * 1024) });

    expect((await POST(request)).status).toBe(400);
    expect(bytesRead()).toBe(0);
  });

  it('cuts off an undeclared oversize body', async () => {
    const { request, bytesRead } = streamedRequest(1024);

    expect((await POST(request)).status).toBe(400);
    expect(bytesRead()).toBeLessThanOrEqual(MAX_BODY_BYTES + 2 * 1024);
  });
});

describe('delivery', () => {
  async function expectSavedButFailed() {
    const res = await submit(GUEST);

    expect(res.status).toBeGreaterThanOrEqual(500);
    const answer = await res.json();
    expect(answer.success).not.toBe(true);
    expect(answer.error).toMatch(/could not be delivered/i);
    expect(savedTickets).toHaveLength(1);
  }

  it('saves the ticket before sending it', async () => {
    let savedBeforeSend = 0;
    sendTransacEmail.mockImplementation(async () => {
      savedBeforeSend = savedTickets.length;
    });

    await submit(GUEST);

    expect(savedBeforeSend).toBe(1);
  });

  it('reports a failed delivery, keeping the ticket', async () => {
    sendTransacEmail.mockRejectedValue(new BrevoError({ statusCode: 500 }));

    await expectSavedButFailed();
  });

  it('does not acknowledge a ticket that was not delivered', async () => {
    signIn();
    sendTransacEmail.mockRejectedValue(new BrevoError({ statusCode: 500 }));

    await expectSavedButFailed();
    expect(emailsTo(ACCOUNT.email)).toEqual([]);
  });

  it('succeeds when only the acknowledgement fails', async () => {
    signIn();
    sendTransacEmail.mockImplementation(async (request: BrevoMock.SentEmail) => {
      if (request.to[0].email === ACCOUNT.email) throw new BrevoError({ statusCode: 500 });
    });

    expect((await submit(GUEST)).status).toBe(201);
  });

  it.each([
    ['BREVO_API_KEY', undefined],
    ['BREVO_API_KEY', 'YOUR_BREVO_API_KEY'],
    ['EMAIL_USER', undefined],
    ['SUPPORT_INBOX_EMAIL', undefined],
    ['SUPPORT_INBOX_EMAIL', '  '],
  ])('fails in production with %s set to %p', async (name, value) => {
    env.NODE_ENV = 'production';
    if (value === undefined) delete env[name];
    else env[name] = value;

    await expectSavedButFailed();
    expect(sendTransacEmail).not.toHaveBeenCalled();
    expect(logOutput()).toContain(name);
  });

  it('fails in development when Brevo is set up and the inbox is not', async () => {
    env.NODE_ENV = 'development';
    delete env.SUPPORT_INBOX_EMAIL;

    await expectSavedButFailed();
  });

  it.each([undefined, 'YOUR_BREVO_API_KEY'])('succeeds in development with the key %p, logging only the ticket id', async (key) => {
    env.NODE_ENV = 'development';
    if (key === undefined) delete env.BREVO_API_KEY;
    else env.BREVO_API_KEY = key;
    delete env.SUPPORT_INBOX_EMAIL;

    const res = await submit(GUEST);

    expect(res.status).toBe(201);
    expect(sendTransacEmail).not.toHaveBeenCalled();
    expect(logOutput()).toContain((await res.json()).ticketId);
    for (const submitted of [GUEST.guestName, GUEST.guestEmail, GUEST.subject, GUEST.message]) {
      expect(logOutput()).not.toContain(submitted);
    }
  });

  it("does not log the addresses that Brevo's error repeats", async () => {
    sendTransacEmail.mockRejectedValue(
      new BrevoError({ statusCode: 400, message: `Body: ${GUEST.guestEmail} is not a valid replyTo` }),
    );

    await submit(GUEST);

    expect(logOutput()).toContain('400');
    expect(logOutput()).not.toContain(GUEST.guestEmail);
  });

  it('answers 500 and sends nothing when the ticket cannot be saved', async () => {
    jest.mocked(SupportTicket.create).mockRejectedValue(new Error('database down') as never);

    expect((await submit(GUEST)).status).toBe(500);
    expect(sendTransacEmail).not.toHaveBeenCalled();
  });
});

describe('ticket id', () => {
  it('is long and does not come from Math.random', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);

    const first = await (await submit(GUEST)).json();
    const second = await (await submit(GUEST)).json();

    expect(first.ticketId).toMatch(/^VEL-[0-9A-F]{12}$/);
    expect(second.ticketId).not.toBe(first.ticketId);
  });
});

describe('rate limit', () => {
  const from = (ip: string) => ({ 'x-real-ip': ip });

  beforeEach(() => {
    env.CLIENT_IP_HEADER = 'x-real-ip';
  });

  async function spendFormBudget(ip: string) {
    for (let i = 0; i < 5; i++) {
      expect((await submit(GUEST, from(ip))).status).toBe(201);
    }
  }

  it('allows five submissions and refuses the sixth', async () => {
    await spendFormBudget('203.0.113.1');

    const res = await submit(GUEST, from('203.0.113.1'));

    expect(res.status).toBe(429);
    expect((await res.json()).error).toEqual(expect.any(String));
    expect(savedTickets).toHaveLength(5);
  });

  it('refuses before reading any of the body', async () => {
    await spendFormBudget('203.0.113.1');
    const { request, bytesRead } = streamedRequest(4, from('203.0.113.1'));

    expect((await POST(request)).status).toBe(429);
    expect(bytesRead()).toBe(0);
  });

  it('counts refused submissions too', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await submit('not json', from('203.0.113.1'))).status).toBe(400);
    }

    expect((await submit(GUEST, from('203.0.113.1'))).status).toBe(429);
  });

  it('counts each client address separately', async () => {
    await spendFormBudget('203.0.113.1');

    expect((await submit(GUEST, from('203.0.113.2'))).status).toBe(201);
  });

  it('shares one budget when no header is trusted', async () => {
    delete env.CLIENT_IP_HEADER;
    for (let i = 0; i < 5; i++) {
      expect((await submit(GUEST, from(`203.0.113.${i}`))).status).toBe(201);
    }

    expect((await submit(GUEST, from('203.0.113.9'))).status).toBe(429);
  });

  it('holds for ten minutes, then opens again', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await spendFormBudget('203.0.113.1');

    now += TEN_MINUTES_MS;
    expect((await submit(GUEST, from('203.0.113.1'))).status).toBe(429);

    now += 1;
    expect((await submit(GUEST, from('203.0.113.1'))).status).toBe(201);
  });

  it('does not spend the shared budget', async () => {
    await spendFormBudget('203.0.113.1');
    expect((await submit(GUEST, from('203.0.113.1'))).status).toBe(429);

    const headers = new Headers(from('203.0.113.1'));
    for (let i = 0; i < 30; i++) {
      expect(isRateLimited(headers)).toBe(false);
    }
    expect(isRateLimited(headers)).toBe(true);
  });

  it('is not spent by the shared budget', async () => {
    const headers = new Headers(from('203.0.113.1'));
    for (let i = 0; i < 31; i++) isRateLimited(headers);

    await spendFormBudget('203.0.113.1');
  });
});

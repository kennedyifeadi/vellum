import { emailFailureReason, sendEmail } from '@/lib/email/send';

// The real Brevo SDK over a stubbed fetch, so nothing can be sent.

jest.setTimeout(30_000);

const EMAIL = {
  senderName: 'Vellum Support',
  to: 'owner@vellum.test',
  replyTo: 'guest@guest.test',
  subject: 'New support ticket',
  html: '<p>Hello</p>',
};

const { BREVO_API_KEY, EMAIL_USER } = process.env;
let fetchStub: jest.SpyInstance;

beforeEach(() => {
  process.env.BREVO_API_KEY = 'test-key';
  process.env.EMAIL_USER = 'no-reply@vellum.test';
  fetchStub = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('no network in tests'));
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const [name, value] of Object.entries({ BREVO_API_KEY, EMAIL_USER })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const failureOf = (sending: Promise<void>) =>
  sending.then(
    () => undefined,
    (error: unknown) => error,
  );

it('sends the email to Brevo once', async () => {
  fetchStub.mockResolvedValue(new Response('{"messageId":"test"}', { status: 201 }));

  await sendEmail(EMAIL);

  expect(fetchStub).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetchStub.mock.calls[0][1].body))).toEqual({
    subject: EMAIL.subject,
    htmlContent: EMAIL.html,
    sender: { name: EMAIL.senderName, email: 'no-reply@vellum.test' },
    to: [{ email: EMAIL.to }],
    replyTo: { email: EMAIL.replyTo },
  });
});

it.each([408, 429, 500, 503])('makes one attempt when Brevo answers %i', async (status) => {
  fetchStub.mockImplementation(
    async () => new Response('{}', { status, headers: { 'content-type': 'application/json', 'retry-after': '1' } }),
  );

  const failure = await failureOf(sendEmail(EMAIL));

  expect(fetchStub).toHaveBeenCalledTimes(1);
  expect(emailFailureReason(failure)).toBe(`Brevo answered ${status}`);
});

it.each([201, 400])('gives up after 10 seconds on a %i whose body never ends', async (status) => {
  const deadline = new AbortController();
  const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  let bodyStarted: () => void;
  const readingBody = new Promise<void>((resolve) => {
    bodyStarted = resolve;
  });
  fetchStub.mockImplementation(async (_url, init: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal!.addEventListener('abort', () => controller.error(new Error('aborted')));
      },
      pull() {
        bodyStarted();
        return new Promise<void>(() => {});
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  });

  const failure = failureOf(sendEmail(EMAIL));
  await readingBody;
  expect(timeout).toHaveBeenCalledWith(10_000);
  deadline.abort();

  expect(emailFailureReason(await failure)).toMatch(/within 10 seconds/);
});

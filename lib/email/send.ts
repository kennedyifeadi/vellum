import { BrevoClient, BrevoError } from '@getbrevo/brevo';

const PLACEHOLDER_API_KEY = 'YOUR_BREVO_API_KEY';

// A form waits on the answer. The client's own timeoutInSeconds stops counting when the
// response's headers arrive, so this deadline is a signal, which covers the body too.
const SEND_DEADLINE_SECONDS = 10;

interface Email {
  senderName: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
}

function brevoApiKey(): string | undefined {
  const key = process.env.BREVO_API_KEY;
  return key === PLACEHOLDER_API_KEY ? undefined : key;
}

export function hasEmailApiKey(): boolean {
  return Boolean(brevoApiKey());
}

/** Resolves once Brevo has accepted the email. */
export async function sendEmail({ senderName, to, replyTo, subject, html }: Email): Promise<void> {
  const apiKey = brevoApiKey();
  if (!apiKey) throw new Error('BREVO_API_KEY is not set.');
  const senderEmail = process.env.EMAIL_USER;
  if (!senderEmail) throw new Error('EMAIL_USER is not set.');

  // No retries: the client waits up to a minute between them, and each can send another copy.
  const client = new BrevoClient({ apiKey, maxRetries: 0 });
  const request = {
    subject,
    htmlContent: html,
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
    ...(replyTo && { replyTo: { email: replyTo } }),
  };

  const deadline = AbortSignal.timeout(SEND_DEADLINE_SECONDS * 1000);
  try {
    await client.transactionalEmails.sendTransacEmail(request, { abortSignal: deadline });
  } catch (error) {
    if (deadline.aborted) {
      throw new Error(`Brevo did not answer within ${SEND_DEADLINE_SECONDS} seconds.`, { cause: error });
    }
    throw error;
  }
}

/** What to log of a failed send: Brevo's answers can repeat the addresses, so only their status. */
export function emailFailureReason(error: unknown): string {
  if (error instanceof BrevoError && error.statusCode) return `Brevo answered ${error.statusCode}`;
  return error instanceof Error ? error.message : String(error);
}

import { BrevoClient, BrevoError } from '@getbrevo/brevo';

const PLACEHOLDER_API_KEY = 'YOUR_BREVO_API_KEY';

// Brevo's client allows 60 seconds by default, and a form waits on the answer.
const SEND_TIMEOUT_SECONDS = 10;

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

  const client = new BrevoClient({ apiKey, timeoutInSeconds: SEND_TIMEOUT_SECONDS });
  await client.transactionalEmails.sendTransacEmail({
    subject,
    htmlContent: html,
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
    ...(replyTo && { replyTo: { email: replyTo } }),
  });
}

/** What to log of a failed send: Brevo's answers can repeat the addresses, so only their status. */
export function emailFailureReason(error: unknown): string {
  if (error instanceof BrevoError && error.statusCode) return `Brevo answered ${error.statusCode}`;
  return error instanceof Error ? error.message : String(error);
}

// Stands in for @getbrevo/brevo, so no test can send a real email.
export const sendTransacEmail = jest.fn();

export class BrevoError extends Error {
  readonly statusCode?: number;

  constructor({ message, statusCode }: { message?: string; statusCode?: number }) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class BrevoClient {
  transactionalEmails = { sendTransacEmail };
}

export interface SentEmail {
  subject: string;
  htmlContent: string;
  sender: { name: string; email: string };
  to: { email: string }[];
  replyTo?: { email: string };
}

export function sentEmails(): SentEmail[] {
  return sendTransacEmail.mock.calls.map(([request]) => request as SentEmail);
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' };

/** What a mail client shows for `html`: tags dropped, then entities decoded. */
export function visibleText(html: string): string {
  return html
    .replace(/<br>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:(amp|lt|gt|quot)|#(\d+));/g, (_entity, name: string | undefined, code: string) =>
      name ? NAMED_ENTITIES[name] : String.fromCharCode(Number(code)),
    );
}

import { ClientError } from '@/lib/convert/errors';
import { optionalName, requiredLine, requiredText } from '@/lib/http/text-input';
import { SUPPORT_TICKET_CATEGORIES, type SupportTicketCategory } from '@/models/supportTicket';

const MAX_EMAIL_LENGTH = 254;
const MAX_SUBJECT_LENGTH = 150;
const MAX_MESSAGE_LENGTH = 5000;

// The address a browser's email field accepts, but with a dot required in the domain and no
// braces: it becomes the reply-to, which can't be escaped from Brevo's {{ }}. One bare
// address, so no list and no display name.
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`|~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export interface TicketContent {
  subject: string;
  category: SupportTicketCategory;
  message: string;
}

function ticketCategory(value: unknown): SupportTicketCategory {
  const category = SUPPORT_TICKET_CATEGORIES.find((known) => known === value);
  if (!category) {
    throw new ClientError('Please choose a valid category.');
  }
  return category;
}

export function ticketContent(body: Record<string, unknown>): TicketContent {
  return {
    subject: requiredLine(body.subject, 'Subject', MAX_SUBJECT_LENGTH),
    category: ticketCategory(body.category),
    message: requiredText(body.message, 'Message', MAX_MESSAGE_LENGTH),
  };
}

export function guestContact(body: Record<string, unknown>): { name: string; email: string } {
  const email = requiredLine(body.guestEmail, 'Email', MAX_EMAIL_LENGTH);
  if (!EMAIL_PATTERN.test(email)) {
    throw new ClientError('A valid email address is required.');
  }
  return { name: optionalName(body.guestName) ?? 'Guest', email };
}

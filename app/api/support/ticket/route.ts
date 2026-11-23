import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import SupportTicket from '@/models/supportTicket';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { ClientError } from '@/lib/convert/errors';
import { emailFailureReason, hasEmailApiKey, sendEmail } from '@/lib/email/send';
import { getSupportInboxEmailHtml } from '@/lib/email/templates/supportInboxEmail';
import { getSupportTicketEmailHtml } from '@/lib/email/templates/supportTicketEmail';
import { assertWithinSupportRateLimit } from '@/lib/http/rate-limit';
import { readJsonObject } from '@/lib/http/read-upload';
import { guestContact, ticketContent, type TicketContent } from '@/lib/support/ticket-input';

const MAX_BODY_BYTES = 16 * 1024;
const BODY_TOO_LARGE_MESSAGE = 'Your message is too large. Please shorten it and try again.';
const INVALID_BODY_MESSAGE = 'Invalid JSON body.';
const UNDELIVERED_MESSAGE = 'Your message could not be delivered. Please try again later.';
const NOT_JSON_MESSAGE = 'Please send the message as JSON.';
const SENDER_NAME = 'Vellum Support';

interface Submitter {
  /** Absent for a guest, whose email address is only what they typed. */
  userId?: string;
  name: string;
  email: string;
}

const generateTicketId = () => `VEL-${randomBytes(6).toString('hex').toUpperCase()}`;

// Another site's page can post text/plain or a form to this route without asking first;
// JSON needs a preflight, which the route does not grant.
const isJson = (req: NextRequest) => /^application\/json\s*(;|$)/i.test(req.headers.get('content-type') ?? '');

async function resolveSubmitter(req: NextRequest, body: Record<string, unknown>): Promise<Submitter> {
  const userId = await getAuthUserId(req);
  const user = userId ? await User.findById(userId) : null;
  return userId && user ? { userId, name: user.name || 'User', email: user.email } : guestContact(body);
}

async function sendToInbox(ticketId: string, submitter: Submitter, content: TicketContent) {
  const inbox = process.env.SUPPORT_INBOX_EMAIL?.trim();
  if (!inbox) throw new Error('SUPPORT_INBOX_EMAIL is not set.');

  const { userId, name, email } = submitter;
  await sendEmail({
    senderName: SENDER_NAME,
    to: inbox,
    replyTo: email,
    // None of the visitor's text: Brevo evaluates {{ }} in a subject, which can't be escaped.
    subject: `New support ticket: ${ticketId}`,
    html: getSupportInboxEmailHtml({ ticketId, name, email, signedIn: Boolean(userId), ...content }),
  });
}

// Only for an account's own address: one a guest typed could be anybody's.
async function acknowledge(ticketId: string, { name, email }: Submitter) {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  try {
    await sendEmail({
      senderName: SENDER_NAME,
      to: email,
      subject: `Support Ticket Received: ${ticketId}`,
      html: getSupportTicketEmailHtml(name, ticketId, baseUrl),
    });
  } catch (error) {
    console.error(`[SUPPORT] Could not acknowledge ticket ${ticketId}: ${emailFailureReason(error)}`);
  }
}

/** Whether the ticket reached the inbox, or is in development where there is no Brevo to send it. */
async function deliver(ticketId: string, submitter: Submitter, content: TicketContent): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production' && !hasEmailApiKey()) {
    console.log(`[SUPPORT] Skipping email send for ticket ${ticketId} (API key not configured).`);
    return true;
  }

  try {
    await sendToInbox(ticketId, submitter, content);
  } catch (error) {
    console.error(`[SUPPORT] Could not deliver ticket ${ticketId}: ${emailFailureReason(error)}`);
    return false;
  }

  if (submitter.userId) {
    await acknowledge(ticketId, submitter);
  }
  return true;
}

export async function POST(req: NextRequest) {
  try {
    // Before the limit, so another site's posts cannot spend a visitor's allowance.
    if (!isJson(req)) {
      return NextResponse.json({ error: NOT_JSON_MESSAGE }, { status: 415 });
    }
    assertWithinSupportRateLimit(req);

    const body = await readJsonObject(
      req,
      MAX_BODY_BYTES,
      () => new ClientError(BODY_TOO_LARGE_MESSAGE),
      INVALID_BODY_MESSAGE,
    );
    const content = ticketContent(body);

    await dbConnect();
    const submitter = await resolveSubmitter(req, body);
    const ticketId = generateTicketId();

    await SupportTicket.create({
      userId: submitter.userId,
      guestName: submitter.userId ? undefined : submitter.name,
      guestEmail: submitter.userId ? undefined : submitter.email,
      ticketId,
      ...content,
    });

    if (!(await deliver(ticketId, submitter, content))) {
      return NextResponse.json({ error: UNDELIVERED_MESSAGE }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      message: 'Ticket submitted successfully!',
      ticketId,
    }, { status: 201 });

  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[API/Support/Ticket] Error:', error);
    return NextResponse.json({ error: 'Failed to submit ticket' }, { status: 500 });
  }
}

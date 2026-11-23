import { escapeHtml } from '@/lib/email/escape-html';
import type { TicketContent } from '@/lib/support/ticket-input';

interface InboxTicket extends TicketContent {
  ticketId: string;
  name: string;
  email: string;
  signedIn: boolean;
}

export const getSupportInboxEmailHtml = ({ ticketId, name, email, signedIn, subject, category, message }: InboxTicket) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>New Support Ticket</title>
</head>
<body style="font-family: sans-serif; line-height: 1.6; color: #1a1a1a;">
    <p><strong>Ticket ID:</strong> ${ticketId}</p>
    <p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p>
    <p><strong>Sender:</strong> ${signedIn ? 'Signed-in account' : 'Guest (email address not verified)'}</p>
    <p><strong>Category:</strong> ${escapeHtml(category)}</p>
    <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(message).replace(/\r\n|\r|\n/g, '<br>')}</p>
</body>
</html>
`;

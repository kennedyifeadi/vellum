import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import SupportTicket from '@/models/supportTicket';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { BrevoClient } from '@getbrevo/brevo';
import { getSupportTicketEmailHtml } from '@/lib/email/templates/supportTicketEmail';

const generateTicketId = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `VEL-${result}`;
};

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { subject, category, message } = await req.json();

    if (!subject || !category || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await dbConnect();

    // 1. Fetch user details for the email
    const user = await User.findById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 2. Generate unique Ticket ID (e.g., VEL-8A2F)
    const ticketId = generateTicketId();

    // 3. Save to Database
    const ticket = await SupportTicket.create({
      userId,
      ticketId,
      subject,
      category,
      message,
    });

    // 4. Send Brevo Email (Asynchronously)
    if (process.env.BREVO_API_KEY && process.env.BREVO_API_KEY !== "YOUR_BREVO_API_KEY") {
      try {
        const client = new BrevoClient({ 
          apiKey: process.env.BREVO_API_KEY as string 
        });

        const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';

        await client.transactionalEmails.sendTransacEmail({
          subject: `Support Ticket Received: ${ticketId}`,
          htmlContent: getSupportTicketEmailHtml(user.name || 'User', ticketId, subject, category, message, baseUrl),
          sender: { name: "Vellum Support", email: process.env.EMAIL_USER as string },
          to: [{ email: user.email }],
        });

      } catch (emailError) {
        console.error('[Brevo/Support] Failed to send support email:', emailError);
      }
    } else {
        console.log(`[SUPPORT] Skipping email send for ${user.email} (API key not configured).`);
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Ticket submitted successfully!', 
      ticketId: ticket.ticketId 
    }, { status: 201 });

  } catch (error) {
    console.error('[API/Support/Ticket] Error:', error);
    return NextResponse.json({ error: 'Failed to submit ticket' }, { status: 500 });
  }
}

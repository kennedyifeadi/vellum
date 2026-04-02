import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import SupportTicket from '@/models/supportTicket';
import dbConnect from '@/lib/db/mongoose';

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

    const ticket = await SupportTicket.create({
      userId,
      subject,
      category,
      message,
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Ticket submitted successfully!', 
      ticketId: ticket._id 
    }, { status: 201 });

  } catch (error) {
    console.error('[API/Support/Ticket] Error:', error);
    return NextResponse.json({ error: 'Failed to submit ticket' }, { status: 500 });
  }
}

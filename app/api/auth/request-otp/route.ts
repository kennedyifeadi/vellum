import { NextRequest, NextResponse } from 'next/server';
import { generateOtp } from '@/lib/auth/otp';
import { BrevoClient } from '@getbrevo/brevo';
import dbConnect from '@/lib/db/mongoose';

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const otpCode = await generateOtp(email);

    // Send email using Brevo (v5 structure)
    if (process.env.BREVO_API_KEY && process.env.BREVO_API_KEY !== "YOUR_BREVO_API_KEY") {
      const client = new BrevoClient({ 
        apiKey: process.env.BREVO_API_KEY as string 
      });

      await client.transactionalEmails.sendTransacEmail({
        subject: "Your Vellum Verification Code",
        htmlContent: `<html><body><p>Your One-Time Password is: <strong>${otpCode}</strong></p><p>It expires in 10 minutes.</p></body></html>`,
        sender: { name: "Vellum Auth", email: process.env.EMAIL_USER as string },
        to: [{ email: email }],
      });
    } else {
      console.log(`[VERIFICATION] Skipping Brevo send (API key not configured). OTP for ${email}: ${otpCode}`);
    }

    return NextResponse.json({ message: 'OTP sent to your email.' }, { status: 200 });
  } catch (error) {
    console.error('Error requesting OTP:', error);
    return NextResponse.json({ error: 'Failed to send OTP.' }, { status: 500 });
  }
}
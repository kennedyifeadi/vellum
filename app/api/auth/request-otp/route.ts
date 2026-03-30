import { NextRequest, NextResponse } from 'next/server';
import { generateOtp } from '@/lib/auth/otp';
import dbConnect from '@/lib/db/mongoose';

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const otpCode = await generateOtp(email);

    // Send email using native fetch to Brevo v3 API
    if (process.env.BREVO_API_KEY && process.env.BREVO_API_KEY !== "YOUR_BREVO_API_KEY") {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': process.env.BREVO_API_KEY as string,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: 'Vellum Auth', email: process.env.EMAIL_USER as string },
          to: [{ email: email }],
          subject: 'Your Vellum Verification Code',
          htmlContent: `<html><body><p>Your One-Time Password is: <strong>${otpCode}</strong></p><p>It expires in 10 minutes.</p></body></html>`
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Brevo API error payload:', errorText);
        throw new Error(`Brevo fetch failed with status ${response.status}`);
      }
    } else {
      console.log(`[VERIFICATION] Skipping Brevo send (API key not configured). OTP for ${email}: ${otpCode}`);
    }

    return NextResponse.json({ message: 'OTP sent to your email.' }, { status: 200 });
  } catch (error) {
    console.error('Error requesting OTP:', error);
    return NextResponse.json({ error: 'Failed to send OTP.' }, { status: 500 });
  }
}
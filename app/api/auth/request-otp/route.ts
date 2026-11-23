import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { signInAddress } from '@/lib/auth/clientAddress';
import { generateOtp } from '@/lib/auth/otp';
import { sendWithinOtpLimits } from '@/lib/auth/otpRequestLimit';
import { createBrowserId, readBrowserId, readKnownDevice, setBrowserId } from '@/lib/auth/signInCookies';
import { formatOtpCode, isJsonRequest, isValidEmail } from '@/lib/auth/signInInput';
import dbConnect from '@/lib/db/mongoose';
import { ClientError } from '@/lib/convert/errors';
import { readJsonRequest } from '@/lib/http/read-upload';

function isBrevoConfigured() {
  return !!process.env.BREVO_API_KEY && process.env.BREVO_API_KEY !== "YOUR_BREVO_API_KEY";
}

async function deliverCode(email: string, otpCode: string, canSendEmail: boolean) {
  if (!canSendEmail) {
    console.log(`[VERIFICATION] Skipping Brevo send (API key not configured). OTP for ${email}: ${otpCode}`);
    return;
  }

  // Send email using native fetch to Brevo v3 API
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
}

export async function POST(req: NextRequest) {
  try {
    if (!isJsonRequest(req)) {
      return NextResponse.json({ error: 'Content-Type must be application/json.' }, { status: 415 });
    }

    const { email } = await readJsonRequest(req, 'Invalid JSON body.');
    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }

    const canSendEmail = isBrevoConfigured();
    if (!canSendEmail && process.env.NODE_ENV === 'production') {
      console.error('Cannot send a sign-in code: BREVO_API_KEY is not configured.');
      return NextResponse.json({ error: 'Email sign-in is temporarily unavailable.' }, { status: 503 });
    }

    const cookieStore = await cookies();
    const browserId = readBrowserId(cookieStore) ?? createBrowserId();
    const knownDeviceId = readKnownDevice(cookieStore, email);

    await dbConnect();
    const sender = { email, address: signInAddress(req.headers), knownDeviceId };
    const sent = await sendWithinOtpLimits(sender, async () => {
      const code = await generateOtp(browserId, email, knownDeviceId);
      await deliverCode(email, formatOtpCode(code), canSendEmail);
    });
    if (!sent) {
      return NextResponse.json({ error: 'Too many codes requested. Please try again later.' }, { status: 429 });
    }
    setBrowserId(cookieStore, browserId);

    return NextResponse.json({ message: 'OTP sent to your email.' }, { status: 200 });
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error requesting OTP:', error);
    return NextResponse.json({ error: 'Failed to send OTP.' }, { status: 500 });
  }
}
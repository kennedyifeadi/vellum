import { NextRequest, NextResponse } from 'next/server';
import { generateOtp } from '@/lib/auth/otp';
import nodemailer from 'nodemailer';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const otpCode = await generateOtp(email);

    // Send email using Nodemailer
    const transporter = nodemailer.createTransport({
      service: 'gmail', // or your preferred email service
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your File Converter OTP',
      html: `<p>Your One-Time Password is: <strong>${otpCode}</strong></p><p>It expires in 10 minutes.</p>`,
    });

    return NextResponse.json({ message: 'OTP sent to your email.' }, { status: 200 });
  } catch (error) {
    console.error('Error requesting OTP:', error);
    return NextResponse.json({ error: 'Failed to send OTP.' }, { status: 500 });
  }
}
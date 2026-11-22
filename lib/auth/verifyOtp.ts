import Otp from '@/models/otp';
import { isValidEmail, isValidOtpCode } from '@/lib/auth/signInInput';

export async function verifyOtp(email: unknown, code: unknown): Promise<boolean> {
  if (!isValidEmail(email) || !isValidOtpCode(code)) return false;

  const otpRecord = await Otp.findOne({ email, code });

  if (otpRecord && otpRecord.expiresAt > new Date()) {
    await Otp.deleteOne({ _id: otpRecord._id }); // OTP used, delete it
    return true;
  }
  return false;
}
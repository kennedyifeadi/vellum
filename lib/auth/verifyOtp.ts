import Otp from '@/models/otp';

export async function verifyOtp(email: string, code: string): Promise<boolean> {
  const otpRecord = await Otp.findOne({ email, code });

  if (otpRecord && otpRecord.expiresAt > new Date()) {
    await Otp.deleteOne({ _id: otpRecord._id }); // OTP used, delete it
    return true;
  }
  return false;
}
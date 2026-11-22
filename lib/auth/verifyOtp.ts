import Otp from '@/models/otp';
import { isValidEmail, isValidOtpCode } from '@/lib/auth/signInInput';

const MAX_ATTEMPTS = 5;

export async function verifyOtp(email: unknown, code: unknown): Promise<boolean> {
  if (!isValidEmail(email) || !isValidOtpCode(code)) return false;

  // Counted before comparing, so simultaneous guesses cannot exceed the limit.
  const otpRecord = await Otp.findOneAndUpdate(
    { _id: email, attempts: { $lt: MAX_ATTEMPTS }, expiresAt: { $gt: new Date() } },
    { $inc: { attempts: 1 } },
  );
  if (otpRecord?.code !== code) return false;

  // Of requests racing with the right code, only the one that deletes it succeeds.
  const { deletedCount } = await Otp.deleteOne({ _id: email, code });
  return deletedCount === 1;
}
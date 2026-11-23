import Otp from '@/models/otp';
import { otpKey } from '@/lib/auth/otp';
import { isValidBrowserId } from '@/lib/auth/signInCookies';
import { isValidEmail, parseOtpCode } from '@/lib/auth/signInInput';

const MAX_ATTEMPTS = 5;

/** Uses up the code and returns the device its browser is now known as, or null if it is not right. */
export async function verifyOtp(browserId: unknown, email: unknown, typedCode: unknown): Promise<string | null> {
  const code = parseOtpCode(typedCode);
  if (!code || !isValidEmail(email) || !isValidBrowserId(browserId)) return null;
  const _id = otpKey(browserId, email);

  // Counted before comparing, so simultaneous guesses cannot exceed the limit.
  const otpRecord = await Otp.findOneAndUpdate(
    { _id, attempts: { $lt: MAX_ATTEMPTS }, expiresAt: { $gt: new Date() } },
    { $inc: { attempts: 1 } },
  );
  if (otpRecord?.code !== code) return null;

  // Of requests racing with the right code, only the one that deletes it succeeds.
  const { deletedCount } = await Otp.deleteOne({ _id, code });
  return deletedCount === 1 ? otpRecord.deviceId : null;
}

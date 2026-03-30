import Otp from '@/models/otp';
import crypto from 'crypto';

export async function generateOtp(email: string) {
  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  await Otp.findOneAndUpdate(
    { email },
    { code, expiresAt },
    { upsert: true, returnDocument: 'after' }
  );

  return code;
}
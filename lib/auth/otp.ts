import Otp from '@/models/otp';
import crypto from 'crypto';
import { CODE_ALPHABET, CODE_LENGTH } from '@/lib/auth/signInInput';

export function otpKey(browserId: string, email: string) {
  return crypto.createHash('sha256').update(browserId + email).digest('hex');
}

function randomCode() {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
}

export async function generateOtp(browserId: string, email: string, knownDeviceId: string | null) {
  const code = randomCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
  // Decided now, so a send on a device's allowance can only sign in as that device.
  const deviceId = knownDeviceId ?? crypto.randomUUID();

  await Otp.findOneAndUpdate(
    { _id: otpKey(browserId, email) },
    { code, deviceId, expiresAt, attempts: 0 },
    { upsert: true, returnDocument: 'after' }
  );

  return code;
}

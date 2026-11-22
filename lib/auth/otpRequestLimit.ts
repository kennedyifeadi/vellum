import OtpRequest from '@/models/otpRequest';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;

/** Counts a code request for this email, or returns false if it has had its share for now. */
export async function reserveOtpRequest(email: string): Promise<boolean> {
  // Lower-cased for this count only: changing the case must not buy a mailbox more emails.
  const _id = email.toLowerCase();
  const now = Date.now();

  await OtpRequest.updateOne(
    { _id },
    {
      $pull: { requestedAt: { $lte: new Date(now - WINDOW_MS) } },
      $set: { expiresAt: new Date(now + WINDOW_MS) },
    },
    { upsert: true },
  );

  // Matches only while there is room, so racing requests cannot pass the limit together.
  const { modifiedCount } = await OtpRequest.updateOne(
    { _id, [`requestedAt.${MAX_REQUESTS - 1}`]: { $exists: false } },
    { $push: { requestedAt: new Date(now) } },
  );
  return modifiedCount === 1;
}

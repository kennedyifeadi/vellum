import { createHash, randomUUID } from 'crypto';
import OtpRequest from '@/models/otpRequest';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const KNOWN_PER_15_MINUTES = 5;
const KNOWN_PER_DAY = 20;
const UNKNOWN_PER_15_MINUTES = 3;
const UNKNOWN_PER_DAY = 10;
const ADDRESS_PER_DAY = 40;
const EMAIL_PER_DAY = 50;
// Brevo's free plan sends 300 a day, and the app's other emails need part of it.
const SITE_PER_DAY = 220;

interface OtpSender {
  email: string;
  address: string | null;
  knownDeviceId: string | null;
}

interface Send {
  id: string;
  at: Date;
}

interface Limit {
  key: string;
  max: number;
  windowMs: number;
}

function limit(max: number, windowMs: number, ...countedFor: string[]): Limit {
  const key = createHash('sha256').update(JSON.stringify([windowMs, ...countedFor])).digest('hex');
  return { key, max, windowMs };
}

const SITE_LIMIT = limit(SITE_PER_DAY, DAY_MS, 'site');
const SITE_LIMIT_LOG = limit(1, DAY_MS, 'site-log');

// Narrowest first: a request holds what it passed until a wider limit refuses it, so a shared
// limit is only ever held by requests that are within their own.
function limitsFor({ email, address, knownDeviceId }: OtpSender): Limit[] {
  // Lower-cased for counting only: changing the case must not buy a mailbox more emails.
  const mailbox = email.toLowerCase();
  const perAddress = address ? [limit(ADDRESS_PER_DAY, DAY_MS, 'address', address)] : [];

  if (knownDeviceId) {
    return [
      limit(KNOWN_PER_15_MINUTES, FIFTEEN_MINUTES_MS, 'device', knownDeviceId, mailbox),
      limit(KNOWN_PER_DAY, DAY_MS, 'device', knownDeviceId, mailbox),
      ...perAddress,
    ];
  }

  const requester = address ?? '';
  return [
    limit(UNKNOWN_PER_15_MINUTES, FIFTEEN_MINUTES_MS, 'requester', requester, mailbox),
    limit(UNKNOWN_PER_DAY, DAY_MS, 'requester', requester, mailbox),
    ...perAddress,
    limit(EMAIL_PER_DAY, DAY_MS, 'email', mailbox),
    SITE_LIMIT,
  ];
}

async function reserve({ key, max, windowMs }: Limit, send: Send): Promise<boolean> {
  const now = send.at.getTime();

  await OtpRequest.updateOne(
    { _id: key },
    {
      $pull: { sends: { at: { $lte: new Date(now - windowMs) } } },
      $set: { expiresAt: new Date(now + windowMs) },
    },
    { upsert: true },
  );

  // Matches only while there is room, so racing requests cannot pass the limit together.
  const { modifiedCount } = await OtpRequest.updateOne(
    { _id: key, [`sends.${max - 1}`]: { $exists: false } },
    { $push: { sends: send } },
  );
  return modifiedCount === 1;
}

async function release(limits: Limit[], send: Send) {
  await Promise.all(
    limits.map(({ key }) => OtpRequest.updateOne({ _id: key }, { $pull: { sends: { id: send.id } } })),
  );
}

async function logSiteLimitOncePerWindow(send: Send) {
  if (await reserve(SITE_LIMIT_LOG, send)) {
    console.warn(`The site-wide limit of ${SITE_PER_DAY} sign-in code emails in 24 hours was reached.`);
  }
}

/**
 * Runs `deliver` if every limit on this sender has room, and says whether it did. A refusal
 * or a failed delivery leaves nothing counted.
 */
export async function sendWithinOtpLimits(sender: OtpSender, deliver: () => Promise<void>): Promise<boolean> {
  const limits = limitsFor(sender);
  const send = { id: randomUUID(), at: new Date() };
  let delivered = false;
  try {
    for (const each of limits) {
      if (!(await reserve(each, send))) {
        if (each === SITE_LIMIT) await logSiteLimitOncePerWindow(send);
        return false;
      }
    }
    await deliver();
    delivered = true;
    return true;
  } finally {
    if (!delivered) await release(limits, send);
  }
}

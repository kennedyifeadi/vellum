import EmailAllowance from '@/models/emailAllowance';

// Brevo's free plan sends 300 emails a day for the whole app, sign-in codes included, so
// these keep the forms and welcome emails to 48 of them in any 24 hours.
const DAY_MS = 24 * 60 * 60 * 1000;

const TICKETS_PER_ADDRESS = 5;
const TICKETS_PER_ACCOUNT = 5;
const GUEST_TICKETS = 12;
const MEMBER_TICKETS = 8;
const ACKNOWLEDGEMENTS_PER_ACCOUNT = 1;
const ACKNOWLEDGEMENTS = 8;
const WELCOME_EMAILS = 20;

interface Limit {
  key: string;
  max: number;
}

// Every key starts with a name such as "address:", never "$", so MongoDB reads it as text.
const usesOf = (key: string) => ({
  $size: { $filter: { input: { $ifNull: ['$sends', []] }, cond: { $in: [key, '$$this.keys'] } } },
});

/** Counts a send of this kind against every limit, or returns false if one has had its share. */
async function reserve(kind: string, limits: Limit[]): Promise<boolean> {
  const now = Date.now();

  await EmailAllowance.updateOne(
    { _id: kind },
    {
      $pull: { sends: { at: { $lte: new Date(now - DAY_MS) } } },
      $set: { expiresAt: new Date(now + DAY_MS) },
    },
    { upsert: true },
  );

  // Matches only while every limit has room, so racing requests cannot pass one together,
  // and a send refused by one limit takes nothing from the others.
  const { modifiedCount } = await EmailAllowance.updateOne(
    { _id: kind, $expr: { $and: limits.map(({ key, max }) => ({ $lt: [usesOf(key), max] })) } },
    { $push: { sends: { at: new Date(now), keys: limits.map(({ key }) => key) } } },
  );
  return modifiedCount === 1;
}

/**
 * A guest's and an account holder's tickets come from separate site-wide shares, so guests
 * cannot use up the account holders'. `address` is the trusted client address, if any.
 */
export function reserveTicket({ userId, address }: { userId?: string; address: string | null }): Promise<boolean> {
  return reserve('tickets', [
    userId ? { key: 'members', max: MEMBER_TICKETS } : { key: 'guests', max: GUEST_TICKETS },
    ...(userId ? [{ key: `account:${userId}`, max: TICKETS_PER_ACCOUNT }] : []),
    ...(address ? [{ key: `address:${address}`, max: TICKETS_PER_ADDRESS }] : []),
  ]);
}

export function reserveAcknowledgement(userId: string): Promise<boolean> {
  return reserve('acknowledgements', [
    { key: 'all', max: ACKNOWLEDGEMENTS },
    { key: `account:${userId}`, max: ACKNOWLEDGEMENTS_PER_ACCOUNT },
  ]);
}

export function reserveWelcomeEmail(): Promise<boolean> {
  return reserve('welcome-emails', [{ key: 'all', max: WELCOME_EMAILS }]);
}

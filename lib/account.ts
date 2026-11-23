import { ClientError } from '@/lib/convert/errors';
import dbConnect from '@/lib/db/mongoose';
import User from '@/models/user';

export const ACCOUNT_MISSING_MESSAGE = 'This account no longer exists.';

/** A signed-in request whose account has been deleted: a session can outlive it. */
export class AccountMissingError extends ClientError {
  constructor() {
    super(ACCOUNT_MISSING_MESSAGE, 401);
    this.name = 'AccountMissingError';
  }
}

export async function accountExists(userId: string): Promise<boolean> {
  await dbConnect();
  return Boolean(await User.findById(userId));
}

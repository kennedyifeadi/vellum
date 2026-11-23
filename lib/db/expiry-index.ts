import type { Model } from 'mongoose';

const EXPIRY_KEY = { expiresAt: 1 } as const;

const NAMESPACE_NOT_FOUND = 26;
const INDEX_NOT_FOUND = 27;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Model<any>;

function hasCode(error: unknown, code: number): boolean {
  return (error as { code?: number })?.code === code;
}

async function ttlIndexNames({ collection }: AnyModel): Promise<string[]> {
  try {
    const indexes = await collection.indexes();
    return indexes
      .filter(({ key, expireAfterSeconds }) =>
        expireAfterSeconds !== undefined && JSON.stringify(key) === JSON.stringify(EXPIRY_KEY))
      .map(({ name }) => name!);
  } catch (error) {
    // A new database has no collection yet.
    if (hasCode(error, NAMESPACE_NOT_FOUND)) return [];
    throw error;
  }
}

/**
 * Makes the index on expiresAt a plain one. A database from before the retention sweep has
 * a TTL index there, which deletes a row and with it the key of a file still stored. MongoDB
 * refuses a plain index beside it on the same key, so the TTL index is dropped first.
 * Safe to run again, and in two processes at once.
 */
export async function ensurePlainExpiryIndex(model: AnyModel): Promise<void> {
  for (const name of await ttlIndexNames(model)) {
    try {
      await model.collection.dropIndex(name);
      console.info(`Dropped the TTL index ${name} of ${model.collection.collectionName}: the retention sweep deletes expired rows.`);
    } catch (error) {
      if (!hasCode(error, INDEX_NOT_FOUND)) throw error;
    }
  }
  await model.collection.createIndex(EXPIRY_KEY);
}

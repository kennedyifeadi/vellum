const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Whether `id` is an ObjectId's hex string: Mongoose fails a query by any other _id. */
export function isObjectId(id: string): boolean {
  return OBJECT_ID.test(id);
}

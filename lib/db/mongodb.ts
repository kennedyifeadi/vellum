// lib/db/mongodb.ts
import { MongoClient } from "mongodb";

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

// Connects on first use, not at import, so the app builds and starts without MONGODB_URI.
// The promise lives on `global` so development HMR reloads reuse the connection.
// A failed connect is forgotten, so the next call retries instead of reusing the rejection.
export function getMongoClient(): Promise<MongoClient> {
  if (!global._mongoClientPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("Please add your Mongo URI to .env.local");
    }
    global._mongoClientPromise = new MongoClient(uri).connect().catch((error) => {
      global._mongoClientPromise = undefined;
      throw error;
    });
  }
  return global._mongoClientPromise;
}

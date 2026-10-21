import mongoose from "mongoose";

// Use a module-level cache that survives hot reloads in dev
// In production, the module is loaded once so this is effectively a singleton
declare global {
  // eslint-disable-next-line no-var
  var _mongooseCache: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
}

if (!global._mongooseCache) {
  global._mongooseCache = { conn: null, promise: null };
}

const cached = global._mongooseCache;

async function dbConnect() {
  // Return existing connection immediately — no async overhead
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    // Checked here, not at import, so the app builds and starts without a database.
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("Please define the MONGODB_URI environment variable inside .env.local");
    }
    cached.promise = mongoose.connect(uri, {
      bufferCommands: false,
      // Connection pool — allows multiple concurrent API routes to share connections
      maxPoolSize: 10,
      minPoolSize: 2,
      // Timeout settings — fail fast instead of hanging for 30s+
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
      connectTimeoutMS: 5000,
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default dbConnect;

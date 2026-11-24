import NextAuth, { AuthOptions } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import GoogleProvider from "next-auth/providers/google";
import { MongoDBAdapter } from "@next-auth/mongodb-adapter";
import { getMongoClient } from "@/lib/db/mongodb";
import { buildSessionEntry } from "@/lib/auth/session";
import { ClientError } from "@/lib/convert/errors";
import { readBoundedBody, requestTooLarge } from "@/lib/http/read-upload";
import User from "@/models/user"; // Your existing User model

// Sign-in and sign-out forms carry a CSRF token and a callback URL.
const AUTH_BODY_LIMIT_BYTES = 64 * 1024;

type Adapter = NonNullable<AuthOptions["adapter"]>;
let cachedAdapter: { client: ReturnType<typeof getMongoClient>; adapter: Adapter } | undefined;

// The adapter keeps the client promise it was built with, so it is rebuilt whenever
// getMongoClient hands out a new one after a failed connect.
function mongoAdapter(): Adapter {
  const client = getMongoClient();
  if (cachedAdapter?.client !== client) {
    cachedAdapter = { client, adapter: MongoDBAdapter(client) as Adapter };
  }
  return cachedAdapter.adapter;
}

// Built per request so the sign-in callbacks can read the request's device and location.
export function authOptionsFor(req: NextRequest): AuthOptions {
  return {
    // The adapter starts connecting as soon as it is created, so it is created on the first
    // auth request rather than when the build imports this route.
    get adapter(): Adapter {
      return mongoAdapter();
    },
    providers: [
      // Google OAuth Provider
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      }),
    ],
    session: {
      strategy: "jwt",
    },
    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          token.id = user.id;
          token.isProfileComplete = user.isProfileComplete;
          token.role = user.role;

          // This only runs on the initial sign-in (user is only present then),
          // not on every session refresh, so it records one entry per login.
          await User.findByIdAndUpdate(user.id, {
            $push: { activeSessions: buildSessionEntry(req) },
          });
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user) {
          session.user.id = token.id ?? '';
          session.user.isProfileComplete = token.isProfileComplete;
          session.user.role = token.role;
        }
        return session;
      },
    },
    pages: {
      signIn: "/login", // Custom sign-in page
      // You can define other custom pages like error, verifyRequest, newUser
    },
    events: {
      async createUser({ user }) {
        // When a user is created via an adapter (Social Login), ensure isProfileComplete is false
        await User.findByIdAndUpdate(user.id, { isProfileComplete: false, plan: 'Basic' });
      }
    },
    secret: process.env.NEXTAUTH_SECRET,
  };
}

interface RouteContext {
  params: Promise<{ nextauth: string[] }>;
}

// NextAuth reads a POST body whole, so it is handed a copy read within the limit instead.
async function withBoundedBody(req: NextRequest): Promise<NextRequest> {
  if (req.method !== "POST" || !req.body) return req;
  const body = await readBoundedBody(req, AUTH_BODY_LIMIT_BYTES, requestTooLarge);
  return new NextRequest(req.url, { method: req.method, headers: req.headers, body });
}

async function handler(req: NextRequest, ctx: RouteContext) {
  let bounded: NextRequest;
  try {
    bounded = await withBoundedBody(req);
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  return NextAuth(bounded, ctx, authOptionsFor(req));
}

export { handler as GET, handler as POST };
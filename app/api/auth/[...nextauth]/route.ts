import NextAuth, { AuthOptions } from "next-auth";
import type { NextRequest } from "next/server";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { MongoDBAdapter } from "@next-auth/mongodb-adapter";
import { getMongoClient } from "@/lib/db/mongodb";
import { verifyOtp } from "@/lib/auth/verifyOtp"; // Your existing OTP verification logic
import { buildSessionEntry } from "@/lib/auth/session";
import User from "@/models/user"; // Your existing User model

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
      // Custom Passwordless OTP Provider
      CredentialsProvider({
        id: "email-otp",
        name: "Email OTP",
        credentials: {
          email: { label: "Email", type: "email" },
          otp: { label: "OTP", type: "text" },
        },
        async authorize(credentials) {
          if (!credentials?.email || !credentials?.otp) {
            return null;
          }

          const isValid = await verifyOtp(credentials.email, credentials.otp);

          if (isValid) {
            let user = await User.findOne({ email: credentials.email });
            if (!user) {
              // If user doesn't exist, create a new one (similar to your previous logic)
              user = await User.create({ email: credentials.email, isProfileComplete: false, emailVerified: new Date() });
            }
            // NextAuth expects a user object with at least id, name, email, image
            return {
              id: user._id.toString(),
              name: user.name || user.email,
              email: user.email,
              image: user.image,
              isProfileComplete: user.isProfileComplete,
              role: user.role,
            };
          }
          return null;
        },
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

function handler(req: NextRequest, ctx: RouteContext) {
  return NextAuth(req, ctx, authOptionsFor(req));
}

export { handler as GET, handler as POST };
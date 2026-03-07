import NextAuth, { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import MicrosoftAzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import { MongoDBAdapter } from "@next-auth/mongodb-adapter";
import clientPromise from "@/lib/db/mongodb"; // Your MongoDB connection
import { verifyOtp } from "@/lib/auth/verifyOtp"; // Your existing OTP verification logic
import User from "@/models/user"; // Your existing User model

export const authOptions: AuthOptions = {
  adapter: MongoDBAdapter(clientPromise) as NonNullable<AuthOptions["adapter"]>,
  providers: [
    // Google OAuth Provider
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
    // Microsoft Azure AD Provider
    MicrosoftAzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID as string,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET as string,
      tenantId: process.env.AZURE_AD_TENANT_ID as string,
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
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
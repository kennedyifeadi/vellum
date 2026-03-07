import { DefaultSession, DefaultUser } from 'next-auth';
import { DefaultJWT } from 'next-auth/jwt';

declare module 'next-auth' {
  interface User extends DefaultUser {
    id: string;
    isProfileComplete?: boolean;
    role?: string;
  }

  interface Session {
    user: {
      id: string;
      isProfileComplete?: boolean;
      role?: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id?: string;
    isProfileComplete?: boolean;
    role?: string;
  }
}

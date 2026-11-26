import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthSession } from '@/lib/auth/jwt';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Get Authentication State
  const session = await getAuthSession(request);
  const isAuthenticated = session !== null;
  const isProfileComplete = !!session?.isProfileComplete;

  // 2. Redirection Logic

  // Guard Dashboard
  if (pathname.startsWith('/dashboard')) {
    if (!isAuthenticated) {
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    }

    if (!isProfileComplete) {
      const signupUrl = new URL('/signup-details', request.url);
      return NextResponse.redirect(signupUrl);
    }







  }

  // Guard Signup Details (must be authenticated but profile incomplete)
  if (pathname === '/signup-details') {
    if (!isAuthenticated) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    if (isProfileComplete) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Redirect authenticated users away from auth pages (but NOT from '/')
  if (pathname === '/login' || pathname === '/verify') {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL(isProfileComplete ? '/dashboard' : '/signup-details', request.url));
    }
  }

  return NextResponse.next();
}

// Next reads and holds the whole body of every request it matches before the route runs,
// whatever the proxy answers, so no API route is matched: each one checks its own session,
// and those that read a body rate limit and size-check it before reading a byte
// (lib/http/read-upload.ts).
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/login',
    '/verify',
    '/signup-details',
  ],
};

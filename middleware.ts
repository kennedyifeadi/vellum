import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth/jwt';
import { getToken } from 'next-auth/jwt';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Get Authentication State
  const token = request.cookies.get('auth-token')?.value;
  const nextAuthToken = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  let isProfileComplete = false;
  let isAuthenticated = false;

  if (token) {
    const payload = await verifyToken(token);
    if (payload) {
      isAuthenticated = true;
      isProfileComplete = !!payload.isProfileComplete;
    }
  } else if (nextAuthToken) {
    isAuthenticated = true;
    isProfileComplete = !!nextAuthToken.isProfileComplete;
  }

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

  // Redirect if already authenticated
  if (pathname === '/login' || pathname === '/verify' || pathname === '/') {
    if (isAuthenticated) {
        return NextResponse.redirect(new URL(isProfileComplete ? '/dashboard' : '/signup-details', request.url));
    }
    // Specific case: root route unauthenticated should go to login for now as per user request
    if (pathname === '/') {
       return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/login', '/verify', '/signup-details'],
};

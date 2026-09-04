import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth/jwt';
import { getToken } from 'next-auth/jwt';

const rateLimitMap = new Map<string, { count: number; timestamp: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 30; // 30 requests per minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record) {
    rateLimitMap.set(ip, { count: 1, timestamp: now });
    return false;
  }
  if (now - record.timestamp > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { count: 1, timestamp: now });
    return false;
  }
  if (record.count >= MAX_REQUESTS) {
    return true;
  }
  record.count += 1;
  
  // Basic cleanup to prevent memory leaks in long-running instances
  if (rateLimitMap.size > 10000) {
    rateLimitMap.clear();
  }
  
  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rate Limiting for API routes
  if (pathname.startsWith('/api/convert/') || pathname.startsWith('/api/documents/') || pathname.startsWith('/api/auth/verify-otp') || pathname.startsWith('/api/auth/request-otp')) {
    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }
  }

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

  // Redirect authenticated users away from auth pages (but NOT from '/')
  if (pathname === '/login' || pathname === '/verify') {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL(isProfileComplete ? '/dashboard' : '/signup-details', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/verify', '/signup-details', '/api/convert/:path*', '/api/documents/:path*', '/api/auth/verify-otp', '/api/auth/request-otp'],
};

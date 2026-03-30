import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export async function createToken(payload: JWTPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h') // Token expires in 2 hours
    .sign(secret);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

export async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get('auth-token')?.value;
  if (token) {
    const payload = await verifyToken(token);
    if (payload?.userId) return payload.userId as string;
  }
  
  const nextAuthToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (nextAuthToken?.id) return nextAuthToken.id as string;
  if (nextAuthToken?.sub) return nextAuthToken.sub as string;

  return null;
}
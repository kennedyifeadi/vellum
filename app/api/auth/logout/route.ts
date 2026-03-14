import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();
  
  // Clear the custom JWT token
  cookieStore.delete('auth-token');
  
  // Clear NextAuth session cookies (standard names)
  cookieStore.delete('next-auth.session-token');
  cookieStore.delete('__Secure-next-auth.session-token');
  cookieStore.delete('next-auth.callback-url');
  cookieStore.delete('next-auth.csrf-token');

  return NextResponse.json({ message: 'Logged out successfully' }, { status: 200 });
}

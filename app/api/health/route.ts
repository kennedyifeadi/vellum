import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Answers whether this process is serving requests, and nothing more. It does not touch the
// database: the platform calls it to decide whether a new deployment may take traffic, and a
// database outage should not hold back or roll back an app deployment that cannot fix it.
// It is also public and unauthenticated, so it must stay cheap.
export function GET() {
  return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}

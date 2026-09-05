import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';

export interface SessionEntry {
  id: string;
  device: string;
  location: string;
  lastActive: Date;
}

export function buildSessionEntry(req?: NextRequest): SessionEntry {
  return {
    id: randomUUID(),
    device: req?.headers.get('user-agent') ?? 'Unknown Device',
    location: req?.headers.get('x-forwarded-for') ?? req?.headers.get('x-real-ip') ?? 'Unknown Location',
    lastActive: new Date(),
  };
}

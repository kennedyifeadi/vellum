import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/http/client-ip';

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
    location: (req && getClientIp(req.headers)) ?? 'Unknown Location',
    lastActive: new Date(),
  };
}

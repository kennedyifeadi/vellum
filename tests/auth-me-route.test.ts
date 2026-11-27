import { NextRequest } from 'next/server';
import type { MemoryModel } from './helpers/memoryModel';

const USER_ID = '507f1f77bcf86cd799439011';

jest.mock('@/lib/auth/jwt', () => ({ getAuthUserId: jest.fn() }));
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('@/models/user', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());

import { getAuthUserId } from '@/lib/auth/jwt';
import User from '@/models/user';
import { GET } from '../app/api/auth/me/route';

const users = User as unknown as MemoryModel;

// Every field the dashboard, its tabs and the Solutions tool host read from the signed-in user.
const SHOWN_FIELDS = ['_id', 'currentGoal', 'email', 'image', 'name', 'plan', 'role'];

const me = () => GET(new NextRequest('http://localhost:3000/api/auth/me'));

beforeEach(() => {
  users.reset();
  (getAuthUserId as jest.Mock).mockResolvedValue(USER_ID);
});

describe('GET /api/auth/me', () => {
  it('returns only the fields the UI shows', async () => {
    users.seed({
      _id: USER_ID,
      email: 'owner@example.com',
      name: 'Ada Owner',
      role: 'Designer',
      currentGoal: 'Ship it',
      image: 'https://lh3.googleusercontent.com/a/photo',
      plan: 'Pro',
      isProfileComplete: true,
      starredTools: ['merge-pdf'],
      notifications: [{ id: 'n1', type: 'info', title: 'Hi', message: 'Hello', timestamp: 'now', isRead: false }],
      preferences: { theme: 'dark', autoDelete: true, notifications: { email: true, marketing: false, updates: true } },
      tokenVersion: 7,
      activeSessions: [{ id: 's1', device: 'Chrome', location: 'Lagos', lastActive: new Date() }],
      accounts: ['507f1f77bcf86cd799439099'],
      otpCode: '123456',
      otpExpiry: new Date(),
    });

    const res = await me();

    expect(res.status).toBe(200);
    const { user } = await res.json();
    expect(Object.keys(user).sort()).toEqual(SHOWN_FIELDS);
    expect(user).toEqual({
      _id: USER_ID,
      email: 'owner@example.com',
      name: 'Ada Owner',
      role: 'Designer',
      currentGoal: 'Ship it',
      image: 'https://lh3.googleusercontent.com/a/photo',
      plan: 'Pro',
    });
  });

  it('leaves out the fields a user has not set', async () => {
    users.seed({ _id: USER_ID, email: 'new@example.com', plan: 'Basic', tokenVersion: 1, activeSessions: [] });

    const { user } = await (await me()).json();

    expect(user).toEqual({ _id: USER_ID, email: 'new@example.com', plan: 'Basic' });
  });

  it('answers 401 without a session and 404 for a user that is gone', async () => {
    (getAuthUserId as jest.Mock).mockResolvedValueOnce(null);
    expect((await me()).status).toBe(401);
    expect((await me()).status).toBe(404);
  });
});

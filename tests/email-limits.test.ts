import { NextRequest } from 'next/server';
import { Types } from 'mongoose';
import SupportTicket from '@/models/supportTicket';
import User from '@/models/user';
import { describeEmailLimitsContract } from './helpers/emailLimitsContract';
import { keepEmailAllowancesInMemory } from './helpers/memoryEmailAllowances';

jest.mock('@getbrevo/brevo', () => jest.requireActual('./helpers/brevoMock'));
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
jest.mock('next-auth/jwt', () => ({
  getToken: jest.fn(async ({ req }: { req: NextRequest }) => ({ email: req.headers.get('x-test-email') })),
}));
jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn(async (req: NextRequest) => req.headers.get('x-test-account')),
  verifyToken: jest.fn(async () => null),
  createToken: jest.fn(async () => 'test-token'),
}));

jest.setTimeout(60_000);

type Row = Record<string, unknown>;
let users: Map<string, Row>;
let tickets: number;

// Users and tickets in maps, each update atomic and letting others run before it.
function keepUsersAndTicketsInMemory() {
  users = new Map();
  tickets = 0;
  const copy = (row: Row | undefined) => (row ? { ...row } : null);
  const update = async (id: string, fields: Row, onlyIf: (row: Row) => boolean = () => true) => {
    await Promise.resolve();
    const row = users.get(id);
    if (!row || !onlyIf(row)) return null;
    Object.assign(row, fields);
    return copy(row);
  };

  jest.spyOn(User, 'create').mockImplementation((async (fields: Row) => {
    const _id = new Types.ObjectId().toString();
    users.set(_id, { _id, tokenVersion: 1, ...fields });
    return copy(users.get(_id));
  }) as never);
  jest.spyOn(User, 'findById').mockImplementation((async (id: string) => copy(users.get(id))) as never);
  jest.spyOn(User, 'findOne').mockImplementation((async ({ email }: Row) =>
    copy([...users.values()].find((row) => row.email === email))) as never);
  jest.spyOn(User, 'findOneAndUpdate').mockImplementation((async (filter: Row, fields: Row) =>
    update(filter._id as string, fields, (row) => row.isProfileComplete !== true)) as never);
  jest.spyOn(User, 'findByIdAndUpdate').mockImplementation((async (id: string, fields: Row) => update(id, fields)) as never);
  jest.spyOn(SupportTicket, 'create').mockImplementation((async (fields: Row) => {
    const ticket = new SupportTicket(fields);
    await ticket.validate();
    tickets++;
    return ticket;
  }) as never);
}

beforeEach(() => {
  keepEmailAllowancesInMemory();
  keepUsersAndTicketsInMemory();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describeEmailLimitsContract('an in-memory database', async () => tickets);

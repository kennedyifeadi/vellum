import { NextRequest } from 'next/server';
import type { AuthOptions } from 'next-auth';

let mockReceivedOptions: AuthOptions | undefined;
const mockGetMongoClient = jest.fn();

jest.mock('next-auth', () => ({
  __esModule: true,
  default: jest.fn((...args: unknown[]) => {
    mockReceivedOptions = args[args.length - 1] as AuthOptions;
    return args.length === 1 ? async () => new Response() : new Response();
  }),
}));

jest.mock('@/lib/db/mongodb', () => ({ getMongoClient: () => mockGetMongoClient() }));

jest.mock('@next-auth/mongodb-adapter', () => ({
  MongoDBAdapter: jest.fn((client: unknown) => ({ client })),
}));

jest.mock('@/models/user', () => ({ __esModule: true, default: {} }));

import { MongoDBAdapter } from '@next-auth/mongodb-adapter';
import { GET } from '../app/api/auth/[...nextauth]/route';

async function adapterOfNextRequest() {
  const req = new NextRequest('http://localhost:3000/api/auth/session');
  await GET(req, { params: Promise.resolve({ nextauth: ['session'] }) });
  return mockReceivedOptions!.adapter as unknown as { client: unknown };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the NextAuth database adapter', () => {
  it('moves to the new client after a failed connect, instead of keeping the failed one', async () => {
    const failed = Promise.reject(new Error('connection refused'));
    failed.catch(() => {});
    const retried = Promise.resolve({ name: 'connected client' });
    mockGetMongoClient.mockReturnValueOnce(failed).mockReturnValueOnce(retried);

    expect((await adapterOfNextRequest()).client).toBe(failed);
    expect((await adapterOfNextRequest()).client).toBe(retried);
  });

  it('is built once while the client stays the same', async () => {
    const client = Promise.resolve({ name: 'connected client' });
    mockGetMongoClient.mockReturnValue(client);

    await adapterOfNextRequest();
    await adapterOfNextRequest();

    expect(MongoDBAdapter).toHaveBeenCalledTimes(1);
  });
});

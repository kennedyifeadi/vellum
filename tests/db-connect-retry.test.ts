const mockMongoConnect = jest.fn();
const mockMongooseConnect = jest.fn();

jest.mock('mongodb', () => ({
  MongoClient: jest.fn().mockImplementation(() => ({ connect: mockMongoConnect })),
}));

jest.mock('mongoose', () => ({
  __esModule: true,
  default: { connect: (...args: unknown[]) => mockMongooseConnect(...args) },
}));

const cache = globalThis as {
  _mongoClientPromise?: unknown;
  _mongooseCache?: unknown;
};

beforeEach(() => {
  mockMongoConnect.mockReset();
  mockMongooseConnect.mockReset();
  delete cache._mongoClientPromise;
  delete cache._mongooseCache;
});

describe('a failed first database connection', () => {
  it('is retried by the next getMongoClient call', async () => {
    const client = { name: 'connected client' };
    mockMongoConnect.mockRejectedValueOnce(new Error('connection refused')).mockResolvedValueOnce(client);

    await jest.isolateModulesAsync(async () => {
      const { getMongoClient } = await import('@/lib/db/mongodb');

      await expect(getMongoClient()).rejects.toThrow('connection refused');
      await expect(getMongoClient()).resolves.toBe(client);
    });
    expect(mockMongoConnect).toHaveBeenCalledTimes(2);
  });

  it('is retried by the next dbConnect call', async () => {
    const connection = { name: 'connected mongoose' };
    mockMongooseConnect.mockRejectedValueOnce(new Error('connection refused')).mockResolvedValueOnce(connection);

    await jest.isolateModulesAsync(async () => {
      const { default: dbConnect } = await import('@/lib/db/mongoose');

      await expect(dbConnect()).rejects.toThrow('connection refused');
      await expect(dbConnect()).resolves.toBe(connection);
    });
    expect(mockMongooseConnect).toHaveBeenCalledTimes(2);
  });
});

describe('a successful database connection', () => {
  it('is shared by later getMongoClient calls', async () => {
    mockMongoConnect.mockResolvedValue({ name: 'connected client' });

    await jest.isolateModulesAsync(async () => {
      const { getMongoClient } = await import('@/lib/db/mongodb');

      expect(getMongoClient()).toBe(getMongoClient());
      await getMongoClient();
    });
    expect(mockMongoConnect).toHaveBeenCalledTimes(1);
  });
});

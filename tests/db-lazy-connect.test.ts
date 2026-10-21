describe('database modules without MONGODB_URI', () => {
  const configuredUri = process.env.MONGODB_URI;

  beforeEach(() => {
    delete process.env.MONGODB_URI;
  });

  afterAll(() => {
    process.env.MONGODB_URI = configuredUri;
  });

  it('can be imported, so the app builds without a database', async () => {
    await jest.isolateModulesAsync(async () => {
      await expect(import('@/lib/db/mongoose')).resolves.toBeDefined();
      await expect(import('@/lib/db/mongodb')).resolves.toBeDefined();
    });
  });

  it('reject the first mongoose connection with a message naming the variable', async () => {
    await jest.isolateModulesAsync(async () => {
      const { default: dbConnect } = await import('@/lib/db/mongoose');
      await expect(dbConnect()).rejects.toThrow('MONGODB_URI');
    });
  });

  it('refuse to create the NextAuth client with a message naming the missing URI', async () => {
    await jest.isolateModulesAsync(async () => {
      const { getMongoClient } = await import('@/lib/db/mongodb');
      expect(() => getMongoClient()).toThrow('Mongo URI');
    });
  });
});

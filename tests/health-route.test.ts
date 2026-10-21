import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  const configuredUri = process.env.MONGODB_URI;

  afterEach(() => {
    process.env.MONGODB_URI = configuredUri;
  });

  it('reports the process as up, uncached', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('does not need the database', async () => {
    delete process.env.MONGODB_URI;
    const res = GET();
    expect(res.status).toBe(200);
  });
});

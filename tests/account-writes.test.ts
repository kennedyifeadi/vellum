import type { MemoryModel } from './helpers/memoryModel';
import { createMemoryStorage, createMemoryVideoJobStore } from './helpers/memoryVideoJobStore';
import { formRequest } from './helpers/uploadRequests';

// No stored file without an account (#158).

const USER_ID = '507f1f77bcf86cd799439011';

let mockUserId: string | null;
let mockStorage: ReturnType<typeof createMemoryStorage>;
let mockStore: ReturnType<typeof createMemoryVideoJobStore>;

jest.mock('@/lib/auth/jwt', () => ({ getAuthUserId: jest.fn(() => Promise.resolve(mockUserId)) }));
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/storage', () => ({ getStorage: () => mockStorage, LocalDiskStorage: class {} }));
jest.mock('@/lib/video/compress', () => jest.requireActual('./helpers/videoJobMocks').passingVideoProbeModule());
jest.mock('@/lib/video/video-job-store', () => ({
  ...jest.requireActual('@/lib/video/video-job-store'),
  createMongoVideoJobStore: () => mockStore,
}));
jest.mock('@/models/user', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());
jest.mock('@/models/conversion', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());
jest.mock('@/models/userDocument', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());

import User from '@/models/user';
import Conversion from '@/models/conversion';
import UserDocument from '@/models/userDocument';
import { recordConversionHistory, saveConversionRecord } from '@/lib/conversions';
import { POST as compressVideo } from '../app/api/convert/video-compress/route';
import { POST as uploadDocuments } from '../app/api/documents/upload/route';

const users = User as unknown as MemoryModel;
const conversions = Conversion as unknown as MemoryModel;
const documents = UserDocument as unknown as MemoryModel;

jest.setTimeout(30_000);

const upload = (...names: string[]) =>
  uploadDocuments(
    formRequest('http://localhost:3000/api/documents/upload', names.map((name) => ['files', { name, bytes: name }])),
  );
const compress = () =>
  compressVideo(formRequest('http://localhost:3000/api/convert/video-compress', [['video', { name: 'clip.mp4', bytes: 'video' }]]));
const saveConversion = () => saveConversionRecord(USER_ID, 'Merge PDF', 'merged.pdf', Buffer.from('pdf'));

const deleteUser = () => users.reset();

beforeEach(() => {
  mockUserId = USER_ID;
  mockStorage = createMemoryStorage();
  mockStore = createMemoryVideoJobStore();
  users.reset();
  users.seed({ _id: USER_ID, plan: 'Basic' });
  conversions.reset();
  documents.reset();
  for (const method of ['error', 'warn'] as const) jest.spyOn(console, method).mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('an account that is already deleted', () => {
  beforeEach(deleteUser);

  it('cannot upload documents', async () => {
    expect((await upload('a.pdf')).status).toBe(401);
    expect(mockStorage.keys()).toEqual([]);
    expect(documents.all()).toEqual([]);
  });

  it('cannot queue a video', async () => {
    expect((await compress()).status).toBe(401);
    expect(mockStorage.keys()).toEqual([]);
    expect(mockStore.all()).toEqual([]);
  });

  it('is not mistaken for a guest, who still can', async () => {
    mockUserId = null;

    expect((await compress()).status).toBe(202);
  });

  it('keeps no conversion', async () => {
    expect(await saveConversion()).toBeNull();
    expect(mockStorage.keys()).toEqual([]);
    expect(conversions.all()).toEqual([]);
  });
});

describe('an account deleted while its file is being stored', () => {
  beforeEach(() => {
    const put = mockStorage.put.bind(mockStorage);
    jest.spyOn(mockStorage, 'put').mockImplementation(async (key, data) => {
      await put(key, data);
      deleteUser();
    });
  });

  it('keeps no document', async () => {
    expect((await upload('a.pdf', 'b.pdf')).status).toBe(401);
    expect(mockStorage.keys()).toEqual([]);
    expect(documents.all()).toEqual([]);
  });

  it('keeps no video job', async () => {
    expect((await compress()).status).toBe(401);
    expect(mockStorage.keys()).toEqual([]);
    expect(mockStore.all()).toEqual([]);
  });

  it('keeps no conversion', async () => {
    expect(await saveConversion()).toBeNull();
    expect(mockStorage.keys()).toEqual([]);
    expect(conversions.all()).toEqual([]);
  });

  it('keeps an expired record when the file cannot be removed', async () => {
    mockStorage.failDeletes = true;

    expect(await saveConversion()).toBeNull();

    const [kept] = conversions.all();
    expect(mockStorage.keys()).toEqual([kept.diskFileName]);
    expect(kept.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

it('keeps no history for an account deleted while it was written', async () => {
  const create = conversions.create;
  jest.spyOn(conversions, 'create').mockImplementationOnce(async (row) => {
    deleteUser();
    return create(row);
  });

  expect(await recordConversionHistory(USER_ID, 'Find in PDF', 'doc.pdf', 10)).toBeNull();
  expect(conversions.all()).toEqual([]);
});

describe('a row that cannot be created', () => {
  const failure = new Error('write concern timeout');

  it('removes the document it stored', async () => {
    jest.spyOn(documents, 'create').mockRejectedValueOnce(failure);

    await expect(upload('a.pdf')).rejects.toThrow(failure.message);
    expect(mockStorage.keys()).toEqual([]);
  });

  it('removes the conversion it stored', async () => {
    jest.spyOn(conversions, 'create').mockRejectedValueOnce(failure);

    await expect(saveConversion()).rejects.toThrow(failure.message);
    expect(mockStorage.keys()).toEqual([]);
  });

  it('records an expired row when the file cannot be removed either', async () => {
    jest.spyOn(conversions, 'create').mockRejectedValueOnce(failure);
    mockStorage.failDeletes = true;

    await expect(saveConversion()).rejects.toThrow(failure.message);

    const [kept] = conversions.all();
    expect(mockStorage.keys()).toEqual([kept.diskFileName]);
    expect(kept.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('records a discarded job when a video upload cannot be removed', async () => {
    jest.spyOn(mockStore, 'create').mockRejectedValueOnce(failure);
    mockStorage.failDeletes = true;

    expect((await compress()).status).toBe(500);

    const [kept] = mockStore.all();
    expect(mockStorage.keys()).toEqual([kept.inputKey]);
    expect(kept).toMatchObject({ status: 'cancelled', resultExpiresAt: null });
  });
});

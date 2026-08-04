import { NextRequest } from 'next/server';
import fs from 'fs';

const VALID_HEX_BASIC = '507f1f77bcf86cd799439011';
const VALID_HEX_PRO = '507f1f77bcf86cd799439012';
const VALID_HEX_GUEST = '507f1f77bcf86cd799439013';

let mockUserId: string | null = VALID_HEX_BASIC;
let mockPlan: string = 'Basic';
let mockExistingUsage: number = 0;
let mockResolvedFiles: any[] = [];

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockImplementation(() => Promise.resolve(mockUserId)),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {
    findById: jest.fn().mockImplementation(() => ({
      lean: jest.fn().mockImplementation(() => Promise.resolve({ plan: mockPlan })),
      then: (resolve: any, reject: any) => Promise.resolve({ plan: mockPlan }).then(resolve, reject),
      plan: mockPlan,
    })),
  },
}));

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: {
    aggregate: jest.fn().mockImplementation(() => Promise.resolve([{ total: mockExistingUsage }])),
  },
}));

jest.mock('@/models/userDocument', () => ({
  __esModule: true,
  default: {
    aggregate: jest.fn().mockImplementation(() => Promise.resolve([{ total: 0 }])),
    create: jest.fn().mockImplementation((data: any) => Promise.resolve({ _id: 'mock-doc-id', ...data })),
  },
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

jest.mock('@/lib/image/to-pdf', () => ({
  convertImagesToPdf: jest.fn().mockResolvedValue(Buffer.from('dummy pdf content')),
}));

jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: jest.fn().mockResolvedValue(true),
}));

import { POST as handleImageToPdf } from '../app/api/convert/image-to-pdf/route';
import { POST as handleDocumentUpload } from '../app/api/documents/upload/route';

describe('Upload Rates & Storage Quota System Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined as any);
    mockUserId = VALID_HEX_BASIC;
    mockPlan = 'Basic';
    mockExistingUsage = 0;
    mockResolvedFiles = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Batch File Upload Limit per Conversion (image-to-pdf)', () => {
    function createPostRequest() {
      const formData = new FormData();
      return new NextRequest('http://localhost:3000/api/convert/image-to-pdf', {
        method: 'POST',
        body: formData,
      });
    }

    it('should return 400 Bad Request if no files are provided', async () => {
      mockResolvedFiles = [];
      const res = await handleImageToPdf(createPostRequest());
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('No image files provided.');
    });

    it('should enforce Guest limit (max 3 files) when unauthenticated or Free plan', async () => {
      mockUserId = null;
      mockPlan = 'Free';
      mockResolvedFiles = Array(4).fill({ name: 'img.jpg', arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) });

      const res = await handleImageToPdf(createPostRequest());
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('allows up to 3 files');
    });

    it('should allow up to 3 files for Guest user without error', async () => {
      mockUserId = null;
      mockPlan = 'Free';
      mockResolvedFiles = Array(3).fill({ name: 'img.jpg', arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) });

      const res = await handleImageToPdf(createPostRequest());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
    });

    it('should enforce Basic plan batch limit (max 30 files)', async () => {
      mockUserId = VALID_HEX_BASIC;
      mockPlan = 'Basic';
      mockResolvedFiles = Array(31).fill({ name: 'img.jpg', arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) });

      const res = await handleImageToPdf(createPostRequest());
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('allows up to 30 files');
    });

    it('should enforce Pro plan batch limit (max 50 files)', async () => {
      mockUserId = VALID_HEX_PRO;
      mockPlan = 'Pro';
      mockResolvedFiles = Array(51).fill({ name: 'img.jpg', arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) });

      const res = await handleImageToPdf(createPostRequest());
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('allows up to 50 files');
    });
  });

  describe('Storage Staging Quotas (/api/documents/upload)', () => {
    function createUploadRequest(actualByteSize: number, fileName = 'doc.pdf') {
      const formData = new FormData();
      const uint8Array = new Uint8Array(actualByteSize);
      const file = new File([uint8Array], fileName, { type: 'application/pdf' });
      formData.append('files', file);

      return new NextRequest('http://localhost:3000/api/documents/upload', {
        method: 'POST',
        body: formData,
      });
    }

    it('should return 401 Unauthorized if user is not authenticated', async () => {
      mockUserId = null;
      const res = await handleDocumentUpload(createUploadRequest(100));
      expect(res.status).toBe(401);
    });

    it('should allow file upload within the 50 MB Basic plan limit', async () => {
      mockUserId = VALID_HEX_BASIC;
      mockPlan = 'Basic';
      mockExistingUsage = 49 * 1024 * 1024; // 49 MB used
      const uploadBytes = 1000; // 1000 bytes (< 1 MB remaining before 50 MB limit)

      const res = await handleDocumentUpload(createUploadRequest(uploadBytes));
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].fileSize).toBe(uploadBytes);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should reject file upload with 507 Insufficient Storage when exceeding 50 MB Basic plan limit', async () => {
      mockUserId = VALID_HEX_BASIC;
      mockPlan = 'Basic';
      const basicLimit = 50 * 1024 * 1024;
      mockExistingUsage = basicLimit - 50; // Only 50 bytes remaining in quota
      const uploadBytes = 100; // 100 bytes -> exceeds quota by 50 bytes

      const res = await handleDocumentUpload(createUploadRequest(uploadBytes, 'heavy-project.zip'));
      expect(res.status).toBe(507);
      const data = await res.json();
      expect(data.error).toBe('Storage limit reached. Cannot upload "heavy-project.zip". Upgrade to Pro for more space.');
    });

    it('should allow larger upload up to 100 MB for Pro plan users', async () => {
      mockUserId = VALID_HEX_PRO;
      mockPlan = 'Pro';
      mockExistingUsage = 99 * 1024 * 1024; // 99 MB used (well above Basic limit of 50 MB)
      const uploadBytes = 2000; // 2000 bytes -> allowed under 100 MB Pro limit

      const res = await handleDocumentUpload(createUploadRequest(uploadBytes));
      expect(res.status).toBe(201);
    });

    it('should reject Pro user upload with 507 when exceeding 100 MB limit', async () => {
      mockUserId = VALID_HEX_PRO;
      mockPlan = 'Pro';
      const proLimit = 100 * 1024 * 1024;
      mockExistingUsage = proLimit - 50; // Only 50 bytes remaining in Pro quota
      const uploadBytes = 100; // 100 bytes -> exceeds quota by 50 bytes

      const res = await handleDocumentUpload(createUploadRequest(uploadBytes, 'dataset.csv'));
      expect(res.status).toBe(507);
      const data = await res.json();
      expect(data.error).toContain('Storage limit reached');
    });
  });
});

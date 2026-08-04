import fs from 'fs';
import { ALL_TOOLS } from '../lib/tools';

let mockFindByIdResult: any = { plan: 'Basic', preferences: { autoDelete: false } };
let mockValidConversions: any[] = [];
let mockReaddirResult: string[] = [];
let mockStatIsDirectory = false;

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {
    findById: jest.fn().mockImplementation(() => Promise.resolve(mockFindByIdResult)),
  },
}));

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: {
    create: jest.fn().mockImplementation((data: any) => Promise.resolve({ _id: 'conv-id-123', ...data })),
    find: jest.fn().mockImplementation(() => Promise.resolve(mockValidConversions)),
  },
}));

import { saveConversionRecord, cleanupStorage } from '../lib/conversions';

describe('Features & Conversion Lifecycle System Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindByIdResult = { plan: 'Basic', preferences: { autoDelete: false } };
    mockValidConversions = [];
    mockReaddirResult = [];
    mockStatIsDirectory = false;

    jest.spyOn(fs, 'existsSync').mockImplementation(() => true);
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined as any);
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined as any);
    jest.spyOn(fs, 'rmSync').mockImplementation(() => undefined as any);
    jest.spyOn(fs, 'readdirSync').mockImplementation(() => mockReaddirResult as any);
    jest.spyOn(fs, 'statSync').mockImplementation(() => ({
      isDirectory: () => mockStatIsDirectory,
    } as any));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Core Tool Features Validation (lib/tools.tsx)', () => {
    it('should correctly expose all 12 application conversion tools', () => {
      expect(ALL_TOOLS).toHaveLength(12);

      const expectedIds = [
        'image-to-pdf', 'merge-pdf', 'split-pdf', 'docx-to-pdf',
        'lock-pdf', 'compress-pdf', 'find-pdf', 'html-to-pdf',
        'jpg-to-png', 'image-compress', 'video-compress', 'pdf-to-docx'
      ];

      const actualIds = ALL_TOOLS.map(t => t.id);
      expectedIds.forEach(id => {
        expect(actualIds).toContain(id);
      });
    });

    it('should ensure every tool has required UI presentation metadata', () => {
      ALL_TOOLS.forEach(tool => {
        expect(tool.id).toBeTruthy();
        expect(tool.title).toBeTruthy();
        expect(tool.desc).toBeTruthy();
        expect(tool.color).toBeTruthy();
        expect(tool.icon).toBeDefined();
      });
    });

    it('should categorize tools correctly into PDF, Documents, and Images', () => {
      const pdfTools = ALL_TOOLS.filter(t => t.categories?.includes('PDF'));
      const imgTools = ALL_TOOLS.filter(t => t.categories?.includes('Images'));
      
      expect(pdfTools.map(t => t.id)).toContain('merge-pdf');
      expect(pdfTools.map(t => t.id)).toContain('compress-pdf');
      expect(imgTools.map(t => t.id)).toContain('image-to-pdf');
      expect(imgTools.map(t => t.id)).toContain('jpg-to-png');
    });
  });

  describe('Conversion Lifecycle & TTL Expiration (lib/conversions.ts)', () => {
    const dummyBuffer = Buffer.from('generated content test');
    const userId = '507f1f77bcf86cd799439011';

    it('should return null and skip recording if user does not exist', async () => {
      mockFindByIdResult = null;
      const res = await saveConversionRecord(userId, 'Merge PDF', 'merged.pdf', dummyBuffer);
      expect(res).toBeNull();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should calculate 3-day TTL expiration for Basic plan users by default', async () => {
      mockFindByIdResult = { plan: 'Basic', preferences: { autoDelete: false } };
      const now = Date.now();
      
      const record: any = await saveConversionRecord(userId, 'Compress PDF', 'doc.pdf', dummyBuffer);
      expect(record).toBeDefined();
      expect(record.userId).toBe(userId);
      expect(record.toolUsed).toBe('Compress PDF');
      expect(record.fileSize).toBe(dummyBuffer.length);
      expect(fs.writeFileSync).toHaveBeenCalled();

      const expected3DaysMs = 3 * 24 * 60 * 60 * 1000;
      const actualDiffMs = new Date(record.expiresAt).getTime() - now;
      expect(actualDiffMs).toBeGreaterThanOrEqual(expected3DaysMs - 5000);
      expect(actualDiffMs).toBeLessThanOrEqual(expected3DaysMs + 5000);
    });

    it('should calculate 5-day TTL expiration for Pro plan users', async () => {
      mockFindByIdResult = { plan: 'Pro', preferences: { autoDelete: false } };
      const now = Date.now();
      
      const record: any = await saveConversionRecord(userId, 'Split PDF', 'split.pdf', dummyBuffer);
      
      const expected5DaysMs = 5 * 24 * 60 * 60 * 1000;
      const actualDiffMs = new Date(record.expiresAt).getTime() - now;
      expect(actualDiffMs).toBeGreaterThanOrEqual(expected5DaysMs - 5000);
      expect(actualDiffMs).toBeLessThanOrEqual(expected5DaysMs + 5000);
    });

    it('should set nearly immediate expiration (1 second) when autoDelete preference is true', async () => {
      mockFindByIdResult = { plan: 'Pro', preferences: { autoDelete: true } };
      const now = Date.now();
      
      const record: any = await saveConversionRecord(userId, 'Lock PDF', 'secret.pdf', dummyBuffer);
      
      const actualDiffMs = new Date(record.expiresAt).getTime() - now;
      expect(actualDiffMs).toBeLessThanOrEqual(5000);
    });
  });

  describe('Storage Sweep & Cleanup Routine (cleanupStorage)', () => {
    it('should delete orphaned files present on disk that have expired in MongoDB', async () => {
      mockReaddirResult = ['valid.pdf', 'expired.pdf'];
      mockValidConversions = [{ diskFileName: 'valid.pdf' }];
      mockStatIsDirectory = false;

      await cleanupStorage();

      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('expired.pdf'));
    });

    it('should remove orphaned subdirectories cleanly using rmSync', async () => {
      mockReaddirResult = ['temp_orphaned_dir'];
      mockValidConversions = [];
      mockStatIsDirectory = true;

      await cleanupStorage();

      expect(fs.rmSync).toHaveBeenCalledTimes(1);
      expect(fs.rmSync).toHaveBeenCalledWith(expect.stringContaining('temp_orphaned_dir'), { recursive: true, force: true });
    });

    it('should do nothing if all physical disk files match valid active database records', async () => {
      mockReaddirResult = ['active1.pdf', 'active2.pdf'];
      mockValidConversions = [{ diskFileName: 'active1.pdf' }, { diskFileName: 'active2.pdf' }];

      await cleanupStorage();

      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(fs.rmSync).not.toHaveBeenCalled();
    });
  });
});

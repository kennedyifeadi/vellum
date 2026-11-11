import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { assertInsideDir } from '@/lib/paths';
import type { StorageDriver, StoredFileStream } from './types';

// A file is written before its database row is created, so a sweep running in that gap
// would see it as orphaned. Files younger than this are never swept: it is far longer
// than any put-then-create gap, and short next to the shortest retention (days).
export const SWEEP_GRACE_MS = 15 * 60 * 1000;

/**
 * Stores files on the local disk under tmp/storage, matching the layout the
 * app has always used. Only safe on a host with a persistent, single-instance
 * filesystem (e.g. local dev) — see S3Storage for serverless/multi-instance
 * deployments.
 */
export class LocalDiskStorage implements StorageDriver {
  private readonly root: string;

  constructor(root: string = path.join(process.cwd(), 'tmp', 'storage')) {
    this.root = root;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const filePath = this.resolve(key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
  }

  async get(key: string): Promise<Buffer | null> {
    const filePath = this.resolve(key);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  }

  async openRead(key: string): Promise<StoredFileStream | null> {
    const filePath = this.resolve(key);
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(filePath, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      const { size } = await handle.stat();
      const stream = Readable.toWeb(fs.createReadStream('', { fd: handle })) as ReadableStream<Uint8Array>;
      return { stream, size };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolve(key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.resolve(key));
  }

  /**
   * Deletes the files in each given folder ('' is the root) whose names are not in
   * that folder's set, once they are older than SWEEP_GRACE_MS. Folders not given,
   * and subfolders, are never touched. Local-disk-only maintenance (S3 relies on
   * bucket lifecycle rules instead), so it lives on this class rather than the
   * shared StorageDriver interface.
   */
  async sweepOrphaned(validNamesByFolder: Map<string, Set<string>>, now = Date.now()): Promise<void> {
    for (const [folder, validNames] of validNamesByFolder) {
      const dir = folder ? this.resolve(folder) : this.root;
      if (!fs.existsSync(dir)) continue;

      for (const entry of fs.readdirSync(dir)) {
        if (validNames.has(entry)) continue;
        this.deleteIfStale(path.join(dir, entry), now);
      }
    }
  }

  private deleteIfStale(filePath: string, now: number): void {
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory() || now - stat.mtimeMs < SWEEP_GRACE_MS) return;
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`Failed to delete expired file ${filePath}:`, err);
    }
  }

  private resolve(key: string): string {
    return assertInsideDir(this.root, path.join(this.root, key));
  }
}

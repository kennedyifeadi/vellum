import fs from 'fs';
import path from 'path';
import type { StorageDriver } from './types';

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
   * Sweeps the storage root and deletes any physical entry not present in
   * `validKeys`. Local-disk-only maintenance (S3 relies on bucket lifecycle
   * rules instead), so it lives on this class rather than the shared
   * StorageDriver interface.
   */
  async sweepOrphaned(validKeys: Set<string>): Promise<void> {
    if (!fs.existsSync(this.root)) return;

    const entries = fs.readdirSync(this.root);
    for (const entry of entries) {
      if (validKeys.has(entry)) continue;

      const entryPath = path.join(this.root, entry);
      try {
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
          // Subdirectories (e.g. tmp/storage/docs) must be removed recursively
          fs.rmSync(entryPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(entryPath);
        }
      } catch (err) {
        console.error(`Failed to delete expired entry ${entry}:`, err);
      }
    }
  }

  private resolve(key: string): string {
    return path.join(this.root, key);
  }
}

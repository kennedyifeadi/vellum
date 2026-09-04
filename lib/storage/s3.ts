import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { StorageDriver } from './types';

function isNotFoundError(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'NotFound' || name === 'NoSuchKey';
}

/**
 * Stores files in an S3-compatible bucket (AWS S3, Cloudflare R2, etc), so
 * uploads and conversion outputs survive across serverless invocations and
 * multiple instances. Configured via STORAGE_DRIVER=s3 plus the S3_* env vars.
 */
export class S3Storage implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'S3 storage driver requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY to be set.'
      );
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      // Lets the same driver target R2 or other S3-compatible providers.
      endpoint: process.env.S3_ENDPOINT,
    });
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!response.Body) return null;
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }
}

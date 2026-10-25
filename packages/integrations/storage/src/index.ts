import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

export interface StorageConfig {
  endpoint: string | undefined;
  region: string;
  accessKey: string | undefined;
  secretKey: string | undefined;
  bucketFiles: string;
}

export interface Storage {
  client: S3Client;
  bucket: string;
  /** False when no endpoint/credentials are configured (health reports `skipped`). */
  configured: boolean;
  ping(): Promise<void>;
  /** Presigned PUT the client uploads to directly (bytes never pass through the API). */
  presignPut(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;
  presignGet(key: string, expiresInSeconds?: number): Promise<string>;
  getObject(key: string): Promise<Uint8Array | null>;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  close(): void;
}

/** S3-compatible object storage (R2 in production, SeaweedFS in dev/CI — ADR-019). Path-style addressing. */
export function createStorage(cfg: StorageConfig): Storage {
  const configured = Boolean(cfg.endpoint && cfg.accessKey && cfg.secretKey);
  const client = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
    ...(cfg.accessKey && cfg.secretKey
      ? { credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } }
      : {}),
    maxAttempts: 1,
    // The SDK otherwise bakes a checksum of an *empty* body into presigned PUT URLs, so every real
    // upload fails (BadDigest). R2 and SeaweedFS also reject the extra checksum parameters.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return {
    client,
    bucket: cfg.bucketFiles,
    configured,
    async ping() {
      await client.send(new HeadBucketCommand({ Bucket: cfg.bucketFiles }));
    },
    presignPut(key, contentType, expiresInSeconds = 900) {
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: cfg.bucketFiles, Key: key, ContentType: contentType }),
        {
          expiresIn: expiresInSeconds,
        },
      );
    },
    async getObject(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: cfg.bucketFiles, Key: key }));
      } catch {
        return null;
      }
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucketFiles, Key: key }));
      return res.Body ? await res.Body.transformToByteArray() : null;
    },
    async putObject(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucketFiles,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    presignGet(key, expiresInSeconds = 3600) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucketFiles, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },
    close() {
      client.destroy();
    },
  };
}

// ── Backups bucket (ADR-019: R2 in production, off the VM) ─────────────────────────────────────

export interface BackupObject {
  key: string;
  size: number;
  lastModified: Date;
}

export interface BackupStore {
  configured: boolean;
  bucket: string;
  /** Streams `body` (e.g. pg_dump stdout) with multipart upload; never buffers the whole dump. */
  upload(key: string, body: Readable, contentType: string): Promise<void>;
  list(prefix: string): Promise<BackupObject[]>;
  download(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
}

export function createBackupStore(
  cfg: Omit<StorageConfig, 'bucketFiles'> & { bucketBackups: string },
): BackupStore {
  const storage = createStorage({ ...cfg, bucketFiles: cfg.bucketBackups });
  const { client } = storage;
  const Bucket = cfg.bucketBackups;
  return {
    configured: storage.configured,
    bucket: Bucket,
    async upload(key, body, contentType) {
      const { Upload } = await import('@aws-sdk/lib-storage');
      await new Upload({
        client,
        params: { Bucket, Key: key, Body: body, ContentType: contentType },
        partSize: 16 * 1024 * 1024,
        queueSize: 2,
      }).done();
    },
    async list(prefix) {
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const out: BackupObject[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of res.Contents ?? [])
          if (o.Key)
            out.push({
              key: o.Key,
              size: o.Size ?? 0,
              lastModified: o.LastModified ?? new Date(0),
            });
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return out.sort((a, b) => a.key.localeCompare(b.key));
    },
    async download(key) {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return res.Body as Readable;
    },
    async remove(key) {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

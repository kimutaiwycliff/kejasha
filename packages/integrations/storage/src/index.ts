import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

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
  close(): void;
}

/** S3-compatible object storage (MinIO self-hosted). Path-style addressing for MinIO. */
export function createStorage(cfg: StorageConfig): Storage {
  const configured = Boolean(cfg.endpoint && cfg.accessKey && cfg.secretKey);
  const client = new S3Client({
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
    ...(cfg.accessKey && cfg.secretKey
      ? { credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } }
      : {}),
    maxAttempts: 1,
  });
  return {
    client,
    bucket: cfg.bucketFiles,
    configured,
    async ping() {
      await client.send(new HeadBucketCommand({ Bucket: cfg.bucketFiles }));
    },
    close() {
      client.destroy();
    },
  };
}

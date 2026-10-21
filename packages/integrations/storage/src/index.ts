import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

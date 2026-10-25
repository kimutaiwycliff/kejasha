import type { Storage } from '@kejasha/integrations-storage';
import { AppError } from '../errors';
import type { Ctx } from './ctx';

/**
 * Keys a client sends back after `POST /v1/uploads` must belong to this org and purpose — never a
 * path into another org's files.
 */
export function assertUploadKeys(ctx: Ctx, purpose: string, keys: readonly string[]) {
  const prefix = `org/${ctx.orgId}/${purpose}/`;
  const bad = keys.find((k) => !k.startsWith(prefix) || k.includes('..'));
  if (bad)
    throw AppError.unprocessable(
      'invalid_upload_key',
      `Files must come from POST /v1/uploads (purpose ${purpose}) for this organization.`,
    );
}

/** Short-lived download links for stored files (empty when storage is not configured). */
export function fileLinks(storage: Storage, keys: readonly string[]) {
  return Promise.all(
    keys.map(async (key) => ({
      key,
      url: storage.configured ? await storage.presignGet(key) : '',
    })),
  );
}

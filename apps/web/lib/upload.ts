import type { Schemas } from '@kejasha/api-client';
import { api, unwrap, writeHeaders } from './api';

type Purpose = Schemas['UploadRequestInput']['purpose'];
type ContentType = Schemas['UploadRequestInput']['contentType'];

/**
 * Two-step upload: the API issues a short-lived ticket, the browser PUTs the bytes straight to
 * object storage (ADR-019), and the returned `key` is what later requests reference.
 */
export async function uploadFile(
  file: File,
  purpose: Purpose,
  contentType: ContentType = file.type as ContentType,
): Promise<string> {
  const ticket = unwrap(
    await api.POST('/v1/uploads', {
      body: { purpose, contentType, sizeBytes: file.size },
      headers: writeHeaders(),
    }),
  );
  const res = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: file });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return ticket.key;
}

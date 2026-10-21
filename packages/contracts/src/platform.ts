import { z } from 'zod';

export const DependencyCheck = z
  .object({
    status: z.enum(['up', 'down', 'skipped']),
    latencyMs: z.int().optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'DependencyCheck' });

export const HealthResponse = z
  .object({
    status: z.enum(['ok', 'degraded']),
    version: z.string(),
    time: z.iso.datetime({ offset: true }),
    checks: z.object({ db: DependencyCheck, redis: DependencyCheck, storage: DependencyCheck }),
  })
  .meta({ id: 'HealthResponse' });
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Remote config read by installed clients so they follow a domain move (ADR-016/017). */
export const MetaConfigResponse = z
  .object({
    apiUrl: z.url(),
    webUrl: z.url(),
    contractVersion: z.string(),
    minAndroidVersionCode: z.int().min(0),
  })
  .meta({ id: 'MetaConfigResponse' });
export type MetaConfigResponse = z.infer<typeof MetaConfigResponse>;

import {
  problemResponses,
  SyncPullQuery,
  SyncPullResponse,
  SyncPushBody,
  SyncPushResponse,
} from '@kejasha/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../deps';
import { ctxOf } from '../../lib/ctx';
import type { SyncService } from './service';

/** Offline sync for the Android app (ADR-017): caretakers and staff, never viewers. */
export function syncRoutes(sync: SyncService): FastifyPluginAsyncZod<AppDeps> {
  return async (app) => {
    const tags = ['sync'];
    const member = { minRole: 'caretaker' as const };

    app.get(
      '/v1/sync/pull',
      {
        config: member,
        schema: {
          operationId: 'syncPull',
          tags,
          summary: 'Changes since the cursor (full snapshot without one)',
          description:
            'Changes are visible ~10 s after they are written. When `reset` is true the device keeps only what this snapshot (and its `hasMore` follow-ups) contains.',
          querystring: SyncPullQuery,
          response: { 200: SyncPullResponse, ...problemResponses(422) },
        },
      },
      async (req) => sync.pull(ctxOf(req), req.query.cursor),
    );
    app.post(
      '/v1/sync/push',
      {
        config: member,
        schema: {
          operationId: 'syncPush',
          tags,
          summary: 'Apply records created offline; each answers applied, duplicate or rejected',
          body: SyncPushBody,
          response: { 200: SyncPushResponse, ...problemResponses(422) },
        },
      },
      async (req) => sync.push(ctxOf(req), req.body),
    );
  };
}

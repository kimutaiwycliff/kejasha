import { createHash } from 'node:crypto';
import { and, eq, lt, schema, sql, withAdmin, type Db } from '@kejasha/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors';

/**
 * Idempotency-Key for every write (CLAUDE.md §2.8).
 * - Same key + same request → the stored response is replayed (`idempotent-replayed: true`).
 * - Same key + different request → 422. Same key while the first is running → 409.
 * - 5xx responses are not stored, so the client can retry with the same key.
 * Routes opt out (webhooks) with `config: { idempotency: 'off' }` or demand a key with 'required'.
 */
declare module 'fastify' {
  interface FastifyContextConfig {
    idempotency?: 'optional' | 'required' | 'off';
  }
  interface FastifyRequest {
    idempotency: { scope: string; key: string } | undefined;
  }
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_RE = /^[A-Za-z0-9_\-:.]{8,255}$/;
const REPLAY_HEADERS = ['content-type', 'location'];
const t = schema.idempotencyKey;

export const idempotencyPlugin = fp(async (app: FastifyInstance, opts: { db: Db }) => {
  const { db } = opts;
  app.decorateRequest('idempotency', undefined);

  app.addHook('preHandler', async (req, reply) => {
    if (!WRITE_METHODS.has(req.method)) return;
    const mode = req.routeOptions.config.idempotency ?? 'optional';
    if (mode === 'off') return;

    const header = req.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    if (!key) {
      if (mode === 'required') {
        throw new AppError(
          400,
          'idempotency_key_required',
          'Idempotency-Key required',
          'Send an Idempotency-Key header (a UUID works).',
        );
      }
      return;
    }
    if (!KEY_RE.test(key)) {
      throw new AppError(
        400,
        'idempotency_key_invalid',
        'Invalid Idempotency-Key',
        'Use 8–255 characters from [A-Za-z0-9_-:.].',
      );
    }

    const scope = scopeOf(req);
    const route = req.routeOptions.url ?? req.url;
    const requestHash = createHash('sha256')
      .update(
        `${req.method}\n${route}\n${JSON.stringify(req.params ?? {})}\n${JSON.stringify(req.body ?? null)}`,
      )
      .digest('hex');

    const replay = await withAdmin(db, async (tx) => {
      await tx
        .delete(t)
        .where(and(eq(t.scope, scope), eq(t.key, key), lt(t.expiresAt, sql`now()`)));
      const inserted = await tx
        .insert(t)
        .values({ scope, key, method: req.method, route, requestHash, status: 'in_progress' })
        .onConflictDoNothing()
        .returning({ key: t.key });
      if (inserted.length > 0) return null;
      const [existing] = await tx
        .select()
        .from(t)
        .where(and(eq(t.scope, scope), eq(t.key, key)));
      return existing ?? null;
    });

    if (replay === null) {
      req.idempotency = { scope, key };
      return;
    }
    if (replay.requestHash !== requestHash) {
      throw AppError.unprocessable(
        'idempotency_key_reused',
        'This Idempotency-Key was already used for a different request.',
      );
    }
    if (replay.status === 'in_progress') {
      throw AppError.conflict(
        'idempotency_request_in_progress',
        'A request with this Idempotency-Key is still being processed.',
      );
    }
    return sendReplay(reply, replay);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const idem = req.idempotency;
    if (!idem) return payload;
    req.idempotency = undefined;
    const body =
      typeof payload === 'string'
        ? payload
        : Buffer.isBuffer(payload)
          ? payload.toString('utf8')
          : null;

    if (reply.statusCode >= 500 || body === null) {
      await db.owner.delete(t).where(and(eq(t.scope, idem.scope), eq(t.key, idem.key)));
      return payload;
    }
    const headers: Record<string, string> = {};
    for (const h of REPLAY_HEADERS) {
      const v = reply.getHeader(h);
      if (v !== undefined) headers[h] = String(v);
    }
    await db.owner
      .update(t)
      .set({
        status: 'completed',
        responseStatus: reply.statusCode,
        responseHeaders: headers,
        responseBody: body,
        completedAt: sql`now()`,
      })
      .where(and(eq(t.scope, idem.scope), eq(t.key, idem.key)));
    return payload;
  });

  // A request that dies before onSend (connection reset) must not leave the key stuck in_progress.
  app.addHook('onResponse', async (req) => {
    const idem = req.idempotency;
    if (!idem) return;
    await db.owner
      .delete(t)
      .where(and(eq(t.scope, idem.scope), eq(t.key, idem.key), eq(t.status, 'in_progress')));
  });
});

function scopeOf(req: FastifyRequest): string {
  if (req.actor?.orgId) return `org:${req.actor.orgId}`;
  if (req.actor?.userId) return `user:${req.actor.userId}`;
  return 'anon';
}

function sendReplay(reply: FastifyReply, row: typeof t.$inferSelect) {
  for (const [h, v] of Object.entries(row.responseHeaders ?? {})) reply.header(h, v);
  reply.header('idempotent-replayed', 'true');
  // Bypass the route serializer: the stored body is already the serialized response.
  return reply
    .status(row.responseStatus ?? 200)
    .serializer((p) => p as string)
    .send(row.responseBody ?? '');
}

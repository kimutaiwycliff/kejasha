import { schema, type Tx } from '@kejasha/db';
import type { FastifyRequest } from 'fastify';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  diff?: Record<string, unknown>;
}

/** Append an audit row in the same transaction as the change (RLS scopes it to the org). */
export async function audit(tx: Tx, req: FastifyRequest, entry: AuditEntry): Promise<void> {
  const actor = req.actor;
  if (!actor?.orgId) throw new Error('audit() needs an org-scoped actor');
  await tx.insert(schema.auditLog).values({
    orgId: actor.orgId,
    actorKind: 'user',
    actorUserId: actor.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    diff: entry.diff ? jsonSafe(entry.diff) : null,
    requestId: req.id,
  });
}

/** bigint → string, Date → ISO, so diffs serialise into jsonb. */
function jsonSafe(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Record<string, unknown>;
}

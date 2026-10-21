import { schema, sql, type Tx } from '@kejasha/db';

export interface OutboxEvent {
  /** Owning org; required inside withTenant() (RLS checks it). Null only for platform events. */
  orgId: string | null;
  topic: string;
  payload: Record<string, unknown>;
  /** Optional business dedupe (e.g. `invoice.issued:<invoiceId>`); a duplicate within the org is ignored. */
  dedupeKey?: string;
  availableAt?: Date;
}

/**
 * Write an event in the SAME transaction as the business change (transactional outbox, ADR-014).
 * If the transaction rolls back, the event never existed. The relay dispatches it after commit.
 */
export async function enqueueInTx(tx: Tx, event: OutboxEvent): Promise<void> {
  await tx
    .insert(schema.outbox)
    .values({
      orgId: event.orgId,
      topic: event.topic,
      payload: event.payload,
      dedupeKey: event.dedupeKey ?? null,
      ...(event.availableAt ? { availableAt: event.availableAt } : {}),
    })
    .onConflictDoNothing({
      target: [schema.outbox.orgId, schema.outbox.dedupeKey],
      where: sql`dedupe_key IS NOT NULL`,
    });
}

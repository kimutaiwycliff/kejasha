import { sql, type Tx } from '@kejasha/db';
import type { Ctx } from './ctx';

/** Per-org running document number, e.g. INV-000042 / CN-000003 / RCT-000017 (row-locked counter). */
export async function nextNumber(tx: Tx, ctx: Ctx, name: string, prefix: string): Promise<string> {
  const { rows } = await tx.execute<{ value: string }>(sql`
    INSERT INTO org_counter (org_id, name, value) VALUES (${ctx.orgId}, ${name}, 1)
    ON CONFLICT (org_id, name) DO UPDATE SET value = org_counter.value + 1
    RETURNING value`);
  return `${prefix}-${String(rows[0]!.value).padStart(6, '0')}`;
}

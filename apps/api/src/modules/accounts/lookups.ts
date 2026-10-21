import { eq, inArray, schema, type Tx } from '@kejasha/db';

/**
 * Read helpers other modules use instead of touching accounts tables (ADR-001). They run inside
 * the caller's tenant transaction, so RLS still scopes them to the org.
 */
const { unit: un, property: pr, propertyStaff: ps } = schema;

export interface UnitInfo {
  id: string;
  code: string;
  mode: 'long_term' | 'short_stay';
  status: 'active' | 'inactive';
  archived: boolean;
  propertyId: string;
  propertyName: string;
}

export async function unitsById(tx: Tx, ids: string[]): Promise<Map<string, UnitInfo>> {
  if (!ids.length) return new Map();
  const rows = await tx
    .select({ u: un, propertyName: pr.name })
    .from(un)
    .innerJoin(pr, eq(pr.id, un.propertyId))
    .where(inArray(un.id, [...new Set(ids)]));
  return new Map(
    rows.map(({ u, propertyName }) => [
      u.id,
      {
        id: u.id,
        code: u.code,
        mode: u.mode,
        status: u.status,
        archived: u.archivedAt !== null,
        propertyId: u.propertyId,
        propertyName,
      },
    ]),
  );
}

export async function unitIdsInProperty(tx: Tx, propertyId: string): Promise<string[]> {
  const rows = await tx.select({ id: un.id }).from(un).where(eq(un.propertyId, propertyId));
  return rows.map((r) => r.id);
}

/** Properties a caretaker is assigned to. */
export async function assignedPropertyIds(tx: Tx, userId: string): Promise<Set<string>> {
  const rows = await tx.select({ id: ps.propertyId }).from(ps).where(eq(ps.userId, userId));
  return new Set(rows.map((r) => r.id));
}

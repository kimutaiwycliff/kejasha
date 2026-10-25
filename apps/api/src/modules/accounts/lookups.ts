import { and, eq, inArray, isNull, schema, sql, type Tx } from '@kejasha/db';

/**
 * Read helpers other modules use instead of touching accounts tables (ADR-001). They run inside
 * the caller's tenant transaction, so RLS still scopes them to the org.
 */
const { unit: un, property: pr, propertyStaff: ps, clientLandlord: cl } = schema;

export interface UnitInfo {
  id: string;
  code: string;
  mode: 'long_term' | 'short_stay';
  status: 'active' | 'inactive';
  archived: boolean;
  propertyId: string;
  propertyName: string;
  clientLandlordId: string;
  baseNightlyCents: bigint | null;
}

export async function unitsById(tx: Tx, ids: string[]): Promise<Map<string, UnitInfo>> {
  if (!ids.length) return new Map();
  const rows = await tx
    .select({ u: un, propertyName: pr.name, clientLandlordId: pr.clientLandlordId })
    .from(un)
    .innerJoin(pr, eq(pr.id, un.propertyId))
    .where(inArray(un.id, [...new Set(ids)]));
  return new Map(
    rows.map(({ u, propertyName, clientLandlordId }) => [
      u.id,
      {
        id: u.id,
        code: u.code,
        mode: u.mode,
        status: u.status,
        archived: u.archivedAt !== null,
        propertyId: u.propertyId,
        propertyName,
        clientLandlordId,
        baseNightlyCents: u.baseNightlyCents,
      },
    ]),
  );
}

export interface PropertyInfo {
  id: string;
  name: string;
  kind: 'residential' | 'commercial' | 'mixed';
  clientLandlordId: string;
  archived: boolean;
}

export async function propertiesById(tx: Tx, ids: string[]): Promise<Map<string, PropertyInfo>> {
  if (!ids.length) return new Map();
  const rows = await tx
    .select()
    .from(pr)
    .where(inArray(pr.id, [...new Set(ids)]));
  return new Map(
    rows.map((p) => [
      p.id,
      {
        id: p.id,
        name: p.name,
        kind: p.kind,
        clientLandlordId: p.clientLandlordId,
        archived: p.archivedAt !== null,
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

/** Unit id for a Paybill account reference (normalised like unit codes), or null. */
export async function unitIdByCode(tx: Tx, code: string): Promise<string | null> {
  const normalised = code.trim().toUpperCase().replace(/[\s#]/g, '');
  if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(normalised)) return null;
  const [row] = await tx.select({ id: un.id }).from(un).where(eq(un.code, normalised)).limit(1);
  return row?.id ?? null;
}

/** Active short-stay units (optionally in one property), sorted by code. */
export async function shortStayUnitIds(tx: Tx, propertyId?: string): Promise<string[]> {
  const rows = await tx
    .select({ id: un.id })
    .from(un)
    .where(
      and(
        eq(un.mode, 'short_stay'),
        isNull(un.archivedAt),
        propertyId ? eq(un.propertyId, propertyId) : undefined,
      ),
    )
    .orderBy(un.code);
  return rows.map((r) => r.id);
}

export interface LandlordInfo {
  id: string;
  name: string;
  isSelf: boolean;
  kraPin: string | null;
  phone: string | null;
  email: string | null;
  mgmtFee: { kind: 'none' | 'percent' | 'flat'; bps: number | null; flatCents: bigint | null };
  archived: boolean;
}

/** The org's landlords (its own "self" landlord first), optionally only some. */
export async function landlords(tx: Tx, ids?: string[]): Promise<LandlordInfo[]> {
  const rows = await tx
    .select()
    .from(cl)
    .where(
      ids ? inArray(cl.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) : undefined,
    )
    .orderBy(sql`${cl.isSelf} DESC`, sql`lower(${cl.name})`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isSelf: r.isSelf,
    kraPin: r.kraPin,
    phone: r.phone,
    email: r.email,
    mgmtFee: { kind: r.mgmtFeeKind, bps: r.mgmtFeeBps, flatCents: r.mgmtFeeFlatCents },
    archived: r.archivedAt !== null,
  }));
}

/** All properties of the org (or of one landlord). */
export async function propertiesOf(tx: Tx, clientLandlordId?: string): Promise<PropertyInfo[]> {
  const rows = await tx
    .select()
    .from(pr)
    .where(clientLandlordId ? eq(pr.clientLandlordId, clientLandlordId) : undefined)
    .orderBy(sql`lower(${pr.name})`);
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    clientLandlordId: p.clientLandlordId,
    archived: p.archivedAt !== null,
  }));
}

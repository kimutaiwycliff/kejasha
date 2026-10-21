import { money, uuidv7 } from '@kejasha/core';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  schema,
  sql,
  type LedgerAccountKind,
  type LedgerSource,
  type Tx,
} from '@kejasha/db';
import type { Ctx } from '../../lib/ctx';

/**
 * The only writer of the ledger (ADR-006). Callers pass a tenant transaction; entries are
 * validated to balance here and again by the database at commit.
 */
const { ledgerAccount: acc, ledgerEntry: ent, ledgerPosting: pst } = schema;

export interface PostingLine {
  accountId: string;
  amountCents: bigint;
}

export interface NewEntry {
  occurredOn: string;
  source: LedgerSource;
  sourceId?: string | undefined;
  leaseId?: string | undefined;
  unitId?: string | undefined;
  memo?: string | undefined;
  /** Unique per org: posting the same business event twice returns the first entry. */
  idempotencyKey: string;
  reversesEntryId?: string | undefined;
  lines: PostingLine[];
}

export class UnbalancedEntryError extends Error {
  constructor(sum: bigint) {
    super(`Ledger entry does not balance (sum ${sum})`);
    this.name = 'UnbalancedEntryError';
  }
}

/** Merge lines per account and drop zero legs; throws if the result does not balance. */
export function normaliseLines(lines: PostingLine[]): PostingLine[] {
  const byAccount = new Map<string, bigint>();
  for (const l of lines)
    byAccount.set(l.accountId, (byAccount.get(l.accountId) ?? 0n) + l.amountCents);
  const merged = [...byAccount]
    .filter(([, v]) => v !== 0n)
    .map(([accountId, amountCents]) => ({ accountId, amountCents }));
  const total = money.sum(merged.map((l) => l.amountCents));
  if (total !== 0n || merged.length < 2) throw new UnbalancedEntryError(total);
  return merged;
}

export async function accountFor(
  tx: Tx,
  ctx: Ctx,
  kind: LedgerAccountKind,
  leaseId?: string,
): Promise<string> {
  const leaseScoped = kind === 'lease_receivable' || kind === 'lease_deposit';
  if (leaseScoped !== Boolean(leaseId))
    throw new Error(`Account ${kind} ${leaseScoped ? 'needs' : 'must not have'} a lease`);
  const where = leaseId
    ? and(eq(acc.leaseId, leaseId), eq(acc.kind, kind))
    : and(sql`${acc.leaseId} IS NULL`, eq(acc.kind, kind));
  const [found] = await tx.select({ id: acc.id }).from(acc).where(where);
  if (found) return found.id;
  await tx
    .insert(acc)
    .values({ id: uuidv7(), orgId: ctx.orgId, kind, leaseId: leaseId ?? null })
    .onConflictDoNothing();
  const [created] = await tx.select({ id: acc.id }).from(acc).where(where);
  return created!.id;
}

export async function leaseAccounts(tx: Tx, ctx: Ctx, leaseId: string) {
  return {
    receivable: await accountFor(tx, ctx, 'lease_receivable', leaseId),
    deposit: await accountFor(tx, ctx, 'lease_deposit', leaseId),
  };
}

/** Post a balanced entry. Idempotent on `idempotencyKey`: returns `{ created: false }` on replay. */
export async function post(
  tx: Tx,
  ctx: Ctx,
  e: NewEntry,
): Promise<{ entryId: string; created: boolean }> {
  const lines = normaliseLines(e.lines);
  const id = uuidv7();
  const inserted = await tx
    .insert(ent)
    .values({
      id,
      orgId: ctx.orgId,
      occurredOn: e.occurredOn,
      source: e.source,
      sourceId: e.sourceId ?? null,
      leaseId: e.leaseId ?? null,
      unitId: e.unitId ?? null,
      memo: e.memo ?? null,
      idempotencyKey: e.idempotencyKey,
      reversesEntryId: e.reversesEntryId ?? null,
      createdBy: ctx.userId ?? null,
    })
    .onConflictDoNothing({ target: [ent.orgId, ent.idempotencyKey] })
    .returning({ id: ent.id });
  if (!inserted.length) {
    const [existing] = await tx
      .select({ id: ent.id })
      .from(ent)
      .where(eq(ent.idempotencyKey, e.idempotencyKey));
    return { entryId: existing!.id, created: false };
  }
  await tx.insert(pst).values(
    lines.map((l) => ({
      orgId: ctx.orgId,
      entryId: id,
      accountId: l.accountId,
      amountCents: l.amountCents,
    })),
  );
  return { entryId: id, created: true };
}

/** Post the exact opposite of an entry (corrections never edit history). */
export async function reverse(
  tx: Tx,
  ctx: Ctx,
  entryId: string,
  opts: { occurredOn: string; source: LedgerSource; memo?: string; idempotencyKey: string },
) {
  const [original] = await tx.select().from(ent).where(eq(ent.id, entryId));
  if (!original) throw new Error(`Ledger entry ${entryId} not found`);
  const lines = await tx
    .select({ accountId: pst.accountId, amountCents: pst.amountCents })
    .from(pst)
    .where(eq(pst.entryId, entryId));
  return post(tx, ctx, {
    occurredOn: opts.occurredOn,
    source: opts.source,
    sourceId: original.sourceId ?? undefined,
    leaseId: original.leaseId ?? undefined,
    unitId: original.unitId ?? undefined,
    memo: opts.memo,
    idempotencyKey: opts.idempotencyKey,
    reversesEntryId: entryId,
    lines: lines.map((l) => ({ accountId: l.accountId, amountCents: -l.amountCents })),
  });
}

export async function balances(tx: Tx, accountIds: string[]): Promise<Map<string, bigint>> {
  if (!accountIds.length) return new Map();
  const rows = await tx
    .select({ accountId: pst.accountId, total: sql<string>`sum(${pst.amountCents})` })
    .from(pst)
    .where(inArray(pst.accountId, accountIds))
    .groupBy(pst.accountId);
  const map = new Map(accountIds.map((id) => [id, 0n]));
  for (const r of rows) map.set(r.accountId, BigInt(r.total));
  return map;
}

/** Receivable and deposit balances for many leases at once (missing accounts → 0). */
export async function leaseBalances(tx: Tx, leaseIds: string[]) {
  const out = new Map(leaseIds.map((id) => [id, { receivable: 0n, depositHeld: 0n }]));
  if (!leaseIds.length) return out;
  const rows = await tx
    .select({
      leaseId: acc.leaseId,
      kind: acc.kind,
      total: sql<string>`coalesce(sum(${pst.amountCents}), 0)`,
    })
    .from(acc)
    .leftJoin(pst, eq(pst.accountId, acc.id))
    .where(inArray(acc.leaseId, leaseIds))
    .groupBy(acc.leaseId, acc.kind);
  for (const r of rows) {
    const b = out.get(r.leaseId!)!;
    // Deposit is a liability: credit balance (negative) = money held for the tenant.
    if (r.kind === 'lease_receivable') b.receivable = BigInt(r.total);
    if (r.kind === 'lease_deposit') b.depositHeld = -BigInt(r.total);
  }
  return out;
}

export interface StatementRow {
  entryId: string;
  occurredOn: string;
  recordedAt: Date;
  source: LedgerSource;
  sourceId: string | null;
  memo: string | null;
  amountCents: bigint;
}

/** Postings to one account between dates (inclusive) with the opening balance before `from`. */
export async function accountActivity(tx: Tx, accountId: string, from: string, to: string) {
  const [opening] = await tx
    .select({ total: sql<string>`coalesce(sum(${pst.amountCents}), 0)` })
    .from(pst)
    .innerJoin(ent, eq(ent.id, pst.entryId))
    .where(and(eq(pst.accountId, accountId), lt(ent.occurredOn, from)));
  const rows: StatementRow[] = await tx
    .select({
      entryId: ent.id,
      occurredOn: ent.occurredOn,
      recordedAt: ent.recordedAt,
      source: ent.source,
      sourceId: ent.sourceId,
      memo: ent.memo,
      amountCents: pst.amountCents,
    })
    .from(pst)
    .innerJoin(ent, eq(ent.id, pst.entryId))
    .where(and(eq(pst.accountId, accountId), gte(ent.occurredOn, from), lte(ent.occurredOn, to)))
    .orderBy(asc(ent.occurredOn), asc(ent.recordedAt), asc(ent.id));
  return { openingBalance: BigInt(opening?.total ?? '0'), rows };
}

/** Σ of every posting in the org — must always be zero. */
export async function trialBalance(tx: Tx): Promise<bigint> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${pst.amountCents}), 0)` })
    .from(pst);
  return BigInt(row?.total ?? '0');
}

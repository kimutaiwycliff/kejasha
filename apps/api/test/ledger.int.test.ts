import { randomUUID } from 'node:crypto';
import { sql, withTenant } from '@kejasha/db';
import { createTestDb } from '@kejasha/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { systemCtx } from '../src/lib/ctx';
import * as ledger from '../src/modules/ledger';

const db = createTestDb();
afterAll(() => db.close());

async function newOrg() {
  const orgId = randomUUID();
  await db.pools.owner.query(
    `INSERT INTO organization (id, name, slug, kind) VALUES ($1, 'L', $2, 'landlord')`,
    [orgId, orgId],
  );
  return orgId;
}

describe('ledger guarantees', () => {
  it('normaliseLines merges per account and refuses unbalanced or one-legged entries', () => {
    expect(
      ledger.normaliseLines([
        { accountId: 'a', amountCents: 100n },
        { accountId: 'a', amountCents: 50n },
        { accountId: 'b', amountCents: -150n },
      ]),
    ).toEqual([
      { accountId: 'a', amountCents: 150n },
      { accountId: 'b', amountCents: -150n },
    ]);
    expect(() =>
      ledger.normaliseLines([
        { accountId: 'a', amountCents: 1n },
        { accountId: 'b', amountCents: -2n },
      ]),
    ).toThrow(ledger.UnbalancedEntryError);
    expect(() =>
      ledger.normaliseLines([
        { accountId: 'a', amountCents: 1n },
        { accountId: 'a', amountCents: -1n },
      ]),
    ).toThrow();
  });

  it('posts idempotently, reverses to zero, and keeps the trial balance at zero', async () => {
    const orgId = await newOrg();
    const ctx = systemCtx(orgId);
    await withTenant(db, ctx, async (tx) => {
      const rent = await ledger.accountFor(tx, ctx, 'income_rent');
      const other = await ledger.accountFor(tx, ctx, 'income_other');
      expect(await ledger.accountFor(tx, ctx, 'income_rent')).toBe(rent);
      const entry = {
        occurredOn: '2026-10-01',
        source: 'adjustment' as const,
        idempotencyKey: 'k1',
        lines: [
          { accountId: rent, amountCents: 500n },
          { accountId: other, amountCents: -500n },
        ],
      };
      const first = await ledger.post(tx, ctx, entry);
      const replay = await ledger.post(tx, ctx, entry);
      expect(first.created).toBe(true);
      expect(replay).toEqual({ entryId: first.entryId, created: false });
      await ledger.reverse(tx, ctx, first.entryId, {
        occurredOn: '2026-10-02',
        source: 'adjustment',
        idempotencyKey: 'k1:rev',
      });
      expect((await ledger.balances(tx, [rent, other])).get(rent)).toBe(0n);
      expect(await ledger.trialBalance(tx)).toBe(0n);
    });
  });

  it('the database rejects unbalanced entries at commit, even if the service is bypassed', async () => {
    const orgId = await newOrg();
    const ctx = systemCtx(orgId);
    const attempt = withTenant(db, ctx, async (tx) => {
      const a = await ledger.accountFor(tx, ctx, 'income_rent');
      const entryId = randomUUID();
      await tx.execute(
        sql`INSERT INTO ledger_entry (id, org_id, occurred_on, source, idempotency_key) VALUES (${entryId}, ${orgId}, '2026-10-01', 'adjustment', 'bad')`,
      );
      await tx.execute(
        sql`INSERT INTO ledger_posting (org_id, entry_id, account_id, amount_cents) VALUES (${orgId}, ${entryId}, ${a}, 100)`,
      );
    });
    await expect(attempt).rejects.toThrow();
  });

  it('postings and entries are append-only, for the owner role too', async () => {
    const orgId = await newOrg();
    const ctx = systemCtx(orgId);
    await withTenant(db, ctx, async (tx) => {
      const a = await ledger.accountFor(tx, ctx, 'income_rent');
      const b = await ledger.accountFor(tx, ctx, 'income_other');
      await ledger.post(tx, ctx, {
        occurredOn: '2026-10-01',
        source: 'adjustment',
        idempotencyKey: 'x',
        lines: [
          { accountId: a, amountCents: 1n },
          { accountId: b, amountCents: -1n },
        ],
      });
    });
    await expect(
      db.pools.owner.query('UPDATE ledger_posting SET amount_cents = 2 WHERE org_id = $1', [orgId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.pools.owner.query('DELETE FROM ledger_entry WHERE org_id = $1', [orgId]),
    ).rejects.toThrow(/append-only/);
  });
});

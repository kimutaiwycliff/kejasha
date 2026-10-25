import type {
  CreateInspectionBody,
  DepositSettlementBody,
  Inspection,
  UploadRequest,
} from '@kejasha/contracts';
import { money, time, uuidv7 } from '@kejasha/core';
import { desc, eq, schema, type Tx } from '@kejasha/db';
import { enqueueInTx } from '@kejasha/jobs';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { inTenant, type Ctx } from '../../lib/ctx';
import * as accounts from '../accounts';
import * as ledger from '../ledger';
import { applyLateFees, billableLeaseIds, billLease, outstandingByLease } from './invoicing';

const { lease: ls, tenant: tn, depositSettlement: ds, leaseInspection: li } = schema;

/** Reminder stages: days relative to due date → stage name (ADR-015). */
const REMINDER_STAGES = new Map<number, string>([
  [-3, 'before'],
  [0, 'due'],
  [3, 'overdue_3'],
  [7, 'overdue_7'],
  [14, 'overdue_14'],
]);

export function createLeasingOperations(deps: AppDeps) {
  const { db, clock, storage } = deps;

  async function remindersForLease(
    tx: Tx,
    ctx: Ctx,
    leaseId: string,
    asOf: string,
  ): Promise<number> {
    const [lease] = await tx.select().from(ls).where(eq(ls.id, leaseId));
    if (!lease || lease.status === 'cancelled') return 0;
    const [tenant] = await tx.select().from(tn).where(eq(tn.id, lease.tenantId));
    if (!tenant?.phone) return 0;
    const unit = (await accounts.unitsById(tx, [lease.unitId])).get(lease.unitId);
    const o = (await outstandingByLease(tx, [leaseId])).get(leaseId)!;
    let queued = 0;
    for (const { invoice, outstandingCents } of o.items) {
      if (outstandingCents <= 0n) continue;
      const stage = REMINDER_STAGES.get(time.diffDays(invoice.dueOn, asOf));
      if (!stage) continue;
      const amount = money.formatKes(outstandingCents);
      const first = tenant.fullName.split(/\s+/)[0];
      const account = unit?.code ?? '';
      const message =
        stage === 'before' || stage === 'due'
          ? `Hi ${first}, invoice ${invoice.number} (${amount}) for ${account} is due ${stage === 'due' ? 'today' : `on ${invoice.dueOn}`}. Pay using account number ${account}.`
          : `Hi ${first}, invoice ${invoice.number} for ${account} is overdue: ${amount} outstanding since ${invoice.dueOn}. Pay using account number ${account}.`;
      await enqueueInTx(tx, {
        orgId: ctx.orgId,
        topic: 'notifications.sms',
        payload: { to: tenant.phone, message },
        dedupeKey: `reminder:${invoice.id}:${stage}`,
      });
      queued++;
    }
    return queued;
  }

  return {
    /**
     * Daily per-org run (also behind POST /v1/billing/run): bill due periods, apply late fees, queue
     * reminders. Each lease runs in its own transaction so one bad lease never blocks the rest.
     */
    async runDaily(ctx: Ctx, asOf = clock.today(), opts: { reminders?: boolean } = {}) {
      const leaseIds = await inTenant(db, ctx, (tx) => billableLeaseIds(tx));
      let invoicesCreated = 0;
      let lateFeesCreated = 0;
      let remindersQueued = 0;
      for (const leaseId of leaseIds) {
        await inTenant(db, ctx, async (tx) => {
          invoicesCreated += (await billLease(tx, ctx, leaseId, asOf)).length;
          const [lease] = await tx.select().from(ls).where(eq(ls.id, leaseId));
          lateFeesCreated += await applyLateFees(tx, ctx, lease!, asOf);
          if (opts.reminders !== false)
            remindersQueued += await remindersForLease(tx, ctx, leaseId, asOf);
        });
      }
      if (invoicesCreated || lateFeesCreated) {
        await inTenant(db, ctx, (tx) =>
          record(tx, ctx, {
            action: 'billing.run',
            entityType: 'organization',
            entityId: ctx.orgId,
            diff: { asOf, invoicesCreated, lateFeesCreated },
          }),
        );
      }
      return {
        asOf,
        leasesProcessed: leaseIds.length,
        invoicesCreated,
        lateFeesCreated,
        remindersQueued,
      };
    },

    async settleDeposit(ctx: Ctx, leaseId: string, body: z.infer<typeof DepositSettlementBody>) {
      const today = clock.today();
      return inTenant(db, ctx, async (tx) => {
        const [lease] = await tx.select().from(ls).where(eq(ls.id, leaseId)).for('update');
        if (!lease) throw AppError.notFound('Lease');
        if (lease.status !== 'terminated' && !(lease.endDate && lease.endDate < today)) {
          throw AppError.unprocessable(
            'lease_not_ended',
            'Settle the deposit after the lease is terminated or has ended.',
          );
        }
        const [existing] = await tx.select().from(ds).where(eq(ds.leaseId, leaseId));
        if (existing)
          throw AppError.conflict('deposit_already_settled', 'This deposit was already settled.');
        const balances = (await ledger.leaseBalances(tx, [leaseId])).get(leaseId)!;
        const held = balances.depositHeld;
        if (held <= 0n)
          throw AppError.unprocessable('no_deposit_held', 'No deposit is held for this lease.');
        const deductions = body.deductions ?? [];
        const deductionsTotal = money.sum(deductions.map((d) => BigInt(d.amountCents)));
        if (deductionsTotal > held)
          throw AppError.unprocessable(
            'deductions_exceed_deposit',
            'Deductions are larger than the deposit held.',
          );
        const arrears = balances.receivable > 0n ? balances.receivable : 0n;
        const applied =
          body.applyToArrears === false ? 0n : money.min(arrears, held - deductionsTotal);
        const refund = held - deductionsTotal - applied;

        const acc = await ledger.leaseAccounts(tx, ctx, leaseId);
        const id = uuidv7();
        const lines: ledger.PostingLine[] = [{ accountId: acc.deposit, amountCents: held }];
        if (deductionsTotal > 0n)
          lines.push({
            accountId: await ledger.accountFor(tx, ctx, 'income_deposit_deductions'),
            amountCents: -deductionsTotal,
          });
        if (applied > 0n) lines.push({ accountId: acc.receivable, amountCents: -applied });
        if (refund > 0n)
          lines.push({
            accountId: await ledger.accountFor(tx, ctx, 'deposit_refund_payable'),
            amountCents: -refund,
          });
        const { entryId } = await ledger.post(tx, ctx, {
          occurredOn: today,
          source: 'deposit_settlement',
          sourceId: id,
          leaseId,
          unitId: lease.unitId,
          memo: `Deposit settlement: ${money.formatKes(deductionsTotal)} deducted, ${money.formatKes(applied)} to arrears, ${money.formatKes(refund)} refund due`,
          idempotencyKey: `deposit_settlement:${leaseId}`,
          lines,
        });
        const [row] = await tx
          .insert(ds)
          .values({
            id,
            orgId: ctx.orgId,
            leaseId,
            settledOn: today,
            depositHeldCents: held,
            deductions,
            deductionsCents: deductionsTotal,
            appliedToArrearsCents: applied,
            refundDueCents: refund,
            ledgerEntryId: entryId,
            createdBy: ctx.userId ?? null,
          })
          .returning();
        await record(tx, ctx, {
          action: 'deposit.settled',
          entityType: 'lease',
          entityId: leaseId,
          diff: { deductions, applied: applied.toString(), refund: refund.toString() },
        });
        return {
          id: row!.id,
          leaseId,
          settledOn: row!.settledOn,
          depositHeldCents: money.toApiInt(held),
          deductionsCents: money.toApiInt(deductionsTotal),
          appliedToArrearsCents: money.toApiInt(applied),
          refundDueCents: money.toApiInt(refund),
          deductions,
        };
      });
    },

    async createUpload(ctx: Ctx, body: z.infer<typeof UploadRequest>) {
      if (!storage.configured)
        throw new AppError(
          503,
          'storage_unavailable',
          'Storage unavailable',
          'File storage is not configured.',
        );
      const isImage = body.contentType.startsWith('image/');
      const allowed =
        body.purpose === 'statement'
          ? !isImage
          : body.purpose === 'licence_document'
            ? isImage || body.contentType === 'application/pdf'
            : isImage;
      if (!allowed) {
        throw AppError.unprocessable(
          'invalid_content_type',
          'Photos and receipts must be images; statements CSV or PDF; licence documents an image or PDF.',
        );
      }
      const EXT = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'text/csv': 'csv',
        'application/pdf': 'pdf',
      } as const;
      const ext = EXT[body.contentType];
      const key = `org/${ctx.orgId}/${body.purpose}/${uuidv7()}.${ext}`;
      const expiresIn = 900;
      return {
        key,
        uploadUrl: await storage.presignPut(key, body.contentType, expiresIn, body.sizeBytes),
        method: 'PUT' as const,
        headers: { 'content-type': body.contentType },
        expiresAt: new Date(clock.now().getTime() + expiresIn * 1000).toISOString(),
      };
    },

    async createInspection(ctx: Ctx, leaseId: string, body: z.infer<typeof CreateInspectionBody>) {
      const prefix = `org/${ctx.orgId}/inspection_photo/`;
      const bad = body.items
        .flatMap((i) => i.photoKeys ?? [])
        .find((k) => !k.startsWith(prefix) || k.includes('..'));
      if (bad)
        throw AppError.unprocessable(
          'invalid_photo_key',
          'Photo keys must come from POST /v1/uploads for this organization.',
        );
      await inTenant(db, ctx, async (tx) => {
        const [lease] = await tx.select({ id: ls.id }).from(ls).where(eq(ls.id, leaseId));
        if (!lease) throw AppError.notFound('Lease');
        const id = uuidv7();
        await tx.insert(li).values({
          id,
          orgId: ctx.orgId,
          leaseId,
          kind: body.kind,
          inspectedOn: body.inspectedOn,
          items: body.items.map((i) => ({
            area: i.area,
            condition: i.condition,
            ...(i.note ? { note: i.note } : {}),
            photoKeys: i.photoKeys ?? [],
          })),
          notes: body.notes || null,
          createdBy: ctx.userId ?? null,
        });
        await record(tx, ctx, {
          action: 'inspection.created',
          entityType: 'lease',
          entityId: leaseId,
          diff: { kind: body.kind },
        });
      });
      return this.listInspections(ctx, leaseId);
    },

    async listInspections(ctx: Ctx, leaseId: string): Promise<z.infer<typeof Inspection>[]> {
      const rows = await inTenant(db, ctx, async (tx) => {
        const [lease] = await tx.select({ id: ls.id }).from(ls).where(eq(ls.id, leaseId));
        if (!lease) throw AppError.notFound('Lease');
        return tx.select().from(li).where(eq(li.leaseId, leaseId)).orderBy(desc(li.inspectedOn));
      });
      const url = (key: string) =>
        storage.configured ? storage.presignGet(key) : Promise.resolve('');
      return Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          leaseId: r.leaseId,
          kind: r.kind,
          inspectedOn: r.inspectedOn,
          notes: r.notes,
          createdAt: r.createdAt.toISOString(),
          items: await Promise.all(
            r.items.map(async (i) => ({
              area: i.area,
              condition: i.condition,
              note: i.note ?? null,
              photos: await Promise.all(
                i.photoKeys.map(async (key) => ({ key, url: await url(key) })),
              ),
            })),
          ),
        })),
      );
    },
  };
}

export type LeasingOperations = ReturnType<typeof createLeasingOperations>;

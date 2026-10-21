import type { CreateCreditNoteBody, ManualInvoiceBody } from '@kejasha/contracts';
import { money } from '@kejasha/core';
import { eq, schema } from '@kejasha/db';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { inTenant, type Ctx } from '../../lib/ctx';
import { issueCreditNote, issueInvoice, outstandingByLease, voidInvoice } from './invoicing';

const { lease: ls, invoice: inv } = schema;

/** Manual invoices, voids and credit notes — managers only (enforced on the routes). */
export function createInvoiceOps(deps: AppDeps) {
  const { db, clock } = deps;

  return {
    async manualInvoice(ctx: Ctx, leaseId: string, body: z.infer<typeof ManualInvoiceBody>) {
      return inTenant(db, ctx, async (tx) => {
        const [lease] = await tx.select().from(ls).where(eq(ls.id, leaseId));
        if (!lease) throw AppError.notFound('Lease');
        if (lease.status === 'cancelled')
          throw AppError.unprocessable('lease_cancelled', 'The lease is cancelled.');
        const today = clock.today();
        const row = await issueInvoice(tx, ctx, lease, {
          kind: 'manual',
          issuedOn: today,
          dueOn: body.dueOn < today ? today : body.dueOn,
          lines: body.lines.map((l) => ({
            kind: l.kind,
            description: l.description,
            amountCents: BigInt(l.amountCents),
          })),
        });
        await record(tx, ctx, {
          action: 'invoice.manual_created',
          entityType: 'invoice',
          entityId: row!.id,
          diff: body,
        });
        return row!.id;
      });
    },

    /** Void only while nothing has been applied to the invoice; otherwise issue a credit note. */
    async voidInvoice(ctx: Ctx, invoiceId: string, reason: string) {
      return inTenant(db, ctx, async (tx) => {
        const [row] = await tx.select().from(inv).where(eq(inv.id, invoiceId));
        if (!row) throw AppError.notFound('Invoice');
        if (row.status === 'void')
          throw AppError.conflict('already_void', 'The invoice is already void.');
        const o = (await outstandingByLease(tx, [row.leaseId])).get(row.leaseId)!;
        const mine = o.items.find((i) => i.invoice.id === invoiceId)!;
        if (mine.outstandingCents !== row.totalCents) {
          throw AppError.conflict(
            'invoice_has_credits',
            'Money has been applied to this invoice; issue a credit note instead.',
          );
        }
        await voidInvoice(tx, ctx, invoiceId, reason, clock.today());
        await record(tx, ctx, {
          action: 'invoice.voided',
          entityType: 'invoice',
          entityId: invoiceId,
          diff: { reason },
        });
        return invoiceId;
      });
    },

    async creditNote(ctx: Ctx, leaseId: string, body: z.infer<typeof CreateCreditNoteBody>) {
      return inTenant(db, ctx, async (tx) => {
        const [lease] = await tx.select().from(ls).where(eq(ls.id, leaseId));
        if (!lease) throw AppError.notFound('Lease');
        if (body.invoiceId) {
          const [target] = await tx.select().from(inv).where(eq(inv.id, body.invoiceId));
          if (!target || target.leaseId !== leaseId) throw AppError.notFound('Invoice');
          if (target.status === 'void')
            throw AppError.unprocessable('invoice_void', 'The invoice is void.');
          if (BigInt(body.amountCents) > target.totalCents) {
            throw AppError.unprocessable(
              'credit_exceeds_invoice',
              'The credit is larger than the invoice.',
            );
          }
        }
        const row = await issueCreditNote(tx, ctx, lease, {
          amountCents: BigInt(body.amountCents),
          reason: body.reason,
          invoiceId: body.invoiceId,
          issuedOn: clock.today(),
        });
        await record(tx, ctx, {
          action: 'credit_note.created',
          entityType: 'credit_note',
          entityId: row.id,
          diff: body,
        });
        return {
          id: row.id,
          number: row.number,
          leaseId,
          invoiceId: row.invoiceId,
          amountCents: money.toApiInt(row.amountCents),
          reason: row.reason,
          issuedOn: row.issuedOn,
          createdAt: row.createdAt.toISOString(),
        };
      });
    },
  };
}

export type InvoiceOps = ReturnType<typeof createInvoiceOps>;

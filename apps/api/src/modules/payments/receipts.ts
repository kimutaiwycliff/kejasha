import { money } from '@kejasha/core';
import { eq, schema } from '@kejasha/db';
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { createElement as h } from 'react';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { inTenant, type Ctx } from '../../lib/ctx';
import * as accounts from '../accounts';
import * as leasing from '../leasing';
import * as ledger from '../ledger';

const { payment: pm, organization: org } = schema;

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: 'Helvetica' },
  title: { fontSize: 18, marginBottom: 4, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#555555', marginBottom: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottom: '1 solid #eeeeee',
  },
  label: { color: '#555555' },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
  },
});

/** PDF receipt for a matched payment, rendered once and cached in object storage. */
export function createReceipts(deps: AppDeps) {
  const { db, storage } = deps;

  return {
    async pdf(ctx: Ctx, paymentId: string): Promise<Buffer> {
      const data = await inTenant(db, ctx, async (tx) => {
        const [p] = await tx.select().from(pm).where(eq(pm.id, paymentId));
        if (!p) throw AppError.notFound('Payment');
        if (p.matchStatus !== 'matched' || !p.leaseId || !p.receiptNumber) {
          throw AppError.unprocessable('no_receipt', 'Receipts exist for allocated payments only.');
        }
        const [lease] = await leasing.leasesForMatching(tx, [p.leaseId]);
        const unit = (await accounts.unitsById(tx, [lease!.unitId])).get(lease!.unitId)!;
        const balance = (await ledger.leaseBalances(tx, [p.leaseId])).get(p.leaseId)!.receivable;
        return { p, lease: lease!, unit, balance };
      });
      const { p } = data;
      if (p.receiptFileKey && storage.configured) {
        const cached = await storage.getObject(p.receiptFileKey);
        if (cached) return Buffer.from(cached);
      }
      const [orgRow] = await db.owner
        .select({ name: org.name })
        .from(org)
        .where(eq(org.id, ctx.orgId));
      const line = (label: string, value: string) =>
        h(
          View,
          { style: styles.row },
          h(Text, { style: styles.label }, label),
          h(Text, null, value),
        );
      const doc = h(
        Document,
        { title: `Receipt ${p.receiptNumber}` },
        h(
          Page,
          { size: 'A5', style: styles.page },
          h(Text, { style: styles.title }, orgRow?.name ?? 'Receipt'),
          h(Text, { style: styles.muted }, `Receipt ${p.receiptNumber}`),
          line('Received from', data.lease.tenantName),
          line('Unit', `${data.unit.code} · ${data.unit.propertyName}`),
          line('Date', p.paidAt.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })),
          line(
            'Method',
            p.method === 'mpesa' ? `M-Pesa ${p.providerRef}` : `${p.method} ${p.providerRef}`,
          ),
          line(
            'Balance after payment',
            data.balance > 0n
              ? money.formatKes(data.balance)
              : data.balance < 0n
                ? `Credit ${money.formatKes(-data.balance)}`
                : 'Nil',
          ),
          h(
            View,
            { style: styles.total },
            h(Text, null, 'Amount received'),
            h(Text, null, money.formatKes(p.amountCents)),
          ),
        ),
      );
      const pdf = await renderToBuffer(doc);
      if (storage.configured) {
        const key = `org/${ctx.orgId}/receipts/${p.receiptNumber}.pdf`;
        await storage.putObject(key, pdf, 'application/pdf');
        await inTenant(db, ctx, (tx) =>
          tx.update(pm).set({ receiptFileKey: key }).where(eq(pm.id, p.id)),
        );
      }
      return pdf;
    },
  };
}

export type Receipts = ReturnType<typeof createReceipts>;

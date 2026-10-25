import type { OwnerStatement } from '@kejasha/contracts';
import { money } from '@kejasha/core';
import { eq, schema } from '@kejasha/db';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { inTenant, type Ctx } from '../../lib/ctx';
import type { Reporting } from './service';

const kes = (cents: number) => money.formatKes(BigInt(cents));

/**
 * Monthly owner statement PDF. Rendered on request (never cached: late receipts change it). An
 * agency's name and brand colour head its client landlords' statements (white-label).
 */
export function createStatementPdf(deps: AppDeps, reporting: Reporting) {
  const { db } = deps;

  return async function render(ctx: Ctx, landlordId: string, period: string): Promise<Buffer> {
    const st: z.infer<typeof OwnerStatement> = await reporting.statement(ctx, landlordId, period);
    const org = await reporting.orgName(ctx.orgId);
    const [profile] = await inTenant(db, ctx, (tx) =>
      tx.select().from(schema.orgProfile).where(eq(schema.orgProfile.orgId, ctx.orgId)),
    );
    const accent =
      (profile?.branding as { brandColor?: string } | undefined)?.brandColor ?? '#0F766E';

    // Loaded lazily (scripts/build-app.mjs): only processes that render PDFs need these.
    const { Document, Page, renderToBuffer, StyleSheet, Text, View } =
      await import('@react-pdf/renderer');
    const { createElement: h } = await import('react');
    const s = StyleSheet.create({
      page: { padding: 36, fontSize: 9.5, fontFamily: 'Helvetica', color: '#1F2937' },
      brand: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: accent },
      muted: { color: '#6B7280', marginBottom: 2 },
      h2: {
        fontSize: 11,
        fontFamily: 'Helvetica-Bold',
        marginTop: 16,
        marginBottom: 6,
        color: accent,
      },
      row: { flexDirection: 'row', paddingVertical: 3, borderBottom: '0.5 solid #E5E7EB' },
      head: {
        flexDirection: 'row',
        paddingVertical: 3,
        borderBottom: `1 solid ${accent}`,
        fontFamily: 'Helvetica-Bold',
      },
      c1: { flex: 3 },
      c2: { flex: 2 },
      c3: { flex: 1.4, textAlign: 'right' },
      total: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
      net: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 6,
        paddingTop: 6,
        borderTop: `1 solid ${accent}`,
        fontSize: 12,
        fontFamily: 'Helvetica-Bold',
      },
    });
    type Style = (typeof s)[keyof typeof s];
    const cells = (style: Style, ...vals: string[]) =>
      h(
        View,
        { style },
        ...vals.map((v, i) => h(Text, { style: [s.c1, s.c2, s.c3][Math.min(i, 2)] }, v)),
      );
    const line = (label: string, value: string, style: Style = s.total) =>
      h(View, { style }, h(Text, null, label), h(Text, null, value));

    const fee =
      st.managementFee.kind === 'percent'
        ? `Management fee (${(st.managementFee.bps ?? 0) / 100}%)`
        : st.managementFee.kind === 'flat'
          ? 'Management fee (flat)'
          : null;

    const doc = h(
      Document,
      { title: `Statement ${st.landlordName} ${period}` },
      h(
        Page,
        { size: 'A4', style: s.page },
        h(Text, { style: s.brand }, org?.name ?? 'Owner statement'),
        h(Text, { style: s.muted }, `Owner statement · ${st.landlordName}`),
        h(Text, { style: s.muted }, `Period ${st.from} to ${st.to}`),
        st.managedBy ? h(Text, { style: s.muted }, `Managed by ${st.managedBy}`) : null,

        h(Text, { style: s.h2 }, 'Income received'),
        cells(s.head, 'Unit', 'Property', 'Amount'),
        ...(st.income.length
          ? st.income.map((i) => cells(s.row, i.unitCode, i.propertyName, kes(i.receivedCents)))
          : [h(Text, { style: s.muted }, 'No payments received this month.')]),

        h(Text, { style: s.h2 }, 'Expenses'),
        cells(s.head, 'Item', 'Date · Unit', 'Amount'),
        ...(st.expenses.length
          ? st.expenses.map((e) =>
              cells(
                s.row,
                `${e.category}${e.description ? ` — ${e.description}` : ''}`,
                `${e.incurredOn}${e.unitCode ? ` · ${e.unitCode}` : ` · ${e.propertyName}`}`,
                kes(e.amountCents),
              ),
            )
          : [h(Text, { style: s.muted }, 'No expenses this month.')]),

        h(Text, { style: s.h2 }, 'Summary'),
        line('Income received', kes(st.incomeCents)),
        line('Expenses', `− ${kes(st.expensesCents)}`),
        fee ? line(fee, `− ${kes(st.managementFeeCents)}`) : null,
        line('Net to owner', kes(st.netCents), s.net),
        h(
          Text,
          { style: [s.muted, { marginTop: 18 }] },
          'Payments are made directly to the owner’s own M-Pesa/bank channels; this statement reports them.',
        ),
      ),
    );
    return renderToBuffer(doc);
  };
}

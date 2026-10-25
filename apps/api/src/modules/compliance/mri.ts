import type {
  FileMriBody,
  MriDetail,
  MriLandlord,
  MriMonth,
  TenantPinRegister,
} from '@kejasha/contracts';
import { money, tax, time, uuidv7 } from '@kejasha/core';
import { eq, schema, type Tx } from '@kejasha/db';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { kes, toCsv } from '../../lib/csv';
import { inTenant, type Ctx } from '../../lib/ctx';
import * as accounts from '../accounts';
import * as leasing from '../leasing';
import * as payments from '../payments';

const { mriFiling: mf } = schema;
const api = (v: bigint) => money.toApiInt(v);

interface Line {
  leaseId: string;
  tenantId: string;
  tenantName: string;
  tenantKraPin: string | null;
  unitCode: string;
  propertyName: string;
  propertyKind: 'residential' | 'mixed';
  clientLandlordId: string;
  receivedCents: bigint;
  rentCents: bigint;
  ytdRentCents: bigint;
}

/**
 * Monthly Rental Income (ADR-006 money, core `tax`): residential rent received per landlord per
 * month. Computed from receipts each time; a filing snapshots the figures sent to KRA.
 */
export function createMri(deps: AppDeps) {
  const { db } = deps;

  /** One line per residential/mixed lease for `period` (month figures and year to date). */
  async function lines(tx: Tx, period: string): Promise<Line[]> {
    const start = time.monthStart(period);
    const end = time.monthEnd(period);
    const yearStart = `${period.slice(0, 4)}-01-01`;
    const leases = await leasing.leaseTaxInputs(tx);
    if (!leases.length) return [];
    const paid = await payments.leasePaymentCredits(tx);
    const units = await accounts.unitsById(
      tx,
      leases.map((l) => l.unitId),
    );
    const props = await accounts.propertiesById(
      tx,
      [...units.values()].map((u) => u.propertyId),
    );
    const out: Line[] = [];
    for (const l of leases) {
      const unit = units.get(l.unitId);
      const prop = unit ? props.get(unit.propertyId) : undefined;
      if (!unit || !prop || prop.kind === 'commercial') continue;
      const credits = [
        ...l.credits,
        ...paid.filter((p) => p.leaseId === l.leaseId).map((p) => p.credit),
      ];
      const attributed = tax.attributeRent(l.invoices, credits);
      let received = 0n;
      let rent = 0n;
      let ytd = 0n;
      for (const a of attributed) {
        if (a.on >= start && a.on <= end) {
          received += a.amountCents;
          rent += a.rentCents;
        }
        if (a.on >= yearStart && a.on <= end) ytd += a.rentCents;
      }
      if (received === 0n && ytd === 0n) continue;
      out.push({
        leaseId: l.leaseId,
        tenantId: l.tenantId,
        tenantName: l.tenantName,
        tenantKraPin: l.tenantKraPin,
        unitCode: unit.code,
        propertyName: prop.name,
        propertyKind: prop.kind,
        clientLandlordId: prop.clientLandlordId,
        receivedCents: received,
        rentCents: rent,
        ytdRentCents: ytd,
      });
    }
    return out.sort((a, b) => a.unitCode.localeCompare(b.unitCode));
  }

  async function summarise(
    tx: Tx,
    period: string,
    landlordIds?: string[],
  ): Promise<{ landlords: z.infer<typeof MriLandlord>[]; byLandlord: Map<string, Line[]> }> {
    const all = await lines(tx, period);
    const list = (await accounts.landlords(tx, landlordIds)).filter(
      (l) => !l.archived || all.some((x) => x.clientLandlordId === l.id),
    );
    const filings = await tx
      .select()
      .from(mf)
      .where(eq(mf.period, time.monthStart(period)));
    const byLandlord = new Map<string, Line[]>();
    const landlords = list.map((l) => {
      const mine = all.filter((x) => x.clientLandlordId === l.id);
      byLandlord.set(l.id, mine);
      const rent = mine.reduce((s, x) => s + x.rentCents, 0n);
      const ytd = mine.reduce((s, x) => s + x.ytdRentCents, 0n);
      const taxCents = tax.mriTax(rent);
      const f = filings.find((x) => x.clientLandlordId === l.id);
      return {
        clientLandlordId: l.id,
        name: l.name,
        isSelf: l.isSelf,
        kraPin: l.kraPin,
        rentCents: api(rent),
        taxCents: api(taxCents),
        yearToDateRentCents: api(ytd),
        band: tax.mriBand(ytd),
        hasMixedProperties: mine.some((x) => x.propertyKind === 'mixed'),
        tenantsMissingPin: new Set(
          mine.filter((x) => x.rentCents > 0n && !x.tenantKraPin).map((x) => x.tenantId),
        ).size,
        filing: f
          ? {
              id: f.id,
              filedOn: f.filedOn,
              kraReference: f.kraReference,
              rentCents: api(f.rentCents),
              taxCents: api(f.taxCents),
              differenceCents: api(taxCents - f.taxCents),
              createdAt: f.createdAt.toISOString(),
            }
          : null,
      };
    });
    return { landlords, byLandlord };
  }

  const toLine = (x: Line) => ({
    leaseId: x.leaseId,
    tenantId: x.tenantId,
    tenantName: x.tenantName,
    tenantKraPin: x.tenantKraPin,
    unitCode: x.unitCode,
    propertyName: x.propertyName,
    propertyKind: x.propertyKind,
    receivedCents: api(x.receivedCents),
    rentCents: api(x.rentCents),
    taxCents: api(tax.mriTax(x.rentCents)),
  });

  async function detailIn(
    tx: Tx,
    clientLandlordId: string,
    period: string,
  ): Promise<z.infer<typeof MriDetail>> {
    const { landlords, byLandlord } = await summarise(tx, period, [clientLandlordId]);
    const head = landlords[0];
    if (!head) throw AppError.notFound('Landlord');
    return {
      ...head,
      period,
      dueOn: tax.mriDueDate(period),
      lines: (byLandlord.get(clientLandlordId) ?? [])
        .filter((x) => x.receivedCents > 0n)
        .map(toLine),
    };
  }

  return {
    async month(ctx: Ctx, period: string, scope?: string): Promise<z.infer<typeof MriMonth>> {
      return inTenant(db, ctx, async (tx) => ({
        period,
        dueOn: tax.mriDueDate(period),
        rateBps: tax.MRI_RATE_BPS,
        landlords: (await summarise(tx, period, scope ? [scope] : undefined)).landlords,
      }));
    },

    async detail(ctx: Ctx, clientLandlordId: string, period: string) {
      return inTenant(db, ctx, (tx) => detailIn(tx, clientLandlordId, period));
    },

    async file(ctx: Ctx, clientLandlordId: string, body: z.infer<typeof FileMriBody>) {
      return inTenant(db, ctx, async (tx) => {
        const d = await detailIn(tx, clientLandlordId, body.period);
        const [row] = await tx
          .insert(mf)
          .values({
            id: uuidv7(),
            orgId: ctx.orgId,
            clientLandlordId,
            period: time.monthStart(body.period),
            rentCents: BigInt(d.rentCents),
            taxCents: BigInt(d.taxCents),
            filedOn: body.filedOn,
            kraReference: body.kraReference || null,
            details: d.lines,
            filedBy: ctx.userId ?? null,
          })
          .onConflictDoNothing()
          .returning();
        if (!row)
          throw AppError.conflict(
            'already_filed',
            'This month is already marked filed for the landlord.',
          );
        await record(tx, ctx, {
          action: 'mri.filed',
          entityType: 'client_landlord',
          entityId: clientLandlordId,
          diff: { period: body.period, taxCents: d.taxCents, kraReference: body.kraReference },
        });
        return detailIn(tx, clientLandlordId, body.period);
      });
    },

    async unfile(ctx: Ctx, filingId: string) {
      return inTenant(db, ctx, async (tx) => {
        const [row] = await tx.delete(mf).where(eq(mf.id, filingId)).returning();
        if (!row) throw AppError.notFound('Filing');
        await record(tx, ctx, {
          action: 'mri.unfiled',
          entityType: 'client_landlord',
          entityId: row.clientLandlordId,
          diff: { period: row.period },
        });
      });
    },

    /** eRITS-ready CSV: one row per tenant with rent received in the month. */
    async eritsCsv(ctx: Ctx, clientLandlordId: string, period: string) {
      const d = await this.detail(ctx, clientLandlordId, period);
      const rows = d.lines.map((l) => [
        l.tenantKraPin,
        l.tenantName,
        l.unitCode,
        l.propertyName,
        kes(BigInt(l.rentCents)),
        kes(BigInt(l.taxCents)),
      ]);
      rows.push(['', 'TOTAL', '', '', kes(BigInt(d.rentCents)), kes(BigInt(d.taxCents))]);
      return toCsv(
        ['Tenant PIN', 'Tenant name', 'Unit', 'Property', 'Rent received (KES)', 'MRI 7.5% (KES)'],
        rows,
      );
    },

    async pinRegister(ctx: Ctx): Promise<z.infer<typeof TenantPinRegister>> {
      return inTenant(db, ctx, async (tx) => {
        const leases = (await leasing.leaseTaxInputs(tx)).filter((l) => l.status === 'active');
        const units = await accounts.unitsById(
          tx,
          leases.map((l) => l.unitId),
        );
        const byTenant = new Map<
          string,
          { tenantId: string; fullName: string; kraPin: string | null; unitCodes: string[] }
        >();
        for (const l of leases) {
          const t = byTenant.get(l.tenantId) ?? {
            tenantId: l.tenantId,
            fullName: l.tenantName,
            kraPin: l.tenantKraPin,
            unitCodes: [],
          };
          t.unitCodes.push(units.get(l.unitId)?.code ?? '');
          byTenant.set(l.tenantId, t);
        }
        const items = [...byTenant.values()].sort(
          (a, b) =>
            Number(a.kraPin !== null) - Number(b.kraPin !== null) ||
            a.fullName.localeCompare(b.fullName),
        );
        return { total: items.length, missing: items.filter((i) => !i.kraPin).length, items };
      });
    },

    /** For reminders: landlords owing MRI for `period` that have not marked it filed. */
    async unfiled(ctx: Ctx, period: string) {
      const m = await this.month(ctx, period);
      return m.landlords.filter((l) => l.band === 'eligible' && l.taxCents > 0 && !l.filing);
    },
  };
}

export type Mri = ReturnType<typeof createMri>;

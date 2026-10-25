import type {
  CollectionsReport,
  OccupancyReport,
  OwnerDashboard,
  OwnerStatement,
  OwnerStatementList,
  RentRoll,
} from '@kejasha/contracts';
import { money, time } from '@kejasha/core';
import { and, eq, inArray, schema, sql, type Tx } from '@kejasha/db';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { inTenant, type Ctx } from '../../lib/ctx';
import * as accounts from '../accounts';
import * as leasing from '../leasing';
import * as maintenance from '../maintenance';
import * as payments from '../payments';
import * as shortstay from '../shortstay';

const { reportCollectionEntry: rce, organization: org } = schema;
const api = (v: bigint) => money.toApiInt(v);
type Entry = typeof rce.$inferSelect;

export interface Scope {
  /** null = every landlord of the org. */
  landlords: accounts.LandlordInfo[];
  limitedTo: accounts.LandlordInfo | null;
  properties: accounts.PropertyInfo[];
}

/**
 * Reporting (B5): read-only views over other modules — ledger collections through the
 * `report_collection_entry` view it owns, everything else through module indexes. Viewers are
 * limited to their landlord (ctx.scope); others may filter by clientLandlordId.
 */
export function createReporting(deps: AppDeps) {
  const { db, clock } = deps;
  const shortStay = shortstay.createShortStay(deps);

  async function scopeOf(tx: Tx, ctx: Ctx, requested?: string): Promise<Scope> {
    if (ctx.scope && requested && requested !== ctx.scope) throw AppError.notFound('Landlord');
    const id = ctx.scope ?? requested;
    const landlords = await accounts.landlords(tx, id ? [id] : undefined);
    if (id && !landlords.length) throw AppError.notFound('Landlord');
    const properties = (await accounts.propertiesOf(tx)).filter(
      (p) => !id || p.clientLandlordId === id,
    );
    return { landlords, limitedTo: id ? landlords[0]! : null, properties };
  }

  async function entries(tx: Tx, from: string, to: string, landlordIds?: string[]) {
    return tx
      .select()
      .from(rce)
      .where(
        and(
          sql`${rce.occurredOn} BETWEEN ${from}::date AND ${to}::date`,
          landlordIds ? inArray(rce.clientLandlordId, landlordIds) : undefined,
        ),
      );
  }

  function fee(l: accounts.LandlordInfo, income: bigint): bigint {
    if (l.mgmtFee.kind === 'percent' && income > 0n)
      return money.applyBps(income, l.mgmtFee.bps ?? 0);
    if (l.mgmtFee.kind === 'flat') return l.mgmtFee.flatCents ?? 0n;
    return 0n;
  }

  /** Totals and details for one landlord and month. */
  async function statementIn(tx: Tx, l: accounts.LandlordInfo, period: string) {
    const from = time.monthStart(period);
    const to = time.monthEnd(period);
    const rows = await entries(tx, from, to, [l.id]);
    const props = (await accounts.propertiesOf(tx, l.id)).map((p) => p.id);
    const expenses = await shortstay.expensesIn(tx, props, from, to);
    const income = rows.reduce((s, r) => s + r.amountCents, 0n);
    const spent = expenses.reduce((s, e) => s + e.amountCents, 0n);
    const f = fee(l, income);
    return { from, to, rows, expenses, income, spent, fee: f, net: income - spent - f };
  }

  async function orgName(orgId: string) {
    const [row] = await db.owner
      .select({ name: org.name, kind: org.kind })
      .from(org)
      .where(eq(org.id, orgId));
    return row;
  }

  async function rentRollIn(tx: Tx, scope: Scope, asOf: string, propertyId?: string) {
    const props = scope.properties.filter(
      (p) => !p.archived && (!propertyId || p.id === propertyId),
    );
    const units = (
      await accounts.unitsOfProperties(
        tx,
        props.map((p) => p.id),
      )
    ).filter((u) => u.mode === 'long_term' && !u.archived);
    const leases = await leasing.rentRollLeases(
      tx,
      units.map((u) => u.id),
      asOf,
    );
    const byUnit = new Map(leases.map((l) => [l.unitId, l]));
    const items = units.map((u) => {
      const l = byUnit.get(u.id);
      return {
        unitId: u.id,
        unitCode: u.code,
        propertyName: u.propertyName,
        status: l ? ('occupied' as const) : ('vacant' as const),
        leaseId: l?.leaseId ?? null,
        tenantName: l?.tenantName ?? null,
        rentCents: api(l ? l.currentRentCents : (u.rentCents ?? 0n)),
        leaseStart: l?.startDate ?? null,
        leaseEnd: l?.endDate ?? null,
        balanceCents: api(l?.balanceCents ?? 0n),
      };
    });
    const occupied = items.filter((i) => i.status === 'occupied');
    return {
      asOf,
      items,
      totals: {
        units: items.length,
        occupied: occupied.length,
        occupancyBps: items.length ? Math.round((occupied.length * 10_000) / items.length) : 0,
        rentCents: occupied.reduce((s, i) => s + i.rentCents, 0),
        balanceCents: items.reduce((s, i) => s + i.balanceCents, 0),
      },
    };
  }

  async function shortStayOccupancy(ctx: Ctx, scope: Scope, period: string) {
    const ids = new Set(scope.properties.map((p) => p.id));
    const report = await shortStay.service.report({ ...ctx, scope: undefined }, period);
    const units = await inTenant(db, ctx, (tx) =>
      accounts.unitsById(
        tx,
        report.units.map((u) => u.unitId),
      ),
    );
    const mine = report.units.filter((u) => ids.has(units.get(u.unitId)?.propertyId ?? ''));
    const nightsSold = mine.reduce((s, u) => s + u.nightsSold, 0);
    const availableNights = mine.reduce((s, u) => s + u.availableNights, 0);
    return {
      units: mine.length,
      nightsSold,
      availableNights,
      occupancyBps: availableNights ? Math.round((nightsSold * 10_000) / availableNights) : 0,
    };
  }

  return {
    scopeOf,
    entries,

    async statements(
      ctx: Ctx,
      period: string,
      landlordId?: string,
    ): Promise<z.infer<typeof OwnerStatementList>> {
      return inTenant(db, ctx, async (tx) => {
        const scope = await scopeOf(tx, ctx, landlordId);
        const items = [];
        for (const l of scope.landlords.filter((x) => !x.archived || scope.limitedTo)) {
          const s = await statementIn(tx, l, period);
          items.push({
            clientLandlordId: l.id,
            landlordName: l.name,
            incomeCents: api(s.income),
            expensesCents: api(s.spent),
            managementFeeCents: api(s.fee),
            netCents: api(s.net),
          });
        }
        return { period, items };
      });
    },

    async statement(
      ctx: Ctx,
      landlordId: string,
      period: string,
    ): Promise<z.infer<typeof OwnerStatement>> {
      const o = await orgName(ctx.orgId);
      return inTenant(db, ctx, async (tx) => {
        const scope = await scopeOf(tx, ctx, landlordId);
        const l = scope.limitedTo!;
        const s = await statementIn(tx, l, period);
        const units = await accounts.unitsById(tx, [
          ...s.rows.map((r) => r.unitId),
          ...s.expenses.map((e) => e.unitId).filter((x): x is string => Boolean(x)),
        ]);
        const props = await accounts.propertiesById(
          tx,
          s.expenses.map((e) => e.propertyId),
        );
        const perUnit = new Map<string, { received: bigint; payments: number }>();
        for (const r of s.rows) {
          const u = perUnit.get(r.unitId) ?? { received: 0n, payments: 0 };
          u.received += r.amountCents;
          u.payments += r.source === 'payment' ? 1 : -1;
          perUnit.set(r.unitId, u);
        }
        return {
          period,
          from: s.from,
          to: s.to,
          clientLandlordId: l.id,
          landlordName: l.name,
          managedBy: o?.kind === 'agency' && !l.isSelf ? o.name : null,
          managementFee: {
            kind: l.mgmtFee.kind,
            bps: l.mgmtFee.bps,
            flatCents: l.mgmtFee.flatCents === null ? null : api(l.mgmtFee.flatCents),
          },
          incomeCents: api(s.income),
          expensesCents: api(s.spent),
          managementFeeCents: api(s.fee),
          netCents: api(s.net),
          income: [...perUnit.entries()]
            .map(([unitId, v]) => ({
              unitId,
              unitCode: units.get(unitId)?.code ?? '',
              propertyName: units.get(unitId)?.propertyName ?? '',
              payments: v.payments,
              receivedCents: api(v.received),
            }))
            .sort(
              (a, b) =>
                a.propertyName.localeCompare(b.propertyName) ||
                a.unitCode.localeCompare(b.unitCode),
            ),
          expenses: s.expenses.map((e) => ({
            id: e.id,
            incurredOn: e.incurredOn,
            propertyName: props.get(e.propertyId)?.name ?? '',
            unitCode: e.unitId ? (units.get(e.unitId)?.code ?? null) : null,
            category: e.category,
            description: e.description,
            amountCents: api(e.amountCents),
          })),
        };
      });
    },

    async rentRoll(
      ctx: Ctx,
      q: {
        asOf?: string | undefined;
        propertyId?: string | undefined;
        clientLandlordId?: string | undefined;
      },
    ): Promise<z.infer<typeof RentRoll>> {
      return inTenant(db, ctx, async (tx) =>
        rentRollIn(
          tx,
          await scopeOf(tx, ctx, q.clientLandlordId),
          q.asOf ?? clock.today(),
          q.propertyId,
        ),
      );
    },

    async collections(
      ctx: Ctx,
      q: { from: string; to: string; clientLandlordId?: string | undefined },
    ): Promise<z.infer<typeof CollectionsReport>> {
      if (q.to < q.from || time.diffDays(q.from, q.to) > 366)
        throw AppError.unprocessable('invalid_range', 'Use a range of up to one year.');
      return inTenant(db, ctx, async (tx) => {
        const scope = await scopeOf(tx, ctx, q.clientLandlordId);
        const rows = await entries(
          tx,
          q.from,
          q.to,
          scope.landlords.map((l) => l.id),
        );
        const info = await payments.paymentsInfo(
          tx,
          rows.map((r) => r.paymentId).filter((x): x is string => Boolean(x)),
        );
        const props = await accounts.propertiesById(
          tx,
          rows.map((r) => r.propertyId),
        );
        const group = (key: (r: Entry) => string) => {
          const m = new Map<string, { amountCents: bigint; count: number }>();
          for (const r of rows) {
            const k = key(r);
            const g = m.get(k) ?? { amountCents: 0n, count: 0 };
            g.amountCents += r.amountCents;
            g.count += r.source === 'payment' ? 1 : -1;
            m.set(k, g);
          }
          return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
        };
        const asBuckets = (g: ReturnType<typeof group>) =>
          g.map(([key, v]) => ({ key, amountCents: api(v.amountCents), count: v.count }));
        return {
          from: q.from,
          to: q.to,
          totalCents: api(rows.reduce((s, r) => s + r.amountCents, 0n)),
          count: rows.reduce((n, r) => n + (r.source === 'payment' ? 1 : -1), 0),
          byDay: group((r) => r.occurredOn).map(([date, v]) => ({
            date,
            amountCents: api(v.amountCents),
            count: v.count,
          })),
          byMethod: asBuckets(group((r) => info.get(r.paymentId ?? '')?.method ?? 'other')),
          bySource: asBuckets(group((r) => info.get(r.paymentId ?? '')?.source ?? 'other')),
          byProperty: group((r) => r.propertyId).map(([key, v]) => ({
            key,
            propertyName: props.get(key)?.name ?? '',
            amountCents: api(v.amountCents),
            count: v.count,
          })),
        };
      });
    },

    async occupancy(
      ctx: Ctx,
      period: string,
      landlordId?: string,
    ): Promise<z.infer<typeof OccupancyReport>> {
      const today = clock.today();
      const at = time.monthEnd(period) < today ? time.monthEnd(period) : today;
      const { scope, roll } = await inTenant(db, ctx, async (tx) => {
        const scope = await scopeOf(tx, ctx, landlordId);
        return { scope, roll: await rentRollIn(tx, scope, at) };
      });
      return {
        period,
        longTerm: {
          units: roll.totals.units,
          occupied: roll.totals.occupied,
          occupancyBps: roll.totals.occupancyBps,
        },
        shortStay: await shortStayOccupancy(ctx, scope, period),
      };
    },

    async dashboard(
      ctx: Ctx,
      period: string,
      landlordId?: string,
    ): Promise<z.infer<typeof OwnerDashboard>> {
      const today = clock.today();
      const base = await inTenant(db, ctx, async (tx) => {
        const scope = await scopeOf(tx, ctx, landlordId);
        const live = scope.landlords.filter((l) => !l.archived || scope.limitedTo);
        const months = Array.from({ length: 6 }, (_, i) => time.addPeriods(period, i - 5));
        const trend = [];
        for (const m of months) {
          let collected = 0n;
          let spent = 0n;
          let fees = 0n;
          for (const l of live) {
            const s = await statementIn(tx, l, m);
            collected += s.income;
            spent += s.spent;
            fees += s.fee;
          }
          trend.push({ period: m, collected, spent, fees });
        }
        const roll = await rentRollIn(tx, scope, today);
        const tickets = await maintenance.activeTicketCount(
          tx,
          scope.properties.map((p) => p.id),
        );
        return { scope, trend, roll, tickets };
      });
      const now = base.trend.at(-1)!;
      const ss = await shortStayOccupancy(ctx, base.scope, period);
      return {
        period,
        landlordName: base.scope.limitedTo?.name ?? null,
        collectedCents: api(now.collected),
        expensesCents: api(now.spent),
        managementFeeCents: api(now.fees),
        netCents: api(now.collected - now.spent - now.fees),
        arrearsCents: base.roll.items.reduce((s, i) => s + Math.max(i.balanceCents, 0), 0),
        longTermOccupancyBps: base.roll.totals.occupancyBps,
        shortStayOccupancyBps: ss.occupancyBps,
        activeTickets: base.tickets,
        trend: base.trend.map((t) => ({
          period: t.period,
          collectedCents: api(t.collected),
          expensesCents: api(t.spent),
          netCents: api(t.collected - t.spent - t.fees),
        })),
      };
    },

    orgName,
  };
}

export type Reporting = ReturnType<typeof createReporting>;

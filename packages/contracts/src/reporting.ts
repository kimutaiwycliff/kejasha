import { z } from 'zod';
import { Cents, IdInput, IsoDate, BusinessDateInput } from './common';
import { PeriodInput } from './compliance';
import { ExpenseCategory } from './shortstay';

const LandlordFilter = {
  clientLandlordId: IdInput.optional().meta({
    description: 'One landlord only (viewers are always limited to their own)',
  }),
};

// ── Owner statements ───────────────────────────────────────────────────────────────────────
const statementTotals = {
  incomeCents: Cents.meta({
    description: 'Money received in the month (ledger payment entries, net of reversals)',
  }),
  expensesCents: Cents,
  managementFeeCents: Cents,
  netCents: Cents.meta({ description: 'income − expenses − management fee' }),
};
export const OwnerStatementSummary = z
  .object({ clientLandlordId: z.uuid(), landlordName: z.string(), ...statementTotals })
  .meta({ id: 'OwnerStatementSummary' });
export const OwnerStatementList = z
  .object({ period: z.string(), items: z.array(OwnerStatementSummary) })
  .meta({ id: 'OwnerStatementList' });

export const OwnerStatement = z
  .object({
    period: z.string(),
    from: IsoDate,
    to: IsoDate,
    clientLandlordId: z.uuid(),
    landlordName: z.string(),
    managedBy: z.string().nullable().meta({ description: 'Agency name for client landlords' }),
    managementFee: z.object({
      kind: z.enum(['none', 'percent', 'flat']),
      bps: z.int().nullable(),
      flatCents: Cents.nullable(),
    }),
    ...statementTotals,
    income: z.array(
      z.object({
        unitId: z.uuid(),
        unitCode: z.string(),
        propertyName: z.string(),
        payments: z.int(),
        receivedCents: Cents,
      }),
    ),
    expenses: z.array(
      z.object({
        id: z.uuid(),
        incurredOn: IsoDate,
        propertyName: z.string(),
        unitCode: z.string().nullable(),
        category: ExpenseCategory,
        description: z.string().nullable(),
        amountCents: Cents,
      }),
    ),
  })
  .meta({ id: 'OwnerStatement' });
export const OwnerStatementQuery = z.object({ period: PeriodInput, ...LandlordFilter });
export const StatementParams = z.object({ clientLandlordId: IdInput });
export const StatementPeriodQuery = z.object({ period: PeriodInput });

// ── Reports ────────────────────────────────────────────────────────────────────────────────
export const RentRoll = z
  .object({
    asOf: IsoDate,
    items: z.array(
      z.object({
        unitId: z.uuid(),
        unitCode: z.string(),
        propertyName: z.string(),
        status: z.enum(['occupied', 'vacant']),
        leaseId: z.uuid().nullable(),
        tenantName: z.string().nullable(),
        rentCents: Cents.meta({ description: 'Current rent (asking rent when vacant)' }),
        leaseStart: IsoDate.nullable(),
        leaseEnd: IsoDate.nullable(),
        balanceCents: Cents,
      }),
    ),
    totals: z.object({
      units: z.int(),
      occupied: z.int(),
      occupancyBps: z.int(),
      rentCents: Cents.meta({ description: 'Rent of occupied units' }),
      balanceCents: Cents,
    }),
  })
  .meta({ id: 'RentRoll' });
export const RentRollQuery = z.object({
  asOf: BusinessDateInput.optional().meta({ description: 'Defaults to today' }),
  propertyId: IdInput.optional(),
  ...LandlordFilter,
});

const bucket = z.object({ key: z.string(), amountCents: Cents, count: z.int() });
export const CollectionsReport = z
  .object({
    from: IsoDate,
    to: IsoDate,
    totalCents: Cents,
    count: z.int(),
    byDay: z.array(z.object({ date: IsoDate, amountCents: Cents, count: z.int() })),
    byMethod: z.array(bucket),
    bySource: z.array(bucket),
    byProperty: z.array(bucket.extend({ propertyName: z.string() })),
  })
  .meta({
    id: 'CollectionsReport',
    description: 'Money matched to leases and bookings (ledger), by date received',
  });
export const DateRangeQuery = z.object({
  from: BusinessDateInput,
  to: BusinessDateInput,
  ...LandlordFilter,
});

export const OccupancyReport = z
  .object({
    period: z.string(),
    longTerm: z.object({ units: z.int(), occupied: z.int(), occupancyBps: z.int() }),
    shortStay: z.object({
      units: z.int(),
      nightsSold: z.int(),
      availableNights: z.int(),
      occupancyBps: z.int(),
    }),
  })
  .meta({
    id: 'OccupancyReport',
    description: 'Long-term: units let at month end. Short-stay: nights sold.',
  });
export const PeriodLandlordQuery = z.object({ period: PeriodInput, ...LandlordFilter });

export const OwnerDashboard = z
  .object({
    period: z.string(),
    landlordName: z.string().nullable().meta({ description: 'Set when limited to one landlord' }),
    collectedCents: Cents,
    expensesCents: Cents,
    managementFeeCents: Cents,
    netCents: Cents,
    arrearsCents: Cents.meta({ description: 'Owed by current tenants now' }),
    longTermOccupancyBps: z.int(),
    shortStayOccupancyBps: z.int(),
    activeTickets: z.int(),
    trend: z.array(
      z.object({
        period: z.string(),
        collectedCents: Cents,
        expensesCents: Cents,
        netCents: Cents,
      }),
    ),
  })
  .meta({ id: 'OwnerDashboard', description: 'Read-only overview for owners (and viewers)' });

// ── CSV exports ────────────────────────────────────────────────────────────────────────────
export const ExportDataset = z
  .enum([
    'rent-roll',
    'collections',
    'payments',
    'unit-expenses',
    'bookings',
    'tickets',
    'tenants',
    'arrears',
  ])
  .meta({
    id: 'ExportDataset',
    description: 'Viewers may export rent-roll, collections and unit-expenses',
  });
export const ExportParams = z.object({ dataset: ExportDataset });
export const ExportQuery = z.object({
  from: BusinessDateInput.optional().meta({
    description: 'Date-ranged datasets; defaults to this month',
  }),
  to: BusinessDateInput.optional(),
  ...LandlordFilter,
});

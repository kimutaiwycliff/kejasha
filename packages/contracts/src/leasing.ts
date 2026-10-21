import { z } from 'zod';
import {
  Cents,
  CursorQuery,
  IdInput,
  pageOf,
  RequiredTextInput,
  SafeString,
  TextInput,
  BusinessDateInput,
} from './common';
import { Email, KraPin, Phone, PhoneInput } from './kenya';

const Timestamp = z.iso.datetime({ offset: true });
const IsoDate = z.iso.date();
const PeriodString = z
  .string()
  .regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM (1900–2199)')
  .meta({ example: '2026-11' });
const booleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');
const PositiveCents = Cents.min(0);

export const Aging = z
  .object({
    current: Cents,
    d1_30: Cents,
    d31_60: Cents,
    d61_90: Cents,
    d90_plus: Cents,
    total: Cents,
  })
  .meta({ id: 'Aging', description: 'Outstanding amounts by days past due (cents)' });

// ── Tenants ─────────────────────────────────────────────────────────────────────────────────
export const Tenant = z
  .object({
    id: z.uuid(),
    fullName: z.string(),
    phone: Phone.nullable(),
    email: z.string().nullable(),
    nationalId: z.string().nullable(),
    kraPin: z.string().nullable(),
    nextOfKinName: z.string().nullable(),
    nextOfKinPhone: Phone.nullable(),
    notes: z.string().nullable(),
    activeLeaseCount: z.int(),
    balanceCents: Cents.meta({ description: 'Sum of lease balances; negative = tenant credit' }),
    archivedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Tenant' });
export const TenantPage = pageOf(Tenant, 'Tenant');

const NationalId = z
  .string()
  .regex(/^[A-Za-z0-9]{4,20}$/, 'National ID / passport: 4–20 letters or digits');

export const CreateTenantBody = z
  .object({
    fullName: RequiredTextInput(120),
    phone: PhoneInput.optional(),
    email: Email.optional(),
    nationalId: NationalId.optional(),
    kraPin: KraPin.optional(),
    nextOfKinName: TextInput(120).optional(),
    nextOfKinPhone: PhoneInput.optional(),
    notes: TextInput(2000).optional(),
  })
  .meta({ id: 'CreateTenantBody' });

export const UpdateTenantBody = z
  .object({
    fullName: RequiredTextInput(120).optional(),
    phone: PhoneInput.nullable().optional(),
    email: Email.nullable().optional(),
    nationalId: NationalId.nullable().optional(),
    kraPin: KraPin.nullable().optional(),
    nextOfKinName: TextInput(120).nullable().optional(),
    nextOfKinPhone: PhoneInput.nullable().optional(),
    notes: TextInput(2000).nullable().optional(),
  })
  .meta({ id: 'UpdateTenantBody' });

export const TenantQuery = CursorQuery.extend({
  q: TextInput(120).optional(),
  includeArchived: booleanQuery,
});

// ── Charges ─────────────────────────────────────────────────────────────────────────────────
export const ChargeKind = z
  .enum(['service_charge', 'garbage', 'water', 'electricity', 'security', 'other'])
  .meta({ id: 'ChargeKind' });
export const ChargeMethod = z.enum(['flat', 'metered']).meta({ id: 'ChargeMethod' });

export const ChargeRule = z
  .object({
    id: z.uuid(),
    leaseId: z.uuid(),
    kind: ChargeKind,
    label: z.string(),
    method: ChargeMethod,
    amountCents: Cents.nullable(),
    unitPriceCents: Cents.nullable(),
    meterId: z.uuid().nullable(),
    startsOn: IsoDate,
    endsOn: IsoDate.nullable(),
  })
  .meta({ id: 'ChargeRule' });
export const ChargeRuleList = z
  .object({ items: z.array(ChargeRule) })
  .meta({ id: 'ChargeRuleList' });

export const CHARGE_RULE =
  'flat charges need amountCents; metered charges need unitPriceCents and a meterId on the same unit (422 invalid_charge)';
export const CreateChargeBody = z
  .object({
    kind: ChargeKind,
    label: TextInput(80).optional(),
    method: ChargeMethod,
    amountCents: PositiveCents.optional().meta({
      description: 'Flat: full-month amount, prorated like rent',
    }),
    unitPriceCents: PositiveCents.optional().meta({
      description: 'Metered: cents per whole unit (m³, kWh)',
    }),
    meterId: IdInput.optional(),
    startsOn: BusinessDateInput.optional().meta({ description: 'Defaults to the lease start' }),
    endsOn: BusinessDateInput.optional(),
  })
  .meta({ id: 'CreateChargeBody', description: CHARGE_RULE });

export const UpdateChargeBody = z
  .object({
    label: TextInput(80).optional(),
    amountCents: PositiveCents.optional(),
    unitPriceCents: PositiveCents.optional(),
    endsOn: BusinessDateInput.nullable().optional(),
  })
  .meta({ id: 'UpdateChargeBody' });

// ── Leases ──────────────────────────────────────────────────────────────────────────────────
export const LeaseStatus = z
  .enum(['active', 'terminated', 'cancelled'])
  .meta({ id: 'LeaseStatus' });
export const LateFeeKind = z.enum(['none', 'flat', 'percent']).meta({ id: 'LateFeeKind' });

const leaseFields = {
  id: z.uuid(),
  unitId: z.uuid(),
  unitCode: z.string(),
  propertyId: z.uuid(),
  propertyName: z.string(),
  tenantId: z.uuid(),
  tenantName: z.string(),
  startDate: IsoDate,
  endDate: IsoDate.nullable(),
  status: LeaseStatus,
  rentCents: Cents.meta({ description: 'Rent at lease start' }),
  currentRentCents: Cents.meta({
    description: 'Rent for the current month after steps and escalation',
  }),
  depositCents: Cents,
  billingDay: z.int(),
  escalationBps: z.int().nullable(),
  escalationEveryMonths: z.int().nullable(),
  nextEscalationPeriod: z.string().nullable(),
  lateFeeKind: LateFeeKind,
  lateFeeFlatCents: Cents.nullable(),
  lateFeeBps: z.int().nullable(),
  lateFeeGraceDays: z.int(),
  notes: z.string().nullable(),
  balanceCents: Cents.meta({ description: 'Receivable balance; negative = tenant credit' }),
  depositHeldCents: Cents,
  terminatedAt: Timestamp.nullable(),
  terminationReason: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
};
export const Lease = z.object(leaseFields).meta({ id: 'Lease' });
export const LeasePage = pageOf(Lease, 'Lease');
export const RentStepDto = z
  .object({ effectivePeriod: z.string(), rentCents: Cents })
  .meta({ id: 'RentStep' });
export const LeaseDetail = z
  .object({
    ...leaseFields,
    charges: z.array(ChargeRule),
    rentSteps: z.array(RentStepDto),
    arrears: Aging,
  })
  .meta({ id: 'LeaseDetail' });

export const LEASE_TERMS_RULE =
  'escalationBps and escalationEveryMonths go together; lateFeeKind flat needs lateFeeFlatCents, percent needs lateFeeBps (422 invalid_lease_terms)';

const leaseTerms = {
  billingDay: z
    .int()
    .min(1)
    .max(31)
    .optional()
    .meta({ description: 'Day rent falls due (clamped to month end). Default 1.' }),
  escalationBps: z
    .int()
    .min(1)
    .max(10_000)
    .optional()
    .meta({ description: 'Compounding rent increase, e.g. 500 = 5%' }),
  escalationEveryMonths: z.int().min(1).max(120).optional(),
  lateFeeKind: LateFeeKind.optional(),
  lateFeeFlatCents: Cents.min(1).optional(),
  lateFeeBps: z.int().min(1).max(10_000).optional(),
  lateFeeGraceDays: z.int().min(0).max(60).optional(),
};

export const CreateLeaseBody = z
  .object({
    unitId: IdInput,
    tenantId: IdInput,
    startDate: BusinessDateInput,
    endDate: BusinessDateInput.optional().meta({
      description: 'Inclusive last day; omit for an open-ended tenancy',
    }),
    rentCents: PositiveCents,
    depositCents: PositiveCents.optional(),
    ...leaseTerms,
    charges: z.array(CreateChargeBody).max(20).optional(),
    notes: TextInput(2000).optional(),
  })
  .meta({
    id: 'CreateLeaseBody',
    description: `Creates the lease, invoices the deposit and bills every period already due. ${LEASE_TERMS_RULE}. Overlapping a unit's existing lease answers 409 lease_overlap.`,
  });

export const UpdateLeaseBody = z
  .object({ ...leaseTerms, notes: TextInput(2000).nullable().optional() })
  .meta({
    id: 'UpdateLeaseBody',
    description: `Applies to invoices not yet issued. ${LEASE_TERMS_RULE}`,
  });

export const RentChangeBody = z
  .object({ effectivePeriod: PeriodString, rentCents: PositiveCents })
  .meta({
    id: 'RentChangeBody',
    description: 'New rent from a future (not yet invoiced) month; escalation restarts from it',
  });

export const RenewLeaseBody = z
  .object({
    endDate: BusinessDateInput.nullable().meta({
      description: 'New inclusive end date, or null for open-ended',
    }),
    rentCents: PositiveCents.optional(),
    rentEffectivePeriod: PeriodString.optional(),
  })
  .meta({ id: 'RenewLeaseBody' });

export const TerminateLeaseBody = z
  .object({ endDate: BusinessDateInput, reason: RequiredTextInput(500) })
  .meta({
    id: 'TerminateLeaseBody',
    description: 'Ends the lease; later invoices are voided and the final month is prorated',
  });

export const CancelLeaseBody = z
  .object({ reason: RequiredTextInput(500) })
  .meta({ id: 'CancelLeaseBody' });

export const LeaseQuery = CursorQuery.extend({
  status: LeaseStatus.optional(),
  unitId: IdInput.optional(),
  tenantId: IdInput.optional(),
  propertyId: IdInput.optional(),
});

export const LeaseCalendarQuery = z.object({ from: BusinessDateInput, to: BusinessDateInput });
export const LeaseCalendarEvent = z
  .object({
    kind: z.enum(['lease_end', 'escalation']),
    date: IsoDate,
    leaseId: z.uuid(),
    unitCode: z.string(),
    tenantName: z.string(),
    rentCents: Cents.nullable().meta({ description: 'New rent for escalations' }),
  })
  .meta({ id: 'LeaseCalendarEvent' });
export const LeaseCalendar = z
  .object({ items: z.array(LeaseCalendarEvent) })
  .meta({ id: 'LeaseCalendar' });

// ── Meters ──────────────────────────────────────────────────────────────────────────────────
export const MeterKind = z.enum(['water', 'electricity']).meta({ id: 'MeterKind' });
const ReadingValue = z
  .string()
  .regex(/^\d{1,11}(\.\d{1,3})?$/, 'Reading like 1234.567 (max 3 decimals)')
  .meta({ description: 'Decimal reading as a string (no float rounding)', example: '1234.5' });

export const MeterReading = z
  .object({
    id: z.uuid(),
    meterId: z.uuid(),
    readOn: IsoDate,
    reading: z.string(),
    consumptionSincePrevious: z.string().nullable(),
    note: z.string().nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'MeterReading' });
export const MeterReadingList = z
  .object({ items: z.array(MeterReading) })
  .meta({ id: 'MeterReadingList' });

export const Meter = z
  .object({
    id: z.uuid(),
    unitId: z.uuid(),
    unitCode: z.string(),
    kind: MeterKind,
    serial: z.string().nullable(),
    unitLabel: z.string(),
    lastReading: MeterReading.nullable(),
    archivedAt: Timestamp.nullable(),
  })
  .meta({ id: 'Meter' });
export const MeterList = z.object({ items: z.array(Meter) }).meta({ id: 'MeterList' });

export const CreateMeterBody = z
  .object({
    kind: MeterKind,
    serial: TextInput(60).optional(),
    unitLabel: TextInput(20).optional().meta({ description: 'e.g. m³ or kWh' }),
    initialReading: z.object({ readOn: BusinessDateInput, reading: ReadingValue }).optional(),
  })
  .meta({ id: 'CreateMeterBody' });

export const CreateReadingBody = z
  .object({ readOn: BusinessDateInput, reading: ReadingValue, note: TextInput(500).optional() })
  .meta({
    id: 'CreateReadingBody',
    description: 'Readings cannot go backwards (422 reading_decreased)',
  });

export const BulkReadingsBody = z
  .object({
    items: z
      .array(
        z.object({
          meterId: IdInput,
          readOn: BusinessDateInput,
          reading: ReadingValue,
          note: TextInput(500).optional(),
        }),
      )
      .min(1)
      .max(500),
  })
  .meta({
    id: 'BulkReadingsBody',
    description: 'Caretaker batch; each item succeeds or fails on its own',
  });
export const BulkReadingsResult = z
  .object({
    items: z.array(
      z.object({
        meterId: z.uuid(),
        readOn: IsoDate,
        status: z.enum(['applied', 'rejected']),
        reading: MeterReading.nullable(),
        errorCode: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'BulkReadingsResult' });

// ── Invoices ────────────────────────────────────────────────────────────────────────────────
export const InvoiceKind = z
  .enum(['periodic', 'deposit', 'late_fee', 'manual'])
  .meta({ id: 'InvoiceKind' });
export const InvoiceLineKind = z
  .enum([
    'rent',
    'deposit',
    'service_charge',
    'garbage',
    'water',
    'electricity',
    'security',
    'late_fee',
    'other',
  ])
  .meta({ id: 'InvoiceLineKind' });
export const PaymentStatus = z
  .enum(['unpaid', 'partially_paid', 'paid', 'void'])
  .meta({ id: 'PaymentStatus' });

export const InvoiceLine = z
  .object({
    id: z.uuid(),
    kind: InvoiceLineKind,
    description: z.string(),
    quantity: z.string(),
    unitPriceCents: Cents.nullable(),
    amountCents: Cents,
    periodStart: IsoDate.nullable(),
    periodEnd: IsoDate.nullable(),
  })
  .meta({ id: 'InvoiceLine' });

const invoiceFields = {
  id: z.uuid(),
  number: z.string(),
  leaseId: z.uuid(),
  tenantName: z.string(),
  unitCode: z.string(),
  kind: InvoiceKind,
  period: z.string().nullable(),
  issuedOn: IsoDate,
  dueOn: IsoDate,
  totalCents: Cents,
  outstandingCents: Cents,
  paymentStatus: PaymentStatus,
  voidedAt: Timestamp.nullable(),
  voidReason: z.string().nullable(),
  createdAt: Timestamp,
};
export const Invoice = z.object(invoiceFields).meta({ id: 'Invoice' });
export const InvoiceDetail = z
  .object({ ...invoiceFields, lines: z.array(InvoiceLine) })
  .meta({ id: 'InvoiceDetail' });
export const InvoicePage = pageOf(Invoice, 'Invoice');

export const InvoiceQuery = CursorQuery.extend({
  leaseId: IdInput.optional(),
  tenantId: IdInput.optional(),
  kind: InvoiceKind.optional(),
  period: PeriodString.optional(),
  includeVoid: booleanQuery,
});

export const ManualInvoiceBody = z
  .object({
    dueOn: BusinessDateInput,
    lines: z
      .array(
        z.object({
          kind: z.enum(['service_charge', 'garbage', 'water', 'electricity', 'security', 'other']),
          description: RequiredTextInput(200),
          amountCents: Cents.min(1),
        }),
      )
      .min(1)
      .max(50),
  })
  .meta({ id: 'ManualInvoiceBody' });

export const VoidInvoiceBody = z
  .object({ reason: RequiredTextInput(500) })
  .meta({ id: 'VoidInvoiceBody' });

export const CreditNote = z
  .object({
    id: z.uuid(),
    number: z.string(),
    leaseId: z.uuid(),
    invoiceId: z.uuid().nullable(),
    amountCents: Cents,
    reason: z.string(),
    issuedOn: IsoDate,
    createdAt: Timestamp,
  })
  .meta({ id: 'CreditNote' });
export const CreateCreditNoteBody = z
  .object({
    amountCents: Cents.min(1),
    reason: RequiredTextInput(500),
    invoiceId: IdInput.optional(),
  })
  .meta({ id: 'CreateCreditNoteBody' });

export const StatementLine = z
  .object({
    date: IsoDate,
    source: z.string(),
    reference: z.string().nullable(),
    description: z.string(),
    debitCents: Cents,
    creditCents: Cents,
    balanceCents: Cents,
  })
  .meta({ id: 'StatementLine' });
export const LeaseStatement = z
  .object({
    leaseId: z.uuid(),
    from: IsoDate,
    to: IsoDate,
    openingBalanceCents: Cents,
    closingBalanceCents: Cents,
    items: z.array(StatementLine),
  })
  .meta({ id: 'LeaseStatement' });
export const StatementQuery = z.object({
  from: BusinessDateInput.optional(),
  to: BusinessDateInput.optional(),
});

export const ArrearsItem = z
  .object({
    leaseId: z.uuid(),
    tenantId: z.uuid(),
    tenantName: z.string(),
    tenantPhone: Phone.nullable(),
    unitCode: z.string(),
    propertyName: z.string(),
    oldestDueOn: IsoDate,
    aging: Aging,
  })
  .meta({ id: 'ArrearsItem' });
export const ArrearsReport = z
  .object({ asOf: IsoDate, totals: Aging, items: z.array(ArrearsItem) })
  .meta({ id: 'ArrearsReport' });
export const ArrearsQuery = z.object({ propertyId: IdInput.optional() });

export const BillingRunResult = z
  .object({
    asOf: IsoDate,
    leasesProcessed: z.int(),
    invoicesCreated: z.int(),
    lateFeesCreated: z.int(),
    remindersQueued: z.int(),
  })
  .meta({ id: 'BillingRunResult' });

// ── Deposits & inspections ─────────────────────────────────────────────────────────────────
export const DepositDeduction = z
  .object({ description: RequiredTextInput(200), amountCents: Cents.min(1) })
  .meta({ id: 'DepositDeduction' });
export const DepositSettlementBody = z
  .object({
    deductions: z.array(DepositDeduction).max(50).optional(),
    applyToArrears: z.boolean().optional(),
  })
  .meta({
    id: 'DepositSettlementBody',
    description: 'Deductions → income; then arrears (default yes); remainder → refund due',
  });
export const DepositSettlement = z
  .object({
    id: z.uuid(),
    leaseId: z.uuid(),
    settledOn: IsoDate,
    depositHeldCents: Cents,
    deductionsCents: Cents,
    appliedToArrearsCents: Cents,
    refundDueCents: Cents,
    deductions: z.array(z.object({ description: z.string(), amountCents: Cents })),
  })
  .meta({ id: 'DepositSettlement' });

export const InspectionItem = z
  .object({
    area: RequiredTextInput(80),
    condition: z.enum(['good', 'fair', 'poor', 'damaged']),
    note: TextInput(500).optional(),
    photoKeys: z.array(SafeString(300)).max(10).optional(),
  })
  .meta({ id: 'InspectionItemInput' });
export const CreateInspectionBody = z
  .object({
    kind: z.enum(['move_in', 'move_out']),
    inspectedOn: BusinessDateInput,
    items: z.array(InspectionItem).min(1).max(100),
    notes: TextInput(2000).optional(),
  })
  .meta({
    id: 'CreateInspectionBody',
    description: 'photoKeys come from POST /v1/uploads (422 invalid_photo_key otherwise)',
  });
export const Inspection = z
  .object({
    id: z.uuid(),
    leaseId: z.uuid(),
    kind: z.enum(['move_in', 'move_out']),
    inspectedOn: IsoDate,
    notes: z.string().nullable(),
    items: z.array(
      z.object({
        area: z.string(),
        condition: z.enum(['good', 'fair', 'poor', 'damaged']),
        note: z.string().nullable(),
        photos: z.array(z.object({ key: z.string(), url: z.string() })),
      }),
    ),
    createdAt: Timestamp,
  })
  .meta({ id: 'Inspection' });
export const InspectionList = z
  .object({ items: z.array(Inspection) })
  .meta({ id: 'InspectionList' });

export const UploadRequest = z
  .object({
    purpose: z.enum(['inspection_photo', 'meter_photo', 'maintenance_photo']),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sizeBytes: z
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .meta({ id: 'UploadRequest' });
export const UploadTicket = z
  .object({
    key: z.string(),
    uploadUrl: z.string(),
    method: z.literal('PUT'),
    headers: z.object({ 'content-type': z.string() }),
    expiresAt: Timestamp,
  })
  .meta({
    id: 'UploadTicket',
    description: 'PUT the file bytes to uploadUrl with these headers, then reference `key`',
  });

export const LeaseIdParam = z.object({ leaseId: IdInput });
export const MeterIdParam = z.object({ meterId: IdInput });
export const UnitIdParam = z.object({ unitId: IdInput });

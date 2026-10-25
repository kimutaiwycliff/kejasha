import { z } from 'zod';
import {
  BusinessDateInput,
  Cents,
  FileLink,
  IdInput,
  IsoDate,
  SafeString,
  TextInput,
  Timestamp,
} from './common';

export const PeriodInput = z
  .string()
  .regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
  .meta({ description: 'Calendar month, YYYY-MM' });
export const PeriodQuery = z.object({ period: PeriodInput });

// ── Monthly Rental Income (MRI) ─────────────────────────────────────────────────────────────
export const MriBand = z.enum(['below_threshold', 'eligible', 'above_threshold']).meta({
  id: 'MriBand',
  description:
    'Calendar-year residential rent received vs the KES 288,000–15,000,000 MRI band (above → normal income tax)',
});

export const MriFiling = z
  .object({
    id: z.uuid(),
    filedOn: IsoDate,
    kraReference: z.string().nullable(),
    rentCents: Cents,
    taxCents: Cents,
    differenceCents: Cents.meta({
      description: 'Tax now computed minus tax filed (non-zero when receipts changed after filing)',
    }),
    createdAt: Timestamp,
  })
  .meta({ id: 'MriFiling' });

export const MriLandlord = z
  .object({
    clientLandlordId: z.uuid(),
    name: z.string(),
    isSelf: z.boolean(),
    kraPin: z.string().nullable(),
    rentCents: Cents.meta({ description: 'Residential rent received in the month' }),
    taxCents: Cents.meta({ description: '7.5% of rentCents' }),
    yearToDateRentCents: Cents,
    band: MriBand,
    hasMixedProperties: z
      .boolean()
      .meta({ description: 'Mixed-use properties are included; review them' }),
    tenantsMissingPin: z.int(),
    filing: MriFiling.nullable(),
  })
  .meta({ id: 'MriLandlord' });

export const MriMonth = z
  .object({
    period: z.string(),
    dueOn: IsoDate,
    rateBps: z.int(),
    landlords: z.array(MriLandlord),
  })
  .meta({ id: 'MriMonth' });

export const MriLine = z
  .object({
    leaseId: z.uuid(),
    tenantId: z.uuid(),
    tenantName: z.string(),
    tenantKraPin: z.string().nullable(),
    unitCode: z.string(),
    propertyName: z.string(),
    propertyKind: z.enum(['residential', 'mixed']),
    receivedCents: Cents.meta({ description: 'Money received from this tenant in the month' }),
    rentCents: Cents.meta({
      description: 'Rent portion of it (deposits, service charges, utilities excluded)',
    }),
    taxCents: Cents,
  })
  .meta({ id: 'MriLine' });

export const MriDetail = MriLandlord.extend({
  period: z.string(),
  dueOn: IsoDate,
  lines: z.array(MriLine),
}).meta({ id: 'MriDetail' });

export const LandlordIdParam = z.object({ clientLandlordId: IdInput });
export const FileMriBody = z
  .object({
    period: PeriodInput,
    filedOn: BusinessDateInput,
    kraReference: TextInput(60).optional().meta({ description: 'KRA payment registration number' }),
  })
  .meta({ id: 'FileMriBody', description: 'Snapshots the computed figures (409 already_filed)' });

export const TenantPinRegister = z
  .object({
    total: z.int(),
    missing: z.int(),
    items: z.array(
      z.object({
        tenantId: z.uuid(),
        fullName: z.string(),
        kraPin: z.string().nullable(),
        unitCodes: z.array(z.string()),
      }),
    ),
  })
  .meta({
    id: 'TenantPinRegister',
    description: 'Tenants with an active lease, missing PINs first',
  });

// ── Licences ───────────────────────────────────────────────────────────────────────────────
export const LicenceKind = z
  .enum(['tra_short_stay', 'county_business_permit', 'other'])
  .meta({ id: 'LicenceKind' });
export const LicenceStatus = z
  .enum(['valid', 'expiring', 'expired'])
  .meta({ id: 'LicenceStatus', description: 'expiring = within 30 days' });

export const Licence = z
  .object({
    id: z.uuid(),
    propertyId: z.uuid(),
    propertyName: z.string(),
    unitId: z.uuid().nullable(),
    unitCode: z.string().nullable(),
    kind: LicenceKind,
    number: z.string().nullable(),
    issuer: z.string().nullable(),
    issuedOn: IsoDate.nullable(),
    expiresOn: IsoDate,
    daysToExpiry: z.int(),
    status: LicenceStatus,
    feeCents: Cents.nullable(),
    document: FileLink.nullable(),
    notes: z.string().nullable(),
    archived: z.boolean(),
    createdAt: Timestamp,
  })
  .meta({ id: 'Licence' });
export const LicenceList = z.object({ items: z.array(Licence) }).meta({ id: 'LicenceList' });

const licenceFields = {
  kind: LicenceKind,
  number: TextInput(60).optional(),
  issuer: TextInput(120).optional(),
  issuedOn: BusinessDateInput.optional(),
  expiresOn: BusinessDateInput,
  feeCents: Cents.min(0).optional(),
  documentKey: SafeString(300)
    .optional()
    .meta({ description: 'Key from POST /v1/uploads (purpose licence_document)' }),
  notes: TextInput(1000).optional(),
};
export const CreateLicenceBody = z
  .object({ propertyId: IdInput.optional(), unitId: IdInput.optional(), ...licenceFields })
  .meta({ id: 'CreateLicenceBody', description: 'unitId or propertyId (422 target_required)' });
export const UpdateLicenceBody = z
  .object({
    number: TextInput(60).nullable().optional(),
    issuer: TextInput(120).nullable().optional(),
    issuedOn: BusinessDateInput.nullable().optional(),
    expiresOn: BusinessDateInput.optional(),
    feeCents: Cents.min(0).nullable().optional(),
    documentKey: SafeString(300).nullable().optional(),
    notes: TextInput(1000).nullable().optional(),
  })
  .meta({ id: 'UpdateLicenceBody', description: 'Renewal: set the new expiresOn (and document)' });
export const LicenceQuery = z.object({
  status: LicenceStatus.optional(),
  propertyId: IdInput.optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

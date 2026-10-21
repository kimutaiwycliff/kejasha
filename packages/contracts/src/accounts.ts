import { z } from 'zod';
import {
  Cents,
  CursorQuery,
  IdInput,
  pageOf,
  RequiredTextInput,
  SafeString,
  TextInput,
} from './common';
import { County, Email, KraPin, Phone, PhoneInput } from './kenya';
import { Role } from './identity';

const Timestamp = z.iso.datetime({ offset: true });
const Name = RequiredTextInput(120);
const Notes = TextInput(2000);
const booleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

// ── Client landlords ─────────────────────────────────────────────────────────────────────────
export const MgmtFeeKind = z.enum(['none', 'percent', 'flat']).meta({ id: 'MgmtFeeKind' });

const feeFields = {
  mgmtFeeKind: MgmtFeeKind,
  mgmtFeeBps: z
    .int()
    .min(0)
    .max(10_000)
    .nullable()
    .meta({ description: 'Percent in basis points (10% = 1000)' }),
  mgmtFeeFlatCents: Cents.nullable(),
};

/**
 * Cross-field business rules are checked by the service (422), not the schema: JSON Schema cannot
 * express them, and a schema-valid request must never be answered with 400.
 */
export function feeConsistent(b: {
  mgmtFeeKind?: string;
  mgmtFeeBps?: number | null;
  mgmtFeeFlatCents?: number | null;
}) {
  if (b.mgmtFeeKind === undefined)
    return b.mgmtFeeBps === undefined && b.mgmtFeeFlatCents === undefined;
  if (b.mgmtFeeKind === 'none') return b.mgmtFeeBps == null && b.mgmtFeeFlatCents == null;
  if (b.mgmtFeeKind === 'percent') return b.mgmtFeeBps != null && b.mgmtFeeFlatCents == null;
  return b.mgmtFeeFlatCents != null && b.mgmtFeeBps == null;
}
export const FEE_RULE =
  'percent needs mgmtFeeBps only; flat needs mgmtFeeFlatCents only; none needs neither (send mgmtFeeKind with any fee change)';

export const ClientLandlord = z
  .object({
    id: z.uuid(),
    name: z.string(),
    isSelf: z.boolean().meta({ description: "The org's own implicit landlord (ADR-005)" }),
    phone: Phone.nullable(),
    email: z.string().nullable(),
    kraPin: z.string().nullable(),
    ...feeFields,
    notes: z.string().nullable(),
    propertyCount: z.int(),
    archivedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'ClientLandlord' });
export const ClientLandlordPage = pageOf(ClientLandlord, 'ClientLandlord');

export const CreateClientLandlordBody = z
  .object({
    name: Name,
    phone: PhoneInput.optional(),
    email: Email.optional(),
    kraPin: KraPin.optional(),
    mgmtFeeKind: MgmtFeeKind.default('none'),
    mgmtFeeBps: feeFields.mgmtFeeBps.optional(),
    mgmtFeeFlatCents: feeFields.mgmtFeeFlatCents.optional(),
    notes: Notes.optional(),
  })
  .meta({ id: 'CreateClientLandlordBody', description: FEE_RULE });

export const UpdateClientLandlordBody = z
  .object({
    name: Name.optional(),
    phone: PhoneInput.nullable().optional(),
    email: Email.nullable().optional(),
    kraPin: KraPin.nullable().optional(),
    mgmtFeeKind: MgmtFeeKind.optional(),
    mgmtFeeBps: feeFields.mgmtFeeBps.optional(),
    mgmtFeeFlatCents: feeFields.mgmtFeeFlatCents.optional(),
    notes: Notes.nullable().optional(),
  })
  .meta({ id: 'UpdateClientLandlordBody', description: FEE_RULE });

export const ClientLandlordQuery = CursorQuery.extend({
  q: TextInput(120).optional(),
  includeArchived: booleanQuery,
});

// ── Properties ───────────────────────────────────────────────────────────────────────────────
export const PropertyKind = z
  .enum(['residential', 'commercial', 'mixed'])
  .meta({ id: 'PropertyKind' });

export const UnitCounts = z
  .object({ total: z.int(), longTerm: z.int(), shortStay: z.int() })
  .meta({ id: 'UnitCounts', description: 'Active (non-archived) units' });

export const StaffAssignment = z
  .object({ userId: z.uuid(), name: z.string(), phone: Phone.nullable(), role: Role })
  .meta({ id: 'StaffAssignment' });

const propertyFields = {
  id: z.uuid(),
  clientLandlordId: z.uuid(),
  clientLandlordName: z.string(),
  name: z.string(),
  kind: PropertyKind,
  county: County,
  area: z.string().nullable(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  notes: z.string().nullable(),
  unitCounts: UnitCounts,
  archivedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
};
export const Property = z.object(propertyFields).meta({ id: 'Property' });
export const PropertyDetail = z
  .object({ ...propertyFields, staff: z.array(StaffAssignment) })
  .meta({ id: 'PropertyDetail' });
export const PropertyPage = pageOf(Property, 'Property');

const Latitude = z.number().min(-90).max(90);
const Longitude = z.number().min(-180).max(180);

export const CreatePropertyBody = z
  .object({
    clientLandlordId: IdInput.optional().meta({
      description: "Defaults to the org's own (self) landlord",
    }),
    name: Name,
    kind: PropertyKind.default('residential'),
    county: County,
    area: TextInput(120).optional(),
    address: TextInput(500).optional(),
    latitude: Latitude.optional(),
    longitude: Longitude.optional(),
    notes: Notes.optional(),
  })
  .meta({ id: 'CreatePropertyBody' });

export const UpdatePropertyBody = z
  .object({
    clientLandlordId: IdInput.optional(),
    name: Name.optional(),
    kind: PropertyKind.optional(),
    county: County.optional(),
    area: TextInput(120).nullable().optional(),
    address: TextInput(500).nullable().optional(),
    latitude: Latitude.nullable().optional(),
    longitude: Longitude.nullable().optional(),
    notes: Notes.nullable().optional(),
  })
  .meta({ id: 'UpdatePropertyBody' });

export const PropertyQuery = CursorQuery.extend({
  q: TextInput(120).optional(),
  clientLandlordId: IdInput.optional(),
  includeArchived: booleanQuery,
});

export const SetPropertyStaffBody = z
  .object({ userIds: z.array(IdInput).max(50) })
  .meta({ id: 'SetPropertyStaffBody' });
export const StaffAssignmentList = z
  .object({ items: z.array(StaffAssignment) })
  .meta({ id: 'StaffAssignmentList' });

// ── Units ────────────────────────────────────────────────────────────────────────────────────
export const UnitMode = z.enum(['long_term', 'short_stay']).meta({ id: 'UnitMode' });
export const UnitStatus = z.enum(['active', 'inactive']).meta({ id: 'UnitStatus' });

/** Paybill account number: 1–12 letters/digits/dashes (STK limit), stored upper-case. */
export const UNIT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,11}$/;
export const UnitCode = z
  .string()
  .regex(UNIT_CODE_PATTERN, 'Use 1–12 letters, digits or dashes, e.g. A101')
  .transform((v) => v.toUpperCase())
  .meta({
    description: 'Paybill account number for this unit (normalised to upper case)',
    example: 'A101',
  });

export const Unit = z
  .object({
    id: z.uuid(),
    propertyId: z.uuid(),
    propertyName: z.string(),
    code: z.string(),
    label: z.string().nullable(),
    mode: UnitMode,
    status: UnitStatus,
    bedrooms: z.int().nullable(),
    bathrooms: z.int().nullable(),
    floor: z.string().nullable(),
    sizeSqm: z.int().nullable(),
    rentCents: Cents.nullable(),
    depositCents: Cents.nullable(),
    baseNightlyCents: Cents.nullable(),
    maxGuests: z.int().nullable(),
    notes: z.string().nullable(),
    archivedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Unit' });
export const UnitPage = pageOf(Unit, 'Unit');
export const UnitList = z.object({ items: z.array(Unit) }).meta({ id: 'UnitList' });

const unitDetails = {
  label: TextInput(120).optional(),
  bedrooms: z.int().min(0).max(50).optional(),
  bathrooms: z.int().min(0).max(50).optional(),
  floor: TextInput(20).optional(),
  sizeSqm: z.int().min(1).max(100_000).optional(),
  rentCents: Cents.min(0).optional(),
  depositCents: Cents.min(0).optional(),
  baseNightlyCents: Cents.min(0).optional(),
  maxGuests: z.int().min(1).max(100).optional(),
  notes: Notes.optional(),
};

export function priceForMode(b: {
  mode?: string;
  rentCents?: number | null;
  baseNightlyCents?: number | null;
}) {
  if (b.mode === 'long_term') return b.rentCents != null;
  if (b.mode === 'short_stay') return b.baseNightlyCents != null;
  return true;
}
export const PRICE_RULE =
  'long_term units need rentCents; short_stay units need baseNightlyCents (422 unit_price_required)';

export const CreateUnitBody = z
  .object({ code: UnitCode, mode: UnitMode, ...unitDetails })
  .meta({ id: 'CreateUnitBody', description: PRICE_RULE });

export const BulkCreateUnitsBody = z
  .object({
    prefix: z
      .string()
      .regex(/^[A-Za-z0-9-]{0,8}$/, 'Prefix: up to 8 letters, digits or dashes')
      .transform((v) => v.toUpperCase()),
    start: z.int().min(0).max(99_999),
    count: z.int().min(1).max(500),
    padding: z
      .int()
      .min(0)
      .max(6)
      .default(0)
      .meta({ description: 'Zero-pad numbers, e.g. 2 → A01' }),
    mode: UnitMode,
    ...unitDetails,
  })
  .meta({
    id: 'BulkCreateUnitsBody',
    description: `${PRICE_RULE}. Generated codes must be ≤ 12 characters (422 invalid_unit_code).`,
  });

export const UpdateUnitBody = z
  .object({
    code: UnitCode.optional(),
    mode: UnitMode.optional(),
    status: UnitStatus.optional(),
    label: TextInput(120).nullable().optional(),
    bedrooms: z.int().min(0).max(50).nullable().optional(),
    bathrooms: z.int().min(0).max(50).nullable().optional(),
    floor: TextInput(20).nullable().optional(),
    sizeSqm: z.int().min(1).max(100_000).nullable().optional(),
    rentCents: Cents.min(0).nullable().optional(),
    depositCents: Cents.min(0).nullable().optional(),
    baseNightlyCents: Cents.min(0).nullable().optional(),
    maxGuests: z.int().min(1).max(100).nullable().optional(),
    notes: Notes.nullable().optional(),
  })
  .meta({ id: 'UpdateUnitBody' });

export const UnitQuery = CursorQuery.extend({
  propertyId: IdInput.optional(),
  mode: UnitMode.optional(),
  status: UnitStatus.optional(),
  q: TextInput(60).optional(),
  includeArchived: booleanQuery,
});

export const CodeAvailabilityQuery = z.object({ code: SafeString(40) });
export const CodeAvailability = z
  .object({ code: z.string(), valid: z.boolean(), available: z.boolean() })
  .meta({ id: 'CodeAvailability' });

export const PropertyIdParam = z.object({ propertyId: IdInput });

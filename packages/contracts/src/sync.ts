import { z } from 'zod';
import { BusinessDateInput, Cents, IdInput, IsoDate, Timestamp } from './common';
import { CreateCashCollectionBody } from './payments';
import {
  AddTicketUpdateBody,
  CreateTicketBody,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from './maintenance';
import { ReadingValue } from './leasing';

// ── Pull ────────────────────────────────────────────────────────────────────────────────────
export const SyncPullQuery = z.object({
  cursor: z
    .string()
    .max(4096)
    .regex(/^[A-Za-z0-9_-]*$/, 'Invalid cursor')
    .optional()
    .meta({ description: 'From the previous pull; omit for a full snapshot' }),
});

const stamp = { updatedAt: Timestamp };
export const SyncProperty = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: z.string(),
    county: z.string(),
    area: z.string().nullable(),
    ...stamp,
  })
  .meta({ id: 'SyncProperty' });
export const SyncUnit = z
  .object({
    id: z.uuid(),
    propertyId: z.uuid(),
    code: z.string(),
    label: z.string().nullable(),
    mode: z.enum(['long_term', 'short_stay']),
    status: z.enum(['active', 'inactive']),
    bedrooms: z.int().nullable(),
    ...stamp,
  })
  .meta({ id: 'SyncUnit' });
export const SyncMeter = z
  .object({
    id: z.uuid(),
    unitId: z.uuid(),
    kind: z.enum(['water', 'electricity']),
    serial: z.string().nullable(),
    unitLabel: z.string(),
    ...stamp,
  })
  .meta({ id: 'SyncMeter' });
export const SyncMeterReading = z
  .object({
    id: z.uuid(),
    meterId: z.uuid(),
    readOn: IsoDate,
    reading: z.string(),
    note: z.string().nullable(),
    recordedBy: z.uuid().nullable(),
    ...stamp,
  })
  .meta({ id: 'SyncMeterReading' });
export const SyncTicket = z
  .object({
    id: z.uuid(),
    number: z.string(),
    propertyId: z.uuid(),
    unitId: z.uuid().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    category: TicketCategory,
    priority: TicketPriority,
    status: TicketStatus,
    reporterKind: z.enum(['staff', 'caretaker', 'tenant']),
    costCents: Cents.nullable(),
    createdAt: Timestamp,
    ...stamp,
  })
  .meta({ id: 'SyncTicket' });
export const SyncTicketUpdate = z
  .object({
    id: z.uuid(),
    ticketId: z.uuid(),
    authorId: z.uuid().nullable(),
    note: z.string().nullable(),
    statusFrom: TicketStatus.nullable(),
    statusTo: TicketStatus.nullable(),
    photoKeys: z.array(z.string()),
    createdAt: Timestamp,
    ...stamp,
  })
  .meta({ id: 'SyncTicketUpdate' });
export const SyncCashCollection = z
  .object({
    id: z.uuid(),
    leaseId: z.uuid().nullable(),
    bookingId: z.uuid().nullable(),
    amountCents: Cents,
    receivedOn: IsoDate,
    payerName: z.string().nullable(),
    note: z.string().nullable(),
    status: z.enum(['pending', 'confirmed', 'rejected']),
    rejectReason: z.string().nullable(),
    createdAt: Timestamp,
    ...stamp,
  })
  .meta({ id: 'SyncCashCollection' });
export const SyncTenant = z
  .object({ id: z.uuid(), fullName: z.string(), phone: z.string().nullable(), ...stamp })
  .meta({ id: 'SyncTenant', description: 'Owners, managers and agents only' });
export const SyncLease = z
  .object({
    id: z.uuid(),
    unitId: z.uuid(),
    tenantId: z.uuid(),
    startDate: IsoDate,
    endDate: IsoDate.nullable(),
    status: z.enum(['active', 'terminated', 'cancelled']),
    ...stamp,
  })
  .meta({ id: 'SyncLease', description: 'Owners, managers and agents only' });

const changes = <T extends z.ZodType>(item: T, name: string) =>
  z
    .object({
      upserted: z.array(item),
      deleted: z
        .array(z.uuid())
        .meta({ description: 'Archived/removed (or no longer visible) ids' }),
    })
    .meta({ id: `${name}Changes` });

export const SyncPullResponse = z
  .object({
    cursor: z.string().meta({ description: 'Send back on the next pull' }),
    reset: z.boolean().meta({
      description:
        'true = this is a full snapshot; drop local copies not in it (access changed or first pull)',
    }),
    hasMore: z.boolean().meta({ description: 'Pull again immediately with the new cursor' }),
    changes: z.object({
      properties: changes(SyncProperty, 'SyncProperty'),
      units: changes(SyncUnit, 'SyncUnit'),
      meters: changes(SyncMeter, 'SyncMeter'),
      meterReadings: changes(SyncMeterReading, 'SyncMeterReading'),
      tickets: changes(SyncTicket, 'SyncTicket'),
      ticketUpdates: changes(SyncTicketUpdate, 'SyncTicketUpdate'),
      cashCollections: changes(SyncCashCollection, 'SyncCashCollection'),
      tenants: changes(SyncTenant, 'SyncTenant'),
      leases: changes(SyncLease, 'SyncLease'),
    }),
  })
  .meta({ id: 'SyncPullResponse' });

// ── Push ────────────────────────────────────────────────────────────────────────────────────
const clientId = {
  id: IdInput.meta({ description: 'Client-generated UUIDv7; a repeat is a duplicate' }),
};
export const SyncPushBody = z
  .object({
    tickets: z.array(CreateTicketBody.extend(clientId)).max(200).optional(),
    ticketUpdates: z
      .array(AddTicketUpdateBody.extend({ ...clientId, ticketId: IdInput }))
      .max(200)
      .optional(),
    meterReadings: z
      .array(
        z.object({
          ...clientId,
          meterId: IdInput,
          readOn: BusinessDateInput,
          reading: ReadingValue,
          note: z.string().max(500).optional(),
        }),
      )
      .max(200)
      .optional(),
    cashCollections: z.array(CreateCashCollectionBody.extend(clientId)).max(200).optional(),
  })
  .meta({
    id: 'SyncPushBody',
    description:
      'Applied in order tickets → ticketUpdates → meterReadings → cashCollections, each record on its own; at most 200 records in total (422 too_many_records)',
  });

export const SyncPushResult = z
  .object({
    id: z.uuid(),
    type: z.enum(['ticket', 'ticket_update', 'meter_reading', 'cash_collection']),
    status: z.enum(['applied', 'duplicate', 'rejected']),
    code: z
      .string()
      .nullable()
      .meta({ description: 'Problem code when rejected, e.g. ticket_finished' }),
    message: z.string().nullable(),
  })
  .meta({ id: 'SyncPushResult' });
export const SyncPushResponse = z
  .object({ results: z.array(SyncPushResult) })
  .meta({ id: 'SyncPushResponse' });

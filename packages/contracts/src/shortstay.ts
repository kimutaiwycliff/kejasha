import { z } from 'zod';
import {
  BusinessDateInput,
  Cents,
  CursorQuery,
  IdInput,
  pageOf,
  RequiredTextInput,
  SafeString,
  TextInput,
} from './common';
import { Email, PhoneInput } from './kenya';

const Timestamp = z.iso.datetime({ offset: true });
const IsoDate = z.iso.date();

export const BookingSource = z
  .enum(['direct', 'walk_in', 'whatsapp', 'airbnb', 'booking', 'other'])
  .meta({ id: 'BookingSource' });
export const BookingStatus = z
  .enum(['confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'])
  .meta({ id: 'BookingStatus' });
export const ExpenseCategory = z
  .enum(['tokens', 'wifi', 'cleaning', 'supplies', 'repair', 'licence', 'laundry', 'other'])
  .meta({ id: 'ExpenseCategory' });

// ── Rates ──────────────────────────────────────────────────────────────────────────────────
export const Season = z
  .object({
    id: z.uuid(),
    label: z.string(),
    startsOn: IsoDate,
    endsOn: IsoDate.meta({ description: 'Exclusive: the first night not in the season' }),
    nightlyCents: Cents,
    minStayNights: z.int().nullable(),
  })
  .meta({ id: 'Season' });
export const RatePlan = z
  .object({
    unitId: z.uuid(),
    unitCode: z.string(),
    baseNightlyCents: Cents,
    weekendNightlyCents: Cents.nullable().meta({ description: 'Friday and Saturday nights' }),
    minStayNights: z.int(),
    bufferDays: z.int().meta({ description: 'Turnover days kept free after each stay' }),
    cleaningFeeCents: Cents,
    checkinInstructions: z.string().nullable(),
    seasons: z.array(Season),
  })
  .meta({ id: 'RatePlan' });
export const UpsertRatePlanBody = z
  .object({
    baseNightlyCents: Cents.min(0),
    weekendNightlyCents: Cents.min(0).nullable().optional(),
    minStayNights: z.int().min(1).max(365).optional(),
    bufferDays: z.int().min(0).max(14).optional(),
    cleaningFeeCents: Cents.min(0).optional(),
    checkinInstructions: TextInput(2000).nullable().optional(),
  })
  .meta({ id: 'UpsertRatePlanBody' });
export const CreateSeasonBody = z
  .object({
    label: RequiredTextInput(80),
    startsOn: BusinessDateInput,
    endsOn: BusinessDateInput,
    nightlyCents: Cents.min(0),
    minStayNights: z.int().min(1).max(365).optional(),
  })
  .meta({
    id: 'CreateSeasonBody',
    description: 'Seasons on a unit cannot overlap (409 season_overlap)',
  });

export const StayQuery = z.object({ checkIn: BusinessDateInput, checkOut: BusinessDateInput });
export const Quote = z
  .object({
    unitId: z.uuid(),
    checkIn: IsoDate,
    checkOut: IsoDate,
    nights: z.array(
      z.object({ date: IsoDate, nightlyCents: Cents, rate: z.enum(['season', 'weekend', 'base']) }),
    ),
    nightCount: z.int(),
    nightsTotalCents: Cents,
    cleaningFeeCents: Cents,
    totalCents: Cents,
    minStayNights: z.int(),
    meetsMinStay: z.boolean(),
    available: z.boolean(),
  })
  .meta({ id: 'Quote' });

// ── Guests ─────────────────────────────────────────────────────────────────────────────────
export const Guest = z
  .object({
    id: z.uuid(),
    fullName: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    idNumber: z.string().nullable(),
    nationality: z.string().nullable(),
    notes: z.string().nullable(),
    stays: z.int(),
    lastStayOn: IsoDate.nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'Guest' });
export const GuestPage = pageOf(Guest, 'Guest');
const guestFields = {
  fullName: RequiredTextInput(120),
  phone: PhoneInput.optional(),
  email: Email.optional(),
  idNumber: TextInput(40).optional(),
  nationality: TextInput(60).optional(),
  notes: TextInput(1000).optional(),
};
export const CreateGuestBody = z.object(guestFields).meta({ id: 'CreateGuestBody' });
export const UpdateGuestBody = z
  .object({
    fullName: RequiredTextInput(120).optional(),
    phone: PhoneInput.nullable().optional(),
    email: Email.nullable().optional(),
    idNumber: TextInput(40).nullable().optional(),
    nationality: TextInput(60).nullable().optional(),
    notes: TextInput(1000).nullable().optional(),
  })
  .meta({ id: 'UpdateGuestBody' });
export const GuestQuery = CursorQuery.extend({ q: TextInput(120).optional() });

// ── Bookings ───────────────────────────────────────────────────────────────────────────────
export const Booking = z
  .object({
    id: z.uuid(),
    unitId: z.uuid(),
    unitCode: z.string(),
    propertyName: z.string(),
    guestId: z.uuid().nullable(),
    guestName: z.string().nullable(),
    isRepeatGuest: z.boolean(),
    checkIn: IsoDate,
    checkOut: IsoDate,
    nights: z.int(),
    source: BookingSource,
    status: BookingStatus,
    guestsCount: z.int(),
    grossCents: Cents,
    cleaningFeeCents: Cents,
    commissionBps: z.int(),
    commissionCents: Cents,
    netCents: Cents.meta({ description: 'gross − commission' }),
    paidCents: Cents.meta({ description: 'Collected through Kejasha payments (direct bookings)' }),
    balanceCents: Cents,
    notes: z.string().nullable(),
    fromIcal: z.boolean(),
    createdAt: Timestamp,
  })
  .meta({ id: 'Booking' });
export const BookingPage = pageOf(Booking, 'Booking');
export const CreateBookingBody = z
  .object({
    unitId: IdInput,
    checkIn: BusinessDateInput,
    checkOut: BusinessDateInput,
    source: BookingSource,
    guestId: IdInput.optional(),
    guest: CreateGuestBody.optional().meta({
      description: 'New or returning guest (matched by phone)',
    }),
    guestsCount: z.int().min(1).max(100).optional(),
    grossCents: Cents.min(0)
      .optional()
      .meta({ description: 'Defaults to the quote (nights + cleaning)' }),
    cleaningFeeCents: Cents.min(0).optional(),
    commissionBps: z
      .int()
      .min(0)
      .max(10_000)
      .optional()
      .meta({ description: 'OTA fee, e.g. 1500 = 15%' }),
    notes: TextInput(2000).optional(),
    allowShortStay: z.boolean().optional().meta({ description: 'Book below the minimum stay' }),
  })
  .meta({
    id: 'CreateBookingBody',
    description:
      'Overlapping a booking or block answers 409 dates_unavailable; below minimum stay 422 min_stay',
  });
export const UpdateBookingBody = z
  .object({
    checkIn: BusinessDateInput.optional(),
    checkOut: BusinessDateInput.optional(),
    guestsCount: z.int().min(1).max(100).optional(),
    grossCents: Cents.min(0).optional(),
    cleaningFeeCents: Cents.min(0).optional(),
    commissionBps: z.int().min(0).max(10_000).optional(),
    guestId: IdInput.nullable().optional(),
    notes: TextInput(2000).nullable().optional(),
  })
  .meta({ id: 'UpdateBookingBody' });
export const CancelBookingBody = z
  .object({ reason: RequiredTextInput(500) })
  .meta({ id: 'CancelBookingBody' });
export const BookingQuery = CursorQuery.extend({
  unitId: IdInput.optional(),
  from: BusinessDateInput.optional(),
  to: BusinessDateInput.optional(),
  status: BookingStatus.optional(),
  source: BookingSource.optional(),
});

// ── Blocks & calendar ──────────────────────────────────────────────────────────────────────
export const BlockReason = z
  .enum(['owner_use', 'maintenance', 'ical', 'other'])
  .meta({ id: 'BlockReason' });
export const CalendarBlock = z
  .object({
    id: z.uuid(),
    unitId: z.uuid(),
    startsOn: IsoDate,
    endsOn: IsoDate,
    reason: BlockReason,
    note: z.string().nullable(),
    fromIcal: z.boolean(),
  })
  .meta({ id: 'CalendarBlock' });
export const CreateBlockBody = z
  .object({
    unitId: IdInput,
    startsOn: BusinessDateInput,
    endsOn: BusinessDateInput.meta({ description: 'Exclusive' }),
    reason: z.enum(['owner_use', 'maintenance', 'other']),
    note: TextInput(500).optional(),
  })
  .meta({ id: 'CreateBlockBody' });

export const CalendarQuery = z.object({
  from: BusinessDateInput,
  to: BusinessDateInput,
  propertyId: IdInput.optional(),
});
export const CalendarEntry = z
  .object({
    kind: z.enum(['booking', 'block']),
    id: z.uuid(),
    start: IsoDate,
    end: IsoDate.meta({ description: 'Exclusive' }),
    label: z.string(),
    status: BookingStatus.nullable(),
    source: BookingSource.nullable(),
  })
  .meta({ id: 'CalendarEntry' });
export const Calendar = z
  .object({
    from: IsoDate,
    to: IsoDate,
    units: z.array(
      z.object({
        unitId: z.uuid(),
        unitCode: z.string(),
        propertyName: z.string(),
        entries: z.array(CalendarEntry),
      }),
    ),
  })
  .meta({ id: 'Calendar' });

// ── iCal ───────────────────────────────────────────────────────────────────────────────────
export const IcalFeed = z
  .object({
    id: z.uuid(),
    unitId: z.uuid(),
    source: z.enum(['airbnb', 'booking', 'other']),
    urlHint: z
      .string()
      .meta({ description: 'Host and last characters only — feed URLs are secrets' }),
    enabled: z.boolean(),
    lastSyncedAt: Timestamp.nullable(),
    lastStatus: z.enum(['ok', 'not_modified', 'error']).nullable(),
    lastError: z.string().nullable(),
    conflicts: z.array(
      z.object({ uid: z.string(), start: IsoDate, end: IsoDate, summary: z.string() }),
    ),
  })
  .meta({ id: 'IcalFeed' });
export const IcalFeedList = z.object({ items: z.array(IcalFeed) }).meta({ id: 'IcalFeedList' });
export const CreateIcalFeedBody = z
  .object({
    unitId: IdInput,
    source: z.enum(['airbnb', 'booking', 'other']),
    url: SafeString(2000).min(10),
  })
  .meta({
    id: 'CreateIcalFeedBody',
    description: 'Public https URL (private addresses answer 422 invalid_feed_url)',
  });
export const UpdateIcalFeedBody = z
  .object({ enabled: z.boolean() })
  .meta({ id: 'UpdateIcalFeedBody' });
export const IcalFeedQuery = z.object({ unitId: IdInput.optional() });
export const IcalSyncResult = z
  .object({
    feedId: z.uuid(),
    status: z.enum(['ok', 'not_modified', 'error']),
    added: z.int(),
    updated: z.int(),
    removed: z.int(),
    conflicts: z.int(),
    error: z.string().nullable(),
  })
  .meta({ id: 'IcalSyncResult' });

// ── Expenses & profit ──────────────────────────────────────────────────────────────────────
export const UnitExpense = z
  .object({
    id: z.uuid(),
    unitId: z.uuid(),
    bookingId: z.uuid().nullable(),
    incurredOn: IsoDate,
    category: ExpenseCategory,
    amountCents: Cents,
    description: z.string().nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'UnitExpense' });
export const UnitExpenseList = z
  .object({ items: z.array(UnitExpense) })
  .meta({ id: 'UnitExpenseList' });
export const CreateExpenseBody = z
  .object({
    unitId: IdInput,
    incurredOn: BusinessDateInput,
    category: ExpenseCategory,
    amountCents: Cents.min(1),
    description: TextInput(500).optional(),
    bookingId: IdInput.optional(),
  })
  .meta({ id: 'CreateExpenseBody' });
export const ExpenseQuery = z.object({
  unitId: IdInput.optional(),
  from: BusinessDateInput,
  to: BusinessDateInput,
});

const profitFields = {
  nightsSold: z.int(),
  availableNights: z.int(),
  occupancyBps: z.int().meta({ description: 'Occupancy in basis points (8000 = 80%)' }),
  grossCents: Cents,
  commissionCents: Cents,
  expensesCents: Cents,
  netCents: Cents,
  adrCents: Cents.meta({ description: 'Average daily rate' }),
  revparCents: Cents.meta({ description: 'Revenue per available night' }),
};
export const ShortStayReport = z
  .object({
    period: z.string(),
    units: z.array(
      z.object({
        unitId: z.uuid(),
        unitCode: z.string(),
        propertyName: z.string(),
        ...profitFields,
      }),
    ),
    totals: z.object(profitFields),
    channels: z.array(
      z.object({
        source: BookingSource,
        bookings: z.int(),
        nights: z.int(),
        grossCents: Cents,
        commissionCents: Cents,
        netCents: Cents,
        effectiveCommissionBps: z.int(),
      }),
    ),
  })
  .meta({ id: 'ShortStayReport' });
export const ProfitQuery = z.object({
  period: z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
  propertyId: IdInput.optional(),
});

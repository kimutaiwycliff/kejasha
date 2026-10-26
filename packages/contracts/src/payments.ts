import { z } from 'zod';
import {
  BusinessDateInput,
  Cents,
  CursorQuery,
  FileLink,
  IdInput,
  pageOf,
  RequiredTextInput,
  SafeString,
  TextInput,
} from './common';
import { Phone, PhoneInput } from './kenya';

const Timestamp = z.iso.datetime({ offset: true });

// ── Channels ───────────────────────────────────────────────────────────────────────────────
export const ChannelKind = z.enum(['paybill', 'till', 'phone']).meta({ id: 'ChannelKind' });
export const DarajaEnvironment = z
  .enum(['sandbox', 'production'])
  .meta({ id: 'DarajaEnvironment' });

export const PaymentChannel = z
  .object({
    id: z.uuid(),
    kind: ChannelKind,
    shortcode: z.string(),
    displayName: z.string(),
    status: z.enum(['active', 'disabled']),
    clientLandlordId: z.uuid().nullable(),
    darajaEnv: DarajaEnvironment,
    hasCredentials: z
      .boolean()
      .meta({ description: 'Daraja credentials are stored (they are never returned)' }),
    credentialsUpdatedAt: Timestamp.nullable(),
    c2bRegisteredAt: Timestamp.nullable(),
    callbackUrls: z
      .object({ confirmation: z.string(), validation: z.string(), stkResult: z.string() })
      .nullable()
      .meta({ description: 'Daraja URLs for Paybill/Till channels; null for personal numbers' }),
    createdAt: Timestamp,
  })
  .meta({ id: 'PaymentChannel' });
export const PaymentChannelList = z
  .object({ items: z.array(PaymentChannel) })
  .meta({ id: 'PaymentChannelList' });

export const CreateChannelBody = z
  .object({
    kind: ChannelKind,
    shortcode: SafeString(20).meta({
      description: 'Paybill/Till number (5–8 digits) or the M-Pesa phone number for kind=phone',
    }),
    displayName: RequiredTextInput(80),
    clientLandlordId: IdInput.optional(),
    darajaEnv: DarajaEnvironment.optional(),
  })
  .meta({
    id: 'CreateChannelBody',
    description: 'A shortcode that does not fit the kind answers 422 invalid_shortcode',
  });

export const UpdateChannelBody = z
  .object({
    displayName: RequiredTextInput(80).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    darajaEnv: DarajaEnvironment.optional(),
  })
  .meta({ id: 'UpdateChannelBody' });

export const SetCredentialsBody = z
  .object({
    consumerKey: SafeString(200).min(1),
    consumerSecret: SafeString(200).min(1),
    passkey: SafeString(200)
      .min(1)
      .optional()
      .meta({ description: 'Lipa na M-Pesa Online passkey (needed for STK Push)' }),
  })
  .meta({
    id: 'SetCredentialsBody',
    description: 'Write-only: stored envelope-encrypted and never returned',
  });

export const GoLiveChecklist = z
  .object({
    channelId: z.uuid(),
    ready: z.boolean(),
    items: z.array(
      z.object({ key: z.string(), label: z.string(), done: z.boolean(), help: z.string() }),
    ),
    documents: z
      .array(z.string())
      .meta({ description: 'What Safaricom asks for to take a shortcode live' }),
  })
  .meta({ id: 'GoLiveChecklist' });

// ── Payments ───────────────────────────────────────────────────────────────────────────────
export const PaymentSource = z
  .enum(['c2b', 'stk', 'statement_import', 'sms', 'manual'])
  .meta({ id: 'PaymentSource' });
export const PaymentMethod = z
  .enum(['mpesa', 'cash', 'bank', 'other'])
  .meta({ id: 'PaymentMethod' });
export const MatchStatus = z.enum(['unmatched', 'matched', 'ignored']).meta({ id: 'MatchStatus' });

export const Payment = z
  .object({
    id: z.uuid(),
    source: PaymentSource,
    method: PaymentMethod,
    providerRef: z.string(),
    amountCents: Cents,
    paidAt: Timestamp,
    msisdn: z.string().nullable(),
    payerName: z.string().nullable(),
    accountRef: z.string().nullable(),
    channelId: z.uuid().nullable(),
    matchStatus: MatchStatus,
    matchMethod: z.enum(['auto_account', 'auto_phone', 'manual']).nullable(),
    leaseId: z.uuid().nullable(),
    bookingId: z.uuid().nullable(),
    tenantName: z.string().nullable(),
    unitCode: z.string().nullable(),
    receiptNumber: z.string().nullable(),
    ignoreReason: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'Payment' });
export const PaymentPage = pageOf(Payment, 'Payment');
export const PaymentQuery = CursorQuery.extend({
  status: MatchStatus.optional(),
  source: PaymentSource.optional(),
  leaseId: IdInput.optional(),
});

export const PaymentSuggestion = z
  .object({
    leaseId: z.uuid(),
    tenantName: z.string(),
    unitCode: z.string(),
    score: z.int().meta({ description: '0–100, higher is more likely' }),
    reasons: z.array(
      z.enum(['phone', 'account_ref', 'exact_invoice_amount', 'exact_balance', 'name']),
    ),
    outstandingCents: Cents,
  })
  .meta({ id: 'PaymentSuggestion' });
export const PaymentSuggestionList = z
  .object({ items: z.array(PaymentSuggestion) })
  .meta({ id: 'PaymentSuggestionList' });

export const AllocatePaymentBody = z
  .object({ leaseId: IdInput.optional(), bookingId: IdInput.optional() })
  .meta({
    id: 'AllocatePaymentBody',
    description: 'Exactly one of leaseId or bookingId (422 target_required)',
  });
export const ReasonBody = z.object({ reason: RequiredTextInput(500) }).meta({ id: 'ReasonBody' });

export const ManualPaymentBody = z
  .object({
    method: PaymentMethod,
    amountCents: Cents.min(1),
    paidOn: BusinessDateInput,
    reference: SafeString(40)
      .optional()
      .meta({ description: 'Bank/M-Pesa reference; generated when omitted' }),
    leaseId: IdInput.optional().meta({
      description: 'Allocate immediately; otherwise it waits in the unmatched queue',
    }),
    bookingId: IdInput.optional().meta({
      description: 'Allocate to a short-stay booking instead (not with leaseId)',
    }),
    payerName: TextInput(120).optional(),
    phone: PhoneInput.optional(),
    notes: TextInput(500).optional(),
  })
  .meta({ id: 'ManualPaymentBody' });

// ── STK Push ───────────────────────────────────────────────────────────────────────────────
export const StkRequestBody = z
  .object({
    leaseId: IdInput.optional(),
    bookingId: IdInput.optional().meta({ description: 'Exactly one of leaseId or bookingId' }),
    amountCents: Cents.min(100)
      .optional()
      .meta({ description: 'Whole shillings; defaults to the lease balance rounded up' }),
    phone: PhoneInput.optional().meta({ description: "Defaults to the tenant's phone" }),
    channelId: IdInput.optional().meta({
      description: 'Defaults to the active Paybill/Till with credentials',
    }),
  })
  .meta({ id: 'StkRequestBody' });
export const StkRequest = z
  .object({
    id: z.uuid(),
    status: z.enum(['pending', 'succeeded', 'failed', 'cancelled', 'timeout']),
    leaseId: z.uuid().nullable(),
    bookingId: z.uuid().nullable(),
    amountCents: Cents,
    msisdn: Phone,
    accountRef: z.string(),
    resultDesc: z.string().nullable(),
    paymentId: z.uuid().nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'StkRequest' });

// ── Statements & SMS ───────────────────────────────────────────────────────────────────────
export const StatementFormat = z
  .enum(['mpesa_business_csv', 'mpesa_statement_pdf'])
  .meta({ id: 'StatementFormat' });
export const StatementImportBody = z
  .object({
    fileKey: SafeString(300).meta({ description: 'Key from POST /v1/uploads (purpose=statement)' }),
    format: StatementFormat,
    password: SafeString(64)
      .optional()
      .meta({ description: 'PDF statement password (usually the ID number)' }),
    channelId: IdInput.optional(),
  })
  .meta({ id: 'StatementImportBody' });
export const StatementImport = z
  .object({
    id: z.uuid(),
    status: z.enum(['parsed', 'failed']),
    format: StatementFormat,
    rowsTotal: z.int(),
    rowsCredits: z.int(),
    rowsNew: z.int(),
    rowsDuplicate: z.int(),
    rowsMatched: z.int(),
    periodFrom: z.string().nullable(),
    periodTo: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'StatementImport' });

export const SmsPaymentBody = z
  .object({ text: SafeString(1000).min(10), channelId: IdInput.optional() })
  .meta({
    id: 'SmsPaymentBody',
    description:
      'An M-Pesa confirmation SMS (share-to-app); unrecognised text answers 422 sms_not_recognised',
  });

// ── Daraja callbacks (public) ──────────────────────────────────────────────────────────────
export const DarajaCallbackBody = z
  .record(z.string(), z.unknown())
  .meta({ id: 'DarajaCallbackBody' });
export const DarajaAck = z
  .object({ ResultCode: z.int(), ResultDesc: z.string() })
  .meta({ id: 'DarajaAck', description: 'Daraja expects ResultCode 0 to acknowledge' });
export const ChannelTokenParam = z.object({
  channelToken: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
});

// ── Cash collected by caretakers ──────────────────────────────────────────────────────────────
export const CashCollectionStatus = z
  .enum(['pending', 'confirmed', 'rejected'])
  .meta({ id: 'CashCollectionStatus' });
export const CashCollection = z
  .object({
    id: z.uuid(),
    leaseId: z.uuid().nullable(),
    bookingId: z.uuid().nullable(),
    unitCode: z.string().nullable(),
    payerName: z.string().nullable(),
    amountCents: Cents,
    receivedOn: z.iso.date(),
    note: z.string().nullable(),
    receipt: FileLink.nullable(),
    status: CashCollectionStatus,
    submittedBy: z.uuid(),
    decidedBy: z.uuid().nullable(),
    decidedAt: Timestamp.nullable(),
    rejectReason: z.string().nullable(),
    paymentId: z.uuid().nullable().meta({ description: 'The payment recorded on confirmation' }),
    createdAt: Timestamp,
  })
  .meta({ id: 'CashCollection' });
export const CashCollectionPage = pageOf(CashCollection, 'CashCollection');
export const CreateCashCollectionBody = z
  .object({
    leaseId: IdInput.optional(),
    bookingId: IdInput.optional(),
    unitId: IdInput.optional().meta({
      description:
        'A long-term unit instead of a lease: the lease covering receivedOn is used (caretakers cannot see leases)',
    }),
    amountCents: Cents.min(1),
    receivedOn: BusinessDateInput,
    payerName: TextInput(120).optional(),
    note: TextInput(500).optional(),
    receiptKey: SafeString(300).optional().meta({
      description: 'Photo of the receipt: key from POST /v1/uploads (purpose cash_receipt)',
    }),
  })
  .meta({
    id: 'CreateCashCollectionBody',
    description:
      'Exactly one of leaseId, bookingId or unitId (422 target_required). A unitId with no lease on receivedOn answers 422 no_lease_on_unit.',
  });
export const CashCollectionQuery = CursorQuery.extend({ status: CashCollectionStatus.optional() });

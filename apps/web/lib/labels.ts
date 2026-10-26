import { COUNTIES } from '@kejasha/contracts';
import type { Option } from '@/components/fields';
import { formatKes } from './format';

export const MODE_LABEL = { long_term: 'Long-term', short_stay: 'Short-stay' } as const;
export const PROPERTY_KIND_LABEL = {
  residential: 'Residential',
  commercial: 'Commercial',
  mixed: 'Mixed use',
} as const;
export const METER_KIND_LABEL = { water: 'Water', electricity: 'Electricity' } as const;

export const options = <K extends string>(labels: Record<K, string>): Option[] =>
  (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }));

export const COUNTY_OPTIONS: Option[] = COUNTIES.map((c) => ({ value: c, label: c }));

/** "10%" from basis points, "Ksh 2,000.00 / month" flat, or "None". */
export function feeLabel(l: {
  mgmtFeeKind: 'none' | 'percent' | 'flat';
  mgmtFeeBps: number | null;
  mgmtFeeFlatCents: number | null;
}) {
  if (l.mgmtFeeKind === 'percent')
    return `${((l.mgmtFeeBps ?? 0) / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  if (l.mgmtFeeKind === 'flat') return `${formatKes(l.mgmtFeeFlatCents)} / month`;
  return 'None';
}

export const LEASE_STATUS_LABEL = {
  active: 'Active',
  terminated: 'Ended',
  cancelled: 'Cancelled',
} as const;
export const CHARGE_KIND_LABEL = {
  service_charge: 'Service charge',
  garbage: 'Garbage',
  water: 'Water',
  electricity: 'Electricity',
  security: 'Security',
  other: 'Other',
} as const;
export const PAYMENT_STATUS_LABEL = {
  unpaid: 'Unpaid',
  partially_paid: 'Part paid',
  paid: 'Paid',
  void: 'Void',
} as const;
export const INVOICE_KIND_LABEL = {
  periodic: 'Monthly',
  deposit: 'Deposit',
  late_fee: 'Late fee',
  manual: 'One-off',
} as const;
export const CONDITION_LABEL = {
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  damaged: 'Damaged',
} as const;

/** "5%" from basis points. */
export const bpsLabel = (bps: number | null | undefined) =>
  bps == null ? '—' : `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

export const PAYMENT_SOURCE_LABEL = {
  c2b: 'Paybill/Till',
  stk: 'M-Pesa request',
  statement_import: 'Statement',
  sms: 'SMS',
  manual: 'Recorded',
} as const;
export const PAYMENT_METHOD_LABEL = {
  mpesa: 'M-Pesa',
  cash: 'Cash',
  bank: 'Bank',
  other: 'Other',
} as const;
export const MATCH_STATUS_LABEL = {
  unmatched: 'Unmatched',
  matched: 'Matched',
  ignored: 'Ignored',
} as const;
export const CHANNEL_KIND_LABEL = {
  paybill: 'Paybill',
  till: 'Till (Buy Goods)',
  phone: 'Personal M-Pesa number',
} as const;
export const SUGGESTION_REASON_LABEL = {
  phone: 'same phone',
  account_ref: 'account number',
  exact_invoice_amount: 'matches an invoice',
  exact_balance: 'matches the balance',
  name: 'similar name',
} as const;

export const BOOKING_SOURCE_LABEL = {
  direct: 'Direct',
  walk_in: 'Walk-in',
  whatsapp: 'WhatsApp',
  airbnb: 'Airbnb',
  booking: 'Booking.com',
  other: 'Other',
} as const;
export const BOOKING_STATUS_LABEL = {
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  checked_out: 'Checked out',
  cancelled: 'Cancelled',
  no_show: 'No-show',
} as const;
export const EXPENSE_CATEGORY_LABEL = {
  tokens: 'Electricity tokens',
  wifi: 'Wi-Fi',
  cleaning: 'Cleaning',
  supplies: 'Supplies',
  repair: 'Repair',
  licence: 'Licence',
  laundry: 'Laundry',
  other: 'Other',
} as const;
export const BLOCK_REASON_LABEL = {
  owner_use: 'Owner use',
  maintenance: 'Maintenance',
  ical: 'Imported',
  other: 'Other',
} as const;

export const TICKET_CATEGORY_LABEL = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  structural: 'Structural',
  appliance: 'Appliance',
  pest: 'Pests',
  cleaning: 'Cleaning',
  security: 'Security',
  other: 'Other',
} as const;
export const TICKET_PRIORITY_LABEL = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
} as const;
export const TICKET_STATUS_LABEL = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
} as const;
export const LICENCE_KIND_LABEL = {
  tra_short_stay: 'TRA short-stay licence',
  county_business_permit: 'County business permit',
  other: 'Other',
} as const;
export const MRI_BAND_LABEL = {
  below_threshold: 'Below KES 288k/yr',
  eligible: 'MRI applies',
  above_threshold: 'Above KES 15M/yr',
} as const;

export const ROLE_LABEL = {
  owner: 'Owner',
  manager: 'Manager',
  agent: 'Agent',
  caretaker: 'Caretaker',
  viewer: 'Read-only owner',
} as const;
export const ROLE_HELP = {
  owner: 'Everything, including billing and roles',
  manager: 'Runs the portfolio: leases, payments, settings',
  agent: 'Tenants, leases, bookings and payments',
  caretaker: 'Assigned properties: readings, repairs, cash',
  viewer: 'Sees statements and reports only',
} as const;

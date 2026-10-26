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

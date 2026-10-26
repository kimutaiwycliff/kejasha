/** UI-edge formatting (ADR-006): money stays integer cents everywhere else. */
const kes = new Intl.NumberFormat('en-KE', {
  style: 'currency',
  currency: 'KES',
  minimumFractionDigits: 2,
});

export function formatKes(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return kes.format(cents / 100);
}

/** "12,500.50" or "12500" (shillings) → cents; null when not a valid amount. */
export function parseKes(input: string): number | null {
  const s = input.replace(/[\s,]/g, '').replace(/^KES/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole = '0', frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

const dateFmt = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium',
  timeZone: 'Africa/Nairobi',
});

/** Business dates are YYYY-MM-DD in Africa/Nairobi (ADR-006). */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  return dateFmt.format(new Date(`${isoDate}T12:00:00+03:00`));
}

export function todayNairobi(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
}

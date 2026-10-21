/**
 * Business dates are Africa/Nairobi calendar dates, represented as ISO `YYYY-MM-DD` strings.
 * Billing periods are `YYYY-MM`. Instants are `Date` (stored as timestamptz).
 */
export const BUSINESS_TZ = 'Africa/Nairobi';

export type IsoDate = string; // YYYY-MM-DD
export type Period = string; // YYYY-MM

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD_RE = /^(\d{4})-(\d{2})$/;

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const offsetFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TZ,
  timeZoneName: 'longOffset',
});

/** Date.UTC maps years 0–99 to 1900–1999; build dates with setUTCFullYear so every year works. */
function utc(y: number, monthIndex: number, day: number): Date {
  const d = new Date(0);
  d.setUTCFullYear(y, monthIndex, day);
  return d;
}

export function isIsoDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = utc(+m[1]!, +m[2]! - 1, +m[3]!);
  return d.toISOString().slice(0, 10) === value;
}

function parseDate(value: IsoDate): Date {
  if (!isIsoDate(value)) throw new RangeError(`Invalid ISO date: ${value}`);
  return new Date(`${value}T00:00:00Z`);
}

function parsePeriod(value: Period): [number, number] {
  const m = PERIOD_RE.exec(value);
  const month = m ? +m[2]! : 0;
  if (!m || month < 1 || month > 12) throw new RangeError(`Invalid period: ${value}`);
  return [+m[1]!, month];
}

function fmtUtc(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** Calendar date in Nairobi for an instant. */
export function nairobiDate(instant: Date = new Date()): IsoDate {
  return dateFmt.format(instant);
}

/** Nairobi UTC offset in minutes at `instant` (180 today; derived from tzdata, not hard-coded). */
export function nairobiOffsetMinutes(instant: Date): number {
  const name =
    offsetFmt.formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  const mins = +m[2]! * 60 + +m[3]!;
  return m[1] === '-' ? -mins : mins;
}

/** The instant at which a Nairobi business date begins. */
export function startOfNairobiDay(date: IsoDate): Date {
  const utcMidnight = parseDate(date);
  const offset = nairobiOffsetMinutes(utcMidnight);
  return new Date(utcMidnight.getTime() - offset * 60_000);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtUtc(d);
}

/** Whole days from `a` to `b` (b − a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

export function daysInMonth(period: Period): number {
  const [y, m] = parsePeriod(period);
  return utc(y, m, 0).getUTCDate();
}

export function periodOf(date: IsoDate): Period {
  parseDate(date);
  return date.slice(0, 7);
}

export function monthStart(period: Period): IsoDate {
  parsePeriod(period);
  return `${period}-01`;
}

export function monthEnd(period: Period): IsoDate {
  return `${period}-${String(daysInMonth(period)).padStart(2, '0')}`;
}

export function addPeriods(period: Period, months: number): Period {
  const [y, m] = parsePeriod(period);
  const d = utc(y, m - 1 + months, 1);
  return fmtUtc(d).slice(0, 7);
}

/** Add months, clamping to the last day (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const period = addPeriods(periodOf(date), months);
  const day = Math.min(+date.slice(8, 10), daysInMonth(period));
  return `${period}-${String(day).padStart(2, '0')}`;
}

/** Due date for a billing day in a period; days past month end clamp to month end. */
export function dueDate(period: Period, billingDay: number): IsoDate {
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) {
    throw new RangeError(`billingDay must be 1–31, got ${billingDay}`);
  }
  const day = Math.min(billingDay, daysInMonth(period));
  return `${period}-${String(day).padStart(2, '0')}`;
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  parseDate(a);
  parseDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

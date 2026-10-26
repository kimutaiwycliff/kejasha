import { todayNairobi } from './format';

/** The calendar month before this one, YYYY-MM (MRI for a month is filed by the 20th of the next). */
export function lastMonth() {
  const [y, m] = todayNairobi().split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export const thisMonth = () => todayNairobi().slice(0, 7);

const monthName = new Intl.DateTimeFormat('en-KE', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
/** "October 2026" from "2026-10". */
export const periodLabel = (p: string) => monthName.format(new Date(`${p}-15T12:00:00Z`));

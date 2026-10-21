/**
 * Kenyan mobile numbers normalised to E.164 (`+2547XXXXXXXX` / `+2541XXXXXXXX`).
 * Accepts 07…, 01…, 7…, 1…, 2547…, +2547…, 002547…, with spaces, dashes, dots or brackets.
 */
export type E164 = string;

export function normalizeKenyanPhone(input: string): E164 | null {
  const digits = input.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;
  const bare = digits.replace(/^\+/, '');

  let subscriber: string;
  if (bare.startsWith('00254')) subscriber = bare.slice(5);
  else if (bare.startsWith('254')) subscriber = bare.slice(3);
  else if (digits.startsWith('+'))
    return null; // other country code
  else if (bare.startsWith('0')) subscriber = bare.slice(1);
  else subscriber = bare;

  if (!/^[17]\d{8}$/.test(subscriber)) return null;
  return `+254${subscriber}`;
}

export function isKenyanMobile(input: string): boolean {
  return normalizeKenyanPhone(input) !== null;
}

/** For logs: +2547****5678. */
export function maskPhone(e164: E164): string {
  if (e164.length < 8) return '****';
  return `${e164.slice(0, 5)}****${e164.slice(-4)}`;
}

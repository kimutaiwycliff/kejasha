/**
 * Money is always integer minor units (cents) as `bigint` (ADR-006). Never floats.
 * Formatting happens only at the edge.
 */
export type Cents = bigint;

export const ZERO: Cents = 0n;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Build cents from an integer number, bigint or integer string. Rejects fractions. */
export function cents(value: bigint | number | string): Cents {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new RangeError(`Not a safe integer cent value: ${value}`);
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value.trim())) throw new RangeError(`Not an integer cent string: ${value}`);
  return BigInt(value.trim());
}

/**
 * Parse a human/statement amount in shillings ("1,234.5", "KES 1,234.50", "-300") into cents.
 * Rejects more than 2 decimal places rather than rounding silently.
 */
export function parseKes(input: string): Cents {
  const cleaned = input.replace(/KES|KSHS?\.?|,|\s/gi, '');
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) throw new RangeError(`Not a KES amount: ${input}`);
  const [, sign, whole, frac = ''] = m;
  const value = BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0') || '0');
  return sign ? -value : value;
}

export function sum(values: Iterable<Cents>): Cents {
  let total = ZERO;
  for (const v of values) total += v;
  return total;
}

export function abs(value: Cents): Cents {
  return value < 0n ? -value : value;
}

export function min(a: Cents, b: Cents): Cents {
  return a < b ? a : b;
}

export function max(a: Cents, b: Cents): Cents {
  return a > b ? a : b;
}

/** Divide with rounding half away from zero. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = abs(numerator);
  const d = abs(denominator);
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

/** Apply a rate in basis points (1% = 100 bps, 7.5% = 750 bps), rounding half away from zero. */
export function applyBps(amount: Cents, bps: number | bigint): Cents {
  const rate = typeof bps === 'bigint' ? bps : BigInt(assertInteger(bps, 'bps'));
  return divRound(amount * rate, 10_000n);
}

/**
 * Split `total` across `weights` so the parts sum exactly to `total` (largest-remainder method).
 * Ties go to the earliest weight, making results deterministic.
 */
export function allocate(total: Cents, weights: readonly (bigint | number)[]): Cents[] {
  if (weights.length === 0) throw new RangeError('allocate needs at least one weight');
  const w = weights.map((x) => (typeof x === 'bigint' ? x : BigInt(assertInteger(x, 'weight'))));
  if (w.some((x) => x < 0n)) throw new RangeError('Weights must be non-negative');
  const weightSum = sum(w);
  if (weightSum === 0n) throw new RangeError('Weights must not all be zero');

  const sign = total < 0n ? -1n : 1n;
  const t = abs(total);
  const parts = w.map((x) => (t * x) / weightSum);
  const remainders = w.map((x, i) => ({ i, r: (t * x) % weightSum }));
  let leftover = t - sum(parts);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    parts[i]! += 1n;
    leftover -= 1n;
  }
  return parts.map((p) => p * sign);
}

/** Split evenly into `n` parts; earlier parts absorb the remainder. */
export function splitEvenly(total: Cents, n: number): Cents[] {
  return allocate(
    total,
    Array.from({ length: assertInteger(n, 'n') }, () => 1),
  );
}

/** "KES 1,234.50" / "-KES 1,234.50". Edge formatting only. */
export function formatKes(value: Cents, opts: { currency?: boolean } = {}): string {
  const negative = value < 0n;
  const a = abs(value);
  const whole = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (a % 100n).toString().padStart(2, '0');
  const body = `${opts.currency === false ? '' : 'KES '}${whole}.${frac}`;
  return negative ? `-${body}` : body;
}

/** Convert to the JSON integer used on the wire; throws past 2^53 rather than losing precision. */
export function toApiInt(value: Cents): number {
  if (value > MAX_SAFE || value < -MAX_SAFE)
    throw new RangeError(`Cents out of JSON-safe range: ${value}`);
  return Number(value);
}

export function fromApiInt(value: number): Cents {
  return cents(value);
}

function assertInteger(n: number, label: string): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${label} must be a safe integer, got ${n}`);
  return n;
}

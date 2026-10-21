import type { Redis } from 'ioredis';
import { AppError } from '../errors';

/**
 * Fixed-window counter in Redis. Throws 429 with a retry hint when `max` is exceeded.
 * Used where one route needs several keys (e.g. OTP: per phone AND per IP).
 */
export async function hitLimit(
  redis: Redis,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<void> {
  const k = `kj:rl:${key}`;
  const [[, count], [, ttl]] = (await redis.multi().incr(k).ttl(k).exec()) as [
    [null, number],
    [null, number],
  ];
  if (ttl < 0) await redis.expire(k, windowSeconds);
  if (count > max) {
    throw new AppError(
      429,
      'rate_limited',
      'Too many requests',
      `Try again in ${Math.max(ttl, 1)} seconds.`,
    );
  }
}

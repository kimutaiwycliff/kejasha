import { expect, it } from 'vitest';
import { uuidv7, uuidv7Timestamp } from './id';

it('produces RFC 9562 v7 ids that sort by time', () => {
  const a = uuidv7(1_700_000_000_000);
  const b = uuidv7(1_700_000_000_001);
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(a < b).toBe(true);
  expect(uuidv7Timestamp(a)).toBe(1_700_000_000_000);
  expect(new Set(Array.from({ length: 1000 }, () => uuidv7())).size).toBe(1000);
});

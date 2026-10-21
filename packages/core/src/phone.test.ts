import { describe, expect, it } from 'vitest';
import { isKenyanMobile, maskPhone, normalizeKenyanPhone } from './phone';

describe('normalizeKenyanPhone', () => {
  it.each([
    ['0712345678', '+254712345678'],
    ['0112345678', '+254112345678'],
    ['712345678', '+254712345678'],
    ['112345678', '+254112345678'],
    ['254712345678', '+254712345678'],
    ['+254712345678', '+254712345678'],
    ['00254712345678', '+254712345678'],
    ['+254 712 345 678', '+254712345678'],
    ['0712-345-678', '+254712345678'],
    ['(0712) 345.678', '+254712345678'],
  ])('%s → %s', (input, expected) => expect(normalizeKenyanPhone(input)).toBe(expected));

  it.each([
    '',
    '0812345678', // not a mobile prefix
    '071234567', // too short
    '07123456789', // too long
    '+255712345678', // Tanzania
    '+44712345678',
    '07123abc78',
    '254',
  ])('rejects %s', (input) => {
    expect(normalizeKenyanPhone(input)).toBeNull();
    expect(isKenyanMobile(input)).toBe(false);
  });
});

it('masks phones for logs', () => {
  expect(maskPhone('+254712345678')).toBe('+2547****5678');
});

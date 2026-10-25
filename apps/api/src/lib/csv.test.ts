import { describe, expect, it } from 'vitest';
import { kes, toCsv } from './csv';

describe('csv', () => {
  it('quotes, escapes and neutralises formulas', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['x,y', 'say "hi"'],
          ['=SUM(A1)', -12],
          ['@cmd', null],
        ],
      ),
    ).toBe('a,b\r\n"x,y","say ""hi"""\r\n\'=SUM(A1),-12\r\n\'@cmd,\r\n');
  });
  it('formats cents', () => {
    expect(kes(123_456n)).toBe('1234.56');
    expect(kes(5n)).toBe('0.05');
    expect(kes(-250n)).toBe('-2.50');
  });
});

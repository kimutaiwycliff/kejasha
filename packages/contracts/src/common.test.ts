import { describe, expect, it } from 'vitest';
import { RequiredTextInput, SafeString, TextInput } from './common';

describe('text inputs reject NUL (Postgres cannot store it)', () => {
  it('required text rejects a single NUL anywhere, and blank text', () => {
    const t = RequiredTextInput(50);
    for (const bad of ['a\u0000b', '\u0000', 'abc\u0000', '\u0000abc', '   ', ''])
      expect(t.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(t.parse('  Kilimani Court ')).toBe('Kilimani Court');
  });

  it('optional and safe text reject NUL too', () => {
    expect(TextInput(50).safeParse('a\u0000b').success).toBe(false);
    expect(SafeString(50).safeParse('a\u0000b').success).toBe(false);
    expect(TextInput(50).parse(' ok ')).toBe('ok');
  });
});

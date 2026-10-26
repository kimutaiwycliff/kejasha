import { describe, expect, it } from 'vitest';
import { bpsLabel, feeLabel } from './labels';

describe('basis points and fees', () => {
  it('shows basis points as a trimmed percent', () => {
    expect(bpsLabel(750)).toBe('7.5%');
    expect(bpsLabel(1000)).toBe('10%');
    expect(bpsLabel(1234)).toBe('12.34%');
    expect(bpsLabel(null)).toBe('—');
  });

  it('describes a management fee', () => {
    expect(feeLabel({ mgmtFeeKind: 'percent', mgmtFeeBps: 800, mgmtFeeFlatCents: null })).toBe(
      '8%',
    );
    expect(feeLabel({ mgmtFeeKind: 'flat', mgmtFeeBps: null, mgmtFeeFlatCents: 250_000 })).toBe(
      'Ksh\u00a02,500.00 / month',
    );
    expect(feeLabel({ mgmtFeeKind: 'none', mgmtFeeBps: null, mgmtFeeFlatCents: null })).toBe(
      'None',
    );
  });
});

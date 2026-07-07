import { describe, expect, it } from 'vitest';
import { tailRiskWidthAdjustment, type TailRiskFlag } from '../tailRisk';

describe('tail risk', () => {
  it('should not apply width adjustment when multiplier is disabled', () => {
    const flag: TailRiskFlag = {
      riskFlag: 'two-sided',
      direction: 'both',
      drivers: ['realized-volatility-jump'],
      intervalMultiplierAdjustment: 1.35,
    };

    expect(tailRiskWidthAdjustment(flag, false)).toBe(1);
  });
});

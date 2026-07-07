import { describe, expect, it } from 'vitest';
import { sampleResidualBlocksDeterministically } from '../forecastInterval';

describe('residual bootstrap helpers', () => {
  it('should sample residual blocks deterministically with seed', () => {
    const residuals = Array.from({ length: 40 }, (_, index) => Math.sin(index / 3) * 0.01);
    const first = sampleResidualBlocksDeterministically({
      residuals,
      blockDays: 5,
      horizonDays: 30,
      simulations: 12,
      seed: 12345,
    });
    const second = sampleResidualBlocksDeterministically({
      residuals,
      blockDays: 5,
      horizonDays: 30,
      simulations: 12,
      seed: 12345,
    });
    const differentSeed = sampleResidualBlocksDeterministically({
      residuals,
      blockDays: 5,
      horizonDays: 30,
      simulations: 12,
      seed: 54321,
    });

    expect(first).toEqual(second);
    expect(first).toHaveLength(12);
    expect(first).not.toEqual(differentSeed);
  });
});

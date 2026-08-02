import { describe, expect, it } from 'vitest';
import { intervalMultiplierForHorizon, sampleResidualBlocksDeterministically } from '../forecastInterval';
import { INTERVAL_CONFIG } from '../modelConfig';

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

  it('should retain baseline runtime multipliers while calibration remains report-only', () => {
    expect(intervalMultiplierForHorizon(90)).toBe(0.87);
    expect(intervalMultiplierForHorizon(365)).toBe(0.59);
    expect(intervalMultiplierForHorizon(366)).toBe(0.59);
  });

  it('should match the recorded fitted multipliers exactly', () => {
    expect(INTERVAL_CONFIG.fittedMultipliers).toEqual([
      { horizonDays: 14, multiplier: 1.01, coverageStatus: 'calibrated', label: 'Calibrated' },
      { horizonDays: 30, multiplier: 0.98, coverageStatus: 'calibrated', label: 'Calibrated' },
      { horizonDays: 60, multiplier: 0.99, coverageStatus: 'conservative', label: 'Conservative' },
      { horizonDays: 90, multiplier: 0.87, coverageStatus: 'calibrated', label: 'Calibrated' },
      { horizonDays: 180, multiplier: 0.86, coverageStatus: 'scenario', label: 'Scenario range' },
      { horizonDays: 365, multiplier: 0.59, coverageStatus: 'scenario', label: 'Scenario range' },
    ]);
  });
});

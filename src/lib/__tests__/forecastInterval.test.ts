import { describe, expect, it } from 'vitest';
import btcHistory from '../../data/btc-history.json';
import {
  computePowerLawInterval,
  intervalMultiplierForHorizon,
  sampleResidualBlocksDeterministically,
} from '../forecastInterval';
import { DISTRIBUTION_CONFIG, INTERVAL_CONFIG, validateDistributionConfig } from '../modelConfig';

const ohlcv = btcHistory.slice(-900);
const goldenInput = { ohlcv, horizonDays: 90, median: 123456.789, currentPrice: 100000 };

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
    expect(intervalMultiplierForHorizon(366)).toBeCloseTo(0.59 * Math.sqrt(366 / 365), 14);
  });

  it('should produce quantiles identical to the pre-refactor lognormal output', () => {
    const interval = computePowerLawInterval(goldenInput);
    expect(interval).toMatchObject({
      sigma: 0.14216065065934885,
      probabilityUp: 0.9308662503989715,
      q025: 93434.5744319942,
      q05: 97715.2607169943,
      q10: 102894.58360510557,
      q50: 123456.789,
      q90: 148128.0959227697,
      q95: 155979.5127020502,
      q975: 163125.6827876282,
    });
    expect(DISTRIBUTION_CONFIG.defaultEnabled).toBe(false);
    expect(() => validateDistributionConfig({
      ...DISTRIBUTION_CONFIG,
      defaultEnabled: true,
      kind: 'student-t',
    })).toThrow(/requires per-horizon nu values/);
  });

  it('should widen the band strictly between 365 and 1825 days', () => {
    const at365 = computePowerLawInterval({ ...goldenInput, horizonDays: 365 })!;
    const at1825 = computePowerLawInterval({ ...goldenInput, horizonDays: 1825 })!;
    expect(at1825.sigma).toBeGreaterThan(at365.sigma * 1.5);
  });

  it('should label horizons beyond the fitted maximum as scenario', () => {
    const interval = computePowerLawInterval({ ...goldenInput, horizonDays: 1825 })!;
    expect(interval.coverageStatus).toBe('scenario');
    expect(interval.calibrationLabel).toBe('Scenario range');
  });

  it('should remain monotone in horizon across the whole supported range', () => {
    let previousSigma = 0;
    for (let horizon = 1; horizon <= 3650; horizon++) {
      const interval = computePowerLawInterval({ ...goldenInput, horizonDays: horizon })!;
      expect(interval.sigma).toBeGreaterThanOrEqual(previousSigma);
      previousSigma = interval.sigma;
    }
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

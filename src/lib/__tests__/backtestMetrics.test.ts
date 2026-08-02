import { describe, expect, it } from 'vitest';
import { aggregateForecastMetrics, pinballLosses } from '../backtestMetrics';
import { crpsFromQuantiles } from '../properScoring';

describe('backtest metrics', () => {
  it('should compute pinball loss for multiple quantiles', () => {
    const losses = pinballLosses(10, {
      0.1: 8,
      0.5: 11,
      0.9: 12,
    });

    expect(losses[0.1]).toBeCloseTo(0.2);
    expect(losses[0.5]).toBeCloseTo(0.5);
    expect(losses[0.9]).toBeCloseTo(0.2);
  });

  it('should score a perfect median at zero pinball loss when actual equals prediction', () => {
    const row = aggregateForecastMetrics([{ actual: 0, forecast: { median: 0 } }]);

    expect(row.pinballLoss.q50).toBe(0);
  });

  it('should weight equal relative errors equally across price levels when scaled', () => {
    const row = aggregateForecastMetrics([
      { actual: 16_000, forecast: { median: 14_400 } },
      { actual: 100_000, forecast: { median: 90_000 } },
    ]);

    const firstLoss = 0.5 * (16_000 - 14_400);
    const secondLoss = 0.5 * (100_000 - 90_000);
    expect(row.pinballLoss.q50).toBeCloseTo((firstLoss + secondLoss) / 2);
    expect(secondLoss / firstLoss).toBeCloseTo(100_000 / 16_000);
    expect(row.pinballLoss.q50).not.toBeCloseTo(0.1);
  });

  it('should retain a zero-valued quantile when computing coverage', () => {
    const row = aggregateForecastMetrics([{
      actual: 1,
      forecast: { median: 1, quantiles: { q10: 0, q90: 2 } },
    }]);

    expect(row.coverage.interval80).toBe(1);
    expect(row.intervalWidthRatio.interval80).toBe(2);
  });

  it('should mark pinballScale absolute on every emitted row', () => {
    expect(aggregateForecastMetrics([]).pinballScale).toBe('absolute');
  });

  it('should report excludedFromPit when a forecast has no sigma', () => {
    const row = aggregateForecastMetrics([
      { actual: 100, forecast: { median: 100, sigma: 0.2 } },
      { actual: 100, forecast: { median: 100 } },
    ]);

    expect(row.excludedFromPit).toBe(1);
    expect(row.pitHistogram?.samples).toBe(1);
  });

  it('should wire the full ForecastDistribution quantile grid into approximate CRPS', () => {
    const forecast = {
      median: 100,
      quantiles: { q025: 20, q05: 40, q10: 80, q50: 100, q90: 120, q95: 160, q975: 1_000 },
    };
    const row = aggregateForecastMetrics([{ actual: 100, forecast }]);
    const fullGridScore = crpsFromQuantiles(100, forecast.quantiles)!;
    const fivePointScore = crpsFromQuantiles(100, { q05: 40, q10: 80, q50: 100, q90: 120, q95: 160 })!;

    expect(row.crps).toBeCloseTo(fullGridScore);
    expect(row.crps).not.toBeCloseTo(fivePointScore);
  });

  it('should keep PIT histogram and uniformity null when every PIT sample is excluded', () => {
    const row = aggregateForecastMetrics([{ actual: 100, forecast: { median: 100 } }]);

    expect(row.pitHistogram).toBeNull();
    expect(row.pitUniformity).toBeNull();
    expect(row.excludedFromPit).toBe(row.samples);
  });
});

import { describe, expect, it } from 'vitest';
import { assertFeatureRowLagSafe } from '../featureExperimentDataset';
import type { FeatureRow } from '../features';

describe('feature experiment dataset', () => {
  it('should reject future source dates', () => {
    const row: FeatureRow = {
      date: '2026-01-10',
      features: {
        stablecoinSupplyChange30d: 0.04,
      },
      sourceDates: {
        stablecoinSupplyChange30d: '2026-01-10',
      },
      missingFeatureReasons: {},
    };

    expect(() => assertFeatureRowLagSafe(row, ['stablecoinSupplyChange30d'], '2026-01-10'))
      .toThrow(/sourceDate >= originDate/);
  });
});

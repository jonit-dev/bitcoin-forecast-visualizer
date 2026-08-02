import { describe, expect, it } from 'vitest';
import { classifyRegime } from '../regimeModel';
import type { FeatureRow } from '../features';

function row(features: Record<string, number>): FeatureRow {
  return {
    date: '2026-08-02',
    features,
    sourceDates: {},
    missingFeatureReasons: {},
  };
}

const completeFeatures = {
  priceResidualLog: 0,
  mvrvPercentile: 0.5,
  residualMomentum30d: 0,
  mvrvLevel: 2,
  realizedPriceDistance: 0,
  drawdownFromCycleHigh: -0.1,
  futuresOpenInterestToMarketCap: 0.002,
  futuresFundingRateDailySum: 0,
  volatilityRegime30d: 0.4,
  hashRate: 0,
};

describe('regime missing-data handling', () => {
  it('should return insufficient-data when required on-chain features are absent', () => {
    const result = classifyRegime(row({
      priceResidualLog: -0.2,
      drawdownFromCycleHigh: -0.1,
    }));

    expect(result.topState).toBe('insufficient-data');
    expect(result.reasonCodes).toContain('unavailable:mvrvPercentile');
    expect(result.reasonCodes.some(reason => reason.startsWith('insufficient-data:'))).toBe(true);
  });

  it('should return probability-one insufficient-data at exactly 40% unavailable inputs', () => {
    const features = { ...completeFeatures };
    delete features.mvrvPercentile;
    delete features.mvrvLevel;
    delete features.realizedPriceDistance;
    delete features.hashRate;

    const result = classifyRegime(row(features));

    expect(result.topState).toBe('insufficient-data');
    expect(result.probabilities['insufficient-data']).toBe(1);
    expect(result.probabilities['sideways-chop']).toBe(0);
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'unavailable:mvrvPercentile',
      'unavailable:mvrvLevel',
      'unavailable:realizedPriceDistance',
      'unavailable:hashRate',
      'insufficient-data:4/10-inputs-unavailable',
    ]));
  });

  it('should not count an absent feature toward the regime score', () => {
    const withNeutralHashRate = classifyRegime(row(completeFeatures));
    const withoutHashRate = { ...completeFeatures };
    delete withoutHashRate.hashRate;
    const omitted = classifyRegime(row(withoutHashRate));

    expect(omitted.topState).toBe(withNeutralHashRate.topState);
    expect(omitted.probabilities).toEqual(withNeutralHashRate.probabilities);
    expect(omitted.reasonCodes).toContain('unavailable:hashRate');
  });
});

import type { FeatureRow } from './features';

export interface TailRiskFlag {
  riskFlag: 'none' | 'downside' | 'upside' | 'two-sided';
  direction: 'neutral' | 'down' | 'up' | 'both';
  drivers: string[];
  // Context-only risk weight. Do not apply to forecast intervals without a backtested calibration gate.
  intervalMultiplierAdjustment: number;
}

export function computeTailRisk(row: FeatureRow | null | undefined): TailRiskFlag {
  if (!row) return { riskFlag: 'none', direction: 'neutral', drivers: ['missing-feature-row'], intervalMultiplierAdjustment: 1 };
  const f = row.features;
  const drivers: string[] = [];
  let downside = 0;
  let upside = 0;

  if (f.volatilityRegime30d > 0.75) {
    downside += 1;
    upside += 1;
    drivers.push('realized-volatility-jump');
  }
  if (f.mvrvPercentile > 0.85) {
    downside += 1;
    drivers.push('high-mvrv-percentile');
  }
  if (f.priceResidualLog < -0.35) {
    upside += 1;
    drivers.push('deep-power-law-discount');
  }
  if (f.drawdownFromCycleHigh < -0.45) {
    upside += 0.5;
    downside += 0.5;
    drivers.push('large-cycle-drawdown');
  }
  if ((f.futuresOpenInterestToMarketCap ?? 0) > 0.0035 && Math.abs(f.futuresFundingRateDailySum ?? 0) > 0.0002) {
    downside += 0.5;
    upside += 0.25;
    drivers.push('futures-leverage-crowding');
  }

  const riskFlag = downside > 0 && upside > 0 ? 'two-sided' : downside > 0 ? 'downside' : upside > 0 ? 'upside' : 'none';
  const direction = riskFlag === 'two-sided' ? 'both' : riskFlag === 'downside' ? 'down' : riskFlag === 'upside' ? 'up' : 'neutral';
  return {
    riskFlag,
    direction,
    drivers: drivers.length > 0 ? drivers : ['no-extreme-tail-driver'],
    intervalMultiplierAdjustment: riskFlag === 'none' ? 1 : Math.min(1.35, 1 + 0.08 * (downside + upside)),
  };
}

import { describe, expect, it } from 'vitest';
import btcHistory from '../../data/btc-history.json';
import { computeDrawdownStats } from '../data';
import { computePowerLawInterval, intervalMultiplierForHorizon } from '../forecastInterval';
import { classifyRegime } from '../regimeModel';
import { computeTailRisk } from '../tailRisk';
import type { OHLCVData } from '../api';
import type { FeatureRow } from '../features';
import { computeBuyZoneBacktests, type BuyZonePoint } from '../buyZone';
import { yellowLineForecastRoute } from '../data';
import {
  YELLOW_LINE_FORECAST_CONFIG,
  validateYellowLineForecastConfig,
  type YellowLineForecastCandidateConfig,
} from '../modelConfig';

const ohlcv = (btcHistory as OHLCVData[]).slice(-900);

describe('engineering hygiene guardrails', () => {
  it('should require evidence artifact for enabled forecast candidate', () => {
    expect(YELLOW_LINE_FORECAST_CONFIG.enabled).toBe(false);
    expect(yellowLineForecastRoute(90)).toBe('production-baseline');

    const invalid: YellowLineForecastCandidateConfig = {
      enabled: true,
      candidateId: 'state-space-residual',
      horizons: [90],
      evidenceArtifact: null,
      evidenceSha256: null,
      configSha256: null,
    };
    expect(() => validateYellowLineForecastConfig(invalid)).toThrow(/requires an exact results artifact/);
  });

  it('should keep forecast quantiles ordered', () => {
    const latest = ohlcv.at(-1)!;
    const interval = computePowerLawInterval({
      ohlcv,
      horizonDays: 90,
      median: latest.close * 1.1,
      currentPrice: latest.close,
    });

    expect(interval).not.toBeNull();
    expect(interval!.q05).toBeLessThan(interval!.q50);
    expect(interval!.q50).toBeLessThan(interval!.q95);
    expect(intervalMultiplierForHorizon(90)).toBeGreaterThan(0);
  });

  it('should output normalized probabilities and explicit drivers', () => {
    const row: FeatureRow = {
      date: '2026-01-02',
      features: {
        priceResidualLog: -0.4,
        mvrvPercentile: 0.2,
        residualMomentum30d: 0.01,
        volatilityRegime30d: 0.9,
        drawdownFromCycleHigh: -0.5,
      },
      sourceDates: {},
      missingFeatureReasons: {},
    };

    const regime = classifyRegime(row);
    const total = Object.values(regime.probabilities).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1);
    expect(regime.reasonCodes.length).toBeGreaterThan(0);

    const tail = computeTailRisk(row);
    expect(tail.drivers).toContain('realized-volatility-jump');
    expect(tail.riskFlag).not.toBe('none');
  });

  it('should produce identical drawdown stats with same seed', () => {
    expect(computeDrawdownStats(ohlcv, 180, 1234)).toEqual(computeDrawdownStats(ohlcv, 180, 1234));
  });

  it('should produce different paths with different seeds', () => {
    const first = computeDrawdownStats(ohlcv, 180, 1234);
    const second = computeDrawdownStats(ohlcv, 180, 5678);

    expect(first.gbmExpectedMDD).not.toBe(second.gbmExpectedMDD);
  });

  it('should respect buy-zone threshold behavior', () => {
    const dates = [3000, 3300, 3600, 3900].map(index => (btcHistory as OHLCVData[])[index].date);
    const points: BuyZonePoint[] = [
      buildPoint(dates[0], 0.69, 0.9),
      buildPoint(dates[1], 0.70, 0.8),
      buildPoint(dates[2], 0.75, 0.79),
      buildPoint(dates[3], 0.76, 0.8),
    ];

    const backtests = computeBuyZoneBacktests(points);
    expect(backtests.find(backtest => backtest.id === 'heavy-buy-zone')?.sampleCount).toBe(3);
    expect(backtests.find(backtest => backtest.id === 'max-conviction-buy-zone')?.sampleCount).toBe(2);
    expect(backtests.find(backtest => backtest.id === 'capitulation-heavy-buy-zone')?.sampleCount).toBe(2);
  });
});

function buildPoint(date: string, bottomScore: number, drawdownPainPctPast: number): BuyZonePoint {
  return {
    date,
    close: 10_000,
    bottomScore,
    residualPctPast: 1 - bottomScore,
    mvrvPercentile: 1 - bottomScore,
    realizedPctPast: 1 - bottomScore,
    drawdownPainPctPast,
    isHeavyBuy: bottomScore >= 0.70,
    isMaxConviction: bottomScore >= 0.75,
  };
}

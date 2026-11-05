import { describe, expect, it } from 'vitest';
import { countUsMarketSessionsAfter } from '../../../shared/us-market-calendar.mjs';
import { loadMarketData } from '../api';
import {
  GOLD_VOL_TERM_STRUCTURE,
  SP500_VOL_TERM_STRUCTURE,
  buildMarketForecast,
  buildMarketForecastSummary,
  computeGoldModelInputs,
  computeSP500ModelInputs,
  ewmaDailyVariance,
  termStructureLogVariance,
  type VolTermStructureConfig,
} from '../marketForecast';

const Z95 = 1.6448536269514722;

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Expected log width, built from the session count of the shared calendar walk. */
function expectedLogScale(returns: number[], originDate: string, horizon: number, config: VolTermStructureConfig): number {
  const sessions = countUsMarketSessionsAfter(originDate, addDays(originDate, horizon));
  const spot = ewmaDailyVariance(returns, config.halfLifeSessions)!;
  return config.scale * Math.sqrt(termStructureLogVariance(spot, config.longRunDailyVol ** 2, config.persistence, sessions));
}

describe('session volatility term structure', () => {
  it('accumulates n * variance when today already sits at the long run', () => {
    expect(termStructureLogVariance(1e-4, 1e-4, 0.99, 252)).toBeCloseTo(252e-4, 15);
  });

  it('reverts a high spot variance toward the long run with shrinking daily increments', () => {
    const at = (n: number) => termStructureLogVariance(9e-4, 1e-4, 0.97, n);
    const increments = [1, 2, 10, 100, 1000].map((n) => at(n) - at(n - 1));
    for (let i = 1; i < increments.length; i++) expect(increments[i]).toBeLessThan(increments[i - 1]);
    expect(increments.at(-1)!).toBeCloseTo(1e-4, 10);
  });

  it('seeds the EWMA with the first 60 squares and needs more than 60 returns', () => {
    expect(ewmaDailyVariance(Array(60).fill(0.01), 21)).toBeNull();
    expect(ewmaDailyVariance(Array(300).fill(0.01), 21)).toBeCloseTo(1e-4, 15);
  });

  it('sets the S&P 500 summary width from the term structure', () => {
    const sp500 = loadMarketData('sp500');
    const { returns } = computeSP500ModelInputs(sp500.ohlcv);
    const origin = sp500.ohlcv.at(-1)!.date;
    for (const horizon of [7, 180, 365, 1825]) {
      const summary = buildMarketForecastSummary('sp500', sp500, horizon, Z95).probabilityForecast!;
      expect(Math.log(summary.q95 / summary.median) / Z95)
        .toBeCloseTo(expectedLogScale(returns, origin, horizon, SP500_VOL_TERM_STRUCTURE), 12);
    }
  });

  it('sets the gold summary width from the term structure everywhere except the 365-day ridge', () => {
    const gold = loadMarketData('gold');
    const { returns, dailyVol } = computeGoldModelInputs(gold.ohlcv);
    const origin = gold.ohlcv.at(-1)!.date;
    for (const horizon of [7, 30, 180, 730]) {
      const summary = buildMarketForecastSummary('gold', gold, horizon, Z95).probabilityForecast!;
      expect(Math.log(summary.q95 / summary.median) / Z95)
        .toBeCloseTo(expectedLogScale(returns, origin, horizon, GOLD_VOL_TERM_STRUCTURE), 12);
    }
    const ridge = buildMarketForecastSummary('gold', gold, 365, Z95).probabilityForecast!;
    expect(ridge.calibrationLabel).toBe('Direct 1Y ridge interval');
    expect(Math.log(ridge.q95 / ridge.median) / Z95).toBeCloseTo(dailyVol * Math.sqrt(365), 12);
  });

  it('keeps the gold band prefix when the horizon grows', () => {
    const gold = loadMarketData('gold');
    const short = buildMarketForecast('gold', gold, 90, Z95).displayData.filter((row) => row.isForecast);
    const long = buildMarketForecast('gold', gold, 180, Z95).displayData.filter((row) => row.isForecast);
    for (let index = 0; index < short.length; index++) {
      expect(long[index].forecastUpper).toBe(short[index].forecastUpper);
      expect(long[index].forecastLower).toBe(short[index].forecastLower);
    }
  }, 30_000);
});

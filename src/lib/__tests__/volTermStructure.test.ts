import { describe, expect, it } from 'vitest';
import { countUsMarketSessionsAfter } from '../../../shared/us-market-calendar.mjs';
import { loadMarketData } from '../api';
import {
  GOLD_VOL_TERM_STRUCTURE,
  SP500_VIX_TERM_STRUCTURE,
  SP500_VOL_TERM_STRUCTURE,
  buildMarketForecast,
  buildMarketForecastSummary,
  computeGoldModelInputs,
  computeSP500ModelInputs,
  ewmaDailyVariance,
  termStructureLogVariance,
  vixSpotVariance,
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

  it('sets the S&P 500 summary width from the VIX term structure inside the first year', () => {
    const sp500 = loadMarketData('sp500');
    const origin = sp500.ohlcv.at(-1)!.date;
    const impliedSpot = vixSpotVariance(sp500.ohlcv, sp500.impliedVol);
    expect(impliedSpot).not.toBeNull();
    for (const horizon of [7, 180, 365]) {
      const sessions = countUsMarketSessionsAfter(origin, addDays(origin, horizon));
      const expected = SP500_VIX_TERM_STRUCTURE.scale * Math.sqrt(
        termStructureLogVariance(
          impliedSpot!,
          SP500_VIX_TERM_STRUCTURE.longRunDailyVol ** 2,
          SP500_VIX_TERM_STRUCTURE.persistence,
          sessions
        )
      );
      const summary = buildMarketForecastSummary('sp500', sp500, horizon, Z95).probabilityForecast!;
      expect(Math.log(summary.q95 / summary.median) / Z95).toBeCloseTo(expected, 12);
    }
  });

  it('keeps the EWMA price-only S&P 500 width when the VIX feed is absent', () => {
    const sp500 = loadMarketData('sp500');
    const noVix = { ...sp500, impliedVol: undefined };
    const { returns } = computeSP500ModelInputs(sp500.ohlcv);
    const origin = sp500.ohlcv.at(-1)!.date;
    for (const horizon of [7, 180, 365, 1825]) {
      const summary = buildMarketForecastSummary('sp500', noVix, horizon, Z95).probabilityForecast!;
      expect(Math.log(summary.q95 / summary.median) / Z95)
        .toBeCloseTo(expectedLogScale(returns, origin, horizon, SP500_VOL_TERM_STRUCTURE), 12);
    }
  });

  it('reads the VIX close of the session before the origin and never carries a stale one', () => {
    const sp500 = loadMarketData('sp500');
    const vix = sp500.impliedVol!;
    const previous = sp500.ohlcv.at(-2)!;
    const index = vix.findIndex((row) => row.date === previous.date);
    expect(index).toBeGreaterThan(-1);
    const throughPrevious = vix.slice(0, index);
    expect(vixSpotVariance(sp500.ohlcv, throughPrevious)).toBeNull();
    const hit = vix.find((row) => row.date === previous.date)!;
    expect(vixSpotVariance(sp500.ohlcv, vix)).toBeCloseTo((hit.close / 100) ** 2 / 252, 15);
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

  it('decays gold momentum to a 4% long-run drift after one year', () => {
    const gold = loadMarketData('gold');
    const { drift } = computeGoldModelInputs(gold.ohlcv);
    const last = gold.ohlcv.at(-1)!;
    const expectedLogReturn = drift * 365 + Math.log(1.04) * (3650 - 365) / 365;
    const summary = buildMarketForecastSummary('gold', gold, 3650, Z95).probabilityForecast!;
    expect(Math.log(summary.median / last.close)).toBeCloseTo(expectedLogReturn, 6);
  });

  it('keeps the gold ten-year primary path on the capped reference drift', () => {
    const gold = loadMarketData('gold');
    const { drift } = computeGoldModelInputs(gold.ohlcv);
    const last = gold.ohlcv.at(-1)!;
    const rows = buildMarketForecast('gold', gold, 3650, Z95).displayData.filter((row) => row.isForecast);
    const terminal = rows.at(-1)!;
    const ratio = terminal.close / terminal.forecast;
    console.log('gold 3650 terminal candle/median ratio', ratio);
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.6);
    const cappedReference = last.close * Math.exp(drift * 365 + Math.log(1.04) * (3650 - 365) / 365);
    expect(terminal.traceReference / cappedReference).toBeCloseTo(1, 6);
  }, 60_000);

  it('keeps the projected gold floor below the median at ten years', () => {
    const gold = loadMarketData('gold');
    const { drift } = computeGoldModelInputs(gold.ohlcv);
    const last = gold.ohlcv.at(-1)!;
    const rows = buildMarketForecast('gold', gold, 3650, Z95).displayData.filter((row) => row.isForecast);
    const terminal = rows.at(-1)!;
    expect(terminal.floorPriceModel).toBeLessThan(terminal.forecast);
    expect(terminal.forecast).toBeLessThan(last.close * Math.exp(drift * 3650));
  }, 60_000);

  it('keeps gold chart rows prefix-stable past one year', () => {
    const gold = loadMarketData('gold');
    const short = buildMarketForecast('gold', gold, 730, Z95).displayData.filter((row) => row.isForecast);
    const long = buildMarketForecast('gold', gold, 1825, Z95).displayData.filter((row) => row.isForecast);
    for (let index = 0; index < short.length; index++) {
      expect(long[index].forecast).toBe(short[index].forecast);
      expect(long[index].forecastUpper).toBe(short[index].forecastUpper);
      expect(long[index].forecastLower).toBe(short[index].forecastLower);
      expect(long[index].floorPriceModel).toBe(short[index].floorPriceModel);
    }
  }, 60_000);
});

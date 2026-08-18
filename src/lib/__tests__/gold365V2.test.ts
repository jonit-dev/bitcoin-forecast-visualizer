import { describe, expect, it } from 'vitest';
import gldHistory from '../../data/gld-history.json';
import goldMacroHistory from '../../data/gold-macro-history.json';
import {
  GOLD_365_V2_GOLDEN,
  buildGold365Features,
  buildGold365Forecast,
  predictGold365LogReturn,
  shouldUseGold365V2,
} from '../gold365V2';
import { buildMarketForecast, computeGoldModelInputs } from '../marketForecast';

const ohlcv = gldHistory as { date: string; open: number; high: number; low: number; close: number; volume: number }[];
const baseline = computeGoldModelInputs(ohlcv);
const marketData = { ohlcv } as Parameters<typeof buildMarketForecast>[1];

describe('GLD 365-day ridge challenger', () => {
  it('reproduces the offline scikit-learn forecast for the frozen snapshot', () => {
    const golden = GOLD_365_V2_GOLDEN;
    expect(ohlcv[ohlcv.length - 1].date).toBe(golden.asOf);

    const features = buildGold365Features(ohlcv);
    expect(features).not.toBeNull();
    expect(predictGold365LogReturn(features!)).toBeCloseTo(golden.logReturn, 12);

    const forecast = buildGold365Forecast(ohlcv, baseline.dailyVol)!;
    expect(forecast.medianPrice).toBeCloseTo(golden.medianPrice, 8);
    expect(forecast.q05Price).toBeCloseTo(golden.q05Price, 8);
    expect(forecast.q95Price).toBeCloseTo(golden.q95Price, 8);
    // The normal CDF is the incumbent's rational approximation, not scipy's.
    expect(forecast.probabilityUp).toBeCloseTo(golden.probabilityUp, 5);
  });

  it('keeps the incumbent interval width rather than a recalibrated one', () => {
    const golden = GOLD_365_V2_GOLDEN;
    expect(baseline.dailyVol).toBeCloseTo(golden.baselineSigma, 12);
    const forecast = buildGold365Forecast(ohlcv, baseline.dailyVol)!;
    const impliedSigma = Math.log(forecast.q95Price / forecast.medianPrice) / 1.6448536269514722;
    expect(impliedSigma).toBeCloseTo(baseline.dailyVol * Math.sqrt(365), 12);
  });

  it('applies only at the 365-day horizon', () => {
    expect(shouldUseGold365V2(365)).toBe(true);
    for (const horizon of [7, 14, 30, 90, 180, 730, 1825, 3650]) {
      expect(shouldUseGold365V2(horizon)).toBe(false);
      expect(buildMarketForecast('gold', marketData, horizon, 1.6448536269514722).probabilityForecast?.calibrationLabel)
        .toBe('Slow momentum interval');
    }
    expect(buildMarketForecast('gold', marketData, 365, 1.6448536269514722).probabilityForecast?.calibrationLabel)
      .toBe('Direct 1Y ridge interval');
  }, 30_000);

  it('drives the rendered 365-day median to the model endpoint', () => {
    const rows = buildMarketForecast('gold', marketData, 365, 1.6448536269514722)
      .displayData.filter((row: { isForecast: boolean }) => row.isForecast);
    expect(rows[rows.length - 1].forecast).toBeCloseTo(GOLD_365_V2_GOLDEN.medianPrice, 6);
  });

  it('fails closed to the baseline on a short snapshot', () => {
    expect(buildGold365Features(ohlcv.slice(-400))).toBeNull();
    expect(buildGold365Forecast(ohlcv.slice(-400), baseline.dailyVol)).toBeNull();
  });

  it('fails closed when the macro cache does not reach the origin session', () => {
    const future = [...ohlcv, { ...ohlcv[ohlcv.length - 1], date: '2099-01-04' }];
    expect(buildGold365Features(future)).toBeNull();
  });

  it('aligns the macro cache to GLD sessions so the one-session lag is exact', () => {
    const rows = (goldMacroHistory as { rows: { date: string }[] }).rows;
    const tail = ohlcv.slice(ohlcv.length - rows.length).map((row) => row.date);
    expect(rows.map((row) => row.date)).toEqual(tail);
  });

  it('leaves the S&P 500 surface on its own model', () => {
    const sp500 = buildMarketForecast('sp500', marketData, 365, 1.6448536269514722);
    expect(sp500.probabilityForecast?.calibrationLabel).not.toBe('Direct 1Y ridge interval');
  });
});

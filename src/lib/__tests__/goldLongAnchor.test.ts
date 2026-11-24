import { describe, expect, it } from 'vitest';
import { loadMarketData, type OHLCVData } from '../api';
import { computeGoldM2MeanReversion } from '../goldLongAnchor';
import { addMonthsYm, type GoldMonthlyRow } from '../goldLongHorizonModel';
import {
  GOLD_LONG_RUN_DRIFT,
  GOLD_MOMENTUM_DAYS,
  buildMarketForecast,
  computeGoldModelInputs,
  genericHeatmapDriftIncrements,
  genericMedianLogReturnAtDay,
} from '../marketForecast';

function makeSyntheticDailyGld(days = 400, startDate = '2024-01-02', startClose = 200): OHLCVData[] {
  const rows: OHLCVData[] = [];
  const d = new Date(`${startDate}T00:00:00Z`);
  let count = 0;
  while (rows.length < days) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const close = startClose * Math.exp(0.0002 * count);
      rows.push({
        date: d.toISOString().slice(0, 10),
        open: close,
        high: close * 1.005,
        low: close * 0.995,
        close,
        volume: 1_000_000,
      });
      count += 1;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return rows;
}

function makeSyntheticMonthlyMacro(months = 120, startYm = '2016-01'): GoldMonthlyRow[] {
  return Array.from({ length: months }, (_, i) => ({
    ym: addMonthsYm(startYm, i),
    gold: 1200 * Math.exp(0.004 * i),
    cpi: 240 * Math.exp(0.002 * i),
    m2: 12500 * Math.exp(0.005 * i),
    gs10: 3.5,
  }));
}

describe('causal Gold/M2 long-horizon valuation anchor', () => {
  it('enforces zero future-month and zero same-month M2/gold leakage', () => {
    const gld = makeSyntheticDailyGld(420, '2024-01-02', 200);
    const originYm = gld[gld.length - 1].date.slice(0, 7);
    const monthly = makeSyntheticMonthlyMacro(150, '2014-01');

    const base = computeGoldM2MeanReversion(gld, monthly);
    expect(base).not.toBeNull();

    // Mutate same-month and future-month rows in monthly table: must have zero effect
    const mutatedFuture = monthly.map((row) =>
      row.ym >= originYm ? { ...row, gold: row.gold * 5, m2: (row.m2 ?? 1) * 5 } : row
    );
    const afterFutureMutation = computeGoldM2MeanReversion(gld, mutatedFuture);
    expect(afterFutureMutation).toEqual(base);
  });

  it('fails closed to null when history is too short or M2 is stale beyond 3 months', () => {
    const gld = makeSyntheticDailyGld(420, '2024-01-02', 200);
    const monthly = makeSyntheticMonthlyMacro(130, '2015-01');

    // Too few GLD sessions
    expect(computeGoldM2MeanReversion(gld.slice(0, 200), monthly)).toBeNull();

    // Origin date far past final M2 month (stale > 3 months) -> fail closed
    const staleGld = gld.map((r, idx) =>
      idx === gld.length - 1 ? { ...r, date: '2099-01-04' } : r
    );
    expect(computeGoldM2MeanReversion(staleGld, monthly)).toBeNull();
  });

  it('leaves days <= 365 unchanged and matches heatmap drift increments at 3650d', () => {
    const gold = loadMarketData('gold');
    const baseline = computeGoldModelInputs(gold.ohlcv);
    const mr = computeGoldM2MeanReversion(gold.ohlcv);
    expect(mr).not.toBeNull();

    const withMr = {
      ...baseline,
      momentumDays: GOLD_MOMENTUM_DAYS,
      longRunDrift: GOLD_LONG_RUN_DRIFT,
      longRunMeanReversion: { amplitude: mr!.amplitude, decayDays: mr!.decayDays },
    };
    const withoutMr = {
      ...baseline,
      momentumDays: GOLD_MOMENTUM_DAYS,
      longRunDrift: GOLD_LONG_RUN_DRIFT,
    };

    for (const day of [1, 30, 90, 180, 365]) {
      expect(genericMedianLogReturnAtDay(withMr, day)).toBe(genericMedianLogReturnAtDay(withoutMr, day));
    }

    // Continuity from day 365 -> 366 (single day change near daily longRunDrift)
    const stepAtKink = genericMedianLogReturnAtDay(withMr, 366) - genericMedianLogReturnAtDay(withMr, 365);
    expect(Math.abs(stepAtKink)).toBeLessThan(0.01);

    // Heatmap increments sum exactly to the 10Y declared log return
    const increments = genericHeatmapDriftIncrements(withMr, 3650);
    const sumIncrements = increments.reduce((a, b) => a + b, 0);
    expect(sumIncrements).toBeCloseTo(genericMedianLogReturnAtDay(withMr, 3650), 10);
  });

  it('preserves prefix stability across 730d, 1825d, and 3650d with the M2 anchor active', () => {
    const gold = loadMarketData('gold');
    const z95 = 1.6448536269514722;
    const f730 = buildMarketForecast('gold', gold, 730, z95).displayData.filter((r) => r.isForecast);
    const f1825 = buildMarketForecast('gold', gold, 1825, z95).displayData.filter((r) => r.isForecast);
    const f3650 = buildMarketForecast('gold', gold, 3650, z95).displayData.filter((r) => r.isForecast);

    for (let i = 0; i < f730.length; i += 1) {
      expect(f1825[i].forecast).toBe(f730[i].forecast);
      expect(f1825[i].forecastUpper).toBe(f730[i].forecastUpper);
      expect(f1825[i].forecastLower).toBe(f730[i].forecastLower);
      expect(f1825[i].floorPriceModel).toBe(f730[i].floorPriceModel);
    }
    for (let i = 0; i < f1825.length; i += 1) {
      expect(f3650[i].forecast).toBe(f1825[i].forecast);
      expect(f3650[i].forecastUpper).toBe(f1825[i].forecastUpper);
      expect(f3650[i].forecastLower).toBe(f1825[i].forecastLower);
      expect(f3650[i].floorPriceModel).toBe(f1825[i].floorPriceModel);
    }
  }, 60_000);
});

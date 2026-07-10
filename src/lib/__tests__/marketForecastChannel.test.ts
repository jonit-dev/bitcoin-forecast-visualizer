import { describe, expect, it } from 'vitest';
import btcHistory from '../../data/btc-history.json';
import type { OHLCVData } from '../api';
import { buildMarketForecast } from '../marketForecast';
import {
  buildFrozenResidualChannel,
  buildMarketForecastChannel,
  MARKET_CHANNEL_CANDIDATE_CONFIG,
  marketSessionDatesAfter,
  type BuildMarketForecastChannelOptions,
} from '../marketForecastChannel';

function rows(count = 1200): OHLCVData[] {
  const result: OHLCVData[] = [];
  const cursor = new Date('2018-01-02T00:00:00Z');
  while (result.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) {
      const index = result.length;
      const close = 100 * Math.exp(index * 0.00025 + Math.sin(index / 13) * 0.012);
      result.push({ date: cursor.toISOString().slice(0, 10), open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000 });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function options(overrides: Partial<BuildMarketForecastChannelOptions> = {}): BuildMarketForecastChannelOptions {
  return {
    assetId: 'sp500', rows: rows(), horizon: 180, drift: 0.0002, dailyVol: 0.012,
    seed: 0x51a7, baselineTrend: 130, baselineLowerResidual: -0.15, baselineUpperResidual: 0.18,
    config: { ...MARKET_CHANNEL_CANDIDATE_CONFIG, simulations: 160 }, ...overrides,
  };
}

describe('market forecast channel paths', () => {
  it('should explain straight generic bounds when residuals and drift are frozen', () => {
    for (const assetId of ['sp500', 'gold'] as const) {
      const result = buildFrozenResidualChannel(options({ assetId }));
      for (const key of ['lower', 'upper'] as const) {
        const logs = result.points.map((point) => Math.log(point[key]));
        const maxSecondDifference = Math.max(...logs.slice(2).map((value, index) => Math.abs(value - 2 * logs[index + 1] + logs[index])));
        expect(maxSecondDifference).toBeLessThan(1e-12);
      }
    }
  });

  it('should keep BTC floor and peak output unchanged when auditing generic channels', () => {
    const history = (btcHistory as OHLCVData[]).slice(-1200);
    const marketData = { ohlcv: history, currentPrice: history.at(-1)!.close, priceChange24h: 0, marketCap: 0, volume24h: 0, fetchedAt: Date.parse(`${history.at(-1)!.date}T00:00:00Z`) };
    const before = buildMarketForecast('btc', marketData, 30, 1.96).displayData
      .map(({ date, floorPriceModel, peakPriceModel }) => ({ date, floorPriceModel, peakPriceModel }));
    buildMarketForecastChannel(options());
    const after = buildMarketForecast('btc', marketData, 30, 1.96).displayData
      .map(({ date, floorPriceModel, peakPriceModel }) => ({ date, floorPriceModel, peakPriceModel }));
    expect(after).toEqual(before);
  });

  it('should never score future rows before their target date', () => {
    const origin = '2025-01-03';
    const targets = marketSessionDatesAfter(origin, 180);
    expect(targets).toHaveLength(180);
    expect(targets.every((date) => date > origin)).toBe(true);
  });

  it('should reproduce channel points when asset origin horizon config and seed match', () => {
    expect(buildMarketForecastChannel(options()).points).toEqual(buildMarketForecastChannel(options()).points);
  });

  it('should not change an earlier channel when future prices are mutated', () => {
    const allRows = rows(1250);
    const originRows = allRows.slice(0, 1200);
    const first = buildMarketForecastChannel(options({ rows: originRows })).points;
    for (const row of allRows.slice(1200)) row.close *= 10;
    const second = buildMarketForecastChannel(options({ rows: allRows.slice(0, 1200) })).points;
    expect(second).toEqual(first);
  });

  it('should return ordered finite positive bounds for every lead', () => {
    const result = buildMarketForecastChannel(options());
    expect(result.fallbackReason).toBeNull();
    for (const point of result.points) {
      expect(Number.isFinite(point.lower) && Number.isFinite(point.upper)).toBe(true);
      expect(point.lower).toBeGreaterThan(0);
      expect(point.upper).toBeGreaterThanOrEqual(point.lower);
    }
  });

  it('should map VOO and GLD leads to valid market sessions', () => {
    for (const origin of ['2024-12-20', '2025-06-13']) {
      const dates = marketSessionDatesAfter(origin, 180);
      expect(dates.every((date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()))).toBe(true);
      expect(dates).not.toContain('2024-12-25');
    }
  });

  it('should use the explicit baseline when candidate inputs are insufficient', () => {
    const result = buildMarketForecastChannel(options({ rows: rows(100) }));
    expect(result.methodId).toBe('frozen-residual-v1');
    expect(result.fallbackReason).toBe('insufficient-origin-history');
    expect(result.points).toHaveLength(180);
  });
});

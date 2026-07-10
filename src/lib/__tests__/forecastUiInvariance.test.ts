import { describe, expect, it } from 'vitest';
import { CONFIDENCE_Z_SCORES } from '../data';
import { loadMarketData, type MarketData, type MarketAssetId } from '../api';
import { buildMarketForecast } from '../marketForecast';

// Presentation-only workspace changes must not change these frozen forecast fixtures.
const FIXTURES = {
  btc: { end: '2020-01-01', rows: 3456, close: 7189.94, median: 16954.54260718957, q10: 12005.311200178212, q90: 23944.111920625546 },
  sp500: { end: '2017-01-03', rows: 1591, close: 177.1337, median: 197.17312707376053, q10: 175.00959351363804, q90: 222.1434908767771 },
  gold: { end: '2012-01-03', rows: 1794, close: 155.92, median: 164.42518564681197, q10: 131.41809678805419, q90: 205.72236499962844 },
} as const;

function frozenFixture(asset: MarketAssetId): MarketData {
  const live = loadMarketData(asset);
  const ohlcv = live.ohlcv.filter((row) => row.date <= FIXTURES[asset].end);
  const latest = ohlcv.at(-1)!;
  const previous = ohlcv.at(-2)!;
  expect(ohlcv).toHaveLength(FIXTURES[asset].rows);
  expect(latest.date).toBe(FIXTURES[asset].end);
  expect(latest.close).toBeCloseTo(FIXTURES[asset].close, 6);
  return { ...live, ohlcv, currentPrice: latest.close, volume24h: latest.volume, priceChange24h: ((latest.close - previous.close) / previous.close) * 100 };
}

describe('forecast outputs remain invariant across workspace presentation', () => {
  for (const asset of ['btc', 'sp500', 'gold'] as const) {
    it(`preserves the ${asset} 180-day, 95% fixture`, () => {
      const forecast = buildMarketForecast(asset, frozenFixture(asset), 180, CONFIDENCE_Z_SCORES[0.95]).probabilityForecast!;
      expect(forecast.median).toBeCloseTo(FIXTURES[asset].median, 6);
      expect(forecast.q10).toBeCloseTo(FIXTURES[asset].q10, 6);
      expect(forecast.q90).toBeCloseTo(FIXTURES[asset].q90, 6);
    });
  }
});

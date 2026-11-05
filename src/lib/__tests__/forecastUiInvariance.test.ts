import { describe, expect, it } from 'vitest';
import { CONFIDENCE_Z_SCORES } from '../data';
import { loadMarketData, type MarketData, type MarketAssetId, type OHLCVData } from '../api';
// A Yahoo revision moved the 2017-01-03 VOO close from 177.1338 to 177.1337.
// The fixture below is the original series from commit d1353bf, so the frozen
// forecast numbers stay a statement about the model, not about the vendor feed.
import vooThrough20170103 from './fixtures/voo-history-through-2017-01-03.json';
import { buildMarketForecast } from '../marketForecast';

// Presentation-only workspace changes must not change these frozen forecast fixtures.
// S&P 500 and gold q10/q90 were re-frozen on 2026-11-05 for the gated session
// volatility term structure; their medians did not move.
const FIXTURES = {
  btc: { end: '2020-01-01', rows: 3456, close: 7189.94, median: 16954.54260718957, q10: 11991.281389866706, q90: 23972.126553707858 },
  sp500: { end: '2017-01-03', rows: 1591, close: 177.1338, median: 197.17322316012064, q10: 180.57496155888487, q90: 215.29717960744514 },
  gold: { end: '2012-01-03', rows: 1794, close: 155.92, median: 164.42518564681197, q10: 137.48794085834191, q90: 196.64009444176807 },
} as const;

const FROZEN_HISTORY: Partial<Record<MarketAssetId, OHLCVData[]>> = { sp500: vooThrough20170103 as OHLCVData[] };

function frozenFixture(asset: MarketAssetId): MarketData {
  const live = loadMarketData(asset);
  const source = FROZEN_HISTORY[asset] ?? live.ohlcv;
  const ohlcv = source.filter((row) => row.date <= FIXTURES[asset].end);
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

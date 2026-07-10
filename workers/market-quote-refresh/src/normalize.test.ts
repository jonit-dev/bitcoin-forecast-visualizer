import { describe, expect, it } from 'vitest';
import { MARKET_ASSET_REGISTRY } from './assets';
import { CandleValidationError, normalizeCoinGecko, normalizeYahoo } from './normalize';

const day = (date: string, hour = 0) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);

describe('market candle normalization', () => {
  it('should normalize completed BTC candles when CoinGecko response is valid', () => {
    const rows = normalizeCoinGecko(MARKET_ASSET_REGISTRY.btc, { prices: [[day('2026-07-08'), 100], [day('2026-07-08', 23), 110]] }, { total_volumes: [[day('2026-07-08'), 50]] }, new Date('2026-07-09T12:00:00Z'));
    expect(rows).toEqual([expect.objectContaining({ assetId: 'btc', date: '2026-07-08', open: 100, high: 110, low: 100, close: 110, volume: 50 })]);
  });

  it('should apply adjusted close ratio when Yahoo returns a split or dividend adjustment', () => {
    const rows = normalizeYahoo(MARKET_ASSET_REGISTRY.sp500, { chart: { result: [{ timestamp: [day('2026-07-08') / 1000], indicators: { quote: [{ open: [100], high: [110], low: [90], close: [100], volume: [12] }], adjclose: [{ adjclose: [50] }] } }] } }, new Date('2026-07-09T00:00:00Z'));
    expect(rows[0]).toMatchObject({ open: 50, high: 55, low: 45, close: 50 });
  });

  it('should reject a partial candle when UTC day is incomplete', () => {
    const rows = normalizeCoinGecko(MARKET_ASSET_REGISTRY.btc, { prices: [[day('2026-07-09'), 100]] }, { total_volumes: [[day('2026-07-09'), 50]] }, new Date('2026-07-09T12:00:00Z'));
    expect(rows).toEqual([]);
  });

  it('should reject malformed OHLC when high is below close', () => {
    expect(() => normalizeYahoo(MARKET_ASSET_REGISTRY.gold, { chart: { result: [{ timestamp: [day('2026-07-08') / 1000], indicators: { quote: [{ open: [100], high: [90], low: [80], close: [100], volume: [1] }], adjclose: [{ adjclose: [100] }] } }] } })).toThrow(CandleValidationError);
  });

  it('should treat a closed-market response as a no-op when no new session exists', () => {
    expect(normalizeYahoo(MARKET_ASSET_REGISTRY.gold, { chart: { result: [{ timestamp: [], indicators: { quote: [{}], adjclose: [{ adjclose: [] }] } }] } })).toEqual([]);
  });

  it('should keep the first UTC volume snapshot when hourly CoinGecko data is used', () => {
    const rows = normalizeCoinGecko(MARKET_ASSET_REGISTRY.btc, { prices: [[day('2026-07-08'), 100], [day('2026-07-08', 1), 101]], total_volumes: [[day('2026-07-08'), 50], [day('2026-07-08', 1), 999]] }, { total_volumes: [[day('2026-07-08'), 50], [day('2026-07-08', 1), 999]] }, new Date('2026-07-09T12:00:00Z'));
    expect(rows[0].volume).toBe(50);
  });
});

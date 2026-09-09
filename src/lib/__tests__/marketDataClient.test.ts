import { describe, expect, it } from 'vitest';
import { hydrateMarketData } from '../marketDataClient';
import type { MarketData, OHLCVData } from '../api';

const row = (date: string, close: number) => ({ date, open: close, high: close, low: close, close, volume: 1 });
const bundleOf = (rows: OHLCVData[]): MarketData => ({ ohlcv: rows, currentPrice: rows.at(-1)!.close, priceChange24h: 0, marketCap: 0, volume24h: rows.at(-1)!.volume, fetchedAt: 0 });
const bundle = bundleOf([row('2026-07-08', 100)]);
const response = (rows: unknown[], overrides: Record<string, unknown> = {}) => async () =>
  new Response(JSON.stringify({ rows, status: 'current', source: 'test', latestDate: '2026-07-09', refreshedAt: null, ...overrides }), { status: 200 });

describe('market data hydration', () => {
  it('should append a newer remote candle when bundle is older', async () => expect((await hydrateMarketData('btc', bundle, response([row('2026-07-09', 110)]) as typeof fetch)).data.currentPrice).toBe(110));
  it('should replace a colliding date with authoritative D1 repair', async () => expect((await hydrateMarketData('btc', bundle, response([row('2026-07-08', 105)]) as typeof fetch)).data.ohlcv).toEqual([row('2026-07-08', 105)]));
  it('should ignore malformed remote rows', async () => expect((await hydrateMarketData('btc', bundle, response([{ date: 'bad' }]) as typeof fetch)).data).toEqual(bundle));
  it('should retain the bundle and label fallback when hydration fails', async () => expect((await hydrateMarketData('btc', bundle, async () => { throw new Error('offline'); })).status).toBe('fallback'));

  it('should apply a repair that predates the bundle tail, exactly like the server merge', async () => {
    const wide = bundleOf([row('2026-07-06', 96), row('2026-07-07', 97), row('2026-07-08', 100)]);
    const hydrated = await hydrateMarketData('btc', wide, response([row('2026-07-07', 88)]) as typeof fetch);
    expect(hydrated.data.ohlcv).toEqual([row('2026-07-06', 96), row('2026-07-07', 88), row('2026-07-08', 100)]);
  });

  it('should reject a discontinuous remote tail and fall back to the last contiguous candle', async () => {
    const wide = bundleOf([row('2026-07-06', 96), row('2026-07-07', 97), row('2026-07-08', 100)]);
    const hydrated = await hydrateMarketData('btc', wide, response([row('2026-07-20', 130)], { latestDate: '2026-07-20' }) as typeof fetch);
    expect(hydrated.data.ohlcv.at(-1)!.date).toBe('2026-07-08');
    expect(hydrated.data.currentPrice).toBe(100);
    expect(hydrated.latestDate).toBe('2026-07-08');
    expect(hydrated.status).not.toBe('current');
    expect(hydrated.continuity.complete).toBe(false);
    expect(hydrated.continuity.missingDates).toHaveLength(11);
  });

  it('should keep an equity weekend gap out of the continuity verdict', async () => {
    const friday = bundleOf([row('2026-08-13', 610), row('2026-08-14', 612)]);
    const hydrated = await hydrateMarketData('sp500', friday, response([row('2026-08-17', 615)], { latestDate: '2026-08-17' }) as typeof fetch);
    expect(hydrated.data.ohlcv.at(-1)!.date).toBe('2026-08-17');
    expect(hydrated.continuity.complete).toBe(true);
    expect(hydrated.status).toBe('current');
  });

  it('should reject an equity tail that skips a real session', async () => {
    const friday = bundleOf([row('2026-08-13', 610), row('2026-08-14', 612)]);
    const hydrated = await hydrateMarketData('sp500', friday, response([row('2026-08-17', 615), row('2026-08-19', 618)], { latestDate: '2026-08-19' }) as typeof fetch);
    expect(hydrated.data.ohlcv.at(-1)!.date).toBe('2026-08-17');
    expect(hydrated.continuity.missingDates).toEqual(['2026-08-18']);
    expect(hydrated.status).not.toBe('current');
  });

  it('should request the same repair window the server merges from', async () => {
    const requested: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ rows: [], status: 'current', source: 'test', latestDate: '2026-07-08', refreshedAt: null }), { status: 200 });
    }) as typeof fetch;
    await hydrateMarketData('btc', bundle, fetcher);
    expect(requested).toEqual(['/api/market-data?asset=btc&since=2026-07-01']);
  });
});

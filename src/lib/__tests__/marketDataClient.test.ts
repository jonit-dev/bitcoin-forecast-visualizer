import { describe, expect, it } from 'vitest';
import { hydrateMarketData } from '../marketDataClient';
import type { MarketData } from '../api';

const row = (date: string, close: number) => ({ date, open: close, high: close, low: close, close, volume: 1 });
const bundle: MarketData = { ohlcv: [row('2026-07-08', 100)], currentPrice: 100, priceChange24h: 0, marketCap: 0, volume24h: 1, fetchedAt: 0 };
const response = (rows: unknown[]) => async () => new Response(JSON.stringify({ rows, status: 'current', source: 'test', latestDate: '2026-07-09', refreshedAt: null }), { status: 200 });

describe('market data hydration', () => {
  it('should append a newer remote candle when bundle is older', async () => expect((await hydrateMarketData('btc', bundle, response([row('2026-07-09', 110)]) as typeof fetch)).data.currentPrice).toBe(110));
  it('should replace a colliding date with authoritative D1 repair', async () => expect((await hydrateMarketData('btc', bundle, response([row('2026-07-08', 105)]) as typeof fetch)).data.ohlcv).toEqual([row('2026-07-08', 105)]));
  it('should ignore older and malformed remote rows', async () => expect((await hydrateMarketData('btc', bundle, response([row('2026-07-07', 90), { date: 'bad' }]) as typeof fetch)).data).toEqual(bundle));
  it('should retain the bundle and label fallback when hydration fails', async () => expect((await hydrateMarketData('btc', bundle, async () => { throw new Error('offline'); })).status).toBe('fallback'));
});

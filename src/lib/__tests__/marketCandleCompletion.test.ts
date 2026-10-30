import { describe, expect, it } from 'vitest';
import { toDailyRows } from '../../../scripts/update-market-data.mjs';
import { MARKET_ASSET_REGISTRY } from '../../../workers/market-quote-refresh/src/assets';
import { normalizeCoinGecko, normalizeYahoo } from '../../../workers/market-quote-refresh/src/normalize';

const yahooResult = (date: string, close = 100) => ({
  timestamp: [Date.parse(`${date}T00:00:00Z`) / 1000],
  indicators: {
    quote: [{ open: [close], high: [close + 1], low: [close - 1], close: [close], volume: [1000] }],
    adjclose: [{ adjclose: [close] }],
  },
});
const yahooPayload = (date: string) => ({ chart: { result: [yahooResult(date)] } });
const coinGeckoPrices = (date: string) => ({ prices: [[Date.parse(`${date}T00:00:00Z`), 100]] });
const coinGeckoVolumes = (date: string) => ({ total_volumes: [[Date.parse(`${date}T00:00:00Z`), 10]] });

describe('completed daily candles only', () => {
  it('should not stage the checked-in VOO candle while its session is still open', () => {
    // 14:15 UTC is the scheduled workflow time; the 2026-07-08 US session has not closed.
    expect(toDailyRows(yahooResult('2026-07-08'), 'sp500', new Date('2026-07-08T14:15:00Z'))).toEqual([]);
    expect(toDailyRows(yahooResult('2026-07-07'), 'sp500', new Date('2026-07-08T14:15:00Z'))).toHaveLength(1);
  });

  it('should stage the same candle once the US session has closed', () => {
    expect(toDailyRows(yahooResult('2026-07-08'), 'sp500', new Date('2026-07-08T21:30:00Z'))).toHaveLength(1);
    expect(toDailyRows(yahooResult('2026-07-08'), 'gold', new Date('2026-07-08T21:30:00Z'))).toHaveLength(1);
  });

  it('should keep the worker ETF rule and reject a same-day Yahoo candle before the close', () => {
    expect(normalizeYahoo(MARKET_ASSET_REGISTRY.sp500, yahooPayload('2026-07-08'), new Date('2026-07-08T14:15:00Z'))).toEqual([]);
    expect(normalizeYahoo(MARKET_ASSET_REGISTRY.sp500, yahooPayload('2026-07-08'), new Date('2026-07-08T21:30:00Z'))).toHaveLength(1);
  });

  it('should reject a same-day BTC candle from the Yahoo fallback at the production cron time', () => {
    // The BTC UTC day runs to midnight, so 23:15 UTC is still unfinished. The
    // CoinGecko path already rejects it; the Yahoo fallback must agree or the
    // anchor date depends on which provider answered.
    expect(normalizeYahoo(MARKET_ASSET_REGISTRY.btc, yahooPayload('2026-09-09'), new Date('2026-09-09T23:15:00Z'))).toEqual([]);
    expect(normalizeCoinGecko(MARKET_ASSET_REGISTRY.btc, coinGeckoPrices('2026-09-09'), coinGeckoVolumes('2026-09-09'), new Date('2026-09-09T23:15:00Z'))).toEqual([]);
    expect(normalizeYahoo(MARKET_ASSET_REGISTRY.btc, yahooPayload('2026-09-08'), new Date('2026-09-09T23:15:00Z'))).toHaveLength(1);
  });
});

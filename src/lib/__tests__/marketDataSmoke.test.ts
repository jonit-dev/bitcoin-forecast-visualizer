import { describe, expect, it } from 'vitest';
import { SMOKE_ASSETS, SMOKE_REPAIR_LOOKBACK_DAYS, evaluateMarketSnapshot } from '../../../shared/market-data-smoke.mjs';
import { MARKET_ASSET_REGISTRY, REPAIR_LOOKBACK_DAYS } from '../../../workers/market-quote-refresh/src/assets';

const candle = (date: string, close: number) => ({ date, open: close, high: close, low: close, close, volume: 1 });
const snapshot = (overrides: Record<string, any> = {}) => {
  const rows = overrides.rows ?? [candle('2026-09-07', 100), candle('2026-09-08', 101), candle('2026-09-09', 102)];
  const latestDate = overrides.latestDate ?? rows.at(-1).date;
  return {
    assetId: 'btc',
    since: overrides.since ?? '2026-09-06',
    today: '2026-09-09',
    staleAfterDays: 2,
    market: { latestDate, status: 'current', rows, continuity: overrides.continuity, ...overrides.market },
    forecast: { latest: { date: latestDate }, marketData: { latestDate, status: 'current' }, ...overrides.forecast },
  };
};

describe('production market data smoke evaluation', () => {
  it('should pass on a fresh contiguous snapshot that agrees with the forecast', () => {
    expect(evaluateMarketSnapshot(snapshot())).toMatchObject({ ok: true, reasons: [] });
  });

  it('should fail a snapshot whose latest date is current but whose interval has holes', () => {
    const rows = [candle('2026-08-16', 90), candle('2026-08-17', 91), candle('2026-09-08', 101), candle('2026-09-09', 102)];
    const result = evaluateMarketSnapshot(snapshot({ rows, since: '2026-08-15' }));
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/missing/i);
  });

  it('should fail when the server reports an incomplete interval even if the rows look dense', () => {
    const result = evaluateMarketSnapshot(snapshot({ continuity: { complete: false, missingDates: ['2026-09-05'], lastContiguousDate: '2026-09-04' } }));
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/2026-09-05/);
  });

  it('should fail a stale snapshot', () => {
    const result = evaluateMarketSnapshot(snapshot({ rows: [candle('2026-09-01', 90), candle('2026-09-02', 91)] }));
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/stale|age/i);
  });

  it('should fail when the forecast anchor disagrees with the market endpoint', () => {
    const result = evaluateMarketSnapshot(snapshot({ forecast: { latest: { date: '2026-09-08' }, marketData: { latestDate: '2026-09-09', status: 'current' } } }));
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/agree|anchor/i);
  });

  it('should not count weekends against an equity snapshot', () => {
    const rows = [candle('2026-09-04', 100), candle('2026-09-08', 101), candle('2026-09-09', 102)]; // 2026-09-07 is Labor Day
    const result = evaluateMarketSnapshot({ ...snapshot({ rows, since: '2026-09-03' }), assetId: 'sp500', staleAfterDays: 3 });
    expect(result).toMatchObject({ ok: true, reasons: [] });
  });

  it('should fail an unavailable status regardless of dates', () => {
    const result = evaluateMarketSnapshot(snapshot({ market: { status: 'unavailable' } }));
    expect(result.ok).toBe(false);
  });

  // The production check runs under plain node and cannot import the registry,
  // so it mirrors these values. Silent drift would flip a production verdict.
  it('should mirror the worker asset contract exactly', () => {
    expect(SMOKE_REPAIR_LOOKBACK_DAYS).toBe(REPAIR_LOOKBACK_DAYS);
    expect(Object.keys(SMOKE_ASSETS).sort()).toEqual(Object.keys(MARKET_ASSET_REGISTRY).sort());
    for (const [assetId, config] of Object.entries(MARKET_ASSET_REGISTRY)) {
      expect(SMOKE_ASSETS[assetId as keyof typeof SMOKE_ASSETS].staleAfterDays).toBe(config.staleAfterDays);
    }
  });
});

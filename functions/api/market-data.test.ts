import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet } from './market-data';
import { onRequestGet as getForecast } from './forecast';
import { loadMarketData } from '../../src/lib/api';
import { hydrateMarketData } from '../../src/lib/marketDataClient';
import { loadMergedMarketData, RUNTIME_PAGE_SIZE } from '../_shared/marketDataRepository';
import type { D1Database, D1PreparedStatement, D1Result } from '../../workers/market-quote-refresh/src/repository';

class ReadStatement implements D1PreparedStatement {
  values: unknown[] = [];
  constructor(private db: ReadDb, private sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async run<T>(): Promise<D1Result<T>> { return { success: true }; }
  async all<T>(): Promise<D1Result<T>> {
    if (!this.sql.includes('FROM market_candles')) return { success: true, results: [] };
    this.db.queries.push({ sql: this.sql, values: [...this.values] });
    const literalLimit = this.sql.match(/LIMIT\s+(\d+)/);
    const boundLimit = typeof this.values.at(-1) === 'number' ? Number(this.values.at(-1)) : Number.NaN;
    const limit = literalLimit ? Number(literalLimit[1]) : boundLimit;
    const [asset, since] = this.values as string[];
    const direction = this.sql.includes('ORDER BY date DESC') ? -1 : 1;
    const rows = this.db.rows
      .filter((row) => row.asset_id === asset && row.date > since)
      .sort((a, b) => direction * a.date.localeCompare(b.date));
    return { success: true, results: (Number.isFinite(limit) ? rows.slice(0, limit) : rows) as T[] };
  }
  async first<T>(): Promise<T | null> {
    if (this.sql.includes('FROM refresh_runs')) return { status: 'completed' } as T;
    const asset = this.values[0];
    return (this.db.rows.filter((row) => row.asset_id === asset).sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null) as T | null;
  }
}
class ReadDb implements D1Database {
  queries: { sql: string; values: unknown[] }[] = [];
  constructor(public rows: any[]) {}
  prepare(sql: string) { return new ReadStatement(this, sql); }
  async batch<T>(): Promise<D1Result<T>[]> { return []; }
}
const runtimeRow = (asset_id: string, date: string, close: number) => ({ asset_id, date, open: close, high: close, low: close, close, volume: 10, source: 'test', source_timestamp: `${date}T23:00:00Z`, ingested_at: `${date}T23:15:00Z` });
const shift = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const marketRequest = (asset: string, since: string) => new Request(`https://example.test/api/market-data?asset=${asset}&since=${since}`);

afterEach(() => { vi.useRealTimers(); });

describe('market data API', () => {
  it('should return bundled fallback when D1 binding is unavailable', async () => {
    const response = await onRequestGet({ request: marketRequest('btc', '2026-07-01'), env: {} });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ asset: 'btc', status: 'fallback', source: 'bundle' });
  });

  it('should reject unsupported asset and malformed since parameters', async () => {
    const response = await onRequestGet({ request: new Request('https://example.test/api/market-data?asset=doge&since=yesterday'), env: {} });
    expect(response.status).toBe(400);
  });

  it('should return rows newer than since, sorted, when D1 contains later candles', async () => {
    const db = new ReadDb([runtimeRow('btc', '2026-07-09', 109), runtimeRow('btc', '2026-07-08', 108), runtimeRow('btc', '2026-07-07', 107)]);
    const response = await onRequestGet({ request: marketRequest('btc', '2026-07-07'), env: { MARKET_QUOTES_DB: db } });
    const body = await response.json();
    expect(body.rows.map((row: any) => row.date)).toEqual(['2026-07-08', '2026-07-09']);
  });

  it('should return every candle in the requested interval when more than eight exist', async () => {
    const rows = Array.from({ length: 20 }, (_, index) => runtimeRow('btc', shift('2026-07-03', index), 103 + index));
    const db = new ReadDb(rows);
    const response = await onRequestGet({ request: marketRequest('btc', '2026-07-02'), env: { MARKET_QUOTES_DB: db } });
    const body = await response.json();
    expect(body.rows.map((row: any) => row.date)).toEqual(rows.map((row) => row.date));
  });

  it('should page the interval with bounded queries instead of one unbounded read', async () => {
    const total = RUNTIME_PAGE_SIZE + 5;
    const rows = Array.from({ length: total }, (_, index) => runtimeRow('btc', shift('2025-01-02', index), 100 + index));
    const db = new ReadDb(rows);
    const response = await onRequestGet({ request: marketRequest('btc', '2025-01-01'), env: { MARKET_QUOTES_DB: db } });
    const body = await response.json();
    expect(body.rows).toHaveLength(total);
    const candleQueries = db.queries.filter((query) => !query.sql.includes('ORDER BY date DESC LIMIT 1'));
    expect(candleQueries.length).toBeGreaterThan(1);
    for (const query of candleQueries) {
      const limit = query.sql.match(/LIMIT\s+(\d+)/) ? Number(query.sql.match(/LIMIT\s+(\d+)/)![1]) : query.values.at(-1);
      expect(Number(limit)).toBeGreaterThan(0);
      expect(Number(limit)).toBeLessThanOrEqual(RUNTIME_PAGE_SIZE);
    }
  });

  it('should report the calendar gap and refuse a current status when the runtime tail is discontinuous', async () => {
    const bundleLatest = loadMarketData('btc').ohlcv.at(-1)!.date;
    vi.setSystemTime(new Date(`${shift(bundleLatest, 23)}T12:00:00Z`));
    const rows = Array.from({ length: 8 }, (_, index) => runtimeRow('btc', shift(bundleLatest, 16 + index), 77_000 + index));
    const db = new ReadDb(rows);
    const response = await onRequestGet({ request: marketRequest('btc', shift(bundleLatest, -7)), env: { MARKET_QUOTES_DB: db } });
    const body = await response.json();
    expect(body.continuity.complete).toBe(false);
    expect(body.continuity.missingDates).toHaveLength(15);
    expect(body.continuity.lastContiguousDate).toBe(bundleLatest);
    expect(body.latestDate).toBe(bundleLatest);
    expect(body.observedLatestDate).toBe(shift(bundleLatest, 23));
    expect(body.status).not.toBe('current');
  });

  it('should keep the forecast anchored on contiguous history when candles are missing', async () => {
    const bundle = loadMarketData('btc');
    const bundleLatest = bundle.ohlcv.at(-1)!;
    vi.setSystemTime(new Date(`${shift(bundleLatest.date, 23)}T12:00:00Z`));
    const rows = Array.from({ length: 8 }, (_, index) => runtimeRow('btc', shift(bundleLatest.date, 16 + index), 77_000 + index));
    const db = new ReadDb(rows);
    const response = await getForecast({ request: new Request('https://example.test/api/forecast?asset=btc&horizon=30&confidence=0.95'), env: { MARKET_QUOTES_DB: db } });
    const body = await response.json();
    expect(body.latest.date).toBe(bundleLatest.date);
    expect(body.latest.close).toBe(bundleLatest.close);
    expect(body.marketData.status).not.toBe('current');
    expect(body.marketData.continuity.complete).toBe(false);
  });

  it('should accept an equity tail that skips weekends and observed holidays', async () => {
    const bundleLatest = loadMarketData('sp500').ohlcv.at(-1)!.date; // 2026-08-14, a Friday
    const sessions = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
    vi.setSystemTime(new Date('2026-08-21T22:00:00Z'));
    const db = new ReadDb(sessions.map((date, index) => runtimeRow('sp500', date, 620 + index)));
    const response = await onRequestGet({ request: marketRequest('sp500', shift(bundleLatest, -7)), env: { MARKET_QUOTES_DB: db } });
    const body = await response.json();
    expect(body.continuity).toMatchObject({ complete: true, missingDates: [] });
    expect(body.latestDate).toBe('2026-08-21');
    expect(body.status).toBe('current');
  });

  it('should report a missing equity session as a gap', async () => {
    const bundleLatest = loadMarketData('sp500').ohlcv.at(-1)!.date;
    vi.setSystemTime(new Date('2026-08-21T22:00:00Z'));
    const sessions = ['2026-08-17', '2026-08-18', '2026-08-20', '2026-08-21'];
    const db = new ReadDb(sessions.map((date, index) => runtimeRow('sp500', date, 620 + index)));
    const response = await onRequestGet({ request: marketRequest('sp500', shift(bundleLatest, -7)), env: { MARKET_QUOTES_DB: db } });
    const body = await response.json();
    expect(body.continuity.missingDates).toEqual(['2026-08-19']);
    expect(body.latestDate).toBe('2026-08-18');
    expect(body.status).not.toBe('current');
  });

  it('should use the D1 close as forecast anchor when newer than the bundle', async () => {
    const latest = loadMarketData('btc').ohlcv.at(-1)!;
    const next = shift(latest.date, 1);
    const db = new ReadDb([runtimeRow('btc', next, latest.close + 123)]);
    const response = await getForecast({ request: new Request('https://example.test/api/forecast?asset=btc&horizon=30&confidence=0.95'), env: { MARKET_QUOTES_DB: db } });
    const body = await response.json();
    expect(body.latest).toMatchObject({ date: next, close: latest.close + 123 });
    expect(body.marketData.status).not.toBe('fallback');
  });

  it('should prefer a D1 repair when its date collides with bundled history', async () => {
    const latest = loadMarketData('btc').ohlcv.at(-1)!;
    const db = new ReadDb([runtimeRow('btc', latest.date, latest.close + 77)]);
    const response = await getForecast({ request: new Request('https://example.test/api/forecast?asset=btc&horizon=30&confidence=0.95'), env: { MARKET_QUOTES_DB: db } });
    expect((await response.json()).latest.close).toBe(latest.close + 77);
  });
});

describe('browser and server consume identical repaired history', () => {
  const parityCase = (label: string, assetId: 'btc' | 'sp500', build: (bundleLatest: string) => string[]) => {
    it(label, async () => {
      const bundled = loadMarketData(assetId);
      const bundleLatest = bundled.ohlcv.at(-1)!.date;
      const dates = build(bundleLatest);
      const db = new ReadDb(dates.map((date, index) => runtimeRow(assetId, date, 500 + index)));
      const env = { MARKET_QUOTES_DB: db };

      const server = await loadMergedMarketData(env, assetId);
      const fetcher = (async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'https://example.test');
        return onRequestGet({ request: marketRequest(url.searchParams.get('asset')!, url.searchParams.get('since')!), env });
      }) as typeof fetch;
      const browser = await hydrateMarketData(assetId, bundled, fetcher);

      expect(browser.data.ohlcv).toEqual(server.marketData.ohlcv);
      expect(browser.data.currentPrice).toBe(server.marketData.currentPrice);
      expect(browser.latestDate).toBe(server.freshness.latestDate);
      expect(browser.status).toBe(server.freshness.status);
      expect(browser.continuity).toEqual(server.freshness.continuity);
    });
  };

  parityCase('should agree when a repair rewrites candles inside the bundle tail', 'btc', (bundleLatest) => [
    shift(bundleLatest, -3), shift(bundleLatest, -2), shift(bundleLatest, -1), bundleLatest, shift(bundleLatest, 1),
  ]);
  parityCase('should agree when the runtime tail is discontinuous', 'btc', (bundleLatest) =>
    Array.from({ length: 8 }, (_, index) => shift(bundleLatest, 16 + index)));
  parityCase('should agree on an equity tail that skips weekends', 'sp500', () => ['2026-08-17', '2026-08-18', '2026-08-19']);
});

import { describe, expect, it } from 'vitest';
import { onRequestGet } from './market-data';
import { onRequestGet as getForecast } from './forecast';
import { loadMarketData } from '../../src/lib/api';
import type { D1Database, D1PreparedStatement, D1Result } from '../../workers/market-quote-refresh/src/repository';

class ReadStatement implements D1PreparedStatement {
  values: unknown[] = [];
  constructor(private db: ReadDb, private sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async run<T>(): Promise<D1Result<T>> { return { success: true }; }
  async all<T>(): Promise<D1Result<T>> {
    if (!this.sql.includes('FROM market_candles')) return { success: true, results: [] };
    const [asset, since] = this.values as string[];
    const direction = this.sql.includes('ORDER BY date DESC') ? -1 : 1;
    const rows = this.db.rows
      .filter((row) => row.asset_id === asset && row.date > since)
      .sort((a, b) => direction * a.date.localeCompare(b.date))
      .slice(0, 8);
    return { success: true, results: rows as T[] };
  }
  async first<T>(): Promise<T | null> {
    if (this.sql.includes('FROM refresh_runs')) return { status: 'completed' } as T;
    const asset = this.values[0];
    return (this.db.rows.filter((row) => row.asset_id === asset).sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null) as T | null;
  }
}
class ReadDb implements D1Database {
  constructor(public rows: any[]) {}
  prepare(sql: string) { return new ReadStatement(this, sql); }
  async batch<T>(): Promise<D1Result<T>[]> { return []; }
}
const runtimeRow = (asset_id: string, date: string, close: number) => ({ asset_id, date, open: close, high: close, low: close, close, volume: 10, source: 'test', source_timestamp: `${date}T23:00:00Z`, ingested_at: `${date}T23:15:00Z` });

describe('market data API', () => {
  it('should return bundled fallback when D1 binding is unavailable', async () => {
    const response = await onRequestGet({ request: new Request('https://example.test/api/market-data?asset=btc&since=2026-07-01'), env: {} });
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
    const response = await onRequestGet({ request: new Request('https://example.test/api/market-data?asset=btc&since=2026-07-07'), env: { MARKET_QUOTES_DB: db } });
    const body = await response.json();
    expect(body.rows.map((row: any) => row.date)).toEqual(['2026-07-08', '2026-07-09']);
  });

  it('should return the newest repair rows in ascending order when more than eight exist', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => runtimeRow('btc', `2026-07-${String(index + 3).padStart(2, '0')}`, 103 + index));
    const db = new ReadDb(rows);
    const response = await onRequestGet({ request: new Request('https://example.test/api/market-data?asset=btc&since=2026-07-02'), env: { MARKET_QUOTES_DB: db } });
    const body = await response.json();
    expect(body.rows.map((row: any) => row.date)).toEqual([
      '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08',
      '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12',
    ]);
  });

  it('should use the D1 close as forecast anchor when newer than the bundle', async () => {
    const latest = loadMarketData('btc').ohlcv.at(-1)!;
    const next = new Date(`${latest.date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    const db = new ReadDb([runtimeRow('btc', next.toISOString().slice(0, 10), latest.close + 123)]);
    const response = await getForecast({ request: new Request('https://example.test/api/forecast?asset=btc&horizon=30&confidence=0.95'), env: { MARKET_QUOTES_DB: db } });
    const body = await response.json();
    expect(body.latest).toMatchObject({ date: next.toISOString().slice(0, 10), close: latest.close + 123 });
    expect(body.marketData.status).not.toBe('fallback');
  });

  it('should prefer a D1 repair when its date collides with bundled history', async () => {
    const latest = loadMarketData('btc').ohlcv.at(-1)!;
    const db = new ReadDb([runtimeRow('btc', latest.date, latest.close + 77)]);
    const response = await getForecast({ request: new Request('https://example.test/api/forecast?asset=btc&horizon=30&confidence=0.95'), env: { MARKET_QUOTES_DB: db } });
    expect((await response.json()).latest.close).toBe(latest.close + 77);
  });
});

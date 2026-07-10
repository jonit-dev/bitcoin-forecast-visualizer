import { describe, expect, it } from 'vitest';
import { runRefresh } from './index';
import type { D1Database, D1PreparedStatement, D1Result } from './repository';

class MemoryStatement implements D1PreparedStatement {
  values: unknown[] = [];
  constructor(private db: MemoryDb, private sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async run<T>(): Promise<D1Result<T>> { return await this.db.run(this.sql, this.values) as D1Result<T>; }
  async all<T>(): Promise<D1Result<T>> { return { success: true, results: [] }; }
  async first<T>(): Promise<T | null> {
    if (this.sql.startsWith('SELECT date FROM market_candles')) {
      const dates = [...this.db.candles.values()].filter((row) => row.assetId === this.values[0]).map((row) => row.date).sort();
      return (dates.length ? { date: dates.at(-1) } : null) as T | null;
    }
    return null;
  }
}

class MemoryDb implements D1Database {
  candles = new Map<string, any>();
  runs = new Map<string, any>();
  prepare(sql: string) { return new MemoryStatement(this, sql); }
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> { return Promise.all(statements.map((statement) => statement.run<T>())); }
  async run(sql: string, values: unknown[]): Promise<D1Result> {
    if (sql.startsWith('INSERT INTO refresh_runs')) {
      this.runs.set(values[0] as string, { id: values[0], status: 'running', results: [] });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE refresh_runs')) {
      const run = this.runs.get(values[4] as string); Object.assign(run, { status: values[1], results: JSON.parse(values[2] as string) });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO market_candles')) {
      const key = `${values[0]}/${values[1]}`;
      const next = { assetId: values[0], date: values[1], open: values[2], high: values[3], low: values[4], close: values[5], volume: values[6] };
      const changed = JSON.stringify(this.candles.get(key)) === JSON.stringify(next) ? 0 : 1;
      this.candles.set(key, next);
      return { success: true, meta: { changes: changed } };
    }
    return { success: true, meta: { changes: 0 } };
  }
}

const timestamp = Date.parse('2026-07-08T00:00:00Z');
function successfulFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('coingecko') && url.includes('interval=hourly')) return Response.json({ prices: [[timestamp, 100]], total_volumes: [[timestamp, 10]] });
    if (url.includes('coingecko')) return Response.json({ total_volumes: [[timestamp, 10]] });
    return Response.json({ chart: { result: [{ timestamp: [timestamp / 1000], indicators: { quote: [{ open: [100], high: [101], low: [99], close: [100], volume: [10] }], adjclose: [{ adjclose: [100] }] } }] } });
  }) as typeof fetch;
}

describe('scheduled market quote refresh', () => {
  it('should upsert one candle per asset and date when scheduled event succeeds', async () => {
    const db = new MemoryDb();
    const results = await runRefresh({ MARKET_QUOTES_DB: db }, new Date('2026-07-09T23:15:00Z'), successfulFetch());
    expect(db.candles.size).toBe(3);
    expect(results.every((result) => result.status === 'updated')).toBe(true);
    expect([...db.runs.values()].at(-1).status).toBe('completed');
  });

  it('should remain idempotent when the same scheduled event runs twice', async () => {
    const db = new MemoryDb(); const now = new Date('2026-07-09T23:15:00Z');
    await runRefresh({ MARKET_QUOTES_DB: db }, now, successfulFetch());
    const results = await runRefresh({ MARKET_QUOTES_DB: db }, now, successfulFetch());
    expect(db.candles.size).toBe(3);
    expect(results.every((result) => result.status === 'no-op')).toBe(true);
  });

  it('should preserve existing candle and update successful assets when one source returns invalid data', async () => {
    const db = new MemoryDb(); const now = new Date('2026-07-09T23:15:00Z');
    await runRefresh({ MARKET_QUOTES_DB: db }, now, successfulFetch());
    const before = db.candles.get('sp500/2026-07-08');
    const badFetch = (async (input: RequestInfo | URL) => String(input).includes('/VOO?') ? Response.json({ bad: true }) : successfulFetch()(input)) as typeof fetch;
    const results = await runRefresh({ MARKET_QUOTES_DB: db }, now, badFetch);
    expect(db.candles.get('sp500/2026-07-08')).toEqual(before);
    expect(results.find((result) => result.assetId === 'sp500')?.status).toBe('failed');
    expect(results.filter((result) => result.assetId !== 'sp500').every((result) => result.status === 'no-op')).toBe(true);
  });
});

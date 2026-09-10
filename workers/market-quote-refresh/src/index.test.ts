import { describe, expect, it } from 'vitest';
import { runRefresh } from './index';
import { MAX_BACKFILL_DAYS } from '../../../shared/market-continuity.mjs';
import type { D1Database, D1PreparedStatement, D1Result } from './repository';

class MemoryStatement implements D1PreparedStatement {
  values: unknown[] = [];
  constructor(private db: MemoryDb, private sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async run<T>(): Promise<D1Result<T>> { return await this.db.run(this.sql, this.values) as D1Result<T>; }
  async all<T>(): Promise<D1Result<T>> {
    if (!this.sql.includes('FROM market_candles')) return { success: true, results: [] };
    const [assetId, since] = this.values as string[];
    const limit = typeof this.values.at(-1) === 'number' ? Number(this.values.at(-1)) : Number.POSITIVE_INFINITY;
    const rows = [...this.db.candles.values()]
      .filter((row) => row.assetId === assetId && row.date >= since)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, limit)
      .map((row) => ({ date: row.date }));
    return { success: true, results: rows as T[] };
  }
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
  seed(assetId: string, dates: string[]) {
    for (const date of dates) this.candles.set(`${assetId}/${date}`, { assetId, date, open: 100, high: 101, low: 99, close: 100, volume: 10 });
    return this;
  }
}

const DAY_MS = 86_400_000;
const timestamp = Date.parse('2026-07-08T00:00:00Z');
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const dateRange = (from: string, to: string) => {
  const dates: string[] = [];
  for (let cursor = from; cursor <= to; cursor = shift(cursor, 1)) dates.push(cursor);
  return dates;
};

function successfulFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('coingecko') && url.includes('interval=hourly')) return Response.json({ prices: [[timestamp, 100]], total_volumes: [[timestamp, 10]] });
    if (url.includes('coingecko')) return Response.json({ total_volumes: [[timestamp, 10]] });
    return Response.json({ chart: { result: [{ timestamp: [timestamp / 1000], indicators: { quote: [{ open: [100], high: [101], low: [99], close: [100], volume: [10] }], adjclose: [{ adjclose: [100] }] } }] } });
  }) as typeof fetch;
}

// Serves every completed UTC day inside the requested window so a backfill run
// can be observed writing the candles the outage dropped.
function windowFetch(recorded: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    recorded.push(url.toString());
    const fromSeconds = Number(url.searchParams.get('from') ?? url.searchParams.get('period1'));
    const toSeconds = Number(url.searchParams.get('to') ?? url.searchParams.get('period2'));
    const stamps: number[] = [];
    for (let seconds = Math.ceil(fromSeconds / 86_400) * 86_400; seconds <= toSeconds; seconds += 86_400) stamps.push(seconds);
    if (url.hostname.includes('coingecko')) {
      const points = stamps.map((seconds) => [seconds * 1000, 100]);
      return Response.json({ prices: points, total_volumes: points.map(([time]) => [time, 10]) });
    }
    return Response.json({
      chart: { result: [{ timestamp: stamps, indicators: {
        quote: [{ open: stamps.map(() => 100), high: stamps.map(() => 101), low: stamps.map(() => 99), close: stamps.map(() => 100), volume: stamps.map(() => 10) }],
        adjclose: [{ adjclose: stamps.map(() => 100) }],
      } }] },
    });
  }) as typeof fetch;
}

const windowStartFor = (recorded: string[], match: string) => {
  const url = new URL(recorded.find((entry) => entry.includes(match))!);
  const seconds = Number(url.searchParams.get('from') ?? url.searchParams.get('period1'));
  return new Date(seconds * 1000).toISOString().slice(0, 10);
};

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

  it('should fall back to Yahoo BTC-USD when CoinGecko is rate limited', async () => {
    const db = new MemoryDb();
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('coingecko')) return new Response('rate limited', { status: 429, headers: { 'retry-after': '0.001' } });
      if (url.includes('/BTC-USD?')) {
        return Response.json({ chart: { result: [{ timestamp: [timestamp / 1000], indicators: { quote: [{ open: [100], high: [101], low: [99], close: [100], volume: [10] }], adjclose: [{ adjclose: [100] }] } }] } });
      }
      return successfulFetch()(input);
    }) as typeof fetch;

    const results = await runRefresh({ MARKET_QUOTES_DB: db }, new Date('2026-07-09T23:15:00Z'), fetcher);

    expect(results.find((result) => result.assetId === 'btc')?.status).toBe('updated');
    expect(db.candles.has('btc/2026-07-08')).toBe(true);
  });
});

describe('outage backfill', () => {
  it('should keep the seven day repair window when stored history is contiguous and current', async () => {
    const now = new Date('2026-07-09T23:15:00Z');
    const db = new MemoryDb().seed('btc', dateRange('2026-06-01', '2026-07-08'));
    const recorded: string[] = [];
    await runRefresh({ MARKET_QUOTES_DB: db }, now, windowFetch(recorded));
    expect(windowStartFor(recorded, 'coingecko')).toBe('2026-07-02');
  });

  it('should reach back to the stored tail when the outage is older than the repair window', async () => {
    const now = new Date('2026-07-09T23:15:00Z');
    const db = new MemoryDb().seed('btc', dateRange('2026-06-01', '2026-06-10'));
    const recorded: string[] = [];
    await runRefresh({ MARKET_QUOTES_DB: db }, now, windowFetch(recorded));
    expect(windowStartFor(recorded, 'coingecko') <= '2026-06-10').toBe(true);
    for (const date of dateRange('2026-06-11', '2026-07-08')) expect(db.candles.has(`btc/${date}`)).toBe(true);
  });

  it('should reach back to the first hole inside otherwise recent history', async () => {
    const now = new Date('2026-07-09T23:15:00Z');
    const db = new MemoryDb().seed('btc', [...dateRange('2026-06-01', '2026-06-14'), ...dateRange('2026-06-18', '2026-07-08')]);
    const recorded: string[] = [];
    await runRefresh({ MARKET_QUOTES_DB: db }, now, windowFetch(recorded));
    expect(windowStartFor(recorded, 'coingecko') <= '2026-06-14').toBe(true);
    for (const date of dateRange('2026-06-15', '2026-06-17')) expect(db.candles.has(`btc/${date}`)).toBe(true);
  });

  it('should ignore weekends and holidays when locating an equity hole', async () => {
    const now = new Date('2026-07-09T23:15:00Z');
    // Sessions only: no weekend rows, and Independence Day is observed on 2026-07-03.
    const sessions = ['2026-06-25', '2026-06-26', '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-06', '2026-07-07', '2026-07-08'];
    const db = new MemoryDb().seed('sp500', sessions);
    const recorded: string[] = [];
    await runRefresh({ MARKET_QUOTES_DB: db }, now, windowFetch(recorded));
    expect(windowStartFor(recorded, '/VOO?')).toBe('2026-07-02');
  });

  it('should bootstrap from the configured date when an asset has no stored candles', async () => {
    const now = new Date('2026-07-09T23:15:00Z');
    const db = new MemoryDb();
    const recorded: string[] = [];
    await runRefresh({ MARKET_QUOTES_DB: db, MARKET_DATA_BOOTSTRAP_SINCE: '2026-05-01' }, now, windowFetch(recorded));
    expect(windowStartFor(recorded, 'BTC-USD') <= '2026-05-01').toBe(true);
    expect(windowStartFor(recorded, '/VOO?') <= '2026-05-01').toBe(true);
  });

  it('should clamp any backfill request to the bounded maximum window', async () => {
    const now = new Date('2026-07-09T23:15:00Z');
    const db = new MemoryDb();
    const recorded: string[] = [];
    await runRefresh({ MARKET_QUOTES_DB: db, MARKET_DATA_BOOTSTRAP_SINCE: '2015-01-01' }, now, windowFetch(recorded));
    const floor = shift('2026-07-09', -MAX_BACKFILL_DAYS);
    expect(windowStartFor(recorded, '/VOO?') >= floor).toBe(true);
  });

  it('should fill only the missing dates when the window widened past the routine repair window', async () => {
    const now = new Date('2026-07-09T23:15:00Z');
    const stored = [...dateRange('2026-06-01', '2026-06-14'), ...dateRange('2026-06-18', '2026-07-08')];
    const db = new MemoryDb().seed('btc', stored);
    // A candle behind the routine window that the store already has right. The
    // widened repair reads Yahoo rather than CoinGecko, so restating it here
    // would plant a provider seam mid-series.
    db.candles.set('btc/2026-06-20', { assetId: 'btc', date: '2026-06-20', open: 61, high: 62, low: 60, close: 61.5, volume: 7 });

    await runRefresh({ MARKET_QUOTES_DB: db }, now, windowFetch([]));

    expect(db.candles.get('btc/2026-06-20')).toMatchObject({ close: 61.5, volume: 7 });
    for (const date of dateRange('2026-06-15', '2026-06-17')) expect(db.candles.has(`btc/${date}`)).toBe(true);
    // Inside the routine window a source revision must still land.
    expect(db.candles.get('btc/2026-07-05')?.close).toBe(100);
  });

  it('should use daily Yahoo history when the bitcoin window exceeds the CoinGecko hourly range', async () => {
    const now = new Date('2026-07-09T23:15:00Z');
    const db = new MemoryDb().seed('btc', dateRange('2026-01-01', '2026-01-10'));
    const recorded: string[] = [];
    await runRefresh({ MARKET_QUOTES_DB: db }, now, windowFetch(recorded));
    expect(recorded.some((url) => url.includes('BTC-USD'))).toBe(true);
    expect(recorded.some((url) => url.includes('coingecko') && url.includes('interval=hourly'))).toBe(false);
    expect(db.candles.has('btc/2026-03-01')).toBe(true);
  });
});

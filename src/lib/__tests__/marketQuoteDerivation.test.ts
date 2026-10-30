import { describe, expect, it } from 'vitest';
import { loadMarketData, withOHLCV, type OHLCVData } from '../api';
import { loadMergedMarketData } from '../../../functions/_shared/marketDataRepository';
import type { D1Database, D1PreparedStatement, D1Result } from '../../../workers/market-quote-refresh/src/repository';

class RepairStatement implements D1PreparedStatement {
  values: unknown[] = [];
  constructor(private db: RepairDb, private sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async run<T>(): Promise<D1Result<T>> { return { success: true }; }
  async all<T>(): Promise<D1Result<T>> {
    if (!this.sql.includes('FROM market_candles')) return { success: true, results: [] };
    const [asset, since] = this.values as string[];
    return { success: true, results: this.db.rows.filter((row) => row.asset_id === asset && row.date > since) as T[] };
  }
  async first<T>(): Promise<T | null> {
    if (this.sql.includes('FROM refresh_runs')) return { status: 'completed' } as T;
    const asset = this.values[0];
    return (this.db.rows.filter((row) => row.asset_id === asset).at(-1) ?? null) as T | null;
  }
}

class RepairDb implements D1Database {
  constructor(public rows: Record<string, unknown>[]) {}
  prepare(sql: string) { return new RepairStatement(this, sql); }
  async batch<T>(): Promise<D1Result<T>[]> { return []; }
}

const repairedRow = (date: string, close: number) => ({
  asset_id: 'btc', date, open: close, high: close, low: close, close, volume: 10,
  source: 'test', source_timestamp: `${date}T23:00:00Z`, ingested_at: `${date}T23:15:00Z`,
});

describe('derived quote fields survive a price repair', () => {
  it('should recompute BTC capitalization from the repaired close', () => {
    const bundled = loadMarketData('btc');
    const doubled: OHLCVData[] = bundled.ohlcv.map((row) => ({ ...row, close: row.close * 2 }));
    const updated = withOHLCV(bundled, doubled);

    expect(updated.currentPrice).toBeCloseTo(bundled.currentPrice * 2, 6);
    expect(updated.marketCap).toBeCloseTo(bundled.marketCap * 2, 3);
  });

  it('should keep the ETF proxies at zero capitalization', () => {
    const bundled = loadMarketData('sp500');
    expect(withOHLCV(bundled, bundled.ohlcv).marketCap).toBe(0);
  });

  it('should recompute capitalization on the server merge path too', async () => {
    const bundled = loadMarketData('btc');
    const latest = bundled.ohlcv.at(-1)!;
    const repairedClose = latest.close * 2;
    const db = new RepairDb([repairedRow(latest.date, repairedClose)]);

    const { marketData } = await loadMergedMarketData({ MARKET_QUOTES_DB: db }, 'btc');

    expect(marketData.currentPrice).toBeCloseTo(repairedClose, 6);
    expect(marketData.marketCap).toBeCloseTo(bundled.marketCap * 2, 3);
  });
});

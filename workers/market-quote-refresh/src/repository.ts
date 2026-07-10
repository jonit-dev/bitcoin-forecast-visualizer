import type { MarketAssetId } from './assets';
import type { CanonicalCandle } from './normalize';

export interface D1Result<T = unknown> { results?: T[]; success: boolean; meta?: { changes?: number } }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
}
export interface D1Database { prepare(sql: string): D1PreparedStatement; batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> }

export type AssetRunResult = { assetId: MarketAssetId; status: 'updated' | 'no-op' | 'failed'; rowCount: number; latestDate?: string; error?: string };

export class MarketQuoteRepository {
  constructor(private db: D1Database) {}

  startRun(id: string, startedAt: string, triggerType: string) {
    return this.db.prepare('INSERT INTO refresh_runs (id, started_at, trigger_type, status, asset_results_json) VALUES (?, ?, ?, ?, ?)')
      .bind(id, startedAt, triggerType, 'running', '[]').run();
  }

  async upsertCandles(rows: CanonicalCandle[]): Promise<number> {
    if (!rows.length) return 0;
    const statements = rows.map((row) => this.db.prepare(`INSERT INTO market_candles
      (asset_id, date, open, high, low, close, volume, source, source_timestamp, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, date) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low,
      close=excluded.close, volume=excluded.volume, source=excluded.source,
      source_timestamp=excluded.source_timestamp, ingested_at=excluded.ingested_at
      WHERE market_candles.open != excluded.open OR market_candles.high != excluded.high OR market_candles.low != excluded.low
        OR market_candles.close != excluded.close OR market_candles.volume != excluded.volume`)
      .bind(row.assetId, row.date, row.open, row.high, row.low, row.close, row.volume, row.source, row.sourceTimestamp, row.ingestedAt));
    const results = await this.db.batch(statements);
    return results.reduce((total, result) => total + (result.meta?.changes ?? 0), 0);
  }

  latest(assetId: MarketAssetId) {
    return this.db.prepare('SELECT date FROM market_candles WHERE asset_id = ? ORDER BY date DESC LIMIT 1').bind(assetId).first<{ date: string }>();
  }

  finishRun(id: string, completedAt: string, results: AssetRunResult[]) {
    const failed = results.filter((result) => result.status === 'failed');
    return this.db.prepare('UPDATE refresh_runs SET completed_at = ?, status = ?, asset_results_json = ?, error_summary = ? WHERE id = ?')
      .bind(completedAt, failed.length ? 'failed' : 'completed', JSON.stringify(results), failed.map((item) => `${item.assetId}: ${item.error}`).join('; ') || null, id).run();
  }
}

import { loadMarketData, type MarketAssetId, type OHLCVData } from '../../src/lib/api';
import { applyContinuityGuard, repairWindowStart, type ContinuityAssessment } from '../../src/lib/marketContinuity';
import type { D1Database } from '../../workers/market-quote-refresh/src/repository';
import { MARKET_ASSET_REGISTRY, REPAIR_LOOKBACK_DAYS } from '../../workers/market-quote-refresh/src/assets';
import { validateCandle } from '../../workers/market-quote-refresh/src/normalize';
import { countUsMarketSessionsAfter } from '../../shared/us-market-calendar.mjs';

export interface MarketDataEnv { MARKET_QUOTES_DB?: D1Database }
export type MarketDataStatus = 'current' | 'delayed' | 'fallback' | 'unavailable';
export interface RuntimeMarketData {
  rows: OHLCVData[];
  latestDate: string;
  /** Newest candle the store holds, even when continuity forced an older anchor. */
  observedLatestDate: string;
  source: string;
  refreshedAt: string | null;
  status: MarketDataStatus;
  runStatus: string | null;
  continuity: ContinuityAssessment;
}

// D1 caps a single result set, and an unbounded read would grow with history.
// Pages are read ascending from the requested `since` until the interval is
// exhausted or the page budget is spent.
export const RUNTIME_PAGE_SIZE = 200;
export const RUNTIME_MAX_PAGES = 8;

const CANDLE_PAGE_SQL = `SELECT asset_id, date, open, high, low, close, volume, source, source_timestamp, ingested_at
      FROM market_candles WHERE asset_id = ? AND date > ? ORDER BY date ASC LIMIT ?`;

const toOhlcv = (row: any): OHLCVData => ({ date: row.date, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume });
const ageInDays = (date: string, now = new Date()) => Math.floor((Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
function marketAge(assetId: MarketAssetId, date: string, now = new Date()) {
  if (assetId === 'btc') return ageInDays(date, now);
  return countUsMarketSessionsAfter(date, now);
}

export function mergeMarketRows(bundle: OHLCVData[], runtime: OHLCVData[]): OHLCVData[] {
  const merged = new Map(bundle.map((row) => [row.date, row]));
  for (const row of runtime) merged.set(row.date, row);
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const defaultRepairWindow = (assetId: MarketAssetId) =>
  repairWindowStart(loadMarketData(assetId).ohlcv.at(-1)!.date, REPAIR_LOOKBACK_DAYS);

/** Read every stored candle after `since`, one bounded page at a time. */
async function readCandlePages(db: D1Database, assetId: MarketAssetId, since: string): Promise<OHLCVData[]> {
  const rows: OHLCVData[] = [];
  let cursor = since;
  for (let page = 0; page < RUNTIME_MAX_PAGES; page += 1) {
    const result = (await db.prepare(CANDLE_PAGE_SQL).bind(assetId, cursor, RUNTIME_PAGE_SIZE).all<any>()).results ?? [];
    for (const row of result) {
      validateCandle({ assetId, ...toOhlcv(row), source: row.source, sourceTimestamp: row.source_timestamp, ingestedAt: row.ingested_at });
      rows.push(toOhlcv(row));
    }
    if (result.length < RUNTIME_PAGE_SIZE) break;
    cursor = result[result.length - 1].date;
  }
  return rows;
}

export async function readRuntimeMarketData(env: MarketDataEnv, assetId: MarketAssetId, since?: string): Promise<RuntimeMarketData> {
  const bundled = loadMarketData(assetId).ohlcv;
  const latestBundle = bundled.at(-1)!;
  const windowStart = since ?? repairWindowStart(latestBundle.date, REPAIR_LOOKBACK_DAYS);
  const bundleOnly = (runStatus: string | null): RuntimeMarketData => {
    const guarded = applyContinuityGuard(assetId, bundled, windowStart);
    const latest = guarded.rows.at(-1) ?? latestBundle;
    return {
      rows: guarded.rows.filter((row) => row.date > windowStart),
      latestDate: latest.date,
      observedLatestDate: latestBundle.date,
      source: 'bundle',
      refreshedAt: null,
      status: 'fallback',
      runStatus,
      continuity: guarded.continuity,
    };
  };
  if (!env.MARKET_QUOTES_DB) return bundleOnly(null);
  try {
    const repairRows = await readCandlePages(env.MARKET_QUOTES_DB, assetId, windowStart);
    const latestDb = await env.MARKET_QUOTES_DB.prepare('SELECT date, source, ingested_at FROM market_candles WHERE asset_id = ? ORDER BY date DESC LIMIT 1').bind(assetId).first<any>();
    const latestRun = await env.MARKET_QUOTES_DB.prepare('SELECT status FROM refresh_runs ORDER BY started_at DESC LIMIT 1').first<{ status: string }>();
    if (!latestDb) return bundleOnly(latestRun?.status ?? null);

    // Continuity is judged on what a consumer actually renders — the bundle
    // merged with the repair rows — not on the repair rows alone.
    const merged = mergeMarketRows(bundled, repairRows);
    const guarded = applyContinuityGuard(assetId, merged, windowStart);
    const latestDate = guarded.rows.at(-1)!.date;
    const ageStatus: MarketDataStatus = marketAge(assetId, latestDate) > MARKET_ASSET_REGISTRY[assetId].staleAfterDays ? 'delayed' : 'current';
    return {
      rows: repairRows,
      latestDate,
      observedLatestDate: merged.at(-1)!.date,
      source: latestDb.source,
      refreshedAt: latestDb.ingested_at,
      // An interval with holes is never current: the newest candle is real but
      // the series behind it cannot carry daily returns.
      status: guarded.continuity.complete ? ageStatus : 'delayed',
      runStatus: latestRun?.status ?? null,
      continuity: guarded.continuity,
    };
  } catch {
    return bundleOnly(null);
  }
}

export async function loadMergedMarketData(env: MarketDataEnv, assetId: MarketAssetId) {
  const bundled = loadMarketData(assetId);
  const windowStart = repairWindowStart(bundled.ohlcv.at(-1)!.date, REPAIR_LOOKBACK_DAYS);
  const runtime = await readRuntimeMarketData(env, assetId, windowStart);
  const merged = runtime.status === 'fallback' ? bundled.ohlcv : mergeMarketRows(bundled.ohlcv, runtime.rows);
  const ohlcv = applyContinuityGuard(assetId, merged, windowStart).rows;
  const latest = ohlcv.at(-1)!;
  const previous = ohlcv.at(-2);
  return {
    marketData: { ...bundled, ohlcv, currentPrice: latest.close, priceChange24h: previous ? ((latest.close - previous.close) / previous.close) * 100 : 0, volume24h: latest.volume },
    freshness: runtime,
  };
}

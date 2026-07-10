import { loadMarketData, type MarketAssetId, type OHLCVData } from '../../src/lib/api';
import type { D1Database } from '../../workers/market-quote-refresh/src/repository';
import { MARKET_ASSET_REGISTRY } from '../../workers/market-quote-refresh/src/assets';
import { validateCandle } from '../../workers/market-quote-refresh/src/normalize';
import { countUsMarketSessionsAfter } from '../../shared/us-market-calendar.mjs';

export interface MarketDataEnv { MARKET_QUOTES_DB?: D1Database }
export type MarketDataStatus = 'current' | 'delayed' | 'fallback' | 'unavailable';
export interface RuntimeMarketData {
  rows: OHLCVData[];
  latestDate: string;
  source: string;
  refreshedAt: string | null;
  status: MarketDataStatus;
  runStatus: string | null;
}

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

export async function readRuntimeMarketData(env: MarketDataEnv, assetId: MarketAssetId, since?: string): Promise<RuntimeMarketData> {
  const bundled = loadMarketData(assetId).ohlcv;
  const latestBundle = bundled.at(-1)!;
  if (!env.MARKET_QUOTES_DB) return { rows: since ? bundled.filter((row) => row.date > since) : bundled, latestDate: latestBundle.date, source: 'bundle', refreshedAt: null, status: 'fallback', runStatus: null };
  try {
    const dbRows = (await env.MARKET_QUOTES_DB.prepare(`SELECT asset_id, date, open, high, low, close, volume, source, source_timestamp, ingested_at
      FROM market_candles WHERE asset_id = ? AND date > ? ORDER BY date ASC LIMIT 8`).bind(assetId, since ?? '0000-00-00').all<any>()).results ?? [];
    const latestDb = await env.MARKET_QUOTES_DB.prepare('SELECT date, source, ingested_at FROM market_candles WHERE asset_id = ? ORDER BY date DESC LIMIT 1').bind(assetId).first<any>();
    const latestRun = await env.MARKET_QUOTES_DB.prepare('SELECT status FROM refresh_runs ORDER BY started_at DESC LIMIT 1').first<{ status: string }>();
    const rows = dbRows.map((row) => {
      validateCandle({ assetId, ...toOhlcv(row), source: row.source, sourceTimestamp: row.source_timestamp, ingestedAt: row.ingested_at });
      return toOhlcv(row);
    });
    if (!latestDb) return { rows: since ? bundled.filter((row) => row.date > since) : bundled, latestDate: latestBundle.date, source: 'bundle', refreshedAt: null, status: 'fallback', runStatus: latestRun?.status ?? null };
    const latestDate = latestDb.date > latestBundle.date ? latestDb.date : latestBundle.date;
    return { rows, latestDate, source: latestDb.source, refreshedAt: latestDb.ingested_at, status: marketAge(assetId, latestDate) > MARKET_ASSET_REGISTRY[assetId].staleAfterDays ? 'delayed' : 'current', runStatus: latestRun?.status ?? null };
  } catch {
    return { rows: since ? bundled.filter((row) => row.date > since) : bundled, latestDate: latestBundle.date, source: 'bundle', refreshedAt: null, status: 'fallback', runStatus: null };
  }
}

export async function loadMergedMarketData(env: MarketDataEnv, assetId: MarketAssetId) {
  const bundled = loadMarketData(assetId);
  const bundleLatest = bundled.ohlcv.at(-1)!.date;
  const repairStart = new Date(`${bundleLatest}T00:00:00Z`);
  repairStart.setUTCDate(repairStart.getUTCDate() - 7);
  const runtime = await readRuntimeMarketData(env, assetId, repairStart.toISOString().slice(0, 10));
  const ohlcv = runtime.status === 'fallback' ? bundled.ohlcv : mergeMarketRows(bundled.ohlcv, runtime.rows);
  const latest = ohlcv.at(-1)!;
  const previous = ohlcv.at(-2);
  return {
    marketData: { ...bundled, ohlcv, currentPrice: latest.close, priceChange24h: previous ? ((latest.close - previous.close) / previous.close) * 100 : 0, volume24h: latest.volume },
    freshness: runtime,
  };
}

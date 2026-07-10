import { mergeOHLCVRows, withOHLCV, type MarketAssetId, type MarketData, type MarketDataStatus, type OHLCVData } from './api';

export interface MarketDataHydration {
  data: MarketData;
  latestDate: string;
  source: string;
  refreshedAt: string | null;
  status: MarketDataStatus;
}

export async function hydrateMarketData(assetId: MarketAssetId, bundled: MarketData, fetcher: typeof fetch = fetch): Promise<MarketDataHydration> {
  const latestBundle = bundled.ohlcv.at(-1)!;
  const repairStart = new Date(`${latestBundle.date}T00:00:00Z`);
  repairStart.setUTCDate(repairStart.getUTCDate() - 7);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(`/api/market-data?asset=${assetId}&since=${repairStart.toISOString().slice(0, 10)}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Market data request failed: ${response.status}`);
    const body = await response.json() as { rows?: unknown[]; latestDate?: string; source?: string; refreshedAt?: string | null; status?: MarketDataStatus };
    const remote = (body.rows ?? []).filter((row): row is OHLCVData => typeof row === 'object' && row !== null && 'date' in row && (row as OHLCVData).date >= latestBundle.date);
    const rows = mergeOHLCVRows(bundled.ohlcv, remote);
    return { data: withOHLCV(bundled, rows), latestDate: rows.at(-1)!.date, source: body.source ?? 'bundle', refreshedAt: body.refreshedAt ?? null, status: body.status ?? 'fallback' };
  } catch {
    return { data: bundled, latestDate: latestBundle.date, source: 'bundle', refreshedAt: null, status: 'fallback' };
  } finally { clearTimeout(timeout); }
}

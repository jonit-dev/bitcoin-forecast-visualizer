import { mergeOHLCVRows, withOHLCV, type MarketAssetId, type MarketData, type MarketDataStatus, type OHLCVData } from './api';
import { applyContinuityGuard, assessContinuity, repairWindowStart, type ContinuityAssessment } from './marketContinuity';
import { REPAIR_LOOKBACK_DAYS } from '../../workers/market-quote-refresh/src/assets';

export interface MarketDataHydration {
  data: MarketData;
  latestDate: string;
  /** Newest candle the endpoint returned, even when continuity forced an older anchor. */
  observedLatestDate: string;
  source: string;
  refreshedAt: string | null;
  status: MarketDataStatus;
  continuity: ContinuityAssessment;
}

export async function hydrateMarketData(assetId: MarketAssetId, bundled: MarketData, fetcher: typeof fetch = fetch): Promise<MarketDataHydration> {
  const latestBundle = bundled.ohlcv.at(-1)!;
  // The same window the server merges from, so browser and server assess the
  // identical interval and cannot disagree about what is missing.
  const windowStart = repairWindowStart(latestBundle.date, REPAIR_LOOKBACK_DAYS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(`/api/market-data?asset=${assetId}&since=${windowStart}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Market data request failed: ${response.status}`);
    const body = await response.json() as { rows?: unknown[]; latestDate?: string; source?: string; refreshedAt?: string | null; status?: MarketDataStatus };
    // Repairs may rewrite candles behind the bundle tail, so every valid remote
    // row is merged, not only rows newer than the bundle.
    const merged = mergeOHLCVRows(bundled.ohlcv, (body.rows ?? []) as OHLCVData[]);
    const guarded = applyContinuityGuard(assetId, merged, windowStart);
    return {
      data: withOHLCV(bundled, guarded.rows),
      latestDate: guarded.rows.at(-1)!.date,
      observedLatestDate: merged.at(-1)!.date,
      source: body.source ?? 'bundle',
      refreshedAt: body.refreshedAt ?? null,
      status: guarded.continuity.complete ? (body.status ?? 'fallback') : 'delayed',
      continuity: guarded.continuity,
    };
  } catch {
    return {
      data: bundled,
      latestDate: latestBundle.date,
      observedLatestDate: latestBundle.date,
      source: 'bundle',
      refreshedAt: null,
      status: 'fallback',
      continuity: assessContinuity(assetId, bundled.ohlcv, windowStart),
    };
  } finally { clearTimeout(timeout); }
}

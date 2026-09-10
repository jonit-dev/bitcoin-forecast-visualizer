import { MARKET_ASSET_IDS, MARKET_ASSET_REGISTRY, REPAIR_LOOKBACK_DAYS } from './assets';
import { MarketQuoteRepository, type AssetRunResult, type D1Database } from './repository';
import { fetchAssetCandles } from './sources';
import { MAX_BACKFILL_DAYS, backfillWindowStart, repairWindowStart } from '../../../shared/market-continuity.mjs';

export interface Env {
  MARKET_QUOTES_DB: D1Database;
  /**
   * Earliest date to read when an asset has no stored candles at all. Clamped
   * to MAX_BACKFILL_DAYS before today, so an older date bootstraps from the
   * clamp rather than from the value given.
   */
  MARKET_DATA_BOOTSTRAP_SINCE?: string;
}
export interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }

/**
 * Rows a run may write. Inside the routine repair window every row is
 * authoritative, so source revisions still land. Behind it -- only reached when
 * the window widened to close an outage -- only genuinely missing dates are
 * written, so recovery never restates candles another provider already got right.
 */
function writableRows<T extends { date: string }>(rows: T[], stored: string[], since: string, routineStart: string): T[] {
  if (since >= routineStart) return rows;
  const known = new Set(stored);
  return rows.filter((row) => row.date >= routineStart || !known.has(row.date));
}

export async function runRefresh(env: Env, now = new Date(), fetcher: typeof fetch = fetch): Promise<AssetRunResult[]> {
  const repository = new MarketQuoteRepository(env.MARKET_QUOTES_DB);
  const runId = crypto.randomUUID();
  const today = now.toISOString().slice(0, 10);
  const scanStart = new Date(now.getTime() - MAX_BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 10);
  const routineStart = repairWindowStart(today, REPAIR_LOOKBACK_DAYS);
  await repository.startRun(runId, now.toISOString(), 'scheduled');
  const results: AssetRunResult[] = [];
  for (const assetId of MARKET_ASSET_IDS) {
    try {
      // Read only as far back as recovery needs: the routine seven-day repair
      // window, widened to the first hole or the stored tail after an outage.
      const stored = await repository.storedDates(assetId, scanStart, MAX_BACKFILL_DAYS + 1);
      const since = backfillWindowStart(assetId, stored, today, {
        lookbackDays: REPAIR_LOOKBACK_DAYS,
        bootstrapSince: env.MARKET_DATA_BOOTSTRAP_SINCE,
      });
      const rows = await fetchAssetCandles(MARKET_ASSET_REGISTRY[assetId], now, fetcher, since);
      // A widened window reads bitcoin from Yahoo rather than CoinGecko, so
      // writing every returned row would restate correct candles in the other
      // provider's aggregation and rounding. The next ordinary run would then
      // revert only the trailing week, leaving a provider seam mid-series --
      // the same spurious daily return this repair exists to remove. Outside
      // the routine window, write only the dates the store is missing.
      const changed = await repository.upsertCandles(writableRows(rows, stored, since, routineStart));
      const latest = await repository.latest(assetId);
      results.push({ assetId, status: changed > 0 ? 'updated' : 'no-op', rowCount: changed, latestDate: latest?.date });
    } catch (error) {
      const latest = await repository.latest(assetId).catch(() => null);
      results.push({ assetId, status: 'failed', rowCount: 0, latestDate: latest?.date, error: error instanceof Error ? error.message : String(error) });
    }
  }
  await repository.finishRun(runId, new Date().toISOString(), results);
  return results;
}

export default {
  scheduled(_controller: unknown, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runRefresh(env));
  },
};

import { MARKET_ASSET_IDS, MARKET_ASSET_REGISTRY } from './assets';
import { MarketQuoteRepository, type AssetRunResult, type D1Database } from './repository';
import { fetchAssetCandles } from './sources';

export interface Env { MARKET_QUOTES_DB: D1Database }
export interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }

export async function runRefresh(env: Env, now = new Date(), fetcher: typeof fetch = fetch): Promise<AssetRunResult[]> {
  const repository = new MarketQuoteRepository(env.MARKET_QUOTES_DB);
  const runId = crypto.randomUUID();
  await repository.startRun(runId, now.toISOString(), 'scheduled');
  const results: AssetRunResult[] = [];
  for (const assetId of MARKET_ASSET_IDS) {
    try {
      const rows = await fetchAssetCandles(MARKET_ASSET_REGISTRY[assetId], now, fetcher);
      const changed = await repository.upsertCandles(rows);
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

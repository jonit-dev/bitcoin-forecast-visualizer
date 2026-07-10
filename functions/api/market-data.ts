import { MARKET_ASSET_IDS, type MarketAssetId } from '../../workers/market-quote-refresh/src/assets';
import { readRuntimeMarketData, type MarketDataEnv } from '../_shared/marketDataRepository';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const headers = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' };

export async function onRequestGet(context: { request: Request; env: MarketDataEnv }) {
  const url = new URL(context.request.url);
  const asset = url.searchParams.get('asset');
  const since = url.searchParams.get('since');
  if (!MARKET_ASSET_IDS.includes(asset as MarketAssetId) || !since || !DATE_PATTERN.test(since) || Number.isNaN(Date.parse(`${since}T00:00:00Z`))) {
    return Response.json({ error: `asset must be one of ${MARKET_ASSET_IDS.join(', ')} and since must be YYYY-MM-DD` }, { status: 400, headers });
  }
  const result = await readRuntimeMarketData(context.env, asset as MarketAssetId, since);
  const etag = `W/\"${asset}-${result.latestDate}\"`;
  if (context.request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...headers, etag } });
  return Response.json({ asset, ...result }, { headers: { ...headers, etag } });
}

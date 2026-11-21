import { MARKET_ASSET_IDS, type MarketAssetId } from '../../workers/market-quote-refresh/src/assets';
import { fetchJson } from '../../workers/market-quote-refresh/src/sources';

// Display-only spot price. The forecast still anchors on completed daily candles.
const YAHOO_SYMBOL: Record<MarketAssetId, string> = { btc: 'BTC-USD', sp500: 'VOO', gold: 'GLD' };
const headers = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=30, s-maxage=60' };

export async function onRequestGet(context: { request: Request }) {
  const asset = new URL(context.request.url).searchParams.get('asset') as MarketAssetId;
  if (!MARKET_ASSET_IDS.includes(asset)) return Response.json({ error: `asset must be one of ${MARKET_ASSET_IDS.join(', ')}` }, { status: 400, headers });
  try {
    const payload = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(YAHOO_SYMBOL[asset])}?interval=1d&range=1d`, fetch, 2) as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; regularMarketTime?: number } }> } };
    const meta = payload.chart?.result?.[0]?.meta;
    if (!Number.isFinite(meta?.regularMarketPrice) || !Number.isFinite(meta?.regularMarketTime)) throw new Error('Quote source returned no price');
    return Response.json({ asset, price: meta!.regularMarketPrice, time: new Date(meta!.regularMarketTime! * 1000).toISOString() }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502, headers: { ...headers, 'cache-control': 'no-store' } });
  }
}

import { MARKET_ASSETS } from '../../src/lib/marketForecast';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
};

export async function onRequestGet() {
  return Response.json({
    assets: MARKET_ASSETS.map((asset) => ({
      id: asset.id,
      label: asset.label,
      ticker: asset.ticker,
      quote: asset.quote,
      instrumentLabel: asset.instrumentLabel,
      dataSourceLabel: asset.dataSourceLabel,
      capabilities: asset.capabilities,
    })),
  }, { headers: jsonHeaders });
}

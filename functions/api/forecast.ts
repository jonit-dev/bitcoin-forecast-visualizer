import { CONFIDENCE_Z_SCORES } from '../../src/lib/data';
import { loadMarketData, type MarketAssetId } from '../../src/lib/api';
import { buildMarketForecast, getMarketAssetConfig, MARKET_ASSETS } from '../../src/lib/marketForecast';

const VALID_ASSETS = new Set<MarketAssetId>(MARKET_ASSETS.map((asset) => asset.id));
const VALID_CONFIDENCE_LEVELS = Object.keys(CONFIDENCE_Z_SCORES).map(Number);
const DEFAULT_ASSET: MarketAssetId = 'btc';
const DEFAULT_HORIZON_DAYS = 180;
const DEFAULT_CONFIDENCE = 0.95;
const MAX_HORIZON_DAYS = 3650;
const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
};

function parseAsset(value: string | null): MarketAssetId | null {
  const asset = value && value.length > 0 ? value : DEFAULT_ASSET;
  return VALID_ASSETS.has(asset as MarketAssetId) ? asset as MarketAssetId : null;
}

function parseHorizon(value: string | null): number | null {
  if (value === null) return DEFAULT_HORIZON_DAYS;
  const horizon = Number(value);
  return Number.isInteger(horizon) && horizon >= 1 && horizon <= MAX_HORIZON_DAYS ? horizon : null;
}

function parseConfidence(value: string | null): number | null {
  if (value === null) return DEFAULT_CONFIDENCE;
  const confidence = Number(value);
  return VALID_CONFIDENCE_LEVELS.includes(confidence) ? confidence : null;
}

function forecastSummary(result: ReturnType<typeof buildMarketForecast>) {
  const forecast = result.probabilityForecast;
  if (!forecast) return null;
  return {
    horizonDays: forecast.horizonDays,
    targetDate: forecast.targetDate,
    median: forecast.median,
    probabilityUp: forecast.probabilityUp,
    q05: forecast.q05,
    q10: forecast.q10,
    q90: forecast.q90,
    q95: forecast.q95,
    calibrationLabel: forecast.calibrationLabel,
    verdict: forecast.verdict,
  };
}

export async function onRequestGet(context: { request: Request }) {
  const url = new URL(context.request.url);
  const assetId = parseAsset(url.searchParams.get('asset'));
  const horizonDays = parseHorizon(url.searchParams.get('horizon'));
  const confidence = parseConfidence(url.searchParams.get('confidence'));
  const errors: string[] = [];

  if (!assetId) errors.push(`asset must be one of: ${MARKET_ASSETS.map((asset) => asset.id).join(', ')}`);
  if (!horizonDays) errors.push(`horizon must be an integer from 1 to ${MAX_HORIZON_DAYS}`);
  if (!confidence) errors.push(`confidence must be one of: ${VALID_CONFIDENCE_LEVELS.join(', ')}`);

  if (errors.length > 0 || !assetId || !horizonDays || !confidence) {
    return Response.json({ error: errors.join('; ') }, { status: 400, headers: jsonHeaders });
  }

  const asset = getMarketAssetConfig(assetId);
  const marketData = loadMarketData(assetId);
  const confidenceZ = CONFIDENCE_Z_SCORES[confidence as keyof typeof CONFIDENCE_Z_SCORES];
  const result = buildMarketForecast(assetId, marketData, horizonDays, confidenceZ);
  const latest = marketData.ohlcv[marketData.ohlcv.length - 1];

  return Response.json({
    asset: {
      id: asset.id,
      label: asset.label,
      ticker: asset.ticker,
      quote: asset.quote,
      instrumentLabel: asset.instrumentLabel,
    },
    input: {
      horizonDays,
      confidence,
    },
    latest: {
      date: latest.date,
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      volume: latest.volume,
    },
    forecast: forecastSummary(result),
    drawdownStats: result.drawdownStats,
    generatedAt: new Date().toISOString(),
  }, { headers: jsonHeaders });
}

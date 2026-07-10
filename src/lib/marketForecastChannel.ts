import type { MarketAssetId, OHLCVData } from './api';
import { isUsMarketSessionDay } from '../../shared/us-market-calendar.mjs';

export interface MarketForecastChannelPoint {
  date: string;
  lower: number;
  upper: number;
}

export interface MarketForecastChannelResult {
  methodId: string;
  configurationVersion: string;
  points: MarketForecastChannelPoint[];
  fallbackReason: string | null;
}

export interface MarketForecastChannelConfig {
  methodId: 'frozen-residual-v1' | 'moving-block-price-quantiles-v1';
  configurationVersion: 'market-channel-path-v1';
  simulations: number;
  blockLength: number;
  innovationLookback: number;
  lowerQuantile: number;
  upperQuantile: number;
  minimumRows: number;
}

export const MARKET_CHANNEL_CANDIDATE_CONFIG: MarketForecastChannelConfig = {
  methodId: 'moving-block-price-quantiles-v1',
  configurationVersion: 'market-channel-path-v1',
  simulations: 1000,
  blockLength: 10,
  innovationLookback: 504,
  lowerQuantile: 0.05,
  upperQuantile: 0.95,
  minimumRows: 1000,
};

export interface BuildMarketForecastChannelOptions {
  assetId: Exclude<MarketAssetId, 'btc'>;
  rows: OHLCVData[];
  horizon: number;
  drift: number;
  dailyVol: number;
  seed: number;
  baselineTrend: number | null;
  baselineLowerResidual: number | null;
  baselineUpperResidual: number | null;
  config?: MarketForecastChannelConfig;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function marketSessionDatesAfter(origin: string, count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${origin}T00:00:00Z`);
  while (dates.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isUsMarketSessionDay(cursor)) dates.push(dateKey(cursor));
  }
  return dates;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function rngFromSeed(initialSeed: number): () => number {
  let seed = initialSeed >>> 0;
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function baseline(options: BuildMarketForecastChannelOptions, reason: string | null): MarketForecastChannelResult {
  const last = options.rows.at(-1);
  const points: MarketForecastChannelPoint[] = [];
  if (!last || !options.baselineTrend || options.baselineLowerResidual === null || options.baselineUpperResidual === null) {
    return { methodId: 'frozen-residual-v1', configurationVersion: 'market-channel-path-v1', points, fallbackReason: reason ?? 'baseline-inputs-unavailable' };
  }
  const dates = marketSessionDatesAfter(last.date, options.horizon);
  for (let lead = 1; lead <= options.horizon; lead++) {
    const trend = options.baselineTrend * Math.exp(options.drift * lead);
    points.push({
      date: dates[lead - 1],
      lower: trend * Math.exp(options.baselineLowerResidual),
      upper: trend * Math.exp(options.baselineUpperResidual),
    });
  }
  return { methodId: 'frozen-residual-v1', configurationVersion: 'market-channel-path-v1', points, fallbackReason: reason };
}

export function buildFrozenResidualChannel(options: BuildMarketForecastChannelOptions): MarketForecastChannelResult {
  return baseline(options, null);
}

export function buildMarketForecastChannel(options: BuildMarketForecastChannelOptions): MarketForecastChannelResult {
  const config = options.config ?? MARKET_CHANNEL_CANDIDATE_CONFIG;
  const last = options.rows.at(-1);
  if (config.methodId === 'frozen-residual-v1') return baseline(options, null);
  if (!last || options.rows.length < config.minimumRows || options.horizon < 1) {
    return baseline(options, !last ? 'empty-input' : 'insufficient-origin-history');
  }

  const rawReturns = options.rows.slice(1).flatMap((row, index) => {
    const previous = options.rows[index];
    return row.close > 0 && previous.close > 0 ? [Math.log(row.close / previous.close)] : [];
  }).slice(-config.innovationLookback);
  if (rawReturns.length < config.blockLength * 4) return baseline(options, 'insufficient-innovations');
  const average = rawReturns.reduce((sum, value) => sum + value, 0) / rawReturns.length;
  const centered = rawReturns.map((value) => value - average);
  const variance = centered.reduce((sum, value) => sum + value * value, 0) / Math.max(1, centered.length - 1);
  const empiricalVol = Math.sqrt(variance);
  if (!Number.isFinite(empiricalVol) || empiricalVol <= 0 || !Number.isFinite(options.dailyVol)) {
    return baseline(options, 'invalid-volatility');
  }
  const innovations = centered.map((value) => value * options.dailyVol / empiricalVol);
  const rng = rngFromSeed(options.seed);
  const paths = Array.from({ length: config.simulations }, () => new Float64Array(options.horizon));
  for (const path of paths) {
    let price = last.close;
    let blockOffset = config.blockLength;
    let blockStart = 0;
    for (let lead = 0; lead < options.horizon; lead++) {
      if (blockOffset >= config.blockLength) {
        blockStart = Math.floor(rng() * Math.max(1, innovations.length - config.blockLength + 1));
        blockOffset = 0;
      }
      price *= Math.exp(options.drift - 0.5 * options.dailyVol ** 2 + innovations[blockStart + blockOffset++]);
      path[lead] = price;
    }
  }
  const dates = marketSessionDatesAfter(last.date, options.horizon);
  const points = dates.map((date, index) => {
    const prices = paths.map((path) => path[index]);
    const median = last.close * Math.exp(options.drift * (index + 1));
    return {
      date,
      lower: Math.min(median, quantile(prices, config.lowerQuantile)),
      upper: Math.max(median, quantile(prices, config.upperQuantile)),
    };
  });
  const valid = points.every((point, index) => Number.isFinite(point.lower) && Number.isFinite(point.upper)
    && point.lower > 0 && point.lower <= point.upper && (index === 0 || point.date > points[index - 1].date));
  return valid
    ? { methodId: config.methodId, configurationVersion: config.configurationVersion, points, fallbackReason: null }
    : baseline(options, 'candidate-invariant-failure');
}

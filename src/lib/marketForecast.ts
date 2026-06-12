import type { MarketAssetId, MarketData, OHLCVData } from './api';
import {
  computeDrawdownStats,
  computeProbabilityForecast,
  generateHeatmapData,
  processRealData,
  type DrawdownStats,
  type HeatmapCell,
  type ProbabilityForecast,
} from './data';

export interface MarketAssetConfig {
  id: MarketAssetId;
  label: string;
  shortLabel: string;
  ticker: string;
  quote: string;
  chartTitle: string;
  subtitle: string;
  dataSourceLabel: string;
  instrumentLabel: string;
  capabilities: {
    bitcoinOverlays: boolean;
    mvrv: boolean;
    halvings: boolean;
    drawdownCycle: boolean;
    modelTrust: boolean;
    sourceFreshness: boolean;
  };
}

export interface MarketForecastResult {
  displayData: any[];
  heatmapData: HeatmapCell[];
  drawdownStats: DrawdownStats | null;
  probabilityForecast: ProbabilityForecast | null;
}

export const MARKET_ASSETS: MarketAssetConfig[] = [
  {
    id: 'btc',
    label: 'Bitcoin',
    shortLabel: 'BTC',
    ticker: 'BTC',
    quote: 'USD',
    chartTitle: 'BTC/USD Forward View',
    subtitle: 'Bitcoin forecast workspace',
    dataSourceLabel: 'CoinGecko market chart',
    instrumentLabel: 'BTC spot proxy',
    capabilities: {
      bitcoinOverlays: true,
      mvrv: true,
      halvings: true,
      drawdownCycle: true,
      modelTrust: true,
      sourceFreshness: true,
    },
  },
  {
    id: 'sp500',
    label: 'S&P 500',
    shortLabel: 'S&P 500',
    ticker: 'VOO',
    quote: 'USD',
    chartTitle: 'S&P 500 / VOO Forward View',
    subtitle: 'S&P 500 proxy forecast workspace',
    dataSourceLabel: 'Yahoo Finance chart API',
    instrumentLabel: 'VOO ETF, adjusted daily OHLCV',
    capabilities: {
      bitcoinOverlays: false,
      mvrv: false,
      halvings: false,
      drawdownCycle: false,
      modelTrust: false,
      sourceFreshness: false,
    },
  },
  {
    id: 'gold',
    label: 'Gold',
    shortLabel: 'Gold',
    ticker: 'GLD',
    quote: 'USD',
    chartTitle: 'Gold / GLD Forward View',
    subtitle: 'Gold proxy forecast workspace',
    dataSourceLabel: 'Yahoo Finance chart API',
    instrumentLabel: 'GLD ETF, adjusted daily OHLCV',
    capabilities: {
      bitcoinOverlays: false,
      mvrv: false,
      halvings: false,
      drawdownCycle: false,
      modelTrust: false,
      sourceFreshness: false,
    },
  },
];

export function getMarketAssetConfig(assetId: MarketAssetId): MarketAssetConfig {
  return MARKET_ASSETS.find((asset) => asset.id === assetId) ?? MARKET_ASSETS[0];
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[index];
}

function mulberry32(seed: number) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalFromRng(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function computeLogReturns(ohlcv: OHLCVData[]): number[] {
  return ohlcv.slice(1).flatMap((row, index) => {
    const prev = ohlcv[index];
    return row.close > 0 && prev.close > 0 ? [Math.log(row.close / prev.close)] : [];
  });
}

const GENERIC_STOCHASTIC_TRACE_COUNT = 12;
const GENERIC_RETURN_BOOTSTRAP_LOOKBACK_DAYS = 504;
const GENERIC_RETURN_BOOTSTRAP_BLOCK_DAYS = 10;
export const SP500_CHANNEL_CONFIG = {
  trendWindowDays: 126,
  residualLookbackDays: 1260,
  lowerResidualQuantile: 0.025,
  upperResidualQuantile: 0.99,
  minResidualSamples: 756,
} as const;

export const GOLD_MOMENTUM_CONFIG = {
  shortMomentumDays: 252,
  longMomentumDays: 504,
  shortMomentumWeight: 0.25,
  longMomentumWeight: 0.25,
  maxDailyDrift: 0.0006,
  volatilityWindowDays: 252,
} as const;

export const GOLD_CHANNEL_CONFIG = {
  trendWindowDays: 252,
  residualLookbackDays: 1260,
  lowerResidualQuantile: 0.025,
  upperResidualQuantile: 0.99,
  minResidualSamples: 756,
} as const;

interface GenericModelInputs {
  returns: number[];
  drift: number;
  dailyVol: number;
}

function quantileInterpolated(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function rollingMeanAt(ohlcv: OHLCVData[], index: number, windowDays: number): number | null {
  if (index < windowDays - 1) return null;
  let total = 0;
  for (let i = index - windowDays + 1; i <= index; i++) total += ohlcv[i].close;
  return total / windowDays;
}

export interface SP500ChannelPoint {
  trend: number | null;
  lower: number | null;
  upper: number | null;
  lowerResidual: number | null;
  upperResidual: number | null;
}

export type MarketChannelPoint = SP500ChannelPoint;

export function computeSP500ChannelBounds(ohlcv: OHLCVData[]): SP500ChannelPoint[] {
  const config = SP500_CHANNEL_CONFIG;
  const trends = ohlcv.map((_, index) => rollingMeanAt(ohlcv, index, config.trendWindowDays));
  const residuals = ohlcv.map((row, index) => {
    const trend = trends[index];
    return trend && trend > 0 && row.close > 0 ? Math.log(row.close / trend) : null;
  });

  return ohlcv.map((_, index) => {
    const trend = trends[index];
    if (!trend || trend <= 0) {
      return { trend, lower: null, upper: null, lowerResidual: null, upperResidual: null };
    }

    const start = Math.max(0, index - config.residualLookbackDays);
    const history = residuals
      .slice(start, index)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    if (history.length < config.minResidualSamples) {
      return { trend, lower: null, upper: null, lowerResidual: null, upperResidual: null };
    }

    const lowerResidual = quantileInterpolated(history, config.lowerResidualQuantile);
    const upperResidual = quantileInterpolated(history, config.upperResidualQuantile);
    return {
      trend,
      lower: trend * Math.exp(lowerResidual),
      upper: trend * Math.exp(upperResidual),
      lowerResidual,
      upperResidual,
    };
  });
}

export function computeGoldChannelBounds(ohlcv: OHLCVData[]): MarketChannelPoint[] {
  const config = GOLD_CHANNEL_CONFIG;
  const trends = ohlcv.map((_, index) => rollingMeanAt(ohlcv, index, config.trendWindowDays));
  const residuals = ohlcv.map((row, index) => {
    const trend = trends[index];
    return trend && trend > 0 && row.close > 0 ? Math.log(row.close / trend) : null;
  });

  return ohlcv.map((_, index) => {
    const trend = trends[index];
    if (!trend || trend <= 0) {
      return { trend, lower: null, upper: null, lowerResidual: null, upperResidual: null };
    }

    const start = Math.max(0, index - config.residualLookbackDays);
    const history = residuals
      .slice(start, index)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    if (history.length < config.minResidualSamples) {
      return { trend, lower: null, upper: null, lowerResidual: null, upperResidual: null };
    }

    const lowerResidual = quantileInterpolated(history, config.lowerResidualQuantile);
    const upperResidual = quantileInterpolated(history, config.upperResidualQuantile);
    return {
      trend,
      lower: trend * Math.exp(lowerResidual),
      upper: trend * Math.exp(upperResidual),
      lowerResidual,
      upperResidual,
    };
  });
}

function buildScaledEmpiricalInnovations(returns: number[], dailyVol: number): number[] {
  const recent = returns
    .slice(-GENERIC_RETURN_BOOTSTRAP_LOOKBACK_DAYS)
    .filter((value) => Number.isFinite(value));
  if (recent.length < GENERIC_RETURN_BOOTSTRAP_BLOCK_DAYS * 4) return [];

  const returnMean = mean(recent);
  const centered = recent.map((value) => value - returnMean);
  const empiricalVol = sampleStandardDeviation(centered);
  if (!Number.isFinite(empiricalVol) || empiricalVol <= 0) return [];

  const scale = dailyVol / empiricalVol;
  return centered.map((value) => value * scale);
}

export function computeSP500ModelInputs(ohlcv: OHLCVData[]) {
  const returns = computeLogReturns(ohlcv);
  const recent90 = returns.slice(-90);
  const recent252 = returns.slice(-252);
  const long252 = ohlcv.length > 252
    ? Math.log(ohlcv[ohlcv.length - 1].close / ohlcv[ohlcv.length - 253].close) / 252
    : mean(recent252);
  const expandingEquityPremium = Math.min(0.00055, Math.max(0.00005, mean(returns)));
  const drift = expandingEquityPremium - 0.25 * mean(recent90) + 0.25 * mean(recent252) + 0.10 * long252;
  const vol90 = sampleStandardDeviation(recent90);
  const vol252 = sampleStandardDeviation(recent252);
  const dailyVol = Math.max(0.0001, 0.65 * vol90 + 0.35 * vol252);

  return { returns, drift, dailyVol, expandingEquityPremium };
}

export function computeGoldModelInputs(ohlcv: OHLCVData[]): GenericModelInputs {
  const returns = computeLogReturns(ohlcv);
  const config = GOLD_MOMENTUM_CONFIG;
  const last = ohlcv[ohlcv.length - 1];

  const dailyMomentum = (days: number): number => {
    if (!last || ohlcv.length <= days) return 0;
    const anchor = ohlcv[ohlcv.length - 1 - days];
    return anchor.close > 0 ? Math.log(last.close / anchor.close) / days : 0;
  };

  const rawDrift = (
    config.shortMomentumWeight * dailyMomentum(config.shortMomentumDays) +
    config.longMomentumWeight * dailyMomentum(config.longMomentumDays)
  );
  const drift = Math.max(-config.maxDailyDrift, Math.min(config.maxDailyDrift, rawDrift));
  const recentVolWindow = returns.slice(-config.volatilityWindowDays);
  const fallbackVolWindow = returns.slice(-Math.min(returns.length, 756));
  const dailyVol = Math.max(
    0.0001,
    sampleStandardDeviation(recentVolWindow.length >= 60 ? recentVolWindow : fallbackVolWindow)
  );

  return { returns, drift, dailyVol };
}

function generateGenericStochasticTraces(
  ohlcv: OHLCVData[],
  horizon: number,
  drift: number,
  dailyVol: number,
  returns: number[]
): Map<string, number[]> {
  const traces = new Map<string, number[]>();
  const last = ohlcv[ohlcv.length - 1];
  if (!last || horizon < 1) return traces;

  const rng = mulberry32(0x5A500 + horizon * 97 + ohlcv.length);
  const lastDate = new Date(`${last.date}T00:00:00Z`);
  const prices = Array.from({ length: GENERIC_STOCHASTIC_TRACE_COUNT }, () => last.close);
  const empiricalInnovations = buildScaledEmpiricalInnovations(returns, dailyVol);
  const blockStarts = Array.from({ length: GENERIC_STOCHASTIC_TRACE_COUNT }, () => 0);
  const blockOffsets = Array.from(
    { length: GENERIC_STOCHASTIC_TRACE_COUNT },
    () => GENERIC_RETURN_BOOTSTRAP_BLOCK_DAYS
  );
  traces.set(last.date, [...prices]);

  for (let day = 1; day <= horizon; day++) {
    const date = dateKey(addUtcDays(lastDate, day));
    for (let i = 0; i < prices.length; i++) {
      let innovation: number;
      if (empiricalInnovations.length > 0) {
        if (blockOffsets[i] >= GENERIC_RETURN_BOOTSTRAP_BLOCK_DAYS) {
          blockStarts[i] = Math.floor(
            rng() * Math.max(1, empiricalInnovations.length - GENERIC_RETURN_BOOTSTRAP_BLOCK_DAYS)
          );
          blockOffsets[i] = 0;
        }
        innovation = empiricalInnovations[blockStarts[i] + blockOffsets[i]++];
      } else {
        innovation = dailyVol * normalFromRng(rng);
      }
      prices[i] *= Math.exp(drift - 0.5 * dailyVol * dailyVol + innovation);
    }
    traces.set(date, [...prices]);
  }

  return traces;
}

function projectTraceAboveLowerBound(primary: number, lowerBound: number | null): number {
  if (!lowerBound || lowerBound <= 0) return primary;
  const supportBuffer = 1.002;
  if (primary >= lowerBound * supportBuffer) return primary;

  const downsideGap = Math.max(0, Math.log(lowerBound / primary));
  const bounce = Math.min(Math.log(1.04), Math.log(supportBuffer) + downsideGap * 0.35);
  return lowerBound * Math.exp(bounce);
}

function selectPrimaryTraceIndex(rows: any[]): number {
  const traceCount = rows.reduce((max, row) => Math.max(max, row.stochasticTraces?.length ?? 0), 0);
  if (traceCount <= 1) return 0;

  let best = { index: 0, score: Number.POSITIVE_INFINITY };
  for (let index = 0; index < traceCount; index++) {
    const validRows = rows.filter((row) =>
      Number.isFinite(row.stochasticTraces?.[index]) &&
      Number.isFinite(row.floorPriceModel) &&
      Number.isFinite(row.close)
    );
    if (validRows.length === 0) continue;

    const breaches = validRows.filter((row) => row.stochasticTraces[index] < row.floorPriceModel).length;
    const avgMedianDistance = validRows.reduce(
      (sum, row) => sum + Math.abs(Math.log(row.stochasticTraces[index] / row.close)),
      0
    ) / validRows.length;
    const first = validRows[0];
    const terminal = validRows[validRows.length - 1];
    const firstDistance = Math.abs(Math.log(first.stochasticTraces[index] / first.close));
    const terminalDistance = Math.abs(Math.log(terminal.stochasticTraces[index] / terminal.close));
    const breachRate = breaches / validRows.length;
    const score = avgMedianDistance + breachRate * 0.2 + firstDistance * 0.8 + terminalDistance * 0.25;
    if (score < best.score) best = { index, score };
  }

  return best.index;
}

function promotePrimaryTrace(rows: any[], initialPrice: number): void {
  const primaryIndex = selectPrimaryTraceIndex(rows);
  let previousRaw = initialPrice;
  let previousProjected = initialPrice;

  for (const row of rows) {
    const traces = row.stochasticTraces;
    if (!Array.isArray(traces) || traces.length === 0) continue;

    const rawPrimary = traces[primaryIndex];
    const rawReturn = Number.isFinite(rawPrimary) && rawPrimary > 0 && previousRaw > 0
      ? Math.log(rawPrimary / previousRaw)
      : 0;
    const proposedPrimary = previousProjected * Math.exp(rawReturn);
    const primary = projectTraceAboveLowerBound(proposedPrimary, row.floorPriceModel);
    const reordered = primaryIndex === 0
      ? traces.slice(1)
      : [...traces.slice(0, primaryIndex), ...traces.slice(primaryIndex + 1)];
    row.stochasticTraces = [
      primary,
      ...reordered,
    ];
    previousRaw = Number.isFinite(rawPrimary) && rawPrimary > 0 ? rawPrimary : previousRaw;
    previousProjected = primary;
  }
}

function processGenericData(
  ohlcv: OHLCVData[],
  horizon: number,
  confidenceZ: number,
  modelInputs: GenericModelInputs,
  channelBounds: MarketChannelPoint[],
  supportAwarePrimaryTrace = false
): any[] {
  const { returns, drift, dailyVol } = modelInputs;
  const tracesByDate = generateGenericStochasticTraces(ohlcv, horizon, drift, dailyVol, returns);
  const latestChannel = [...channelBounds].reverse().find((point) =>
    point.lowerResidual !== null && point.upperResidual !== null
  );
  const data: any[] = ohlcv.map((row, index) => {
    const sma20 = index >= 19 ? mean(ohlcv.slice(index - 19, index + 1).map((d) => d.close)) : null;
    const sma50 = index >= 49 ? mean(ohlcv.slice(index - 49, index + 1).map((d) => d.close)) : null;
    const channel = channelBounds[index];
    return {
      ...row,
      sma20,
      sma50,
      isForecast: false,
      powerLawModel: channel.trend,
      floorPriceModel: channel.lower,
      peakPriceModel: channel.upper,
      stochasticTraces: tracesByDate.get(row.date),
    };
  });

  const last = ohlcv[ohlcv.length - 1];
  const lastDate = new Date(`${last.date}T00:00:00Z`);
  data[data.length - 1].forecast = last.close;
  data[data.length - 1].forecastUpper = last.close;
  data[data.length - 1].forecastLower = last.close;

  for (let day = 1; day <= horizon; day++) {
    const date = dateKey(addUtcDays(lastDate, day));
    const prevMedian = day === 1 ? last.close : last.close * Math.exp(drift * (day - 1));
    const median = last.close * Math.exp(drift * day);
    const representativeClose = median;
    const representativeOpen = prevMedian;
    const sigma = dailyVol * Math.sqrt(day);
    const rangeLow = median * Math.exp(-confidenceZ * sigma);
    const rangeHigh = median * Math.exp(confidenceZ * sigma);
    const candleSpread = Math.max(0.001, dailyVol * 0.25);
    const channelTrend = latestChannel?.trend
      ? latestChannel.trend * Math.exp(drift * day)
      : null;
    const lowerBound = channelTrend && latestChannel?.lowerResidual !== null && latestChannel?.lowerResidual !== undefined
      ? channelTrend * Math.exp(latestChannel.lowerResidual)
      : null;
    const upperBound = channelTrend && latestChannel?.upperResidual !== null && latestChannel?.upperResidual !== undefined
      ? channelTrend * Math.exp(latestChannel.upperResidual)
      : null;
    data.push({
      date,
      open: representativeOpen,
      high: Math.max(representativeOpen, representativeClose) * (1 + candleSpread),
      low: Math.min(representativeOpen, representativeClose) * (1 - candleSpread),
      close: representativeClose,
      volume: 0,
      forecast: median,
      forecastUpper: rangeHigh,
      forecastLower: rangeLow,
      forecastRange: [rangeLow, rangeHigh],
      isForecast: true,
      powerLawModel: channelTrend ?? median,
      floorPriceModel: lowerBound,
      peakPriceModel: upperBound,
      stochasticTraces: tracesByDate.get(date),
      sma20: null,
      sma50: null,
    });
  }

  if (supportAwarePrimaryTrace) {
    promotePrimaryTrace(data.filter((row) => row.isForecast), last.close);
  }

  return data;
}

function generateGenericHeatmapData(
  ohlcv: OHLCVData[],
  horizon: number,
  modelInputs: GenericModelInputs,
  numSimulations = 500,
  numPriceBands = 80
): HeatmapCell[] {
  const last = ohlcv[ohlcv.length - 1];
  if (!last || horizon < 1) return [];

  const { drift, dailyVol } = modelInputs;
  const lastDate = new Date(`${last.date}T00:00:00Z`);
  const rng = mulberry32(0x500500 + horizon * 53 + ohlcv.length);
  const sampleStep = horizon <= 90 ? 1 : horizon <= 365 ? 2 : horizon <= 1825 ? 5 : 10;
  const sampledDays: number[] = [];
  for (let day = 1; day <= horizon; day++) {
    if (day === 1 || day === horizon || day % sampleStep === 0) sampledDays.push(day);
  }

  const sampledCount = sampledDays.length;
  const sampledSet = new Set(sampledDays);
  const results = new Float64Array(numSimulations * sampledCount);

  for (let sim = 0; sim < numSimulations; sim++) {
    let price = last.close;
    let sampleIndex = 0;
    for (let day = 1; day <= horizon; day++) {
      price *= Math.exp(drift - 0.5 * dailyVol * dailyVol + dailyVol * normalFromRng(rng));
      if (sampledSet.has(day)) results[sim * sampledCount + sampleIndex++] = price;
    }
  }

  const sorted = Array.from(results).sort((a, b) => a - b);
  const p05 = quantile(sorted, 0.05);
  const p95 = quantile(sorted, 0.95);
  const logMin = Math.log(p05);
  const logMax = Math.log(p95);
  const bandSize = (logMax - logMin) / numPriceBands;
  if (!Number.isFinite(bandSize) || bandSize <= 0) return [];

  const cells: HeatmapCell[] = [];
  for (let dateIndex = 0; dateIndex < sampledCount; dateIndex++) {
    const counts = new Uint16Array(numPriceBands);
    for (let sim = 0; sim < numSimulations; sim++) {
      const logPrice = Math.log(results[sim * sampledCount + dateIndex]);
      const band = Math.min(numPriceBands - 1, Math.max(0, Math.floor((logPrice - logMin) / bandSize)));
      counts[band]++;
    }

    const maxCount = Math.max(...counts);
    if (maxCount === 0) continue;
    const date = dateKey(addUtcDays(lastDate, sampledDays[dateIndex]));
    for (let band = 0; band < numPriceBands; band++) {
      if (counts[band] === 0) continue;
      cells.push({
        date,
        priceLow: Math.exp(logMin + band * bandSize),
        priceHigh: Math.exp(logMin + (band + 1) * bandSize),
        density: counts[band] / maxCount,
      });
    }
  }

  return cells;
}

function computeGenericProbabilityForecast(
  ohlcv: OHLCVData[],
  horizonDays: number,
  modelInputs: GenericModelInputs,
  calibrationLabel = 'Log-return interval'
): ProbabilityForecast | null {
  const last = ohlcv[ohlcv.length - 1];
  if (!last || horizonDays < 1 || ohlcv.length < 252) return null;

  const { drift, dailyVol } = modelInputs;
  const targetDate = dateKey(addUtcDays(new Date(`${last.date}T00:00:00Z`), horizonDays));
  const median = last.close * Math.exp(drift * horizonDays);
  const sigma = dailyVol * Math.sqrt(horizonDays);
  const q05 = median * Math.exp(-1.6448536269514722 * sigma);
  const q10 = median * Math.exp(-1.2815515655446004 * sigma);
  const q90 = median * Math.exp(1.2815515655446004 * sigma);
  const q95 = median * Math.exp(1.6448536269514722 * sigma);
  const zUp = Math.log(last.close / median) / Math.max(sigma, 1e-9);
  const probabilityUp = Math.min(0.99, Math.max(0.01, 1 - normalCdf(zUp)));

  return {
    horizonDays,
    targetDate,
    median,
    probabilityUp,
    q05,
    q10,
    q90,
    q95,
    calibrationLabel,
    verdict: probabilityUp > 0.57 ? 'Upside-biased scenario' : probabilityUp < 0.43 ? 'Downside-biased scenario' : 'Balanced distribution',
  };
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export function buildMarketForecast(
  assetId: MarketAssetId,
  marketData: MarketData,
  horizon: number,
  confidenceZ: number
): MarketForecastResult {
  if (assetId === 'btc') {
    return {
      displayData: processRealData(marketData.ohlcv, horizon, confidenceZ),
      heatmapData: generateHeatmapData(marketData.ohlcv, horizon),
      drawdownStats: computeDrawdownStats(marketData.ohlcv, horizon),
      probabilityForecast: computeProbabilityForecast(marketData.ohlcv, horizon),
    };
  }

  if (assetId === 'gold') {
    const modelInputs = computeGoldModelInputs(marketData.ohlcv);
    return {
      displayData: processGenericData(
        marketData.ohlcv,
        horizon,
        confidenceZ,
        modelInputs,
        computeGoldChannelBounds(marketData.ohlcv),
        true
      ),
      heatmapData: generateGenericHeatmapData(marketData.ohlcv, horizon, modelInputs),
      drawdownStats: null,
      probabilityForecast: computeGenericProbabilityForecast(
        marketData.ohlcv,
        horizon,
        modelInputs,
        'Slow momentum interval'
      ),
    };
  }

  const modelInputs = computeSP500ModelInputs(marketData.ohlcv);
  return {
    displayData: processGenericData(
      marketData.ohlcv,
      horizon,
      confidenceZ,
      modelInputs,
      computeSP500ChannelBounds(marketData.ohlcv)
    ),
    heatmapData: generateGenericHeatmapData(marketData.ohlcv, horizon, modelInputs),
    drawdownStats: null,
    probabilityForecast: computeGenericProbabilityForecast(marketData.ohlcv, horizon, modelInputs),
  };
}

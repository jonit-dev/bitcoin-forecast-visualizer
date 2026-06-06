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
    dataSourceLabel: 'CoinGecko + CryptoCompare',
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

function rollingTrend(ohlcv: OHLCVData[], index: number): number | null {
  if (index < 199) return null;
  const window = ohlcv.slice(index - 199, index + 1);
  return window.reduce((sum, row) => sum + row.close, 0) / window.length;
}

function generateGenericStochasticTraces(ohlcv: OHLCVData[], horizon: number, drift: number, dailyVol: number): Map<string, number[]> {
  const traces = new Map<string, number[]>();
  const last = ohlcv[ohlcv.length - 1];
  if (!last || horizon < 1) return traces;

  const rng = mulberry32(0x5A500 + horizon * 97 + ohlcv.length);
  const lastDate = new Date(`${last.date}T00:00:00Z`);
  const prices = Array.from({ length: 12 }, () => last.close);
  traces.set(last.date, [...prices]);

  for (let day = 1; day <= horizon; day++) {
    const date = dateKey(addUtcDays(lastDate, day));
    for (let i = 0; i < prices.length; i++) {
      prices[i] *= Math.exp(drift - 0.5 * dailyVol * dailyVol + dailyVol * normalFromRng(rng));
    }
    traces.set(date, [...prices]);
  }

  return traces;
}

function processGenericData(ohlcv: OHLCVData[], horizon: number, confidenceZ: number): any[] {
  const { drift, dailyVol } = computeSP500ModelInputs(ohlcv);
  const tracesByDate = generateGenericStochasticTraces(ohlcv, horizon, drift, dailyVol);
  const data: any[] = ohlcv.map((row, index) => {
    const sma20 = index >= 19 ? mean(ohlcv.slice(index - 19, index + 1).map((d) => d.close)) : null;
    const sma50 = index >= 49 ? mean(ohlcv.slice(index - 49, index + 1).map((d) => d.close)) : null;
    return {
      ...row,
      sma20,
      sma50,
      isForecast: false,
      powerLawModel: rollingTrend(ohlcv, index),
      floorPriceModel: null,
      peakPriceModel: null,
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
    const sigma = dailyVol * Math.sqrt(day);
    const rangeLow = median * Math.exp(-confidenceZ * sigma);
    const rangeHigh = median * Math.exp(confidenceZ * sigma);
    const candleSpread = Math.max(0.001, dailyVol * 0.25);

    data.push({
      date,
      open: prevMedian,
      high: Math.max(prevMedian, median) * (1 + candleSpread),
      low: Math.min(prevMedian, median) * (1 - candleSpread),
      close: median,
      volume: 0,
      forecast: median,
      forecastUpper: rangeHigh,
      forecastLower: rangeLow,
      forecastRange: [rangeLow, rangeHigh],
      isForecast: true,
      powerLawModel: median,
      floorPriceModel: null,
      peakPriceModel: null,
      stochasticTraces: tracesByDate.get(date),
      sma20: null,
      sma50: null,
    });
  }

  return data;
}

function generateGenericHeatmapData(ohlcv: OHLCVData[], horizon: number, numSimulations = 500, numPriceBands = 80): HeatmapCell[] {
  const last = ohlcv[ohlcv.length - 1];
  if (!last || horizon < 1) return [];

  const { drift, dailyVol } = computeSP500ModelInputs(ohlcv);
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
  const p005 = quantile(sorted, 0.005);
  const p995 = quantile(sorted, 0.995);
  const logMin = Math.log(p005);
  const logMax = Math.log(p995);
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

function computeGenericProbabilityForecast(ohlcv: OHLCVData[], horizonDays: number): ProbabilityForecast | null {
  const last = ohlcv[ohlcv.length - 1];
  if (!last || horizonDays < 1 || ohlcv.length < 252) return null;

  const { drift, dailyVol } = computeSP500ModelInputs(ohlcv);
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
    calibrationLabel: 'Log-return interval',
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

  return {
    displayData: processGenericData(marketData.ohlcv, horizon, confidenceZ),
    heatmapData: generateGenericHeatmapData(marketData.ohlcv, horizon),
    drawdownStats: null,
    probabilityForecast: computeGenericProbabilityForecast(marketData.ohlcv, horizon),
  };
}

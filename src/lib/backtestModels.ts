import type { OHLCVData } from './api';
import { INTERVAL_CONFIG } from './modelConfig';
import { powerLawForecast, POWER_LAW_MEAN_REVERSION_TAU_DAYS } from './powerLaw';
import type { ForecastDistribution } from './backtestMetrics';

export type BacktestModelId =
  | 'naive-current-price'
  | 'gbm-driftless'
  | 'gbm-recent-drift'
  | 'ma-trend-20-50-200'
  | 'powerlaw-current';

export interface BacktestModel {
  id: BacktestModelId;
  description: string;
  config: Record<string, unknown>;
  forecast: (ohlcv: OHLCVData[], originIndex: number, horizonDays: number) => ForecastDistribution | null;
}

const RECENT_LOOKBACK = 90;
const STRUCTURAL_LOOKBACK = 365;

export function getBacktestModels(): BacktestModel[] {
  return [
    {
      id: 'naive-current-price',
      description: 'Endpoint forecast equal to the origin close.',
      config: {},
      forecast: (ohlcv, originIndex) => ({ median: ohlcv[originIndex].close }),
    },
    {
      id: 'gbm-driftless',
      description: 'Driftless geometric Brownian benchmark centered on the origin close.',
      config: { lookbackDays: STRUCTURAL_LOOKBACK },
      forecast: (ohlcv, originIndex, horizonDays) => {
        const sigma = computeLogReturnVol(ohlcv, originIndex, STRUCTURAL_LOOKBACK) * Math.sqrt(horizonDays);
        return withLogNormalQuantiles(ohlcv[originIndex].close, sigma);
      },
    },
    {
      id: 'gbm-recent-drift',
      description: 'Recent-drift geometric Brownian benchmark using trailing 90-day log returns.',
      config: { lookbackDays: RECENT_LOOKBACK },
      forecast: (ohlcv, originIndex, horizonDays) => {
        const stats = computeLogReturnStats(ohlcv, originIndex, RECENT_LOOKBACK);
        const median = ohlcv[originIndex].close * Math.exp(stats.meanReturn * horizonDays);
        return withLogNormalQuantiles(median, stats.dailyVol * Math.sqrt(horizonDays));
      },
    },
    {
      id: 'ma-trend-20-50-200',
      description: 'Moving-average trend benchmark blended from 20/50/200-day slopes.',
      config: { windows: [20, 50, 200] },
      forecast: (ohlcv, originIndex, horizonDays) => {
        if (originIndex < 220) return null;
        const current = ohlcv[originIndex].close;
        const ma20 = movingAverage(ohlcv, originIndex, 20);
        const ma50 = movingAverage(ohlcv, originIndex, 50);
        const ma200 = movingAverage(ohlcv, originIndex, 200);
        const trend = 0.55 * Math.log(ma20 / ma50) / 30 + 0.45 * Math.log(ma50 / ma200) / 150;
        const cappedTrend = Math.max(-0.006, Math.min(0.006, trend));
        return { median: current * Math.exp(cappedTrend * horizonDays) };
      },
    },
    {
      id: 'powerlaw-current',
      description: 'Current app power-law endpoint forecast.',
      config: {
        interval: INTERVAL_CONFIG,
        meanReversionTauDays: POWER_LAW_MEAN_REVERSION_TAU_DAYS,
      },
      forecast: (ohlcv, originIndex, horizonDays) => {
        const current = ohlcv[originIndex];
        const currentDate = parseDate(current.date);
        const targetDate = addUtcDays(currentDate, horizonDays);
        const median = powerLawForecast(targetDate, current.close, currentDate);
        const dailyVol = blendedPowerLawHeatmapVol(ohlcv, originIndex);
        const sigma = powerLawIntervalStressMultiplier(horizonDays) * Math.sqrt(powerLawResidualVariance(horizonDays, dailyVol));
        return withLogNormalQuantiles(median, sigma);
      },
    },
  ];
}

export function computeLogReturnStats(ohlcv: OHLCVData[], endIndex: number, lookback: number) {
  const start = Math.max(0, endIndex - lookback);
  const recent = ohlcv.slice(start, endIndex + 1);
  const logReturns = recent.slice(1).map((point, index) => Math.log(point.close / recent[index].close));
  const meanReturn = logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / logReturns.length;
  return {
    meanReturn,
    dailyVol: Math.sqrt(variance),
  };
}

function computeLogReturnVol(ohlcv: OHLCVData[], endIndex: number, lookback: number) {
  return computeLogReturnStats(ohlcv, endIndex, lookback).dailyVol;
}

function blendedPowerLawHeatmapVol(ohlcv: OHLCVData[], endIndex: number) {
  const recentVol = computeLogReturnVol(ohlcv, endIndex, RECENT_LOOKBACK);
  const structuralVol = computeLogReturnVol(ohlcv, endIndex, STRUCTURAL_LOOKBACK);
  return Math.sqrt(
    INTERVAL_CONFIG.recentVolWeight * recentVol * recentVol +
    (1 - INTERVAL_CONFIG.recentVolWeight) * structuralVol * structuralVol
  );
}

function powerLawResidualVariance(days: number, dailyVol: number): number {
  const residualDecay = Math.exp(-1 / POWER_LAW_MEAN_REVERSION_TAU_DAYS);
  let varianceMultiplier = 0;
  let decayPowerSq = 1;

  for (let step = 0; step < days; step++) {
    varianceMultiplier += decayPowerSq;
    decayPowerSq *= residualDecay * residualDecay;
  }

  return dailyVol * dailyVol * varianceMultiplier;
}

function powerLawIntervalStressMultiplier(days: number): number {
  const { base, amplitude, tauDays } = INTERVAL_CONFIG.stressMultiplier;
  return base + amplitude * (1 - Math.exp(-days / tauDays));
}

function movingAverage(ohlcv: OHLCVData[], endIndex: number, windowDays: number): number {
  const start = endIndex - windowDays + 1;
  const window = ohlcv.slice(start, endIndex + 1);
  return window.reduce((sum, row) => sum + row.close, 0) / window.length;
}

function withLogNormalQuantiles(median: number, sigma: number): ForecastDistribution {
  return {
    median,
    sigma,
    quantiles: {
      q025: median * Math.exp(sigma * normalQuantile(0.025)),
      q05: median * Math.exp(sigma * normalQuantile(0.05)),
      q10: median * Math.exp(sigma * normalQuantile(0.10)),
      q50: median,
      q90: median * Math.exp(sigma * normalQuantile(0.90)),
      q95: median * Math.exp(sigma * normalQuantile(0.95)),
      q975: median * Math.exp(sigma * normalQuantile(0.975)),
    },
  };
}

function normalQuantile(probability: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  const p = Math.min(Math.max(probability, 1e-9), 1 - 1e-9);

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

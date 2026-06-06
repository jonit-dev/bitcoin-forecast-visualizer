import type { OHLCVData } from './api';
import { computePowerLawInterval, normalQuantile } from './forecastInterval';
import { INTERVAL_CONFIG } from './modelConfig';
import { powerLawForecast, POWER_LAW_MEAN_REVERSION_TAU_DAYS } from './powerLaw';
import { forecastWithPowerLawCoefficients, type PowerLawFitCoefficients } from './powerLawFit';
import type { ForecastDistribution } from './backtestMetrics';

export type BacktestModelId =
  | 'naive-current-price'
  | 'gbm-driftless'
  | 'gbm-recent-drift'
  | 'ma-trend-20-50-200'
  | 'powerlaw-current'
  | 'powerlaw-refit-candidate';

export interface BacktestModel {
  id: BacktestModelId;
  description: string;
  config: Record<string, unknown>;
  forecast: (ohlcv: OHLCVData[], originIndex: number, horizonDays: number) => ForecastDistribution | null;
}

const RECENT_LOOKBACK = 90;
const STRUCTURAL_LOOKBACK = 365;

export interface BacktestModelOptions {
  powerLawCandidate?: PowerLawFitCoefficients | null;
}

export function getBacktestModels(options: BacktestModelOptions = {}): BacktestModel[] {
  const models: BacktestModel[] = [
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
        const interval = computePowerLawInterval({
          ohlcv: ohlcv.slice(0, originIndex + 1),
          horizonDays,
          median,
          currentPrice: current.close,
        });
        return interval ? withLogNormalQuantiles(median, interval.sigma) : null;
      },
    },
  ];

  if (options.powerLawCandidate) {
    const candidate = options.powerLawCandidate;
    models.push({
      id: 'powerlaw-refit-candidate',
      description: 'Opt-in refit candidate from a coefficient stability report.',
      config: {
        coefficients: candidate,
        interval: INTERVAL_CONFIG,
        meanReversionTauDays: POWER_LAW_MEAN_REVERSION_TAU_DAYS,
      },
      forecast: (ohlcv, originIndex, horizonDays) => {
        const current = ohlcv[originIndex];
        const currentDate = parseDate(current.date);
        const targetDate = addUtcDays(currentDate, horizonDays);
        const median = forecastWithPowerLawCoefficients(candidate, targetDate, current.close, currentDate);
        const interval = computePowerLawInterval({
          ohlcv: ohlcv.slice(0, originIndex + 1),
          horizonDays,
          median,
          currentPrice: current.close,
        });
        return interval ? withLogNormalQuantiles(median, interval.sigma) : null;
      },
    });
  }

  return models;
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

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

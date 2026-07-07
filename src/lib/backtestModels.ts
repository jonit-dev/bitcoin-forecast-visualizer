import type { OHLCVData } from './api';
import {
  computePowerLawInterval,
  computeResidualBootstrapSigmaMultiplier,
  normalQuantile,
  type ResidualBootstrapPolicyId,
} from './forecastInterval';
import { cycleAdjustedPowerLawForecast, cycleIntervalSigmaMultiplier, type CycleStrategyId } from './cycle';
import { CYCLE_EXPERIMENT_CONFIG, ENSEMBLE_CONFIG, INTERVAL_CONFIG, RESIDUAL_BOOTSTRAP_CONFIG, TAU_EXPERIMENT_CONFIG } from './modelConfig';
import { powerLawForecast, POWER_LAW_MEAN_REVERSION_TAU_DAYS, powerLawForecastWithTau } from './powerLaw';
import { forecastWithPowerLawCoefficients, type PowerLawFitCoefficients } from './powerLawFit';
import type { ForecastDistribution } from './backtestMetrics';
import { blendForecastDistributions } from './ensembleForecast';

export type BacktestModelId =
  | 'naive-current-price'
  | 'gbm-driftless'
  | 'gbm-recent-drift'
  | 'ma-trend-20-50-200'
  | 'powerlaw-current'
  | 'validation-weighted-ensemble'
  | 'powerlaw-refit-candidate'
  | `powerlaw-tau-${number}`
  | 'powerlaw-tau-vol-conditional'
  | `powerlaw-cycle-${CycleStrategyId}`
  | `powerlaw-residual-${ResidualBootstrapPolicyId}`;

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
  tauSuite?: boolean;
  cycleSuite?: boolean;
  residualBootstrapSuite?: boolean;
  ensembleWeights?: Partial<Record<number, Record<string, number>>>;
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
  if (options.tauSuite) {
    for (const tauDays of TAU_EXPERIMENT_CONFIG.fixedCandidates) {
      models.push(buildTauModel(`powerlaw-tau-${tauDays}`, `Power-law forecast with fixed ${tauDays} day residual mean-reversion tau.`, tauDays));
    }
    models.push({
      id: 'powerlaw-tau-vol-conditional',
      description: 'Power-law forecast with tau selected from trailing realized volatility regime.',
      config: TAU_EXPERIMENT_CONFIG.volatilityConditional,
      forecast: (ohlcv, originIndex, horizonDays) => {
        const tauDays = tauForVolatilityRegime(ohlcv, originIndex);
        return forecastPowerLawWithTau(ohlcv, originIndex, horizonDays, tauDays);
      },
    });
  }
  if (options.cycleSuite) {
    for (const strategyId of CYCLE_EXPERIMENT_CONFIG.candidateStrategyIds) {
      models.push(buildCycleModel(strategyId as CycleStrategyId));
    }
  }
  if (options.residualBootstrapSuite) {
    for (const policyId of RESIDUAL_BOOTSTRAP_CONFIG.candidatePolicyIds) {
      models.push(buildResidualBootstrapModel(policyId as ResidualBootstrapPolicyId));
    }
  }
  if (options.ensembleWeights) {
    models.push(buildValidationWeightedEnsemble(options.ensembleWeights));
  }

  return models;
}

function buildValidationWeightedEnsemble(weightsByHorizon: Partial<Record<number, Record<string, number>>>): BacktestModel {
  return {
    id: 'validation-weighted-ensemble',
    description: 'Report-only validation-weighted blend of power-law, recent-drift GBM, and moving-average trend members.',
    config: {
      defaultEnabled: ENSEMBLE_CONFIG.defaultEnabled,
      members: ENSEMBLE_CONFIG.candidateMembers,
      weightsByHorizon,
      reportOnly: true,
    },
    forecast: (ohlcv, originIndex, horizonDays) => {
      const weights = weightsByHorizon[horizonDays] ?? {};
      const memberModels = getBacktestModels().filter(model => ENSEMBLE_CONFIG.candidateMembers.includes(model.id as never));
      return blendForecastDistributions(memberModels.map(model => ({
        id: model.id,
        weight: weights[model.id] ?? 0,
        forecast: model.forecast(ohlcv, originIndex, horizonDays),
      })));
    },
  };
}

function buildResidualBootstrapModel(policyId: ResidualBootstrapPolicyId): BacktestModel {
  return {
    id: `powerlaw-residual-${policyId}`,
    description: residualPolicyDescription(policyId),
    config: {
      policyId,
      reportOnly: policyId !== RESIDUAL_BOOTSTRAP_CONFIG.selectedPolicyId,
      blockDays: RESIDUAL_BOOTSTRAP_CONFIG.blockDays,
      simulations: RESIDUAL_BOOTSTRAP_CONFIG.simulations,
    },
    forecast: (ohlcv, originIndex, horizonDays) => {
      if (!RESIDUAL_BOOTSTRAP_CONFIG.gatedHorizons.includes(horizonDays as never)) return null;
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
      if (!interval) return null;
      const multiplier = computeResidualBootstrapSigmaMultiplier(ohlcv, horizonDays, policyId, originIndex);
      return withLogNormalQuantiles(median, interval.sigma * multiplier);
    },
  };
}

function residualPolicyDescription(policyId: ResidualBootstrapPolicyId): string {
  switch (policyId) {
    case 'recent-730d':
      return 'Current recent-residual bootstrap policy using approximately the last 730 daily residuals.';
    case 'full-history':
      return 'Full-history residual bootstrap policy using all available one-day power-law residuals before origin.';
    case 'vol-regime-stratified':
      return 'Volatility-regime-stratified residual bootstrap policy sampling residual blocks from matching realized-volatility regimes.';
  }
}

function buildCycleModel(strategyId: CycleStrategyId): BacktestModel {
  return {
    id: `powerlaw-cycle-${strategyId}`,
    description: cycleStrategyDescription(strategyId),
    config: {
      strategyId,
      reportOnly: strategyId !== CYCLE_EXPERIMENT_CONFIG.selectedStrategyId,
      sigmaMultiplier: cycleIntervalSigmaMultiplier(strategyId, 365),
    },
    forecast: (ohlcv, originIndex, horizonDays) => {
      const current = ohlcv[originIndex];
      const currentDate = parseDate(current.date);
      const targetDate = addUtcDays(currentDate, horizonDays);
      const median = cycleAdjustedPowerLawForecast(targetDate, current.close, currentDate, strategyId);
      const interval = computePowerLawInterval({
        ohlcv: ohlcv.slice(0, originIndex + 1),
        horizonDays,
        median,
        currentPrice: current.close,
      });
      if (!interval) return null;
      return withLogNormalQuantiles(median, interval.sigma * cycleIntervalSigmaMultiplier(strategyId, horizonDays));
    },
  };
}

function cycleStrategyDescription(strategyId: CycleStrategyId): string {
  switch (strategyId) {
    case 'deterministic-pivots':
      return 'Current UI cycle strategy with deterministic future ATL/ATH pivot interpolation.';
    case 'no-future-pivots':
      return 'Power-law residual forecast with no future pivot interpolation beyond sinusoidal base terms.';
    case 'damped-future-pivots':
      return 'Cycle-aware forecast with future pivot amplitude damped by projected cycle distance.';
    case 'pivot-uncertainty-wide':
      return 'Deterministic pivot median with wider intervals for future pivot-timing uncertainty.';
  }
}

function buildTauModel(id: `powerlaw-tau-${number}`, description: string, tauDays: number): BacktestModel {
  return {
    id,
    description,
    config: {
      tauDays,
      reportOnly: tauDays !== POWER_LAW_MEAN_REVERSION_TAU_DAYS,
    },
    forecast: (ohlcv, originIndex, horizonDays) => forecastPowerLawWithTau(ohlcv, originIndex, horizonDays, tauDays),
  };
}

function forecastPowerLawWithTau(ohlcv: OHLCVData[], originIndex: number, horizonDays: number, tauDays: number): ForecastDistribution | null {
  const current = ohlcv[originIndex];
  const currentDate = parseDate(current.date);
  const targetDate = addUtcDays(currentDate, horizonDays);
  const median = powerLawForecastWithTau(targetDate, current.close, currentDate, tauDays);
  const interval = computePowerLawInterval({
    ohlcv: ohlcv.slice(0, originIndex + 1),
    horizonDays,
    median,
    currentPrice: current.close,
  });
  return interval ? withLogNormalQuantiles(median, interval.sigma) : null;
}

function tauForVolatilityRegime(ohlcv: OHLCVData[], originIndex: number): number {
  const vol = computeLogReturnStats(ohlcv, originIndex, 90).dailyVol;
  const config = TAU_EXPERIMENT_CONFIG.volatilityConditional;
  if (vol >= config.highVolDailyThreshold) return config.highVolTauDays;
  if (vol <= config.lowVolDailyThreshold) return config.lowVolTauDays;
  return config.normalTauDays;
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

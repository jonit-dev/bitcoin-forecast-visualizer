import type { OHLCVData } from './api';
import { DISTRIBUTION_CONFIG, INTERVAL_CONFIG, RESIDUAL_BOOTSTRAP_CONFIG, validateDistributionConfig } from './modelConfig';
import { cdfAt, quantileAt, type PredictiveDistribution } from './predictiveDistribution';
import { POWER_LAW_MEAN_REVERSION_TAU_DAYS, powerLawForecast } from './powerLaw';

export { normalCdf, normalQuantile } from './predictiveDistribution';

export type ResidualBootstrapPolicyId = 'recent-730d' | 'full-history' | 'vol-regime-stratified';

export const CONFIDENCE_Z_SCORES = {
  0.95: 1.96,
  0.9: 1.64,
  0.8: 1.28,
} as const;

export interface PowerLawIntervalInput {
  ohlcv: OHLCVData[];
  horizonDays: number;
  median: number;
  currentPrice: number;
  distribution?: PredictiveDistribution;
}

export interface PowerLawInterval {
  sigma: number;
  multiplier: number;
  probabilityUp: number;
  q025: number;
  q05: number;
  q10: number;
  q50: number;
  q90: number;
  q95: number;
  q975: number;
  calibrationLabel: string;
  coverageStatus: string;
}

interface ResidualRow {
  index: number;
  residual: number;
  volatility: number;
}

const RESIDUAL_ROWS_CACHE = new WeakMap<OHLCVData[], ResidualRow[]>();
const RESIDUAL_SIGMA_MULTIPLIER_CACHE = new WeakMap<OHLCVData[], Map<string, number>>();

export function computePowerLawInterval(input: PowerLawIntervalInput): PowerLawInterval | null {
  const { ohlcv, horizonDays, median, currentPrice } = input;
  if (ohlcv.length < 365 || horizonDays < 1 || median <= 0 || currentPrice <= 0) return null;

  const dailyVol = blendedPowerLawHeatmapVol(ohlcv);
  const multiplier = intervalMultiplierForHorizon(horizonDays);
  const sigma = dailyVol * effectiveSigmaScaleForHorizon(horizonDays);
  const distribution = input.distribution ?? distributionForHorizon(horizonDays);

  return {
    sigma,
    multiplier,
    probabilityUp: 1 - cdfAt(distribution, median, sigma, currentPrice),
    q025: quantileAt(distribution, median, sigma, 0.025),
    q05: quantileAt(distribution, median, sigma, 0.05),
    q10: quantileAt(distribution, median, sigma, 0.10),
    q50: median,
    q90: quantileAt(distribution, median, sigma, 0.90),
    q95: quantileAt(distribution, median, sigma, 0.95),
    q975: quantileAt(distribution, median, sigma, 0.975),
    calibrationLabel: calibrationLabel(horizonDays),
    coverageStatus: coverageStatus(horizonDays),
  };
}

export function distributionForHorizon(horizonDays: number): PredictiveDistribution {
  validateDistributionConfig(DISTRIBUTION_CONFIG);
  if (!DISTRIBUTION_CONFIG.defaultEnabled || DISTRIBUTION_CONFIG.kind === 'lognormal') {
    return { kind: 'lognormal' };
  }

  const nu = DISTRIBUTION_CONFIG.nuByHorizon?.[String(horizonDays)];
  return Number.isFinite(nu) && nu > 2 ? { kind: 'student-t', nu } : { kind: 'lognormal' };
}

export function computeResidualBootstrapSigmaMultiplier(
  ohlcv: OHLCVData[],
  horizonDays: number,
  policyId: ResidualBootstrapPolicyId,
  endIndex: number = ohlcv.length - 1
): number {
  if (horizonDays < 1 || endIndex < 365) return 1;
  const cache = residualSigmaMultiplierCache(ohlcv);
  const cacheKey = `${policyId}:${endIndex}:${horizonDays}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const residuals = residualsForPolicy(ohlcv, endIndex, policyId);
  if (residuals.length < RESIDUAL_BOOTSTRAP_CONFIG.blockDays * 4) {
    cache.set(cacheKey, 1);
    return 1;
  }

  const sampled = sampleResidualBlocksDeterministically({
    residuals,
    blockDays: RESIDUAL_BOOTSTRAP_CONFIG.blockDays,
    horizonDays,
    simulations: RESIDUAL_BOOTSTRAP_CONFIG.simulations,
    seed: 0xB007500 + horizonDays * 997 + policyId.length * 131 + endIndex,
  });
  const sampledSd = sampleStandardDeviation(sampled);
  const baseVol = blendedPowerLawHeatmapVol(ohlcv.slice(0, endIndex + 1));
  const baseSigma = Math.sqrt(powerLawResidualVariance(horizonDays, baseVol));
  const multiplier = !Number.isFinite(sampledSd) || sampledSd <= 0 || !Number.isFinite(baseSigma) || baseSigma <= 0
    ? 1
    : Math.max(0.7, Math.min(1.8, sampledSd / baseSigma));
  cache.set(cacheKey, multiplier);
  return multiplier;
}

export function sampleResidualBlocksDeterministically(input: {
  residuals: number[];
  blockDays: number;
  horizonDays: number;
  simulations: number;
  seed: number;
}): number[] {
  const residuals = input.residuals.filter(Number.isFinite);
  if (residuals.length === 0 || input.horizonDays < 1 || input.simulations < 1) return [];
  const blockDays = Math.max(1, Math.min(input.blockDays, residuals.length));
  const rng = mulberry32(input.seed);
  const totals: number[] = [];

  for (let simulation = 0; simulation < input.simulations; simulation++) {
    let total = 0;
    let sampledDays = 0;
    while (sampledDays < input.horizonDays) {
      const start = Math.floor(rng() * Math.max(1, residuals.length - blockDays + 1));
      for (let offset = 0; offset < blockDays && sampledDays < input.horizonDays; offset++, sampledDays++) {
        total += residuals[start + offset];
      }
    }
    totals.push(total);
  }

  return totals;
}

export function intervalMultiplierForHorizon(horizonDays: number): number {
  const table = [...INTERVAL_CONFIG.fittedMultipliers].sort((a, b) => a.horizonDays - b.horizonDays);
  const direct = table.find(row => row.horizonDays === horizonDays);
  if (direct) return direct.multiplier;

  if (horizonDays < table[0].horizonDays) return table[0].multiplier;
  const last = table[table.length - 1];
  if (horizonDays > last.horizonDays) {
    // The residual-process variance converges to ~105.5 for tau=210 days.
    // Above the fitted maximum, trend-estimation uncertainty is extrapolated
    // explicitly so the displayed scenario band does not saturate.
    const maxFittedHorizon = INTERVAL_CONFIG.scenarioPolicy.maxFittedHorizonDays;
    return last.multiplier * Math.sqrt(horizonDays / maxFittedHorizon);
  }

  for (let i = 1; i < table.length; i++) {
    const left = table[i - 1];
    const right = table[i];
    if (horizonDays < right.horizonDays) {
      const t = (Math.log(horizonDays) - Math.log(left.horizonDays)) / (Math.log(right.horizonDays) - Math.log(left.horizonDays));
      return Math.exp(Math.log(left.multiplier) + t * (Math.log(right.multiplier) - Math.log(left.multiplier)));
    }
  }

  return last.multiplier;
}

function effectiveSigmaScaleForHorizon(horizonDays: number): number {
  const table = [...INTERVAL_CONFIG.fittedMultipliers].sort((a, b) => a.horizonDays - b.horizonDays);
  const fittedScales = table.map(row => row.multiplier * Math.sqrt(powerLawResidualVariance(row.horizonDays, 1)));
  const monotoneScales = fittedScales.map((scale, index) =>
    index === 0 ? scale : Math.max(scale, fittedScales.slice(0, index).reduce((max, previous) => Math.max(max, previous), 0))
  );

  if (horizonDays < table[0].horizonDays) {
    return table[0].multiplier * Math.sqrt(powerLawResidualVariance(horizonDays, 1));
  }

  const last = table[table.length - 1];
  if (horizonDays > last.horizonDays) {
    // The fitted 180d and 365d multipliers are retained as published inputs,
    // but their raw sigma values are not monotone. Continue the monotone
    // effective scale from the largest fitted sigma with sqrt(h / 365).
    return monotoneScales[monotoneScales.length - 1]
      * Math.sqrt(horizonDays / INTERVAL_CONFIG.scenarioPolicy.maxFittedHorizonDays);
  }

  const direct = table.findIndex(row => row.horizonDays === horizonDays);
  if (direct >= 0) return monotoneScales[direct];

  for (let index = 1; index < table.length; index++) {
    const left = table[index - 1];
    const right = table[index];
    if (horizonDays < right.horizonDays) {
      if (monotoneScales[index] === monotoneScales[index - 1]) return monotoneScales[index - 1];
      const t = (Math.log(horizonDays) - Math.log(left.horizonDays)) /
        (Math.log(right.horizonDays) - Math.log(left.horizonDays));
      return Math.exp(Math.log(monotoneScales[index - 1]) + t * (Math.log(monotoneScales[index]) - Math.log(monotoneScales[index - 1])));
    }
  }

  return monotoneScales[monotoneScales.length - 1];
}

export function blendedPowerLawHeatmapVol(ohlcv: OHLCVData[]) {
  const recentVol = computeLogReturnStats(ohlcv, 90).dailyVol;
  const structuralVol = computeLogReturnStats(ohlcv, 365).dailyVol;

  return Math.sqrt(
    INTERVAL_CONFIG.recentVolWeight * recentVol * recentVol +
    (1 - INTERVAL_CONFIG.recentVolWeight) * structuralVol * structuralVol
  );
}

export function powerLawResidualVariance(days: number, dailyVol: number): number {
  const residualDecay = Math.exp(-1 / POWER_LAW_MEAN_REVERSION_TAU_DAYS);
  let varianceMultiplier = 0;
  let decayPowerSq = 1;

  for (let step = 0; step < days; step++) {
    varianceMultiplier += decayPowerSq;
    decayPowerSq *= residualDecay * residualDecay;
  }

  return dailyVol * dailyVol * varianceMultiplier;
}

function computeLogReturnStats(ohlcv: OHLCVData[], lookback: number) {
  const cappedLookback = Math.min(Math.max(1, lookback), ohlcv.length - 1);
  const recent = ohlcv.slice(-cappedLookback - 1);
  const logReturns = recent.slice(1).map((d, i) => Math.log(d.close / recent[i].close));
  const meanReturn = logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length;
  const variance = logReturns.length < 2
    ? 0
    : logReturns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / (logReturns.length - 1);

  return {
    meanReturn,
    dailyVol: Math.sqrt(variance),
  };
}

function residualsForPolicy(
  ohlcv: OHLCVData[],
  endIndex: number,
  policyId: ResidualBootstrapPolicyId
): number[] {
  const all = residualRowsForData(ohlcv).filter(row => row.index <= endIndex);
  if (policyId === 'full-history') return all.map(row => row.residual);
  if (policyId === 'recent-730d') return all.slice(-RESIDUAL_BOOTSTRAP_CONFIG.recentLookbackDays).map(row => row.residual);

  const currentVol = trailingVolatility(ohlcv, endIndex, 30);
  const vols = all.map(row => row.volatility).filter(Number.isFinite).sort((a, b) => a - b);
  const lowCutoff = percentile(vols, 0.33);
  const highCutoff = percentile(vols, 0.67);
  const currentBucket = volatilityBucket(currentVol, lowCutoff, highCutoff);
  const sameBucket = all.filter(row => volatilityBucket(row.volatility, lowCutoff, highCutoff) === currentBucket).map(row => row.residual);
  return sameBucket.length >= RESIDUAL_BOOTSTRAP_CONFIG.blockDays * 4 ? sameBucket : all.map(row => row.residual);
}

function residualRowsForData(ohlcv: OHLCVData[]): ResidualRow[] {
  const cached = RESIDUAL_ROWS_CACHE.get(ohlcv);
  if (cached) return cached;

  const rows: ResidualRow[] = [];
  for (let index = 1; index < ohlcv.length; index++) {
    const previous = ohlcv[index - 1];
    const current = ohlcv[index];
    if (previous.close <= 0 || current.close <= 0) continue;
    const previousDate = parseDate(previous.date);
    const currentDate = parseDate(current.date);
    const expected = powerLawForecast(currentDate, previous.close, previousDate);
    if (!Number.isFinite(expected) || expected <= 0) continue;
    rows.push({
      index,
      residual: Math.log(current.close / expected),
      volatility: trailingVolatility(ohlcv, index, 30),
    });
  }
  const filtered = rows.filter(row => Number.isFinite(row.residual) && Number.isFinite(row.volatility));
  RESIDUAL_ROWS_CACHE.set(ohlcv, filtered);
  return filtered;
}

function residualSigmaMultiplierCache(ohlcv: OHLCVData[]): Map<string, number> {
  let cache = RESIDUAL_SIGMA_MULTIPLIER_CACHE.get(ohlcv);
  if (!cache) {
    cache = new Map();
    RESIDUAL_SIGMA_MULTIPLIER_CACHE.set(ohlcv, cache);
  }
  return cache;
}

function trailingVolatility(ohlcv: OHLCVData[], endIndex: number, lookback: number): number {
  const start = Math.max(1, endIndex - lookback + 1);
  const returns: number[] = [];
  for (let index = start; index <= endIndex; index++) {
    const previous = ohlcv[index - 1];
    const current = ohlcv[index];
    if (previous?.close > 0 && current?.close > 0) returns.push(Math.log(current.close / previous.close));
  }
  return sampleStandardDeviation(returns);
}

function volatilityBucket(value: number, lowCutoff: number, highCutoff: number): 'low' | 'normal' | 'high' {
  if (value <= lowCutoff) return 'low';
  if (value >= highCutoff) return 'high';
  return 'normal';
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function mulberry32(seed: number) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function calibrationLabel(horizonDays: number): string {
  if (horizonDays >= 180) return INTERVAL_CONFIG.scenarioPolicy.label;
  const table = [...INTERVAL_CONFIG.fittedMultipliers].sort((a, b) => a.horizonDays - b.horizonDays);
  const nearest = table.reduce((best, row) =>
    Math.abs(row.horizonDays - horizonDays) < Math.abs(best.horizonDays - horizonDays) ? row : best
  );
  if (nearest.coverageStatus === 'conservative') return 'Conservative';
  if (nearest.coverageStatus === 'calibrated') return 'Calibrated';
  return 'Directional only';
}

function coverageStatus(horizonDays: number): string {
  if (horizonDays >= 180) return 'scenario';
  const table = [...INTERVAL_CONFIG.fittedMultipliers].sort((a, b) => a.horizonDays - b.horizonDays);
  const nearest = table.reduce((best, row) =>
    Math.abs(row.horizonDays - horizonDays) < Math.abs(best.horizonDays - horizonDays) ? row : best
  );
  return nearest.coverageStatus;
}

import type { OHLCVData } from './api';
import { INTERVAL_CONFIG, RESIDUAL_BOOTSTRAP_CONFIG } from './modelConfig';
import { POWER_LAW_MEAN_REVERSION_TAU_DAYS, powerLawForecast } from './powerLaw';

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
  const sigma = multiplier * Math.sqrt(powerLawResidualVariance(horizonDays, dailyVol));
  const quantilePrice = (p: number) => median * Math.exp(sigma * normalQuantile(p));

  return {
    sigma,
    multiplier,
    probabilityUp: 1 - normalCdf((Math.log(currentPrice) - Math.log(median)) / sigma),
    q025: quantilePrice(0.025),
    q05: quantilePrice(0.05),
    q10: quantilePrice(0.10),
    q50: median,
    q90: quantilePrice(0.90),
    q95: quantilePrice(0.95),
    q975: quantilePrice(0.975),
    calibrationLabel: calibrationLabel(horizonDays),
    coverageStatus: coverageStatus(horizonDays),
  };
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
  if (horizonDays > last.horizonDays) return INTERVAL_CONFIG.scenarioPolicy.aboveMaxMultiplier;

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

export function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

export function normalQuantile(probability: number): number {
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

function computeLogReturnStats(ohlcv: OHLCVData[], lookback: number) {
  const cappedLookback = Math.min(Math.max(1, lookback), ohlcv.length - 1);
  const recent = ohlcv.slice(-cappedLookback - 1);
  const logReturns = recent.slice(1).map((d, i) => Math.log(d.close / recent[i].close));
  const meanReturn = logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / logReturns.length;

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

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

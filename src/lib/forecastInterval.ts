import type { OHLCVData } from './api';
import { INTERVAL_CONFIG } from './modelConfig';
import { POWER_LAW_MEAN_REVERSION_TAU_DAYS } from './powerLaw';

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

export function legacyStressMultiplierForHorizon(horizonDays: number): number {
  const { base, amplitude, tauDays } = INTERVAL_CONFIG.stressMultiplier;
  return base + amplitude * (1 - Math.exp(-horizonDays / tauDays));
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

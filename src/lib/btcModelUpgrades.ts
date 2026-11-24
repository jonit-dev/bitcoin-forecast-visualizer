import type { OHLCVData } from './api';
import { purgeAndEmbargoResidualRows } from './featureExperimentDataset';
import { POWER_LAW_CONFIG } from './modelConfig';
import { basePowerLawPrice, daysSinceGenesis } from './powerLaw';
import { cdfAt, quantileAt, studentTCdf, standardizedStudentTScale, type PredictiveDistribution } from './predictiveDistribution';

export const UPGRADE_MIN_WARMUP_DAYS = 60;
const MS_PER_DAY = 86_400_000;
const MIN_VARIANCE = 1e-10;
const GARMAN_KLASS_COEFF = 2 * Math.LN2 - 1;

export interface DvolRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  availableAfter: string;
  observedAt: string;
}

export interface CausalVariancePoint {
  date: string;
  dailyVar: number;
  spotVar: number | null;
  longRunVar: number | null;
}

export interface PredictiveQuantilesResult {
  q025: number;
  q05: number;
  q10: number;
  q50: number;
  q90: number;
  q95: number;
  q975: number;
  probabilityUp: number;
  nll: number | null;
  pit: number | null;
}

export interface MaturedConformalError {
  originDate: string;
  targetDate: string;
  value: number;
}

export interface ConformalQuantileResult {
  abstained: boolean;
  eligibleCount: number;
  usedCount: number;
  lastKnownTargetDate: string | null;
  excludedUnresolvedTargets: number;
  excludedByEmbargo: number;
  quantiles: {
    q025: number;
    q05: number;
    q10: number;
    q50: number;
    q90: number;
    q95: number;
    q975: number;
  } | null;
  rawCalibratedValues: number[] | null;
}

export type MedianAblationArmId = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';

export interface LogPowerLawCoefficients {
  b0: number;
  b1: number;
  b2Sin: number;
  b3Cos: number;
  cycleDays: number;
  dampedCycle: boolean;
  withCycle: boolean;
  startDate: string;
  endDate: string;
  trainingRows: number;
}

function addUtcDays(dateStr: string, days: number): string {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Daily Garman-Klass range variance with safe close-return fallback when OHLC lacks intraday range. */
export function garmanKlassDailyVariance(bar: OHLCVData, prevClose: number): number {
  if (
    Number.isFinite(bar.open) &&
    Number.isFinite(bar.high) &&
    Number.isFinite(bar.low) &&
    Number.isFinite(bar.close) &&
    bar.open > 0 &&
    bar.low > 0 &&
    bar.close > 0 &&
    bar.high > bar.low
  ) {
    const hl = Math.log(bar.high / bar.low);
    const co = Math.log(bar.close / bar.open);
    const gk = 0.5 * hl * hl - GARMAN_KLASS_COEFF * co * co;
    if (Number.isFinite(gk) && gk > 0) {
      return Math.max(MIN_VARIANCE, gk);
    }
  }
  if (Number.isFinite(bar.close) && Number.isFinite(prevClose) && bar.close > 0 && prevClose > 0) {
    const r = Math.log(bar.close / prevClose);
    return Math.max(MIN_VARIANCE, r * r);
  }
  return Number.NaN;
}

/** Build strictly causal spot EWMA variance and trailing long-run mean variance series. */
export function buildCausalVarianceSeries(
  ohlcv: readonly OHLCVData[],
  halfLifeDays: number,
  longRunWindowDays: number,
  mode: 'close' | 'gk'
): CausalVariancePoint[] {
  if (!(halfLifeDays > 0) || !Number.isInteger(longRunWindowDays) || longRunWindowDays < UPGRADE_MIN_WARMUP_DAYS) {
    throw new Error(`Invalid variance parameters: halfLife=${halfLifeDays}, longRunWindow=${longRunWindowDays}`);
  }
  const lambda = Math.pow(0.5, 1 / halfLifeDays);
  const points: CausalVariancePoint[] = new Array(ohlcv.length);
  const dailyVars = new Float64Array(ohlcv.length);
  const prefixVars = new Float64Array(ohlcv.length);
  let ewma = Number.NaN;

  for (let i = 0; i < ohlcv.length; i++) {
    let dv = Number.NaN;
    if (i > 0) {
      if (mode === 'gk') {
        dv = garmanKlassDailyVariance(ohlcv[i], ohlcv[i - 1].close);
      } else if (ohlcv[i].close > 0 && ohlcv[i - 1].close > 0) {
        const r = Math.log(ohlcv[i].close / ohlcv[i - 1].close);
        dv = Math.max(MIN_VARIANCE, r * r);
      }
    }
    dailyVars[i] = Number.isFinite(dv) ? dv : Number.NaN;
    const add = Number.isFinite(dailyVars[i]) ? dailyVars[i] : 0;
    prefixVars[i] = (i > 0 ? prefixVars[i - 1] : 0) + add;

    let spotVar: number | null = null;
    let longRunVar: number | null = null;

    if (i === UPGRADE_MIN_WARMUP_DAYS) {
      let sum = 0;
      let count = 0;
      for (let k = 1; k <= i; k++) {
        if (Number.isFinite(dailyVars[k])) {
          sum += dailyVars[k];
          count++;
        }
      }
      if (count >= UPGRADE_MIN_WARMUP_DAYS) {
        ewma = sum / count;
        spotVar = ewma;
      }
    } else if (i > UPGRADE_MIN_WARMUP_DAYS && Number.isFinite(dailyVars[i])) {
      ewma = Number.isFinite(ewma) ? lambda * ewma + (1 - lambda) * dailyVars[i] : dailyVars[i];
      spotVar = ewma;
    }

    if (i >= UPGRADE_MIN_WARMUP_DAYS) {
      const startIdx = Math.max(1, i - longRunWindowDays + 1);
      const count = i - startIdx + 1;
      if (count >= UPGRADE_MIN_WARMUP_DAYS) {
        longRunVar = (prefixVars[i] - prefixVars[startIdx - 1]) / count;
      }
    }

    points[i] = {
      date: ohlcv[i].date,
      dailyVar: dailyVars[i],
      spotVar,
      longRunVar,
    };
  }

  return points;
}

/**
 * Mean-reverting Ornstein-Uhlenbeck horizon log-variance with unbounded linear extrapolation above 365d
 * so bands keep widening across multi-year horizons rather than saturating.
 */
export function ouMeanRevertingVariance(
  spotVar: number,
  longRunVar: number,
  phi: number,
  horizonDays: number,
  tauVarDays: number = POWER_LAW_CONFIG.meanReversionTauDays
): number {
  if (!(spotVar > 0) || !(longRunVar > 0) || !(phi >= 0 && phi <= 1) || !(horizonDays >= 1)) {
    throw new Error(`Invalid OU variance args: spot=${spotVar}, lr=${longRunVar}, phi=${phi}, h=${horizonDays}`);
  }
  const maxDirectDays = Math.min(horizonDays, 365);
  const gap = spotVar - longRunVar;
  let variance = 0;
  let phiPow = 1;
  const decayStep = Number.isFinite(tauVarDays) && tauVarDays > 0 ? Math.exp(-2 / tauVarDays) : 1;
  let decayPow = 1;

  for (let k = 0; k < maxDirectDays; k++) {
    const dailyV = Math.max(MIN_VARIANCE, longRunVar + gap * phiPow);
    variance += dailyV * decayPow;
    phiPow *= phi;
    decayPow *= decayStep;
  }

  if (horizonDays > 365) {
    return variance * (horizonDays / 365);
  }
  return variance;
}

/** Ratio-matched dynamic sigma scaling the incumbent baseline sigma by dynamic vs stationary OU variance. */
export function ratioMatchedTermStructureSigma(
  baselineSigma: number,
  blendedDailyVol: number,
  spotVar: number,
  longRunVar: number,
  phi: number,
  horizonDays: number,
  tauVarDays: number = POWER_LAW_CONFIG.meanReversionTauDays,
  scaleC: number = 1
): number {
  if (!(baselineSigma > 0) || !(blendedDailyVol > 0) || !(scaleC > 0)) {
    throw new Error('baselineSigma, blendedDailyVol, and scaleC must be positive');
  }
  const refVar = blendedDailyVol * blendedDailyVol;
  const vDyn = ouMeanRevertingVariance(spotVar, longRunVar, phi, horizonDays, tauVarDays);
  const vRef = ouMeanRevertingVariance(refVar, refVar, phi, horizonDays, tauVarDays);
  return baselineSigma * scaleC * Math.sqrt(vDyn / vRef);
}

/** Unbounded power-law dispersion scaling sigma(H) = c * sigma_d * H^alpha. */
export function scalingLawSigma(
  blendedDailyVol: number,
  horizonDays: number,
  alpha: number,
  scaleC: number = 1
): number {
  if (!(blendedDailyVol > 0) || !(horizonDays >= 1) || !(alpha > 0) || !(scaleC > 0)) {
    throw new Error('Invalid scalingLawSigma parameters');
  }
  return scaleC * blendedDailyVol * Math.pow(horizonDays, alpha);
}

/**
 * Strictly lag-safe Deribit DVOL lookup. Never reads >= originDate and never forward-fills missing dates.
 * Returns daily variance = (DVOL / 100)^2 / 365, or null when missing/stale so caller falls back explicitly.
 */
export function selectCausalDvolSpotVariance(
  originDate: string,
  dvolByDate: ReadonlyMap<string, DvolRow>,
  lagDays: number = 1
): number | null {
  if (!Number.isInteger(lagDays) || lagDays < 1) {
    throw new Error(`lagDays must be an integer >= 1, received ${lagDays}`);
  }
  const sourceDate = addUtcDays(originDate, -lagDays);
  const row = dvolByDate.get(sourceDate);
  if (!row || !Number.isFinite(row.close) || row.close <= 0) {
    return null;
  }
  if (row.date >= originDate || row.availableAfter > `${originDate}T00:00:00.000Z`) {
    return null;
  }
  const annualized = row.close / 100;
  return (annualized * annualized) / 365;
}

/** Exact log-price NLL for Normal or unit-variance Student-t predictive distribution. */
export function predictiveLogPriceNll(
  actualPrice: number,
  medianPrice: number,
  sigma: number,
  distribution: PredictiveDistribution
): number | null {
  if (!(actualPrice > 0) || !(medianPrice > 0) || !(sigma > 0) || !Number.isFinite(sigma)) return null;
  const err = Math.log(actualPrice) - Math.log(medianPrice);
  if (distribution.kind === 'lognormal' || (distribution.kind === 'student-t' && distribution.nu === Number.POSITIVE_INFINITY)) {
    const v = sigma * sigma;
    return 0.5 * Math.log(2 * Math.PI * v) + (err * err) / (2 * v);
  }
  const nu = distribution.nu;
  const scale = sigma * standardizedStudentTScale(nu);
  const t = err / scale;
  const logNormConst = logGamma((nu + 1) / 2) - logGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) - Math.log(scale);
  return -(logNormConst - ((nu + 1) / 2) * Math.log1p((t * t) / nu));
}

function logGamma(z: number): number {
  const coeffs = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
    12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  const shifted = z - 1;
  let sum = 0.9999999999998099;
  for (let i = 0; i < coeffs.length; i++) sum += coeffs[i] / (shifted + i + 1);
  const t = shifted + coeffs.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
}

/** Build full predictive quantiles + likelihood/PIT preserving q50 === median bit-identically. */
export function buildPredictiveQuantiles(
  median: number,
  sigma: number,
  nu: number,
  actualPrice?: number
): PredictiveQuantilesResult {
  const distribution: PredictiveDistribution =
    Number.isFinite(nu) && nu > 2 ? { kind: 'student-t', nu } : { kind: 'lognormal' };
  const q025 = quantileAt(distribution, median, sigma, 0.025);
  const q05 = quantileAt(distribution, median, sigma, 0.05);
  const q10 = quantileAt(distribution, median, sigma, 0.10);
  const q90 = quantileAt(distribution, median, sigma, 0.90);
  const q95 = quantileAt(distribution, median, sigma, 0.95);
  const q975 = quantileAt(distribution, median, sigma, 0.975);
  const probabilityUp =
    actualPrice !== undefined ? 1 - cdfAt(distribution, median, sigma, actualPrice) : Number.NaN;
  const nll = actualPrice !== undefined ? predictiveLogPriceNll(actualPrice, median, sigma, distribution) : null;
  const pit = actualPrice !== undefined && actualPrice > 0 ? cdfAt(distribution, median, sigma, actualPrice) : null;

  return { q025, q05, q10, q50: median, q90, q95, q975, probabilityUp, nll, pit };
}

/** Build embargoed split-conformal empirical quantiles with explicit abstention and q50 invariance. */
export function computeEmbargoedConformalQuantiles(
  maturedErrors: readonly MaturedConformalError[],
  originDate: string,
  horizonDays: number,
  median: number,
  scaleMultiplier: number = 1,
  options: { minSamples?: number; maxRows?: number } = {}
): ConformalQuantileResult {
  const minSamples = options.minSamples ?? 50;
  const maxRows = options.maxRows ?? 730;
  const purged = purgeAndEmbargoResidualRows([...maturedErrors], originDate, horizonDays, horizonDays);

  if (purged.rows.length < minSamples) {
    return {
      abstained: true,
      eligibleCount: purged.rows.length,
      usedCount: 0,
      lastKnownTargetDate: purged.lastKnownTargetDate,
      excludedUnresolvedTargets: purged.excludedUnresolvedTargets,
      excludedByEmbargo: purged.excludedByEmbargo,
      quantiles: null,
      rawCalibratedValues: null,
    };
  }

  const ordered = [...purged.rows]
    .sort((a, b) => a.originDate.localeCompare(b.originDate))
    .slice(-maxRows)
    .map(r => r.value)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (ordered.length < minSamples) {
    return {
      abstained: true,
      eligibleCount: purged.rows.length,
      usedCount: ordered.length,
      lastKnownTargetDate: purged.lastKnownTargetDate,
      excludedUnresolvedTargets: purged.excludedUnresolvedTargets,
      excludedByEmbargo: purged.excludedByEmbargo,
      quantiles: null,
      rawCalibratedValues: null,
    };
  }

  const q025Off = Math.min(0, empiricalQuantile(ordered, 0.025) * scaleMultiplier);
  const q05Off = Math.min(0, Math.max(q025Off, empiricalQuantile(ordered, 0.05) * scaleMultiplier));
  const q10Off = Math.min(0, Math.max(q05Off, empiricalQuantile(ordered, 0.10) * scaleMultiplier));
  const q90Off = Math.max(0, empiricalQuantile(ordered, 0.90) * scaleMultiplier);
  const q95Off = Math.max(q90Off, empiricalQuantile(ordered, 0.95) * scaleMultiplier);
  const q975Off = Math.max(q95Off, empiricalQuantile(ordered, 0.975) * scaleMultiplier);

  return {
    abstained: false,
    eligibleCount: purged.rows.length,
    usedCount: ordered.length,
    lastKnownTargetDate: purged.lastKnownTargetDate,
    excludedUnresolvedTargets: purged.excludedUnresolvedTargets,
    excludedByEmbargo: purged.excludedByEmbargo,
    quantiles: {
      q025: median * Math.exp(q025Off),
      q05: median * Math.exp(q05Off),
      q10: median * Math.exp(q10Off),
      q50: median,
      q90: median * Math.exp(q90Off),
      q95: median * Math.exp(q95Off),
      q975: median * Math.exp(q975Off),
    },
    rawCalibratedValues: ordered.map(v => v * scaleMultiplier),
  };
}

/** Empirical PIT value in [0, 1] using mid-rank of realized standardized/raw error in sorted calibration values. */
export function empiricalConformalPit(sortedValues: readonly number[], observed: number): number | null {
  if (!sortedValues.length || !Number.isFinite(observed)) return null;
  let less = 0;
  let equal = 0;
  for (const v of sortedValues) {
    if (v < observed) less++;
    else if (v === observed) equal++;
    else break;
  }
  return (less + 0.5 * equal) / sortedValues.length;
}

function empiricalQuantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Pure power-law base price with sinusoid cycle stripped (c1 = c2 = 0). */
export function pureBasePowerLawPrice(t: number): number {
  return POWER_LAW_CONFIG.base.coefficient * Math.pow(t, POWER_LAW_CONFIG.base.exponent);
}

/** E1 median structure ablation at strictly frozen tau = 210 days. */
export function medianStructureAblationForecast(
  arm: MedianAblationArmId,
  futureDate: Date,
  currentPrice: number,
  currentDate: Date
): number {
  if (arm === 'A3') return currentPrice;
  const tau = POWER_LAW_CONFIG.meanReversionTauDays;
  const tNow = daysSinceGenesis(currentDate);
  const tFut = daysSinceGenesis(futureDate);
  const hDays = Math.round((futureDate.getTime() - currentDate.getTime()) / MS_PER_DAY);
  const usePure = arm === 'A2' || arm === 'A4';
  const noGrowth = arm === 'A1' || arm === 'A4';
  const bNow = usePure ? pureBasePowerLawPrice(tNow) : basePowerLawPrice(tNow);
  const bFut = noGrowth ? bNow : usePure ? pureBasePowerLawPrice(tFut) : basePowerLawPrice(tFut);
  const residual = Math.log(currentPrice) - Math.log(bNow);
  return bFut * Math.exp(residual * Math.exp(-hDays / tau));
}

/** Shipped base curve with damped sinusoidal cycle amplitude gamma in [0, 1] at frozen tau = 210 days. */
export function shippedDampedCycleForecast(
  futureDate: Date,
  currentPrice: number,
  currentDate: Date,
  gamma: number
): number {
  const { base, meanReversionTauDays } = POWER_LAW_CONFIG;
  const omega = (2 * Math.PI) / base.cycleDays;
  const curve = (t: number) =>
    base.coefficient * Math.pow(t, base.exponent) * (1 + gamma * (base.sinAmplitude * Math.sin(omega * t) + base.cosAmplitude * Math.cos(omega * t)));
  const tNow = daysSinceGenesis(currentDate);
  const tFut = daysSinceGenesis(futureDate);
  const hDays = Math.round((futureDate.getTime() - currentDate.getTime()) / MS_PER_DAY);
  const bNow = curve(tNow);
  const bFut = curve(tFut);
  const residual = Math.log(currentPrice) - Math.log(bNow);
  return bFut * Math.exp(residual * Math.exp(-hDays / meanReversionTauDays));
}

/** Exact log-space OLS fit: log(close) = b0 + b1*log(t) + b2*sinNorm + b3*cosNorm. */
export function fitCausalLogPowerLaw(
  rowsThroughOrigin: readonly OHLCVData[],
  options: { withCycle: boolean; dampedCycle?: boolean; startDate?: string }
): LogPowerLawCoefficients | null {
  const startDate = options.startDate ?? '2009-01-03';
  const cycleDays = POWER_LAW_CONFIG.base.cycleDays;
  const omega = (2 * Math.PI) / cycleDays;
  const damped = Boolean(options.dampedCycle && options.withCycle);
  const filtered = rowsThroughOrigin.filter(r => r.date >= startDate && r.close > 0 && daysSinceGenesis(new Date(`${r.date}T00:00:00Z`)) > 0);
  if (filtered.length < 365) return null;

  let logTSum = 0;
  const tVals = new Float64Array(filtered.length);
  const logTVals = new Float64Array(filtered.length);
  const yVals = new Float64Array(filtered.length);
  for (let i = 0; i < filtered.length; i++) {
    const t = daysSinceGenesis(new Date(`${filtered[i].date}T00:00:00Z`));
    const lt = Math.log(t);
    tVals[i] = t;
    logTVals[i] = lt;
    yVals[i] = Math.log(filtered[i].close);
    logTSum += lt;
  }
  const meanLogT = logTSum / filtered.length;

  const k = options.withCycle ? 4 : 2;
  const xtx = Array.from({ length: k }, () => new Float64Array(k));
  const xty = new Float64Array(k);

  for (let idx = 0; idx < filtered.length; idx++) {
    const t = tVals[idx];
    const centeredLogT = logTVals[idx] - meanLogT;
    const y = yVals[idx];
    let x: number[];
    if (options.withCycle) {
      const damp = damped ? Math.sqrt(cycleDays / t) : 1;
      x = [1, centeredLogT, damp * Math.sin(omega * t), damp * Math.cos(omega * t)];
    } else {
      x = [1, centeredLogT];
    }
    for (let i = 0; i < k; i++) {
      xty[i] += x[i] * y;
      for (let j = 0; j < k; j++) xtx[i][j] += x[i] * x[j];
    }
  }

  const beta = solveSymmetricLinear(xtx, xty);
  if (!beta) return null;
  const b1 = beta[1];
  const b0 = beta[0] - b1 * meanLogT;

  return {
    b0,
    b1,
    b2Sin: options.withCycle ? beta[2] : 0,
    b3Cos: options.withCycle ? beta[3] : 0,
    cycleDays,
    dampedCycle: damped,
    withCycle: options.withCycle,
    startDate: filtered[0].date,
    endDate: filtered[filtered.length - 1].date,
    trainingRows: filtered.length,
  };
}

/** Evaluate log-space structural base curve without log-vs-linear cycle distortion. */
export function evaluateCausalLogPowerLawBase(fit: LogPowerLawCoefficients, t: number): number {
  const omega = (2 * Math.PI) / fit.cycleDays;
  const damp = fit.dampedCycle ? Math.sqrt(fit.cycleDays / t) : 1;
  const cycle = fit.withCycle ? damp * (fit.b2Sin * Math.sin(omega * t) + fit.b3Cos * Math.cos(omega * t)) : 0;
  return Math.exp(fit.b0 + fit.b1 * Math.log(t) + cycle);
}

/** Forecast median using exact log-space OLS coefficients at frozen tau = 210 days. */
export function forecastCausalLogPowerLaw(
  fit: LogPowerLawCoefficients,
  futureDate: Date,
  currentPrice: number,
  currentDate: Date
): number {
  const tNow = daysSinceGenesis(currentDate);
  const tFut = daysSinceGenesis(futureDate);
  const hDays = Math.round((futureDate.getTime() - currentDate.getTime()) / MS_PER_DAY);
  const logBNow = Math.log(evaluateCausalLogPowerLawBase(fit, tNow));
  const logBFut = Math.log(evaluateCausalLogPowerLawBase(fit, tFut));
  const residual = Math.log(currentPrice) - logBNow;
  return Math.exp(logBFut + residual * Math.exp(-hDays / POWER_LAW_CONFIG.meanReversionTauDays));
}

function solveSymmetricLinear(mat: Float64Array[], rhs: Float64Array): number[] | null {
  const n = rhs.length;
  const aug = mat.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(aug[pivotRow][col]) < 1e-12) return null;
    [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];
    const piv = aug[col][col];
    for (let c = col; c <= n; c++) aug[col][c] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      for (let c = col; c <= n; c++) aug[r][c] -= factor * aug[col][c];
    }
  }
  return aug.map(r => r[n]);
}

export { studentTCdf };

import type { OHLCVData } from './api';
import { POWER_LAW_CONFIG } from './modelConfig';
import {
  basePowerLawPrice,
  daysSinceGenesis,
  floorPowerLawPrice,
  peakPowerLawPrice,
} from './powerLaw';
import { normalCdf } from './predictiveDistribution';
import { seededRandom } from './random';
import { holmAdjust } from './trendReversal';

export { holmAdjust };

const MS_PER_DAY = 86_400_000;
export const T_REF_DAYS = 3650;
export const S_MIN_SCALE = 0.20;
const MIN_RVOL_FLOOR = 0.005;
const MIN_INNER_CV_PRIOR_ROWS = 1095;
const MIN_INNER_CV_VAL_ROWS = 180;

export const GAMMA_GRID = [0.35, 0.5, 0.65, 0.8, 1.0] as const;
export const BETA_GRID = [0.0, 0.25, 0.5, 0.75, 1.0, 1.25] as const;
export const RVOL_WINDOW_GRID = [365, 730] as const;

export type StructuralBandArmId =
  | 'B0_incumbent'
  | 'B1_logt_qr'
  | 'B2_stretched_log_const'
  | 'B3_stretched_log_decay'
  | 'B4_logt_decay'
  | 'B5_stretched_log_rvol'
  | 'B6_shipped_base_anchored';

export interface BandEvaluation {
  floor: number;
  center: number;
  peak: number;
}

export interface FittedStructuralBandModel {
  armId: StructuralBandArmId;
  alpha: number;
  trainStartDate: string;
  trainEndDate: string;
  trainingRows: number;
  params: Record<string, number | string | boolean | null>;
  evaluate: (t: number, laggedVol?: number) => BandEvaluation;
}

export interface QuantileLineFit {
  intercept: number;
  slope: number;
  loss: number;
}

export interface StretchedLogOlsFit {
  intercept: number;
  slope: number;
  gamma: number;
}

export interface CircularBootstrapResult {
  blockLength: number;
  observedMean: number;
  lower95: number;
  upper95: number;
  pOneSided: number;
}

export interface NeweyWestResult {
  tStat: number;
  pOneSided: number;
  lag: number;
}

export function parseUtcDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

export function utcDaysSinceGenesis(dateStr: string): number {
  return daysSinceGenesis(parseUtcDate(dateStr));
}

export function addUtcDaysStr(dateStr: string, days: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + days * MS_PER_DAY;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Interval (Winkler) score in log-price space for an equal-tailed (1 - alpha) band.
 * Lower values are better (narrower width + proportional breach penalty).
 */
export function winklerScoreLog(lower: number, upper: number, actual: number, alpha: number): number {
  if (!(lower > 0 && upper > 0 && actual > 0 && alpha > 0 && alpha < 1)) return Number.NaN;
  const logL = Math.log(lower);
  const logU = Math.log(upper);
  const logY = Math.log(actual);
  const width = logU - logL;
  const below = logY < logL ? (2 / alpha) * (logL - logY) : 0;
  const above = logY > logU ? (2 / alpha) * (logY - logU) : 0;
  return width + below + above;
}

/**
 * OHLC-extreme interval (Winkler) score in log-price space:
 * checks daily low against floor and daily high against peak.
 */
export function winklerScoreOhlcLog(
  lower: number,
  upper: number,
  low: number,
  high: number,
  alpha: number
): number {
  if (!(lower > 0 && upper > 0 && low > 0 && high > 0 && alpha > 0 && alpha < 1)) return Number.NaN;
  const logL = Math.log(lower);
  const logU = Math.log(upper);
  const width = logU - logL;
  const below = Math.log(low) < logL ? (2 / alpha) * (logL - Math.log(low)) : 0;
  const above = Math.log(high) > logU ? (2 / alpha) * (Math.log(high) - logU) : 0;
  return width + below + above;
}

/** Pinball (check) loss in log-price space for target quantile tau. */
export function pinballLossLog(pred: number, actual: number, tau: number): number {
  if (!(pred > 0 && actual > 0 && tau > 0 && tau < 1)) return Number.NaN;
  const diff = Math.log(actual) - Math.log(pred);
  return (tau - (diff < 0 ? 1 : 0)) * diff;
}

/** Linearly interpolated empirical quantile on unsorted values. */
export function empiricalQuantile(values: readonly number[], p: number): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const clipped = Math.min(1, Math.max(0, p));
  const pos = (sorted.length - 1) * clipped;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function quickselectKth(arr: Float64Array, k: number): number {
  let left = 0;
  let right = arr.length - 1;
  while (left < right) {
    const mid = (left + right) >> 1;
    const pivot = arr[mid];
    let i = left;
    let j = right;
    while (i <= j) {
      while (arr[i] < pivot) i++;
      while (arr[j] > pivot) j--;
      if (i <= j) {
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
        i++;
        j--;
      }
    }
    if (j < k) left = i;
    if (i > k) right = j;
  }
  return arr[k];
}

function checkLossProfileAtSlope(
  dx: Float64Array,
  ys: readonly number[],
  tau: number,
  slope: number,
  scratch: Float64Array
): { a: number; loss: number } {
  const n = dx.length;
  for (let i = 0; i < n; i++) scratch[i] = ys[i] - slope * dx[i];
  const k = Math.min(n - 1, Math.max(0, Math.floor(tau * n)));
  const a = quickselectKth(scratch, k);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (a + slope * dx[i]);
    sum += r >= 0 ? tau * r : (tau - 1) * r;
  }
  return { a, loss: sum / n };
}

/**
 * Exact 2D check-loss quantile regression for y = intercept + slope * x.
 * Profiles out intercept at the exact tau-order-statistic and runs coarse scan + golden-section
 * refinement on the convex profiled objective in slope.
 */
export function fitQuantileLine(xs: readonly number[], ys: readonly number[], tau: number): QuantileLineFit {
  const n = xs.length;
  if (n === 0 || n !== ys.length || !(tau > 0 && tau < 1)) {
    throw new Error(`Invalid fitQuantileLine inputs: n=${n}, tau=${tau}`);
  }
  if (n === 1) {
    return { intercept: ys[0], slope: 0, loss: 0 };
  }

  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;

  const dx = new Float64Array(n);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    dx[i] = xs[i] - mx;
    num += dx[i] * (ys[i] - my);
    den += dx[i] * dx[i];
  }
  const olsSlope = den > 1e-15 ? num / den : 0;
  const scratch = new Float64Array(n);
  if (den <= 1e-15) {
    const prof = checkLossProfileAtSlope(dx, ys, tau, 0, scratch);
    return { intercept: prof.a, slope: 0, loss: prof.loss };
  }

  const minSlope = Math.min(-10, olsSlope - 10);
  const maxSlope = Math.max(15, olsSlope + 10);
  const step = 0.2;

  let bestSlope = olsSlope;
  let bestProf = checkLossProfileAtSlope(dx, ys, tau, olsSlope, scratch);

  for (let s = minSlope; s <= maxSlope + 1e-9; s += step) {
    const prof = checkLossProfileAtSlope(dx, ys, tau, s, scratch);
    if (prof.loss < bestProf.loss) {
      bestProf = prof;
      bestSlope = s;
    }
  }

  // Golden-section search on [lo, hi] around bestSlope
  let lo = bestSlope - 0.5;
  let hi = bestSlope + 0.5;
  const invPhi = (Math.sqrt(5) - 1) / 2;
  let c = hi - invPhi * (hi - lo);
  let d = lo + invPhi * (hi - lo);
  let fc = checkLossProfileAtSlope(dx, ys, tau, c, scratch);
  let fd = checkLossProfileAtSlope(dx, ys, tau, d, scratch);

  for (let iter = 0; iter < 60; iter++) {
    if (fc.loss < fd.loss) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - invPhi * (hi - lo);
      fc = checkLossProfileAtSlope(dx, ys, tau, c, scratch);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + invPhi * (hi - lo);
      fd = checkLossProfileAtSlope(dx, ys, tau, d, scratch);
    }
  }

  const mid = 0.5 * (lo + hi);
  const fMid = checkLossProfileAtSlope(dx, ys, tau, mid, scratch);
  const finalProf = fMid.loss <= bestProf.loss ? { ...fMid, slope: mid } : { ...bestProf, slope: bestSlope };
  if (fc.loss < finalProf.loss) {
    return { intercept: fc.a - c * mx, slope: c, loss: fc.loss };
  }
  if (fd.loss < finalProf.loss) {
    return { intercept: fd.a - d * mx, slope: d, loss: fd.loss };
  }
  return {
    intercept: finalProf.a - finalProf.slope * mx,
    slope: finalProf.slope,
    loss: finalProf.loss,
  };
}

/**
 * Exact 2-parameter OLS for logY = intercept + slope * (logT)^gamma.
 * Reduces identically to standard log-log OLS when gamma = 1.
 */
export function fitStretchedLogOls(
  logTs: readonly number[],
  logYs: readonly number[],
  gamma: number
): StretchedLogOlsFit {
  const n = logTs.length;
  if (n < 2 || n !== logYs.length || !(gamma > 0)) {
    throw new Error(`Invalid fitStretchedLogOls inputs: n=${n}, gamma=${gamma}`);
  }
  const xs = new Float64Array(n);
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    const x = gamma === 1 ? logTs[i] : Math.pow(logTs[i], gamma);
    xs[i] = x;
    mx += x;
    my += logYs[i];
  }
  mx /= n;
  my /= n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    num += dx * (logYs[i] - my);
    den += dx * dx;
  }
  const slope = den > 1e-15 ? num / den : 0;
  const intercept = my - slope * mx;
  return { intercept, slope, gamma };
}

export function evaluateStretchedLogOls(fit: StretchedLogOlsFit, t: number): number {
  const logT = Math.log(Math.max(2, t));
  const x = fit.gamma === 1 ? logT : Math.pow(logT, fit.gamma);
  return fit.intercept + fit.slope * x;
}

/** Non-crossing decaying log-scale with asymptotic floor s_min > 0. */
export function decayingLogScale(
  t: number,
  beta: number,
  tRef = T_REF_DAYS,
  sMin = S_MIN_SCALE
): number {
  const safeT = Math.max(2, t);
  const ratioTerm = Math.pow(safeT / tRef, -2 * beta);
  return Math.sqrt(ratioTerm + sMin * sMin);
}

/** Strictly causal trailing sample SD of daily log returns using closes up to endIdx. */
export function trailingDailyLogVol(closes: readonly number[], endIdx: number, windowDays: number): number {
  if (endIdx < 2 || endIdx >= closes.length) return 0.05;
  const start = Math.max(1, endIdx - windowDays + 1);
  const returns: number[] = [];
  for (let i = start; i <= endIdx; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev > 0 && curr > 0) {
      const r = Math.log(curr / prev);
      if (Number.isFinite(r)) returns.push(r);
    }
  }
  if (returns.length < 2) return 0.05;
  const avg = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - avg) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  return Number.isFinite(sd) && sd > 0 ? sd : 0.05;
}

/** Build 1-day lagged causal trailing daily log-volatility series aligned with rows. */
export function computeCausalLaggedVolByDate(
  rows: readonly OHLCVData[],
  maxDate: string,
  windowDays: number
): Map<string, number> {
  const causalRows = rows.filter(row => row.date <= maxDate && row.close > 0);
  const closes = causalRows.map(row => row.close);
  const map = new Map<string, number>();
  for (let i = 0; i < causalRows.length; i++) {
    // Strictly 1-day availability lag: day i only observes closes up to i - 1
    map.set(causalRows[i].date, trailingDailyLogVol(closes, i - 1, windowDays));
  }
  return map;
}

export function shippedSecularTrendLog(t: number): number {
  const safeT = Math.max(2, t);
  return Math.log(POWER_LAW_CONFIG.base.coefficient) + POWER_LAW_CONFIG.base.exponent * Math.log(safeT);
}

function buildPreparedRows(rows: readonly OHLCVData[]) {
  return rows
    .map(row => {
      const t = utcDaysSinceGenesis(row.date);
      return {
        date: row.date,
        t,
        logT: t > 1 ? Math.log(t) : Number.NaN,
        close: row.close,
        high: row.high,
        low: row.low,
        logClose: row.close > 0 ? Math.log(row.close) : Number.NaN,
      };
    })
    .filter(row => row.t > 1 && Number.isFinite(row.logT) && Number.isFinite(row.logClose));
}

function innerCvValidationYears(trainRows: readonly { date: string }[]): number[] {
  if (trainRows.length === 0) return [];
  const lastYear = Number(trainRows[trainRows.length - 1].date.slice(0, 4));
  const years: number[] = [];
  for (let yr = 2016; yr <= lastYear; yr++) {
    const startStr = `${yr}-01-01`;
    const endStr = `${yr}-12-31`;
    const priorCount = trainRows.filter(r => r.date < startStr).length;
    const valCount = trainRows.filter(r => r.date >= startStr && r.date <= endStr).length;
    if (priorCount >= MIN_INNER_CV_PRIOR_ROWS && valCount >= MIN_INNER_CV_VAL_ROWS) {
      years.push(yr);
    }
  }
  return years;
}

function fitB3OrB4Fixed(
  armId: 'B2_stretched_log_const' | 'B3_stretched_log_decay' | 'B4_logt_decay',
  prepared: readonly { date: string; t: number; logT: number; close: number; logClose: number }[],
  gamma: number,
  beta: number,
  alpha: number,
  useConstantScale: boolean
): FittedStructuralBandModel {
  const logTs = prepared.map(r => r.logT);
  const logYs = prepared.map(r => r.logClose);
  const ols = fitStretchedLogOls(logTs, logYs, gamma);
  const standardized = prepared.map(r => {
    const mu = evaluateStretchedLogOls(ols, r.t);
    const res = r.logClose - mu;
    return useConstantScale ? res : res / decayingLogScale(r.t, beta);
  });
  const tauL = alpha / 2;
  const tauU = 1 - alpha / 2;
  const zL = Math.min(-1e-6, empiricalQuantile(standardized, tauL));
  const zU = Math.max(1e-6, empiricalQuantile(standardized, tauU));

  return {
    armId,
    alpha,
    trainStartDate: prepared[0].date,
    trainEndDate: prepared[prepared.length - 1].date,
    trainingRows: prepared.length,
    params: {
      gamma,
      beta: useConstantScale ? 0 : beta,
      intercept: ols.intercept,
      slope: ols.slope,
      zL,
      zU,
      tRef: useConstantScale ? null : T_REF_DAYS,
      sMin: useConstantScale ? null : S_MIN_SCALE,
    },
    evaluate: (t: number): BandEvaluation => {
      const mu = evaluateStretchedLogOls(ols, t);
      const scale = useConstantScale ? 1 : decayingLogScale(t, beta);
      return {
        floor: Math.exp(mu + zL * scale),
        center: Math.exp(mu),
        peak: Math.exp(mu + zU * scale),
      };
    },
  };
}

function fitB5Fixed(
  prepared: readonly { date: string; t: number; logT: number; close: number; logClose: number }[],
  laggedVolMap: Map<string, number>,
  gamma: number,
  windowDays: number,
  alpha: number
): FittedStructuralBandModel {
  const logTs = prepared.map(r => r.logT);
  const logYs = prepared.map(r => r.logClose);
  const ols = fitStretchedLogOls(logTs, logYs, gamma);

  const standardized: number[] = [];
  for (const r of prepared) {
    const vol = laggedVolMap.get(r.date) ?? 0.05;
    const scale = Math.max(vol, MIN_RVOL_FLOOR);
    const mu = evaluateStretchedLogOls(ols, r.t);
    standardized.push((r.logClose - mu) / scale);
  }
  const tauL = alpha / 2;
  const tauU = 1 - alpha / 2;
  const zL = Math.min(-1e-6, empiricalQuantile(standardized, tauL));
  const zU = Math.max(1e-6, empiricalQuantile(standardized, tauU));
  const lastTrainDate = prepared[prepared.length - 1].date;
  const frozenOriginVol = Math.max(laggedVolMap.get(lastTrainDate) ?? 0.05, MIN_RVOL_FLOOR);

  return {
    armId: 'B5_stretched_log_rvol',
    alpha,
    trainStartDate: prepared[0].date,
    trainEndDate: lastTrainDate,
    trainingRows: prepared.length,
    params: {
      gamma,
      windowDays,
      intercept: ols.intercept,
      slope: ols.slope,
      zL,
      zU,
      frozenOriginVol,
    },
    evaluate: (t: number, laggedVol?: number): BandEvaluation => {
      const mu = evaluateStretchedLogOls(ols, t);
      const scale = Math.max(laggedVol ?? frozenOriginVol, MIN_RVOL_FLOOR);
      return {
        floor: Math.exp(mu + zL * scale),
        center: Math.exp(mu),
        peak: Math.exp(mu + zU * scale),
      };
    },
  };
}

function fitB6Fixed(
  prepared: readonly { date: string; t: number; logT: number; close: number; logClose: number }[],
  beta: number,
  alpha: number
): FittedStructuralBandModel {
  const standardized = prepared.map(r => {
    const mu = shippedSecularTrendLog(r.t);
    return (r.logClose - mu) / decayingLogScale(r.t, beta);
  });
  const tauL = alpha / 2;
  const tauU = 1 - alpha / 2;
  const zL = Math.min(-1e-6, empiricalQuantile(standardized, tauL));
  const zU = Math.max(1e-6, empiricalQuantile(standardized, tauU));

  return {
    armId: 'B6_shipped_base_anchored',
    alpha,
    trainStartDate: prepared[0].date,
    trainEndDate: prepared[prepared.length - 1].date,
    trainingRows: prepared.length,
    params: {
      beta,
      zL,
      zU,
      tRef: T_REF_DAYS,
      sMin: S_MIN_SCALE,
      sameVintageCenterline: true,
    },
    evaluate: (t: number): BandEvaluation => {
      const mu = shippedSecularTrendLog(t);
      const scale = decayingLogScale(t, beta);
      return {
        floor: Math.exp(mu + zL * scale),
        center: Math.exp(mu),
        peak: Math.exp(mu + zU * scale),
      };
    },
  };
}

function meanWinklerOnSlice(
  model: FittedStructuralBandModel,
  valRows: readonly { date: string; t: number; close: number }[],
  alpha: number,
  frozenVolOnly = true,
  volMap?: Map<string, number>
): number {
  let sum = 0;
  let count = 0;
  for (const row of valRows) {
    const vol = frozenVolOnly ? undefined : volMap?.get(row.date);
    const band = model.evaluate(row.t, vol);
    const score = winklerScoreLog(band.floor, band.peak, row.close, alpha);
    if (Number.isFinite(score)) {
      sum += score;
      count++;
    }
  }
  return count > 0 ? sum / count : Number.POSITIVE_INFINITY;
}

/**
 * Strictly causal fitting of any structural band arm using only rows up to trainEndDate.
 * Hyperparameters are selected on purged expanding inner calendar-year CV folds (< trainEndDate).
 */
export function fitStructuralBandArm(
  armId: StructuralBandArmId,
  allRows: readonly OHLCVData[],
  options: {
    trainStartDate: string;
    trainEndDate: string;
    alpha?: number;
  }
): FittedStructuralBandModel {
  const alpha = options.alpha ?? 0.05;
  const causalFull = allRows.filter(r => r.date <= options.trainEndDate && r.close > 0);
  const trainSlice = causalFull.filter(r => r.date >= options.trainStartDate);
  const prepared = buildPreparedRows(trainSlice);

  if (armId === 'B0_incumbent') {
    return {
      armId,
      alpha,
      trainStartDate: options.trainStartDate,
      trainEndDate: options.trainEndDate,
      trainingRows: prepared.length,
      params: { shipped: true },
      evaluate: (t: number): BandEvaluation => {
        const safeT = Math.max(2, t);
        return {
          floor: floorPowerLawPrice(safeT),
          center: basePowerLawPrice(safeT),
          peak: peakPowerLawPrice(safeT),
        };
      },
    };
  }

  if (prepared.length < 30) {
    throw new Error(`Insufficient training rows (${prepared.length}) for ${armId}`);
  }

  if (armId === 'B1_logt_qr') {
    const xs = prepared.map(r => r.logT);
    const ys = prepared.map(r => r.logClose);
    const tauL = alpha / 2;
    const tauU = 1 - alpha / 2;
    const fitL = fitQuantileLine(xs, ys, tauL);
    const fitM = fitQuantileLine(xs, ys, 0.5);
    const fitU = fitQuantileLine(xs, ys, tauU);

    return {
      armId,
      alpha,
      trainStartDate: prepared[0].date,
      trainEndDate: prepared[prepared.length - 1].date,
      trainingRows: prepared.length,
      params: {
        tauL,
        tauU,
        interceptL: fitL.intercept,
        slopeL: fitL.slope,
        intercept50: fitM.intercept,
        slope50: fitM.slope,
        interceptU: fitU.intercept,
        slopeU: fitU.slope,
      },
      evaluate: (t: number): BandEvaluation => {
        const logT = Math.log(Math.max(2, t));
        return {
          floor: Math.exp(fitL.intercept + fitL.slope * logT),
          center: Math.exp(fitM.intercept + fitM.slope * logT),
          peak: Math.exp(fitU.intercept + fitU.slope * logT),
        };
      },
    };
  }

  const cvYears = innerCvValidationYears(prepared);

  if (armId === 'B2_stretched_log_const') {
    let bestGamma: number = GAMMA_GRID[0];
    let bestScore = Number.POSITIVE_INFINITY;
    if (cvYears.length > 0) {
      for (const gamma of GAMMA_GRID) {
        let total = 0;
        for (const yr of cvYears) {
          const innerTrain = prepared.filter(r => r.date < `${yr}-01-01`);
          const innerVal = prepared.filter(r => r.date >= `${yr}-01-01` && r.date <= `${yr}-12-31`);
          const candidate = fitB3OrB4Fixed('B2_stretched_log_const', innerTrain, gamma, 0, alpha, true);
          total += meanWinklerOnSlice(candidate, innerVal, alpha);
        }
        const avg = total / cvYears.length;
        if (avg < bestScore) {
          bestScore = avg;
          bestGamma = gamma;
        }
      }
    } else {
      bestGamma = 0.65;
    }
    const finalModel = fitB3OrB4Fixed('B2_stretched_log_const', prepared, bestGamma, 0, alpha, true);
    finalModel.params.innerCvMeanWinkler = Number.isFinite(bestScore) ? bestScore : null;
    finalModel.params.innerCvFolds = cvYears.length;
    return finalModel;
  }

  if (armId === 'B3_stretched_log_decay' || armId === 'B4_logt_decay') {
    const gammaList = armId === 'B4_logt_decay' ? [1.0] : [...GAMMA_GRID];
    let bestGamma = gammaList[0];
    let bestBeta: number = BETA_GRID[0];
    let bestScore = Number.POSITIVE_INFINITY;

    if (cvYears.length > 0) {
      for (const gamma of gammaList) {
        for (const beta of BETA_GRID) {
          let total = 0;
          for (const yr of cvYears) {
            const innerTrain = prepared.filter(r => r.date < `${yr}-01-01`);
            const innerVal = prepared.filter(r => r.date >= `${yr}-01-01` && r.date <= `${yr}-12-31`);
            const candidate = fitB3OrB4Fixed(armId, innerTrain, gamma, beta, alpha, false);
            total += meanWinklerOnSlice(candidate, innerVal, alpha);
          }
          const avg = total / cvYears.length;
          if (avg < bestScore) {
            bestScore = avg;
            bestGamma = gamma;
            bestBeta = beta;
          }
        }
      }
    } else {
      bestGamma = armId === 'B4_logt_decay' ? 1.0 : 0.65;
      bestBeta = 0.5;
    }

    const finalModel = fitB3OrB4Fixed(armId, prepared, bestGamma, bestBeta, alpha, false);
    finalModel.params.innerCvMeanWinkler = Number.isFinite(bestScore) ? bestScore : null;
    finalModel.params.innerCvFolds = cvYears.length;
    return finalModel;
  }

  if (armId === 'B5_stretched_log_rvol') {
    const volMaps = new Map<number, Map<string, number>>();
    for (const w of RVOL_WINDOW_GRID) {
      volMaps.set(w, computeCausalLaggedVolByDate(causalFull, options.trainEndDate, w));
    }

    let bestGamma: number = GAMMA_GRID[0];
    let bestWindow: number = RVOL_WINDOW_GRID[0];
    let bestScore = Number.POSITIVE_INFINITY;

    if (cvYears.length > 0) {
      for (const gamma of GAMMA_GRID) {
        for (const w of RVOL_WINDOW_GRID) {
          const vMap = volMaps.get(w)!;
          let total = 0;
          for (const yr of cvYears) {
            const innerTrain = prepared.filter(r => r.date < `${yr}-01-01`);
            const innerVal = prepared.filter(r => r.date >= `${yr}-01-01` && r.date <= `${yr}-12-31`);
            const candidate = fitB5Fixed(innerTrain, vMap, gamma, w, alpha);
            total += meanWinklerOnSlice(candidate, innerVal, alpha, true);
          }
          const avg = total / cvYears.length;
          if (avg < bestScore) {
            bestScore = avg;
            bestGamma = gamma;
            bestWindow = w;
          }
        }
      }
    } else {
      bestGamma = 0.65;
      bestWindow = 365;
    }

    const finalModel = fitB5Fixed(prepared, volMaps.get(bestWindow)!, bestGamma, bestWindow, alpha);
    finalModel.params.innerCvMeanWinkler = Number.isFinite(bestScore) ? bestScore : null;
    finalModel.params.innerCvFolds = cvYears.length;
    return finalModel;
  }

  // B6_shipped_base_anchored
  let bestBeta: number = BETA_GRID[0];
  let bestScore = Number.POSITIVE_INFINITY;
  if (cvYears.length > 0) {
    for (const beta of BETA_GRID) {
      let total = 0;
      for (const yr of cvYears) {
        const innerTrain = prepared.filter(r => r.date < `${yr}-01-01`);
        const innerVal = prepared.filter(r => r.date >= `${yr}-01-01` && r.date <= `${yr}-12-31`);
        const candidate = fitB6Fixed(innerTrain, beta, alpha);
        total += meanWinklerOnSlice(candidate, innerVal, alpha);
      }
      const avg = total / cvYears.length;
      if (avg < bestScore) {
        bestScore = avg;
        bestBeta = beta;
      }
    }
  } else {
    bestBeta = 0.5;
  }

  const finalModel = fitB6Fixed(prepared, bestBeta, alpha);
  finalModel.params.innerCvMeanWinkler = Number.isFinite(bestScore) ? bestScore : null;
  finalModel.params.innerCvFolds = cvYears.length;
  return finalModel;
}

/** Deterministic circular moving-block bootstrap for mean paired loss improvement. */
export function circularBlockBootstrapMeanDiff(
  diffs: readonly number[],
  blockLength: number,
  reps = 5000,
  seed = 20261124
): CircularBootstrapResult {
  const finite = diffs.filter(Number.isFinite);
  const n = finite.length;
  if (n === 0) {
    return {
      blockLength,
      observedMean: Number.NaN,
      lower95: Number.NaN,
      upper95: Number.NaN,
      pOneSided: 1,
    };
  }
  const observed = finite.reduce((s, v) => s + v, 0) / n;
  const safeBlock = Math.max(1, Math.min(blockLength, n));
  const rng = seededRandom(seed);
  const estimates = new Float64Array(reps);

  for (let rep = 0; rep < reps; rep++) {
    let sum = 0;
    for (let i = 0; i < n; i += safeBlock) {
      const start = Math.floor(rng() * n);
      const count = Math.min(safeBlock, n - i);
      for (let j = 0; j < count; j++) {
        sum += finite[(start + j) % n];
      }
    }
    estimates[rep] = sum / n;
  }

  estimates.sort();
  let exceed = 0;
  for (let rep = 0; rep < reps; rep++) {
    if (estimates[rep] - observed >= observed) exceed++;
  }
  return {
    blockLength: safeBlock,
    observedMean: observed,
    lower95: estimates[Math.floor(reps * 0.025)],
    upper95: estimates[Math.min(reps - 1, Math.floor(reps * 0.975))],
    pOneSided: (1 + exceed) / (reps + 1),
  };
}

/** Newey-West HAC Diebold-Mariano t-statistic and one-sided normal p-value (H1: mean > 0). */
export function neweyWestDmT(diffs: readonly number[], maxLag: number): NeweyWestResult {
  const finite = diffs.filter(Number.isFinite);
  const n = finite.length;
  const lag = Math.max(1, Math.min(maxLag, Math.floor(n / 3)));
  if (n < 5) return { tStat: 0, pOneSided: 1, lag };

  const dBar = finite.reduce((s, v) => s + v, 0) / n;
  const centered = new Float64Array(n);
  let gamma0 = 0;
  for (let i = 0; i < n; i++) {
    const c = finite[i] - dBar;
    centered[i] = c;
    gamma0 += c * c;
  }
  gamma0 /= n;
  if (gamma0 <= 1e-24) return { tStat: 0, pOneSided: 1, lag };

  let lrv = gamma0;
  for (let k = 1; k <= lag; k++) {
    let cov = 0;
    for (let t = k; t < n; t++) cov += centered[t] * centered[t - k];
    cov /= n;
    lrv += 2 * (1 - k / (lag + 1)) * cov;
  }

  const safeLrv = lrv > 1e-24 ? lrv : gamma0;
  const se = Math.sqrt(safeLrv / n);
  const tStat = se > 0 ? dBar / se : 0;
  return {
    tStat,
    pOneSided: 1 - normalCdf(tStat),
    lag,
  };
}

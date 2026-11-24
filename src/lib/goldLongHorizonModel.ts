import {
  circularBlockBootstrapMeanDiff,
  holmAdjust,
  neweyWestDmT,
} from './btcStructuralBands';

export { circularBlockBootstrapMeanDiff, holmAdjust, neweyWestDmT };

export const GOLD_HORIZONS_MONTHS = [12, 24, 60, 120] as const;
export const GOLD_ANCHOR_START_YM = '1972-01';
export const GOLD_DEV_START_YM = '1975-01';
export const GOLD_HOLDOUT_START_YM = '2004-01';

export const TAU_GRID_STD = [24, 60, 120, Number.POSITIVE_INFINITY] as const;
export const LAMBDA_MR_GRID = [0.25, 0.5, 0.75, 1.0] as const;
export const TAU_GRID_MR = [36, 60, 120] as const;
export const RIDGE_GRID_G5 = [1, 5, 25, 100] as const;

export type GoldLongArmId =
  | 'G0_incumbent'
  | 'G1_power_law_1971'
  | 'G2_exponential_mr'
  | 'G3_erb_harvey_cpi_mr'
  | 'G4a_m2_ratio_mr'
  | 'G4b_m2_cpi_coint'
  | 'G5_real_rate_cpi_drift';

export interface GoldMonthlyRow {
  ym: string;
  gold: number;
  cpi: number | null;
  m2: number | null;
  gs10: number | null;
}

export interface GoldArmParams {
  tau?: number;
  lambda?: number;
  ridge?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function latestCausalMacro(
  rows: readonly GoldMonthlyRow[],
  maxIdx: number,
  field: 'cpi' | 'm2' | 'gs10',
  maxStalenessMonths = 2
): { idx: number; value: number } | null {
  if (maxIdx < 0) return null;
  const hi = Math.min(maxIdx, rows.length - 1);
  const lo = Math.max(0, hi - maxStalenessMonths);
  for (let j = hi; j >= lo; j -= 1) {
    const val = rows[j]?.[field];
    if (val !== null && Number.isFinite(val) && (field === 'gs10' || val > 0)) {
      return { idx: j, value: val };
    }
  }
  return null;
}

export function addMonthsYm(ym: string, months: number): string {
  const [yStr, mStr] = ym.split('-');
  const total = Number(yStr) * 12 + (Number(mStr) - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function daysSince1971Aug15(ym: string): number {
  const [yStr, mStr] = ym.split('-');
  const ms = Date.UTC(Number(yStr), Number(mStr) - 1, 15);
  const t0 = Date.UTC(1971, 7, 15);
  return Math.max(1, (ms - t0) / 86_400_000);
}

export function yearsSince1972Jan(ym: string): number {
  const [yStr, mStr] = ym.split('-');
  return (Number(yStr) - 1972) + (Number(mStr) - 1) / 12;
}

function fitSimpleOls(xs: readonly number[], ys: readonly number[]): { intercept: number; slope: number } {
  const n = xs.length;
  if (n < 2) return { intercept: ys[0] ?? 0, slope: 0 };
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i += 1) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    den += dx * dx;
  }
  const slope = den > 1e-15 ? num / den : 0;
  return { intercept: my - slope * mx, slope };
}

function fitTwoFactorRidge(
  x1s: readonly number[],
  x2s: readonly number[],
  ys: readonly number[],
  ridge: number
): { b0: number; b1: number; b2: number } {
  const n = ys.length;
  if (n < 6) {
    return { b0: ys[n - 1] ?? 0, b1: 0, b2: 0 };
  }
  let m1 = 0;
  let m2 = 0;
  let my = 0;
  for (let i = 0; i < n; i += 1) {
    m1 += x1s[i];
    m2 += x2s[i];
    my += ys[i];
  }
  m1 /= n;
  m2 /= n;
  my /= n;

  let v1 = 0;
  let v2 = 0;
  for (let i = 0; i < n; i += 1) {
    v1 += (x1s[i] - m1) ** 2;
    v2 += (x2s[i] - m2) ** 2;
  }
  const sd1 = Math.sqrt(v1 / Math.max(1, n - 1)) || 1;
  const sd2 = Math.sqrt(v2 / Math.max(1, n - 1)) || 1;

  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let sy1 = 0;
  let sy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const z1 = (x1s[i] - m1) / sd1;
    const z2 = (x2s[i] - m2) / sd2;
    const dy = ys[i] - my;
    s11 += z1 * z1;
    s12 += z1 * z2;
    s22 += z2 * z2;
    sy1 += z1 * dy;
    sy2 += z2 * dy;
  }

  const a11 = s11 + ridge * n;
  const a22 = s22 + ridge * n;
  const det = a11 * a22 - s12 * s12;
  if (Math.abs(det) < 1e-18) {
    return { b0: my, b1: 0, b2: 0 };
  }
  const w1 = (a22 * sy1 - s12 * sy2) / det;
  const w2 = (-s12 * sy1 + a11 * sy2) / det;
  const b1 = w1 / sd1;
  const b2 = w2 / sd2;
  const b0 = my - b1 * m1 - b2 * m2;
  return { b0, b1, b2 };
}

function anchorIndex(rows: readonly GoldMonthlyRow[], anchorYm = GOLD_ANCHOR_START_YM): number {
  const idx = rows.findIndex((r) => r.ym >= anchorYm);
  return idx >= 0 ? idx : 0;
}

/** G0: Current production gold horizon curve (`1Y momentum -> +4%/yr`). */
export function predictG0Incumbent(rows: readonly GoldMonthlyRow[], originIdx: number, horizonMonths: number): number {
  if (originIdx < 24 || originIdx >= rows.length) return Number.NaN;
  const lpNow = Math.log(rows[originIdx].gold);
  const lp12 = Math.log(rows[originIdx - 12].gold);
  const lp24 = Math.log(rows[originIdx - 24].gold);
  const rawMom = (0.25 * (lpNow - lp12)) / 252 + (0.25 * (lpNow - lp24)) / 504;
  const mom = clamp(rawMom, -0.0006, 0.0006);
  const d = Math.round(horizonMonths * 30.44);
  return mom * Math.min(d, 365) + (Math.log(1.04) / 365) * Math.max(0, d - 365);
}

/** G1: Causal post-1971 log-log power law with optional mean reversion `tau`. */
export function predictG1PowerLaw1971(
  rows: readonly GoldMonthlyRow[],
  originIdx: number,
  horizonMonths: number,
  tau: number
): number {
  const start = anchorIndex(rows);
  if (originIdx <= start + 6 || originIdx >= rows.length) return Number.NaN;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let s = start; s <= originIdx; s += 1) {
    if (rows[s].gold > 0) {
      xs.push(Math.log(daysSince1971Aug15(rows[s].ym)));
      ys.push(Math.log(rows[s].gold));
    }
  }
  const ols = fitSimpleOls(xs, ys);
  const xNow = Math.log(daysSince1971Aug15(rows[originIdx].ym));
  const xFut = Math.log(daysSince1971Aug15(addMonthsYm(rows[originIdx].ym, horizonMonths)));
  const predNow = ols.intercept + ols.slope * xNow;
  const predFut = ols.intercept + ols.slope * xFut;
  const resNow = Math.log(rows[originIdx].gold) - predNow;
  const decay = Number.isFinite(tau) ? Math.exp(-horizonMonths / tau) : 1;
  return (predFut - predNow) + resNow * (decay - 1);
}

/** G2: Causal exponential trend since 1972 with optional mean reversion `tau`. */
export function predictG2ExponentialMr(
  rows: readonly GoldMonthlyRow[],
  originIdx: number,
  horizonMonths: number,
  tau: number
): number {
  const start = anchorIndex(rows);
  if (originIdx <= start + 6 || originIdx >= rows.length) return Number.NaN;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let s = start; s <= originIdx; s += 1) {
    if (rows[s].gold > 0) {
      xs.push(yearsSince1972Jan(rows[s].ym));
      ys.push(Math.log(rows[s].gold));
    }
  }
  const ols = fitSimpleOls(xs, ys);
  const xNow = yearsSince1972Jan(rows[originIdx].ym);
  const predNow = ols.intercept + ols.slope * xNow;
  const resNow = Math.log(rows[originIdx].gold) - predNow;
  const decay = Number.isFinite(tau) ? Math.exp(-horizonMonths / tau) : 1;
  return ols.slope * (horizonMonths / 12) + resNow * (decay - 1);
}

/** G3: Erb & Harvey causal real-gold (`Gold / CPI`) mean reversion + causal expanding CPI drift. */
export function predictG3ErbHarveyCpiMr(
  rows: readonly GoldMonthlyRow[],
  originIdx: number,
  horizonMonths: number,
  lambda: number,
  tau: number,
  macroLagMonths: number
): number {
  const start = Math.max(macroLagMonths, anchorIndex(rows));
  if (originIdx <= start + 12 || originIdx >= rows.length || !(rows[originIdx].gold > 0)) {
    return Number.NaN;
  }

  const qs: number[] = [];
  let firstCpiIdx = -1;
  for (let s = start; s <= originIdx; s += 1) {
    const mIdx = s - macroLagMonths;
    const gold = rows[s].gold;
    const cpi = rows[mIdx]?.cpi;
    if (gold > 0 && cpi !== null && cpi > 0) {
      if (firstCpiIdx < 0) firstCpiIdx = mIdx;
      qs.push(Math.log(gold) - Math.log(cpi));
    }
  }
  const curCpi = latestCausalMacro(rows, originIdx - macroLagMonths, 'cpi', 2);
  if (qs.length < 12 || firstCpiIdx < 0 || !curCpi || curCpi.idx <= firstCpiIdx) {
    return Number.NaN;
  }
  const qBar = qs.reduce((sum, v) => sum + v, 0) / qs.length;
  const qNow = Math.log(rows[originIdx].gold) - Math.log(curCpi.value);

  const cpiFirst = rows[firstCpiIdx].cpi!;
  const yrs = (curCpi.idx - firstCpiIdx) / 12;
  const piRaw = yrs > 0 ? Math.log(curCpi.value / cpiFirst) / yrs : 0.03;
  const pi = clamp(piRaw, 0.01, 0.08);

  return pi * (horizonMonths / 12) - lambda * (qNow - qBar) * (1 - Math.exp(-horizonMonths / tau));
}

/** G4a: Causal `Gold / M2` ratio mean reversion + causal expanding M2 growth drift. */
export function predictG4aM2RatioMr(
  rows: readonly GoldMonthlyRow[],
  originIdx: number,
  horizonMonths: number,
  lambda: number,
  tau: number,
  macroLagMonths: number
): number {
  const start = Math.max(macroLagMonths, anchorIndex(rows));
  if (originIdx <= start + 12 || originIdx >= rows.length || !(rows[originIdx].gold > 0)) {
    return Number.NaN;
  }

  const vs: number[] = [];
  let firstM2Idx = -1;
  for (let s = start; s <= originIdx; s += 1) {
    const mIdx = s - macroLagMonths;
    const m2 = rows[mIdx]?.m2;
    if (rows[s].gold > 0 && m2 !== null && m2 > 0) {
      if (firstM2Idx < 0) firstM2Idx = mIdx;
      vs.push(Math.log(rows[s].gold) - Math.log(m2));
    }
  }
  const curM2 = latestCausalMacro(rows, originIdx - macroLagMonths, 'm2', 2);
  if (vs.length < 12 || firstM2Idx < 0 || !curM2 || curM2.idx <= firstM2Idx) {
    return Number.NaN;
  }

  const vBar = vs.reduce((sum, v) => sum + v, 0) / vs.length;
  const vNow = Math.log(rows[originIdx].gold) - Math.log(curM2.value);
  const m2FirstVal = rows[firstM2Idx].m2!;
  const yrs = (curM2.idx - firstM2Idx) / 12;
  const gM2Raw = yrs > 0 ? Math.log(curM2.value / m2FirstVal) / yrs : 0.06;
  const gM2 = clamp(gM2Raw, 0.02, 0.12);

  return gM2 * (horizonMonths / 12) - lambda * (vNow - vBar) * (1 - Math.exp(-horizonMonths / tau));
}

/** G4b: Causal 2-factor M2 + CPI cointegration regression with residual mean reversion. */
export function predictG4bM2CpiCoint(
  rows: readonly GoldMonthlyRow[],
  originIdx: number,
  horizonMonths: number,
  tau: number,
  macroLagMonths: number
): number {
  const start = Math.max(macroLagMonths, anchorIndex(rows));
  if (originIdx <= start + 12 || originIdx >= rows.length || !(rows[originIdx].gold > 0)) {
    return Number.NaN;
  }

  const x1s: number[] = [];
  const x2s: number[] = [];
  const ys: number[] = [];
  let firstMIdx = -1;

  for (let s = start; s <= originIdx; s += 1) {
    const mIdx = s - macroLagMonths;
    const m2 = rows[mIdx]?.m2;
    const cpi = rows[mIdx]?.cpi;
    if (rows[s].gold > 0 && cpi !== null && cpi > 0 && m2 !== null && m2 > 0) {
      if (firstMIdx < 0) firstMIdx = mIdx;
      x1s.push(Math.log(m2));
      x2s.push(Math.log(cpi));
      ys.push(Math.log(rows[s].gold));
    }
  }

  const curM2 = latestCausalMacro(rows, originIdx - macroLagMonths, 'm2', 2);
  const curCpi = latestCausalMacro(rows, originIdx - macroLagMonths, 'cpi', 2);
  if (
    ys.length < 18 ||
    firstMIdx < 0 ||
    !curM2 ||
    !curCpi ||
    curM2.idx <= firstMIdx ||
    curCpi.idx <= firstMIdx
  ) {
    return Number.NaN;
  }

  const { b0, b1, b2 } = fitTwoFactorRidge(x1s, x2s, ys, 1e-3);
  const yrsM2 = (curM2.idx - firstMIdx) / 12;
  const yrsCpi = (curCpi.idx - firstMIdx) / 12;
  const gM2 = clamp(Math.log(curM2.value / rows[firstMIdx].m2!) / yrsM2, 0.02, 0.12);
  const pi = clamp(Math.log(curCpi.value / rows[firstMIdx].cpi!) / yrsCpi, 0.01, 0.08);

  const x1Now = Math.log(curM2.value);
  const x2Now = Math.log(curCpi.value);
  const x1Fut = x1Now + gM2 * (horizonMonths / 12);
  const x2Fut = x2Now + pi * (horizonMonths / 12);

  const predNow = b0 + b1 * x1Now + b2 * x2Now;
  const predFut = b0 + b1 * x1Fut + b2 * x2Fut;
  const resNow = Math.log(rows[originIdx].gold) - predNow;
  const decay = Number.isFinite(tau) ? Math.exp(-horizonMonths / tau) : 1;
  return (predFut - predNow) + resNow * (decay - 1);
}

function causalPi5y(rows: readonly GoldMonthlyRow[], macroIdx: number): number {
  const cur = latestCausalMacro(rows, macroIdx, 'cpi', 2);
  const base = latestCausalMacro(rows, Math.max(0, macroIdx - 60), 'cpi', 2);
  if (!cur || !base || cur.idx <= base.idx) return 0.03;
  const spanYears = (cur.idx - base.idx) / 12;
  return clamp(Math.log(cur.value / base.value) / spanYears, 0.01, 0.08);
}

function causalReal10(rows: readonly GoldMonthlyRow[], macroIdx: number): number | null {
  if (macroIdx < 12) return null;
  const gs10 = latestCausalMacro(rows, macroIdx, 'gs10', 2);
  const curCpi = latestCausalMacro(rows, macroIdx, 'cpi', 2);
  const prevCpi =
    curCpi && curCpi.idx >= 12 ? latestCausalMacro(rows, curCpi.idx - 12, 'cpi', 2) : null;
  if (!gs10 || !curCpi || !prevCpi || curCpi.idx <= prevCpi.idx) return null;
  const yoyCpi = Math.pow(curCpi.value / prevCpi.value, 12 / (curCpi.idx - prevCpi.idx)) - 1;
  return gs10.value / 100 - yoyCpi;
}

/** G5: 1Y momentum for months 1..12, then causal 5Y CPI + real-10Y rate ridge drift. */
export function predictG5RealRateCpiDrift(
  rows: readonly GoldMonthlyRow[],
  originIdx: number,
  horizonMonths: number,
  ridge: number,
  macroLagMonths: number
): number {
  if (originIdx < 24 || originIdx >= rows.length) return Number.NaN;
  if (horizonMonths <= 12) {
    return predictG0Incumbent(rows, originIdx, horizonMonths);
  }
  const mom1y = predictG0Incumbent(rows, originIdx, 12);
  const remYears = (horizonMonths - 12) / 12;
  const originMacroIdx = originIdx - macroLagMonths;
  if (originMacroIdx < 12) return Number.NaN;

  const piNow = causalPi5y(rows, originMacroIdx);
  const real10Now = causalReal10(rows, originMacroIdx);
  if (real10Now === null) return mom1y + piNow * remYears;

  const start = Math.max(24, anchorIndex(rows));
  const pairs: { real10: number; targetExcessAnnual: number }[] = [];

  for (let u = start; u + horizonMonths <= originIdx; u += 1) {
    const uMacroIdx = u - macroLagMonths;
    const r10 = causalReal10(rows, uMacroIdx);
    if (r10 === null || !(rows[u].gold > 0) || !(rows[u + horizonMonths].gold > 0)) continue;
    const actualRet = Math.log(rows[u + horizonMonths].gold / rows[u].gold);
    const uMom1y = predictG0Incumbent(rows, u, 12);
    const uPi = causalPi5y(rows, uMacroIdx);
    const excessAnnual = (actualRet - uMom1y - uPi * remYears) / remYears;
    if (Number.isFinite(excessAnnual)) {
      pairs.push({ real10: r10, targetExcessAnnual: excessAnnual });
    }
  }

  if (pairs.length < 24) {
    return mom1y + piNow * remYears;
  }

  const mR = pairs.reduce((s, p) => s + p.real10, 0) / pairs.length;
  const sdR = Math.sqrt(pairs.reduce((s, p) => s + (p.real10 - mR) ** 2, 0) / Math.max(1, pairs.length - 1)) || 1;
  const mY = pairs.reduce((s, p) => s + p.targetExcessAnnual, 0) / pairs.length;

  // Shrink intercept alpha0 -> 0 and standardized slope alpha1 -> 0 via L2 ridge
  const alpha0 = mY / (1 + ridge / pairs.length);
  let sxx = 0;
  let sxy = 0;
  for (const p of pairs) {
    const z = (p.real10 - mR) / sdR;
    sxx += z * z;
    sxy += z * (p.targetExcessAnnual - alpha0);
  }
  const alpha1 = sxy / (sxx + ridge);
  const zNow = (real10Now - mR) / sdR;
  const driftAnnual = clamp(piNow + alpha0 + alpha1 * zNow, -0.02, 0.14);

  return mom1y + driftAnnual * remYears;
}

export function predictGoldArm(
  armId: GoldLongArmId,
  rows: readonly GoldMonthlyRow[],
  originIdx: number,
  horizonMonths: number,
  params: GoldArmParams,
  macroLagMonths = 1
): number {
  switch (armId) {
    case 'G0_incumbent':
      return predictG0Incumbent(rows, originIdx, horizonMonths);
    case 'G1_power_law_1971':
      return predictG1PowerLaw1971(rows, originIdx, horizonMonths, params.tau ?? Number.POSITIVE_INFINITY);
    case 'G2_exponential_mr':
      return predictG2ExponentialMr(rows, originIdx, horizonMonths, params.tau ?? Number.POSITIVE_INFINITY);
    case 'G3_erb_harvey_cpi_mr':
      return predictG3ErbHarveyCpiMr(rows, originIdx, horizonMonths, params.lambda ?? 0.5, params.tau ?? 60, macroLagMonths);
    case 'G4a_m2_ratio_mr':
      return predictG4aM2RatioMr(rows, originIdx, horizonMonths, params.lambda ?? 0.5, params.tau ?? 60, macroLagMonths);
    case 'G4b_m2_cpi_coint':
      return predictG4bM2CpiCoint(rows, originIdx, horizonMonths, params.tau ?? 60, macroLagMonths);
    case 'G5_real_rate_cpi_drift':
      return predictG5RealRateCpiDrift(rows, originIdx, horizonMonths, params.ridge ?? 25, macroLagMonths);
  }
}

export function candidateParamGrid(armId: GoldLongArmId): GoldArmParams[] {
  switch (armId) {
    case 'G0_incumbent':
      return [{}];
    case 'G1_power_law_1971':
    case 'G2_exponential_mr':
    case 'G4b_m2_cpi_coint':
      return TAU_GRID_STD.map((tau) => ({ tau }));
    case 'G3_erb_harvey_cpi_mr':
    case 'G4a_m2_ratio_mr': {
      const grid: GoldArmParams[] = [];
      for (const lambda of LAMBDA_MR_GRID) {
        for (const tau of TAU_GRID_MR) {
          grid.push({ lambda, tau });
        }
      }
      return grid;
    }
    case 'G5_real_rate_cpi_drift':
      return RIDGE_GRID_G5.map((ridge) => ({ ridge }));
  }
}

/**
 * Purged pre-2004 development selection for each (armId, horizonMonths).
 * Only origins >= 1975-01 with targetYm <= 2003-12 are inspected.
 */
export function selectGoldDevParams(
  armId: GoldLongArmId,
  rows: readonly GoldMonthlyRow[],
  horizonMonths: number,
  macroLagMonths = 1,
  devEndYm = '2003-12'
): { params: GoldArmParams; devMale: number; nDev: number } {
  const grid = candidateParamGrid(armId);
  const originIndices: number[] = [];
  for (let i = 0; i + horizonMonths < rows.length; i += 1) {
    if (rows[i].ym >= GOLD_DEV_START_YM && rows[i + horizonMonths].ym <= devEndYm) {
      originIndices.push(i);
    }
  }

  let bestParams = grid[0];
  let bestMale = Number.POSITIVE_INFINITY;
  let bestN = 0;

  for (const candidate of grid) {
    let errSum = 0;
    let count = 0;
    for (const idx of originIndices) {
      const pred = predictGoldArm(armId, rows, idx, horizonMonths, candidate, macroLagMonths);
      const actual = Math.log(rows[idx + horizonMonths].gold / rows[idx].gold);
      if (Number.isFinite(pred) && Number.isFinite(actual)) {
        errSum += Math.abs(actual - pred);
        count += 1;
      }
    }
    const male = count > 0 ? errSum / count : Number.POSITIVE_INFINITY;
    if (male < bestMale) {
      bestMale = male;
      bestParams = candidate;
      bestN = count;
    }
  }

  return { params: bestParams, devMale: bestMale, nDev: bestN };
}

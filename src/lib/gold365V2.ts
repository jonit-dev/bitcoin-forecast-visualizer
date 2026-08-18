/**
 * GLD 365-day direct Ridge challenger (gld-365-direct-positive-ridge-v2).
 *
 * Scope is deliberately one horizon. On weekly origins over 2020-2025 this beats
 * the slow-momentum baseline by ~33% mean absolute log error, but it loses at
 * 7/14/30/90/180 days and it was worse than the baseline across 2019 origins, so
 * every other horizon keeps the incumbent. Training happens offline against the
 * immutable gld-history.json snapshot; this module only evaluates the frozen
 * coefficients and fails closed to the baseline whenever an input is missing.
 *
 * The point forecast is recentred inside the incumbent's uncertainty: the
 * deliberately wide baseline sigma*sqrt(365) is retained because the narrower
 * calibrated scale did not survive the 2019 stress gap.
 */
import goldMacroHistory from '../data/gold-macro-history.json';
import goldModel from '../data/gold-365-v2-model.json';
import type { OHLCVData } from './api';

export const GOLD_365_V2_HORIZON_DAYS = 365;

interface GoldMacroRow {
  date: string;
  usdBroad: number;
  real10: number;
  gvz: number;
}

interface Gold365Model {
  modelId: string;
  horizonDays: number;
  predictionShrink: number;
  targetClip: [number, number];
  featureNames: string[];
  featureMean: number[];
  featureScale: number[];
  coefficientsStandardized: number[];
  intercept: number;
  trainedOnLastSession: string;
  goldenSnapshot: {
    asOf: string;
    close: number;
    rawLogReturn: number;
    logReturn: number;
    medianPrice: number;
    q05Price: number;
    q95Price: number;
    probabilityUp: number;
    baselineSigma: number;
    baselineMu: number;
  };
}

const MODEL = goldModel as unknown as Gold365Model;
const MACRO_ROWS = (goldMacroHistory as { rows: GoldMacroRow[] }).rows;

export const GOLD_365_V2_MODEL_ID = MODEL.modelId;

export interface Gold365Forecast {
  logReturn: number;
  medianPrice: number;
  q05Price: number;
  q95Price: number;
  probabilityUp: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Zelen & Severo 26.2.17, matching the incumbent model family. */
function normalCdf(x: number): number {
  const abs = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * abs);
  const density = 0.3989423 * Math.exp(-(abs * abs) / 2);
  const tail =
    density * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - tail : tail;
}

function windowOf(values: number[], window: number): number[] | null {
  return values.length >= window ? values.slice(-window) : null;
}

function meanOf(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStd(values: number[]): number {
  const avg = meanOf(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Adjusted Fisher-Pearson standardized third moment, matching pandas rolling skew. */
function sampleSkew(values: number[]): number | null {
  const n = values.length;
  if (n < 3) return null;
  const avg = meanOf(values);
  const std = sampleStd(values);
  if (!(std > 0)) return null;
  const cubed = values.reduce((sum, value) => sum + ((value - avg) / std) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * cubed;
}

/**
 * Origin-time feature record in the serialized order. Returns null when the
 * price snapshot or the macro cache is too short, or when the macro cache does
 * not reach the session before the origin — a stale feed must fall back to the
 * baseline rather than forecast off a carried-forward value of unknown age.
 */
export function buildGold365Features(ohlcv: OHLCVData[]): Record<string, number> | null {
  if (ohlcv.length < 505) return null;
  const closes = ohlcv.map((row) => row.close);
  const logCloses = closes.map((close) => Math.log(close));
  const last = closes.length - 1;
  const returns: number[] = [];
  for (let index = 1; index < logCloses.length; index += 1) {
    returns.push(logCloses[index] - logCloses[index - 1]);
  }

  // The macro cache is keyed to GLD sessions; one session of lag keeps the
  // current GLD close from seeing a same-session macro close.
  const originDate = ohlcv[last].date;
  const macroIndex = MACRO_ROWS.findIndex((row) => row.date === originDate);
  if (macroIndex < 253) return null;
  const macroAt = (sessionsBack: number): GoldMacroRow | null =>
    MACRO_ROWS[macroIndex - 1 - sessionsBack] ?? null;

  const features: Record<string, number> = {};
  const put = (name: string, value: number | null): boolean => {
    if (value === null || !Number.isFinite(value)) return false;
    features[name] = value;
    return true;
  };

  const logReturnOver = (window: number): number | null =>
    last >= window ? logCloses[last] - logCloses[last - window] : null;

  let ok = true;
  for (const window of [5, 10, 21, 42, 63, 126, 252, 504]) {
    ok = put(`ret_${window}`, logReturnOver(window)) && ok;
  }
  for (const window of [21, 63, 126, 252, 504]) {
    const slice = windowOf(closes, window);
    ok = put(`sma_gap_${window}`, slice ? Math.log(closes[last] / meanOf(slice)) : null) && ok;
  }
  for (const window of [10, 21, 63, 126, 252]) {
    const slice = windowOf(returns, window);
    ok = put(`vol_${window}`, slice ? sampleStd(slice) : null) && ok;
  }
  ok = put('vol_ratio_21_252', Math.log(features.vol_21 / features.vol_252)) && ok;
  ok = put('vol_ratio_63_252', Math.log(features.vol_63 / features.vol_252)) && ok;

  for (const window of [63, 252, 504]) {
    const slice = windowOf(closes, window);
    ok = put(`drawdown_${window}`, slice ? Math.log(closes[last] / Math.max(...slice)) : null) && ok;
    ok = put(`rebound_${window}`, slice ? Math.log(closes[last] / Math.min(...slice)) : null) && ok;
  }
  for (const window of [21, 63, 252]) {
    const slice = windowOf(returns, window);
    ok = put(`positive_share_${window}`, slice ? meanOf(slice.map((value) => (value > 0 ? 1 : 0))) : null) && ok;
  }
  for (const window of [63, 252]) {
    const slice = windowOf(returns, window);
    ok = put(`skew_${window}`, slice ? sampleSkew(slice) : null) && ok;
  }

  // Attached baseline state, reproduced as model inputs.
  const momentum252 = logReturnOver(252);
  const momentum504 = logReturnOver(504);
  const rawMu = 0.25 * ((momentum252 ?? 0) / 252) + 0.25 * ((momentum504 ?? 0) / 504);
  ok = put('baseline_mu', clamp(rawMu, -0.0006, 0.0006)) && ok;
  const vol252 = windowOf(returns, 252);
  ok = put('baseline_sigma', vol252 ? Math.max(1e-4, sampleStd(vol252)) : null) && ok;
  ok = put('baseline_at_cap', Math.abs(rawMu) >= 0.0006 ? 1 : 0) && ok;

  const macroNow = macroAt(0);
  if (!macroNow) return null;
  ok = put('usd_broad', macroNow.usdBroad) && ok;
  ok = put('real10', macroNow.real10) && ok;
  ok = put('gvz', macroNow.gvz) && ok;
  for (const window of [21, 63, 126, 252]) {
    const past = macroAt(window);
    if (!past) return null;
    ok = put(`usd_broad_chg_${window}`, Math.log(macroNow.usdBroad / past.usdBroad)) && ok;
    ok = put(`real10_chg_${window}`, macroNow.real10 - past.real10) && ok;
    ok = put(`gvz_chg_${window}`, macroNow.gvz - past.gvz) && ok;
  }
  ok = put('gvz_to_realized_21', Math.log(macroNow.gvz / 100 / Math.sqrt(252) / features.vol_21)) && ok;

  if (!ok) return null;
  return MODEL.featureNames.every((name) => Number.isFinite(features[name])) ? features : null;
}

/** Standardize, positive-Ridge dot product, clip to the training target range, shrink. */
export function predictGold365LogReturn(features: Readonly<Record<string, number>>): number | null {
  let raw = MODEL.intercept;
  for (let index = 0; index < MODEL.featureNames.length; index += 1) {
    const value = features[MODEL.featureNames[index]];
    const scale = MODEL.featureScale[index];
    if (!Number.isFinite(value) || !(scale > 0)) return null;
    raw += ((value - MODEL.featureMean[index]) / scale) * MODEL.coefficientsStandardized[index];
  }
  if (!Number.isFinite(raw)) return null;
  const clipped = clamp(raw, MODEL.targetClip[0], MODEL.targetClip[1]);
  return MODEL.predictionShrink * clipped;
}

/**
 * Full 365-day forecast, or null to fall back to the baseline. `baselineDailySigma`
 * is the incumbent's realized volatility; the interval width stays the incumbent's
 * on purpose.
 */
export function buildGold365Forecast(
  ohlcv: OHLCVData[],
  baselineDailySigma: number,
  confidenceZ = 1.6448536269514722
): Gold365Forecast | null {
  const last = ohlcv[ohlcv.length - 1];
  if (!last || !(last.close > 0) || !(baselineDailySigma > 0)) return null;

  const features = buildGold365Features(ohlcv);
  if (!features) return null;
  const logReturn = predictGold365LogReturn(features);
  if (logReturn === null) return null;

  const sigmaHorizon = baselineDailySigma * Math.sqrt(GOLD_365_V2_HORIZON_DAYS);
  return {
    logReturn,
    medianPrice: last.close * Math.exp(logReturn),
    q05Price: last.close * Math.exp(logReturn - confidenceZ * sigmaHorizon),
    q95Price: last.close * Math.exp(logReturn + confidenceZ * sigmaHorizon),
    probabilityUp: clamp(normalCdf(logReturn / sigmaHorizon), 0.01, 0.99),
  };
}

export function shouldUseGold365V2(horizonDays: number): boolean {
  return horizonDays === GOLD_365_V2_HORIZON_DAYS;
}

export const GOLD_365_V2_GOLDEN = MODEL.goldenSnapshot;

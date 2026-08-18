/**
 * Causal Session-Residual v1 for the S&P 500 / VOO surface.
 *
 * The incumbent constant-drift model stays the prior. This layer learns a small
 * horizon-specific residual on top of it, counts market sessions instead of
 * calendar days for uncertainty, and switches to the expanding equity premium
 * beyond 365 days. Residual trees are trained offline against the immutable
 * voo-history.json snapshot and serialized to voo-csr-v1-residuals.json; nothing
 * here fits a model at runtime.
 *
 * Every anchor is computed regardless of the selected UI horizon, which is what
 * keeps the median path prefix-stable when the user switches 90d -> 180d.
 */
import { usMarketHolidays } from '../../shared/us-market-calendar.mjs';
import residualArtifact from '../data/voo-csr-v1-residuals.json';
import type { OHLCVData } from './api';

export const CSR_V1_HORIZONS = [7, 14, 30, 90, 180, 365, 730, 1825, 3650] as const;
export type CsrV1Horizon = (typeof CSR_V1_HORIZONS)[number];

/** Locked on validation; 180d deliberately keeps the incumbent point forecast. */
export const CSR_V1_SHORT_WEIGHTS: Readonly<Record<number, number>> = {
  7: 0.4,
  14: 0.3,
  30: 0.8,
  90: 0.9,
  180: 0.0,
  365: 1.0,
};

export const CSR_V1_MODEL_ID = 'causal-session-residual-v1';
export const CSR_V1_MIN_SESSIONS = 1000;

interface ResidualStump {
  feature: number;
  threshold: number;
  left: number;
  right: number;
}

interface ResidualModel {
  init: number;
  learningRate: number;
  stumps: ResidualStump[];
}

interface ResidualArtifact {
  modelId: string;
  residualArtifactVersion: string;
  trainedOnLastSession: string;
  featureNames: string[];
  imputerMedians: number[];
  models: Record<string, ResidualModel>;
}

const ARTIFACT = residualArtifact as ResidualArtifact;

export const CSR_V1_ARTIFACT_VERSION = ARTIFACT.residualArtifactVersion;

export interface CsrOriginInputs {
  spot: number;
  mu: number;
  sigma: number;
  expandingEquityPremium: number;
}

export interface CsrAnchor {
  horizonDays: CsrV1Horizon | 0;
  sessions: number;
  medianLogReturn: number;
  logVariance: number;
}

export interface CsrEndpointForecast {
  horizonDays: CsrV1Horizon;
  sessions: number;
  medianPrice: number;
  lowerPrice: number;
  upperPrice: number;
  probabilityUp: number;
  medianLogReturn: number;
  logScale: number;
}

export type SessionCounts = Record<CsrV1Horizon, number>;
export type ResidualPredictions = Partial<Record<CsrV1Horizon, number>>;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Zelen & Severo 26.2.17, matching the incumbent implementation. */
export function csrNormalCdf(x: number): number {
  const absolute = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * absolute);
  const density = 0.3989423 * Math.exp(-(absolute * absolute) / 2);
  const tail =
    density * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - tail : tail;
}

const MAX_CSR_HORIZON = CSR_V1_HORIZONS[CSR_V1_HORIZONS.length - 1];

/**
 * Cumulative market sessions elapsed at each calendar day offset from the
 * origin, index 0 being the origin close itself. One forward pass with a
 * per-year holiday cache; scanning the calendar afresh for every offset is
 * quadratic and dominates a 10-year render.
 */
function buildSessionLadder(originDate: string, calendarDays: number): number[] {
  const cursor = new Date(`${originDate}T00:00:00Z`);
  const ladder = new Array<number>(calendarDays + 1);
  ladder[0] = 0;
  let elapsed = 0;
  let cachedYear = -1;
  let cachedHolidays = new Set<string>();

  for (let day = 1; day <= calendarDays; day += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      const year = cursor.getUTCFullYear();
      if (year !== cachedYear) {
        cachedYear = year;
        cachedHolidays = usMarketHolidays(year) as Set<string>;
      }
      if (!cachedHolidays.has(isoDate(cursor))) elapsed += 1;
    }
    ladder[day] = elapsed;
  }
  return ladder;
}

/**
 * Forward market sessions between the origin close and each horizon deadline.
 * Approximating this as 252/365 drifts by days at the 10-year anchor, so the
 * exchange calendar is used instead.
 */
export function csrSessionCounts(originDate: string): SessionCounts {
  const ladder = buildSessionLadder(originDate, MAX_CSR_HORIZON);
  const counts = {} as SessionCounts;
  for (const horizon of CSR_V1_HORIZONS) counts[horizon] = ladder[horizon];
  return counts;
}

function rollingMean(values: number[], window: number): number | null {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  return slice.reduce((sum, value) => sum + value, 0) / window;
}

function rollingStd(values: number[], window: number): number | null {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  const avg = slice.reduce((sum, value) => sum + value, 0) / window;
  const variance = slice.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (window - 1);
  return Math.sqrt(variance);
}

/**
 * Origin-time design row in the serialized feature order. `rf` and `inflation`
 * are absent from the price-only VOO snapshot the trees were fitted on, so they
 * are not part of the schema at all rather than being silently backfilled with
 * revised macro values.
 */
export function buildCsrFeatureRecord(
  ohlcv: OHLCVData[],
  origin: CsrOriginInputs,
  horizonDays: CsrV1Horizon,
  sessions: number
): Record<string, number | null> {
  const closes = ohlcv.map((row) => row.close);
  const logCloses = closes.map((close) => Math.log(close));
  const last = logCloses.length - 1;
  const returns: number[] = [];
  for (let index = 1; index < logCloses.length; index += 1) {
    returns.push(logCloses[index] - logCloses[index - 1]);
  }

  const logReturnOver = (window: number): number | null =>
    last >= window ? logCloses[last] - logCloses[last - window] : null;
  const drawdown = (window: number): number | null =>
    closes.length >= window ? closes[last] / Math.max(...closes.slice(-window)) - 1 : null;
  const smaGap = (window: number): number | null => {
    const avg = rollingMean(closes, window);
    return avg === null ? null : closes[last] / avg - 1;
  };
  const upFraction = (window: number): number | null =>
    rollingMean(
      returns.map((value) => (value > 0 ? 1 : 0)),
      window
    );

  const incumbent = origin.mu * horizonDays;
  return {
    mu: origin.mu,
    ep: origin.expandingEquityPremium,
    sigma: origin.sigma,
    m90: rollingMean(returns, 90),
    m252: rollingMean(returns, 252),
    long252: logReturnOver(252) === null ? null : (logReturnOver(252) as number) / 252,
    ret21: logReturnOver(21),
    ret63: logReturnOver(63),
    ret126: logReturnOver(126),
    ret252: logReturnOver(252),
    ret504: logReturnOver(504),
    vol21: rollingStd(returns, 21),
    vol63: rollingStd(returns, 63),
    vol126: rollingStd(returns, 126),
    vol252: rollingStd(returns, 252),
    dd63: drawdown(63),
    dd126: drawdown(126),
    dd252: drawdown(252),
    sma_gap63: smaGap(63),
    sma_gap126: smaGap(126),
    sma_gap252: smaGap(252),
    up63: upFraction(63),
    up126: upFraction(126),
    incumbent,
    // The duplicated incumbent column was present in the locked research design.
    // Removing it would change every fitted split index, so it stays until a
    // newly validated artifact drops it.
    incumbent_dup: incumbent,
    calendar_mu: origin.mu * sessions,
    calendar_ep: origin.expandingEquityPremium * sessions,
    tau: sessions,
    sigma_sqrt_tau: origin.sigma * Math.sqrt(sessions),
  };
}

/** Depth-1 gradient-boosted stump ensemble with median imputation. */
export function predictCsrResidual(
  horizonDays: CsrV1Horizon,
  features: Readonly<Record<string, number | null>>
): number | null {
  const model = ARTIFACT.models[String(horizonDays)];
  if (!model) return null;

  const row = ARTIFACT.featureNames.map((name, index) => {
    const value = features[name];
    return value === null || value === undefined || !Number.isFinite(value)
      ? ARTIFACT.imputerMedians[index]
      : (value as number);
  });

  let prediction = model.init;
  for (const stump of model.stumps) {
    prediction += model.learningRate * (row[stump.feature] > stump.threshold ? stump.right : stump.left);
  }
  return Number.isFinite(prediction) ? prediction : null;
}

export function buildCsrResidualPredictions(
  ohlcv: OHLCVData[],
  origin: CsrOriginInputs,
  sessionsByHorizon: SessionCounts
): ResidualPredictions {
  const predictions: ResidualPredictions = {};
  for (const horizon of CSR_V1_HORIZONS) {
    if ((CSR_V1_SHORT_WEIGHTS[horizon] ?? 0) === 0) continue;
    const features = buildCsrFeatureRecord(ohlcv, origin, horizon, sessionsByHorizon[horizon]);
    const residual = predictCsrResidual(horizon, features);
    if (residual !== null) predictions[horizon] = residual;
  }
  return predictions;
}

export function buildCsrAnchors(
  origin: CsrOriginInputs,
  sessionsByHorizon: SessionCounts,
  residualPredictions: ResidualPredictions
): CsrAnchor[] | null {
  if (!(origin.spot > 0) || !Number.isFinite(origin.mu) || !(origin.sigma > 0)) return null;
  if (!Number.isFinite(origin.expandingEquityPremium)) return null;

  const anchors: CsrAnchor[] = [{ horizonDays: 0, sessions: 0, medianLogReturn: 0, logVariance: 0 }];
  for (const horizon of CSR_V1_HORIZONS) {
    const sessions = sessionsByHorizon[horizon];
    if (!(sessions > 0) || !Number.isFinite(sessions)) return null;

    let medianLogReturn: number;
    if (horizon <= 365) {
      const weight = CSR_V1_SHORT_WEIGHTS[horizon] ?? 0;
      const residual = residualPredictions[horizon];
      // A missing residual on a weighted horizon fails closed to the incumbent
      // rather than quietly dropping the correction to zero.
      if (weight !== 0 && !Number.isFinite(residual)) return null;
      medianLogReturn = origin.mu * horizon + weight * (residual ?? 0);
    } else {
      medianLogReturn = origin.expandingEquityPremium * sessions;
    }

    // Validation-locked fallback: 180d keeps the incumbent calendar-day width.
    const varianceSteps = horizon === 180 ? 180 : sessions;
    anchors.push({
      horizonDays: horizon,
      sessions,
      medianLogReturn,
      logVariance: origin.sigma * origin.sigma * varianceSteps,
    });
  }

  for (let index = 1; index < anchors.length; index += 1) {
    if (anchors[index].sessions <= anchors[index - 1].sessions) return null;
  }
  return anchors;
}

function bracketAnchors(anchors: readonly CsrAnchor[], sessions: number): [CsrAnchor, CsrAnchor] {
  if (sessions <= 0) return [anchors[0], anchors[0]];
  for (let index = 1; index < anchors.length; index += 1) {
    if (sessions <= anchors[index].sessions) return [anchors[index - 1], anchors[index]];
  }
  const last = anchors[anchors.length - 1];
  return [last, last];
}

/** Piecewise-linear in session/log-return space; variance, not sigma, interpolates. */
export function interpolateCsrState(
  anchors: readonly CsrAnchor[],
  sessions: number
): { medianLogReturn: number; logVariance: number } {
  const [left, right] = bracketAnchors(anchors, Math.max(0, sessions));
  if (left.sessions === right.sessions) {
    return { medianLogReturn: left.medianLogReturn, logVariance: left.logVariance };
  }
  const fraction = (sessions - left.sessions) / (right.sessions - left.sessions);
  return {
    medianLogReturn: left.medianLogReturn + fraction * (right.medianLogReturn - left.medianLogReturn),
    logVariance: left.logVariance + fraction * (right.logVariance - left.logVariance),
  };
}

export function computeCsrEndpoint(
  origin: CsrOriginInputs,
  anchors: readonly CsrAnchor[],
  horizonDays: CsrV1Horizon,
  confidenceZ: number
): CsrEndpointForecast | null {
  const anchor = anchors.find((candidate) => candidate.horizonDays === horizonDays);
  if (!anchor || !(origin.spot > 0)) return null;

  const logScale = Math.sqrt(Math.max(anchor.logVariance, 1e-18));
  return {
    horizonDays,
    sessions: anchor.sessions,
    medianPrice: origin.spot * Math.exp(anchor.medianLogReturn),
    lowerPrice: origin.spot * Math.exp(anchor.medianLogReturn - confidenceZ * logScale),
    upperPrice: origin.spot * Math.exp(anchor.medianLogReturn + confidenceZ * logScale),
    probabilityUp: Math.min(0.99, Math.max(0.01, csrNormalCdf(anchor.medianLogReturn / logScale))),
    medianLogReturn: anchor.medianLogReturn,
    logScale,
  };
}

export interface CsrProjection {
  anchors: CsrAnchor[];
  sessionsByHorizon: SessionCounts;
  residualPredictions: ResidualPredictions;
  origin: CsrOriginInputs;
  originDate: string;
  /** Cumulative sessions elapsed at each calendar day 1..maxHorizon. */
  sessionsByCalendarDay: number[];
}

/**
 * Build the full projection once per render. Returns null when the snapshot is
 * too short or an anchor is unusable, which is the caller's signal to fall back
 * to the incumbent model rather than to ship a partially-corrected curve.
 */
export function buildCsrProjection(
  ohlcv: OHLCVData[],
  origin: CsrOriginInputs,
  maxCalendarDays: number
): CsrProjection | null {
  const last = ohlcv[ohlcv.length - 1];
  if (!last || ohlcv.length < CSR_V1_MIN_SESSIONS) return null;

  const ladder = buildSessionLadder(last.date, Math.max(MAX_CSR_HORIZON, maxCalendarDays));
  const sessionsByHorizon = {} as SessionCounts;
  for (const horizon of CSR_V1_HORIZONS) sessionsByHorizon[horizon] = ladder[horizon];

  const residualPredictions = buildCsrResidualPredictions(ohlcv, origin, sessionsByHorizon);
  const anchors = buildCsrAnchors(origin, sessionsByHorizon, residualPredictions);
  if (!anchors) return null;

  const sessionsByCalendarDay = ladder.slice(0, maxCalendarDays + 1);

  return {
    anchors,
    sessionsByHorizon,
    residualPredictions,
    origin,
    originDate: last.date,
    sessionsByCalendarDay,
  };
}

/**
 * Median log return at a calendar day offset. Weekend and holiday rows carry the
 * previous session value because the session count does not advance.
 */
export function csrMedianLogReturnAtDay(projection: CsrProjection, day: number): number {
  const sessions = projection.sessionsByCalendarDay[Math.max(0, Math.min(day, projection.sessionsByCalendarDay.length - 1))] ?? 0;
  return interpolateCsrState(projection.anchors, sessions).medianLogReturn;
}

export function csrLogScaleAtDay(projection: CsrProjection, day: number): number {
  const sessions = projection.sessionsByCalendarDay[Math.max(0, Math.min(day, projection.sessionsByCalendarDay.length - 1))] ?? 0;
  return Math.sqrt(Math.max(interpolateCsrState(projection.anchors, sessions).logVariance, 0));
}

export function isCsrV1Horizon(horizonDays: number): horizonDays is CsrV1Horizon {
  return (CSR_V1_HORIZONS as readonly number[]).includes(horizonDays);
}

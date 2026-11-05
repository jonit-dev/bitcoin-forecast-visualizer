import type { ForecastAssetId, MarketAssetId, MarketData, OHLCVData } from './api';
import {
  computeDrawdownStats,
  computeProbabilityForecast,
  generateHeatmapData,
  processRealData,
  type DrawdownStats,
  type HeatmapCell,
  type ProbabilityForecast,
  type ForecastPathPolicy,
} from './data';
import { FORECAST_PATH_GENERATOR_VERSION, forecastDataVersion, forecastPathSeed } from './forecastPathSeed';
import {
  buildCsrProjection,
  buildSessionLadder,
  csrLogScaleAtDay,
  csrMedianLogReturnAtDay,
  csrNormalCdf,
  type CsrProjection,
} from './csrV1';
import { GOLD_365_V2_HORIZON_DAYS, buildGold365Forecast, shouldUseGold365V2 } from './gold365V2';

export interface MarketAssetConfig {
  id: MarketAssetId;
  label: string;
  shortLabel: string;
  ticker: string;
  quote: string;
  chartTitle: string;
  subtitle: string;
  dataSourceLabel: string;
  instrumentLabel: string;
  capabilities: {
    bitcoinOverlays: boolean;
    mvrv: boolean;
    halvings: boolean;
    drawdownCycle: boolean;
    modelTrust: boolean;
    sourceFreshness: boolean;
  };
}

export interface MarketForecastResult {
  displayData: any[];
  heatmapData: HeatmapCell[];
  drawdownStats: DrawdownStats | null;
  probabilityForecast: ProbabilityForecast | null;
}

export const MARKET_ASSETS: MarketAssetConfig[] = [
  {
    id: 'btc',
    label: 'Bitcoin',
    shortLabel: 'BTC',
    ticker: 'BTC',
    quote: 'USD',
    chartTitle: 'BTC/USD Forward View',
    subtitle: 'Bitcoin forecast workspace',
    dataSourceLabel: 'CoinGecko market chart',
    instrumentLabel: 'BTC spot proxy',
    capabilities: {
      bitcoinOverlays: true,
      mvrv: true,
      halvings: true,
      drawdownCycle: true,
      modelTrust: true,
      sourceFreshness: true,
    },
  },
  {
    id: 'sp500',
    label: 'S&P 500',
    shortLabel: 'S&P 500',
    ticker: 'VOO',
    quote: 'USD',
    chartTitle: 'S&P 500 / VOO Forward View',
    subtitle: 'S&P 500 proxy forecast workspace',
    dataSourceLabel: 'Yahoo Finance chart API',
    instrumentLabel: 'VOO ETF, adjusted daily OHLCV',
    capabilities: {
      bitcoinOverlays: false,
      mvrv: false,
      halvings: false,
      drawdownCycle: false,
      modelTrust: false,
      sourceFreshness: false,
    },
  },
  {
    id: 'gold',
    label: 'Gold',
    shortLabel: 'Gold',
    ticker: 'GLD',
    quote: 'USD',
    chartTitle: 'Gold / GLD Forward View',
    subtitle: 'Gold proxy forecast workspace',
    dataSourceLabel: 'Yahoo Finance chart API',
    instrumentLabel: 'GLD ETF, adjusted daily OHLCV',
    capabilities: {
      bitcoinOverlays: false,
      mvrv: false,
      halvings: false,
      drawdownCycle: false,
      modelTrust: false,
      sourceFreshness: false,
    },
  },
];

export function getMarketAssetConfig(assetId: ForecastAssetId): MarketAssetConfig {
  return MARKET_ASSETS.find((asset) => asset.id === assetId) ?? MARKET_ASSETS[0];
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[index];
}

function mulberry32(seed: number) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalFromRng(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function computeLogReturns(ohlcv: OHLCVData[]): number[] {
  return ohlcv.slice(1).flatMap((row, index) => {
    const prev = ohlcv[index];
    return row.close > 0 && prev.close > 0 ? [Math.log(row.close / prev.close)] : [];
  });
}

const GENERIC_STOCHASTIC_TRACE_COUNT = 12;
const GENERIC_RETURN_BOOTSTRAP_LOOKBACK_DAYS = 504;
const GENERIC_RETURN_BOOTSTRAP_BLOCK_DAYS = 10;
export const SP500_CHANNEL_CONFIG = {
  trendWindowDays: 126,
  residualLookbackDays: 1260,
  lowerResidualQuantile: 0.025,
  upperResidualQuantile: 0.99,
  minResidualSamples: 756,
} as const;

export const GOLD_MOMENTUM_CONFIG = {
  shortMomentumDays: 252,
  longMomentumDays: 504,
  shortMomentumWeight: 0.25,
  longMomentumWeight: 0.25,
  maxDailyDrift: 0.0006,
  volatilityWindowDays: 252,
} as const;

export const GOLD_CHANNEL_CONFIG = {
  trendWindowDays: 252,
  residualLookbackDays: 1260,
  lowerResidualQuantile: 0.025,
  upperResidualQuantile: 0.99,
  minResidualSamples: 756,
} as const;

export const GOLD_MOMENTUM_DAYS = 365;
export const GOLD_LONG_RUN_DRIFT = Math.log(1.04) / 365;

/**
 * Session volatility term structure: an EWMA estimate of today's daily variance
 * that reverts geometrically to a long-run level, summed over the market sessions
 * to each calendar day. Parameters were fit on pre-2019 data (S&P 500 index
 * 1991-2018 and GLD 2009-2018) and gated on 2019+ origins by
 * scripts/backtest-market-production.ts. See the 2026-11-05 entry in
 * docs/reports/experiments-backlog.md.
 */
export interface VolTermStructureConfig {
  halfLifeSessions: number;
  /** Per-session decay of the gap between today's variance and the long run. */
  persistence: number;
  longRunDailyVol: number;
  /** Width multiplier; below 1 offsets fat tails under the pinball loss. */
  scale: number;
}

export const SP500_VOL_TERM_STRUCTURE: VolTermStructureConfig = {
  halfLifeSessions: 21,
  persistence: 0.995,
  // S&P 500 index daily log-return RMS, 1970-2018 (16.8% a year).
  longRunDailyVol: 0.0106,
  scale: 0.86,
};

export const GOLD_VOL_TERM_STRUCTURE: VolTermStructureConfig = {
  halfLifeSessions: 42,
  persistence: 0.97,
  // Gold daily log-return RMS before 2019 (GLD 0.0117, gold futures 0.0112).
  longRunDailyVol: 0.0115,
  // The pre-2019 optimum (0.86) under-covered 2019+ outcomes; 1 did not.
  scale: 1,
};

/**
 * VIX-set S&P 500 width for the first year: the spot variance is the VIX close
 * of the session before the origin, and c 0.70 absorbs the variance risk premium.
 * Beyond 365 days the band grows by the price-only increments, because this
 * spec under-covered 2- and 5-year S&P 500 outcomes over 1991-2018.
 */
export const SP500_VIX_TERM_STRUCTURE = {
  horizonDays: 365,
  persistence: 0.998,
  longRunDailyVol: 0.0106,
  scale: 0.7,
} as const;

/**
 * VIX close of the session before the origin as a daily variance. Null when the
 * feed does not reach that session, which keeps the price-only width: a stale
 * VIX is never carried forward. The lag matches the validated research setup.
 */
export function vixSpotVariance(ohlcv: OHLCVData[], vix: OHLCVData[] | undefined): number | null {
  const previous = ohlcv[ohlcv.length - 2];
  if (!previous || !vix) return null;
  for (let index = vix.length - 1; index >= 0; index--) {
    if (vix[index].date > previous.date) continue;
    return vix[index].date === previous.date && vix[index].close > 0 ? (vix[index].close / 100) ** 2 / 252 : null;
  }
  return null;
}

const EWMA_SEED_RETURNS = 60;

/** EWMA of squared daily log returns, seeded with the mean of the first 60. */
export function ewmaDailyVariance(returns: number[], halfLifeSessions: number): number | null {
  if (returns.length <= EWMA_SEED_RETURNS) return null;
  const lambda = 0.5 ** (1 / halfLifeSessions);
  let variance = 0;
  for (let i = 0; i < EWMA_SEED_RETURNS; i++) variance += returns[i] ** 2 / EWMA_SEED_RETURNS;
  for (let i = EWMA_SEED_RETURNS; i < returns.length; i++) {
    variance = lambda * variance + (1 - lambda) * returns[i] ** 2;
  }
  return variance;
}

/** Log variance accumulated over `sessions` while daily variance reverts from `spot` to `longRun`. */
export function termStructureLogVariance(spot: number, longRun: number, persistence: number, sessions: number): number {
  return sessions * longRun + ((spot - longRun) * persistence * (1 - persistence ** sessions)) / (1 - persistence);
}

/**
 * Cumulative log variance at calendar days 0..horizon. It depends only on the
 * origin, so a longer horizon never rewrites a shorter one's band. Null keeps
 * the incumbent width.
 */
export function buildVolTermStructure(
  ohlcv: OHLCVData[],
  returns: number[],
  horizon: number,
  config: VolTermStructureConfig,
  impliedSpot: number | null = null
): number[] | null {
  const last = ohlcv[ohlcv.length - 1];
  const spot = ewmaDailyVariance(returns, config.halfLifeSessions);
  if (!last || spot === null || !Number.isFinite(spot)) return null;
  const priceOnly = (sessions: number) =>
    config.scale ** 2 * termStructureLogVariance(spot, config.longRunDailyVol ** 2, config.persistence, sessions);
  if (impliedSpot === null) return buildSessionLadder(last.date, horizon).map(priceOnly);

  const vix = SP500_VIX_TERM_STRUCTURE;
  const implied = (sessions: number) =>
    vix.scale ** 2 * termStructureLogVariance(impliedSpot, vix.longRunDailyVol ** 2, vix.persistence, sessions);
  const ladder = buildSessionLadder(last.date, Math.max(horizon, vix.horizonDays));
  const cutoff = ladder[vix.horizonDays];
  return ladder.slice(0, horizon + 1).map((sessions) =>
    sessions <= cutoff ? implied(sessions) : implied(cutoff) + priceOnly(sessions) - priceOnly(cutoff)
  );
}

export interface GenericModelInputs {
  returns: number[];
  drift: number;
  dailyVol: number;
  /**
   * Causal Session-Residual v1 anchors for the S&P 500 surface. Null means the
   * challenger failed its own validity checks, in which case every consumer
   * below falls back to the incumbent constant-drift calendar-day path.
   */
  csr?: CsrProjection | null;
  /**
   * Daily log drift that reproduces a horizon-specific endpoint forecast, used
   * for the median line, its interval and the heatmap. The stochastic traces
   * keep `drift` so their horizon-prefix contract is unaffected.
   */
  medianDrift?: number;
  /**
   * Calendar days the momentum drift carries before the long-run drift starts.
   * Gold sets this so one year of momentum does not extrapolate forever.
   */
  momentumDays?: number;
  /** Per calendar day log drift after `momentumDays`. */
  longRunDrift?: number;
  /**
   * Cumulative log variance per calendar day from the session term structure.
   * When present it is the forecast width everywhere (band, heatmap, summary),
   * superseding the CSR anchor variance and `dailyVol * sqrt(day)`.
   */
  logVarianceByDay?: number[];
}

/**
 * Median log return at a calendar day offset. Momentum carries for one year,
 * then a long-run 4%/yr drift; evidence = monthly gold 1972-2026, 10y MAE -42%
 * (1975-2003 origins) and -63% (2004+ origins) vs momentum forever.
 */
export function genericMedianLogReturnAtDay(modelInputs: GenericModelInputs, day: number): number {
  const { csr = null, momentumDays, longRunDrift } = modelInputs;
  if (csr) return csrMedianLogReturnAtDay(csr, day);
  const dailyDrift = modelInputs.medianDrift ?? modelInputs.drift;
  if (momentumDays === undefined) return dailyDrift * day;
  return dailyDrift * Math.min(day, momentumDays) + (longRunDrift ?? 0) * Math.max(0, day - momentumDays);
}

/**
 * Reference log return for traces and the projected channel: the same
 * momentum-capped curve, with any horizon-specific median override removed so
 * the 365-day ridge never enters.
 */
function genericReferenceLogReturnAtDay(modelInputs: GenericModelInputs, day: number): number {
  return genericMedianLogReturnAtDay({ ...modelInputs, medianDrift: undefined }, day);
}

/** Log-price standard deviation of the forecast at a calendar day offset. */
export function genericLogScaleAtDay(modelInputs: GenericModelInputs, day: number): number {
  const { logVarianceByDay, csr = null, dailyVol } = modelInputs;
  if (logVarianceByDay) return Math.sqrt(logVarianceByDay[Math.max(0, Math.min(day, logVarianceByDay.length - 1))]);
  return csr ? csrLogScaleAtDay(csr, day) : dailyVol * Math.sqrt(day);
}

function quantileInterpolated(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function rollingMeanAt(ohlcv: OHLCVData[], index: number, windowDays: number): number | null {
  if (index < windowDays - 1) return null;
  let total = 0;
  for (let i = index - windowDays + 1; i <= index; i++) total += ohlcv[i].close;
  return total / windowDays;
}

export interface SP500ChannelPoint {
  trend: number | null;
  lower: number | null;
  upper: number | null;
  lowerResidual: number | null;
  upperResidual: number | null;
}

export type MarketChannelPoint = SP500ChannelPoint;

export function computeSP500ChannelBounds(ohlcv: OHLCVData[]): SP500ChannelPoint[] {
  const config = SP500_CHANNEL_CONFIG;
  const trends = ohlcv.map((_, index) => rollingMeanAt(ohlcv, index, config.trendWindowDays));
  const residuals = ohlcv.map((row, index) => {
    const trend = trends[index];
    return trend && trend > 0 && row.close > 0 ? Math.log(row.close / trend) : null;
  });

  return ohlcv.map((_, index) => {
    const trend = trends[index];
    if (!trend || trend <= 0) {
      return { trend, lower: null, upper: null, lowerResidual: null, upperResidual: null };
    }

    const start = Math.max(0, index - config.residualLookbackDays);
    const history = residuals
      .slice(start, index)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    if (history.length < config.minResidualSamples) {
      return { trend, lower: null, upper: null, lowerResidual: null, upperResidual: null };
    }

    const lowerResidual = quantileInterpolated(history, config.lowerResidualQuantile);
    const upperResidual = quantileInterpolated(history, config.upperResidualQuantile);
    return {
      trend,
      lower: trend * Math.exp(lowerResidual),
      upper: trend * Math.exp(upperResidual),
      lowerResidual,
      upperResidual,
    };
  });
}

export function computeGoldChannelBounds(ohlcv: OHLCVData[]): MarketChannelPoint[] {
  const config = GOLD_CHANNEL_CONFIG;
  const trends = ohlcv.map((_, index) => rollingMeanAt(ohlcv, index, config.trendWindowDays));
  const residuals = ohlcv.map((row, index) => {
    const trend = trends[index];
    return trend && trend > 0 && row.close > 0 ? Math.log(row.close / trend) : null;
  });

  return ohlcv.map((_, index) => {
    const trend = trends[index];
    if (!trend || trend <= 0) {
      return { trend, lower: null, upper: null, lowerResidual: null, upperResidual: null };
    }

    const start = Math.max(0, index - config.residualLookbackDays);
    const history = residuals
      .slice(start, index)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    if (history.length < config.minResidualSamples) {
      return { trend, lower: null, upper: null, lowerResidual: null, upperResidual: null };
    }

    const lowerResidual = quantileInterpolated(history, config.lowerResidualQuantile);
    const upperResidual = quantileInterpolated(history, config.upperResidualQuantile);
    return {
      trend,
      lower: trend * Math.exp(lowerResidual),
      upper: trend * Math.exp(upperResidual),
      lowerResidual,
      upperResidual,
    };
  });
}

function buildScaledEmpiricalInnovations(returns: number[], dailyVol: number): number[] {
  const recent = returns
    .slice(-GENERIC_RETURN_BOOTSTRAP_LOOKBACK_DAYS)
    .filter((value) => Number.isFinite(value));
  if (recent.length < GENERIC_RETURN_BOOTSTRAP_BLOCK_DAYS * 4) return [];

  const returnMean = mean(recent);
  const centered = recent.map((value) => value - returnMean);
  const empiricalVol = sampleStandardDeviation(centered);
  if (!Number.isFinite(empiricalVol) || empiricalVol <= 0) return [];

  const scale = dailyVol / empiricalVol;
  return centered.map((value) => value * scale);
}

export function computeSP500ModelInputs(ohlcv: OHLCVData[]) {
  const returns = computeLogReturns(ohlcv);
  const recent90 = returns.slice(-90);
  const recent252 = returns.slice(-252);
  const long252 = ohlcv.length > 252
    ? Math.log(ohlcv[ohlcv.length - 1].close / ohlcv[ohlcv.length - 253].close) / 252
    : mean(recent252);
  const expandingEquityPremium = Math.min(0.00055, Math.max(0.00005, mean(returns)));
  const drift = expandingEquityPremium - 0.25 * mean(recent90) + 0.25 * mean(recent252) + 0.10 * long252;
  const vol90 = sampleStandardDeviation(recent90);
  const vol252 = sampleStandardDeviation(recent252);
  const dailyVol = Math.max(0.0001, 0.65 * vol90 + 0.35 * vol252);

  return { returns, drift, dailyVol, expandingEquityPremium };
}

export function computeGoldModelInputs(ohlcv: OHLCVData[]): GenericModelInputs {
  const returns = computeLogReturns(ohlcv);
  const config = GOLD_MOMENTUM_CONFIG;
  const last = ohlcv[ohlcv.length - 1];

  const dailyMomentum = (days: number): number => {
    if (!last || ohlcv.length <= days) return 0;
    const anchor = ohlcv[ohlcv.length - 1 - days];
    return anchor.close > 0 ? Math.log(last.close / anchor.close) / days : 0;
  };

  const rawDrift = (
    config.shortMomentumWeight * dailyMomentum(config.shortMomentumDays) +
    config.longMomentumWeight * dailyMomentum(config.longMomentumDays)
  );
  const drift = Math.max(-config.maxDailyDrift, Math.min(config.maxDailyDrift, rawDrift));
  const recentVolWindow = returns.slice(-config.volatilityWindowDays);
  const fallbackVolWindow = returns.slice(-Math.min(returns.length, 756));
  const dailyVol = Math.max(
    0.0001,
    sampleStandardDeviation(recentVolWindow.length >= 60 ? recentVolWindow : fallbackVolWindow)
  );

  return { returns, drift, dailyVol };
}

function generateGenericStochasticTraces(
  assetId: Exclude<ForecastAssetId, 'btc'>,
  ohlcv: OHLCVData[],
  horizon: number,
  drift: number,
  dailyVol: number,
  returns: number[],
  pathPolicy: ForecastPathPolicy,
  csr: CsrProjection | null = null,
  momentumDays?: number,
  longRunDrift?: number
): Map<string, number[]> {
  const traces = new Map<string, number[]>();
  const last = ohlcv[ohlcv.length - 1];
  if (!last || horizon < 1) return traces;

  const lastDate = new Date(`${last.date}T00:00:00Z`);
  const prices = Array.from({ length: GENERIC_STOCHASTIC_TRACE_COUNT }, () => last.close);
  const empiricalInnovations = buildScaledEmpiricalInnovations(returns, dailyVol);
  const blockStarts = Array.from({ length: GENERIC_STOCHASTIC_TRACE_COUNT }, () => 0);
  const blockOffsets = Array.from(
    { length: GENERIC_STOCHASTIC_TRACE_COUNT },
    () => GENERIC_RETURN_BOOTSTRAP_BLOCK_DAYS
  );
  const rngs = prices.map((_, traceIndex) => mulberry32(forecastPathSeed({
    assetId: assetId as MarketAssetId,
    originDate: last.date,
    dataVersion: forecastDataVersion(ohlcv),
    methodId: 'generic-return-block-bootstrap-10d',
    generatorVersion: FORECAST_PATH_GENERATOR_VERSION,
  }, traceIndex)));
  const baselineRng = mulberry32(0x5A500 + horizon * 97 + ohlcv.length);
  traces.set(last.date, [...prices]);

  for (let day = 1; day <= horizon; day++) {
    const date = dateKey(addUtcDays(lastDate, day));
    // Under CSR the path advances only on market sessions; weekend and holiday
    // rows carry the previous price. The anchor curve is already a log-return
    // forecast, so no second -sigma^2/2 correction is applied on top of it.
    const anchorIncrement = csr
      ? csrMedianLogReturnAtDay(csr, day) - csrMedianLogReturnAtDay(csr, day - 1)
      : null;
    const isSession = !csr || csr.sessionsByCalendarDay[day] > csr.sessionsByCalendarDay[day - 1];
    if (csr && !isSession) {
      traces.set(date, [...prices]);
      continue;
    }

    for (let i = 0; i < prices.length; i++) {
      const rng = pathPolicy === 'prefix-stable-v1'
        ? rngs[i]
        : baselineRng;
      let innovation: number;
      if (empiricalInnovations.length > 0) {
        if (blockOffsets[i] >= GENERIC_RETURN_BOOTSTRAP_BLOCK_DAYS) {
          blockStarts[i] = Math.floor(
            rng() * Math.max(1, empiricalInnovations.length - GENERIC_RETURN_BOOTSTRAP_BLOCK_DAYS)
          );
          blockOffsets[i] = 0;
        }
        innovation = empiricalInnovations[blockStarts[i] + blockOffsets[i]++];
      } else {
        innovation = dailyVol * normalFromRng(rng);
      }
      const driftIncrement = momentumDays !== undefined && day > momentumDays ? longRunDrift ?? 0 : drift;
      prices[i] *= anchorIncrement === null
        ? Math.exp(driftIncrement - 0.5 * dailyVol * dailyVol + innovation)
        : Math.exp(anchorIncrement + innovation);
    }
    traces.set(date, [...prices]);
  }

  return traces;
}

export function projectTraceAboveLowerBound(primary: number, lowerBound: number | null): number {
  if (!lowerBound || lowerBound <= 0) return primary;
  const supportBuffer = 1.002;
  if (primary >= lowerBound * supportBuffer) return primary;

  const downsideGap = Math.max(0, Math.log(lowerBound / primary));
  const bounce = Math.min(Math.log(1.04), Math.log(supportBuffer) + downsideGap * 0.35);
  return lowerBound * Math.exp(bounce);
}

function selectPrimaryTraceIndex(rows: any[]): number {
  const traceCount = rows.reduce((max, row) => Math.max(max, row.stochasticTraces?.length ?? 0), 0);
  if (traceCount <= 1) return 0;

  let best = { index: 0, score: Number.POSITIVE_INFINITY };
  for (let index = 0; index < traceCount; index++) {
    // Scored against the horizon-independent reference path, never the displayed
    // median: a horizon-specific median (gold 365d) would otherwise reselect the
    // primary trace and rewrite a prefix the user has already seen.
    const referenceOf = (row: any): number => row.traceReference ?? row.close;
    const validRows = rows.filter((row) =>
      Number.isFinite(row.stochasticTraces?.[index]) &&
      Number.isFinite(row.floorPriceModel) &&
      Number.isFinite(referenceOf(row))
    );
    if (validRows.length === 0) continue;

    const breaches = validRows.filter((row) => row.stochasticTraces[index] < row.floorPriceModel).length;
    const avgMedianDistance = validRows.reduce(
      (sum, row) => sum + Math.abs(Math.log(row.stochasticTraces[index] / referenceOf(row))),
      0
    ) / validRows.length;
    const first = validRows[0];
    const terminal = validRows[validRows.length - 1];
    const firstDistance = Math.abs(Math.log(first.stochasticTraces[index] / referenceOf(first)));
    const terminalDistance = Math.abs(Math.log(terminal.stochasticTraces[index] / referenceOf(terminal)));
    const breachRate = breaches / validRows.length;
    const score = avgMedianDistance + breachRate * 0.2 + firstDistance * 0.8 + terminalDistance * 0.25;
    if (score < best.score) best = { index, score };
  }

  return best.index;
}

function promotePrimaryTrace(rows: any[], initialPrice: number, selectionWindowDays = 14): number {
  // Freeze selection to a window available at every supported horizon. Scoring
  // a requested terminal horizon would allow path extension to rewrite its prefix.
  const primaryIndex = selectPrimaryTraceIndex(rows.slice(0, selectionWindowDays));
  let previousRaw = initialPrice;
  let previousProjected = initialPrice;

  for (const row of rows) {
    const traces = row.stochasticTraces;
    if (!Array.isArray(traces) || traces.length === 0) continue;

    const rawPrimary = traces[primaryIndex];
    const rawReturn = Number.isFinite(rawPrimary) && rawPrimary > 0 && previousRaw > 0
      ? Math.log(rawPrimary / previousRaw)
      : 0;
    const proposedPrimary = previousProjected * Math.exp(rawReturn);
    const primary = projectTraceAboveLowerBound(proposedPrimary, row.floorPriceModel);
    const reordered = primaryIndex === 0
      ? traces.slice(1)
      : [...traces.slice(0, primaryIndex), ...traces.slice(primaryIndex + 1)];
    row.stochasticTraces = [
      primary,
      ...reordered,
    ];
    previousRaw = Number.isFinite(rawPrimary) && rawPrimary > 0 ? rawPrimary : previousRaw;
    previousProjected = primary;
  }
  return primaryIndex;
}

function processGenericData(
  assetId: Exclude<ForecastAssetId, 'btc'>,
  ohlcv: OHLCVData[],
  horizon: number,
  confidenceZ: number,
  modelInputs: GenericModelInputs,
  channelBounds: MarketChannelPoint[],
  supportAwarePrimaryTrace = false,
  pathPolicy: ForecastPathPolicy = 'production-baseline'
): any[] {
  const { returns, drift, dailyVol, csr = null } = modelInputs;
  const tracesByDate = generateGenericStochasticTraces(
    assetId, ohlcv, horizon, drift, dailyVol, returns, pathPolicy, csr,
    modelInputs.momentumDays, modelInputs.longRunDrift
  );
  // Anchors are horizon-independent, so the median at day d never depends on the
  // selected horizon and switching 90d -> 180d preserves the whole 90d prefix.
  const medianLogReturnAt = (day: number): number => genericMedianLogReturnAtDay(modelInputs, day);
  // Same curve minus any horizon-specific override, so trace selection stays
  // identical whichever horizon the user asked for.
  const referenceLogReturnAt = (day: number): number => genericReferenceLogReturnAtDay(modelInputs, day);
  const logScaleAt = (day: number): number => genericLogScaleAtDay(modelInputs, day);
  const latestChannel = [...channelBounds].reverse().find((point) =>
    point.lowerResidual !== null && point.upperResidual !== null
  );
  // The projected trend is the same rolling SMA the history uses, fed with the
  // horizon-independent reference path. A running sum keeps it O(n), so the
  // channel and its floor never change when the requested horizon changes.
  const channelWindowDays = assetId === 'gold'
    ? GOLD_CHANNEL_CONFIG.trendWindowDays
    : SP500_CHANNEL_CONFIG.trendWindowDays;
  const channelWindow = new Float64Array(channelWindowDays);
  let channelWindowSum = 0;
  let channelWindowCount = 0;
  let channelWindowWrite = 0;
  for (let index = Math.max(0, ohlcv.length - (channelWindowDays - 1)); index < ohlcv.length; index++) {
    channelWindowSum += ohlcv[index].close;
    channelWindow[channelWindowWrite] = ohlcv[index].close;
    channelWindowWrite = (channelWindowWrite + 1) % channelWindowDays;
    channelWindowCount++;
  }
  const data: any[] = ohlcv.map((row, index) => {
    const sma20 = index >= 19 ? mean(ohlcv.slice(index - 19, index + 1).map((d) => d.close)) : null;
    const sma50 = index >= 49 ? mean(ohlcv.slice(index - 49, index + 1).map((d) => d.close)) : null;
    const channel = channelBounds[index];
    return {
      ...row,
      sma20,
      sma50,
      isForecast: false,
      powerLawModel: channel.trend,
      floorPriceModel: channel.lower,
      peakPriceModel: channel.upper,
      stochasticTraces: tracesByDate.get(row.date),
    };
  });

  const last = ohlcv[ohlcv.length - 1];
  const lastDate = new Date(`${last.date}T00:00:00Z`);
  data[data.length - 1].forecast = last.close;
  data[data.length - 1].forecastUpper = last.close;
  data[data.length - 1].forecastLower = last.close;

  for (let day = 1; day <= horizon; day++) {
    const date = dateKey(addUtcDays(lastDate, day));
    const prevMedian = day === 1 ? last.close : last.close * Math.exp(medianLogReturnAt(day - 1));
    const median = last.close * Math.exp(medianLogReturnAt(day));
    const representativeClose = median;
    const representativeOpen = prevMedian;
    const sigma = logScaleAt(day);
    const rangeLow = median * Math.exp(-confidenceZ * sigma);
    const rangeHigh = median * Math.exp(confidenceZ * sigma);
    const candleSpread = Math.max(0.001, dailyVol * 0.25);
    const referencePrice = last.close * Math.exp(referenceLogReturnAt(day));
    channelWindowSum += referencePrice - channelWindow[channelWindowWrite];
    channelWindow[channelWindowWrite] = referencePrice;
    channelWindowWrite = (channelWindowWrite + 1) % channelWindowDays;
    channelWindowCount = Math.min(channelWindowDays, channelWindowCount + 1);
    const channelTrend = latestChannel?.trend
      ? channelWindowSum / channelWindowCount
      : null;
    const lowerBound = channelTrend && latestChannel?.lowerResidual !== null && latestChannel?.lowerResidual !== undefined
      ? channelTrend * Math.exp(latestChannel.lowerResidual)
      : null;
    const upperBound = channelTrend && latestChannel?.upperResidual !== null && latestChannel?.upperResidual !== undefined
      ? channelTrend * Math.exp(latestChannel.upperResidual)
      : null;
    data.push({
      date,
      open: representativeOpen,
      high: Math.max(representativeOpen, representativeClose) * (1 + candleSpread),
      low: Math.min(representativeOpen, representativeClose) * (1 - candleSpread),
      close: representativeClose,
      volume: 0,
      forecast: median,
      forecastUpper: rangeHigh,
      forecastLower: rangeLow,
      forecastRange: [rangeLow, rangeHigh],
      isForecast: true,
      powerLawModel: channelTrend ?? median,
      floorPriceModel: lowerBound,
      peakPriceModel: upperBound,
      stochasticTraces: tracesByDate.get(date),
      traceReference: last.close * Math.exp(referenceLogReturnAt(day)),
      sma20: null,
      sma50: null,
    });
  }

  if (supportAwarePrimaryTrace) {
    if (pathPolicy === 'production-baseline') {
      promotePrimaryTrace(data.filter((row) => row.isForecast), last.close, Number.POSITIVE_INFINITY);
      return data;
    }
    const primaryTraceIndex = promotePrimaryTrace(data.filter((row) => row.isForecast), last.close);
    for (const row of data.filter((row) => row.isForecast)) row.primaryTraceIndex = primaryTraceIndex;
  }

  return data;
}

/**
 * Per-calendar-day median log return the heatmap applies before its shock. It is
 * the same anchor curve the summary card and the rendered median use, and it
 * carries no second `-sigma^2/2` correction: the curve is already a log-return
 * forecast, so subtracting the Ito term again shifts the distribution below the
 * declared median.
 */
export function genericHeatmapDriftIncrements(modelInputs: GenericModelInputs, horizon: number): number[] {
  const { csr = null, momentumDays, longRunDrift } = modelInputs;
  const dailyDrift = modelInputs.medianDrift ?? modelInputs.drift;
  if (!csr && momentumDays !== undefined) {
    return Array.from({ length: horizon }, (_, index) =>
      index + 1 <= momentumDays ? dailyDrift : longRunDrift ?? 0
    );
  }
  if (!csr) return Array.from({ length: horizon }, () => dailyDrift);
  return Array.from({ length: horizon }, (_, index) =>
    csrMedianLogReturnAtDay(csr, index + 1) - csrMedianLogReturnAtDay(csr, index)
  );
}

/**
 * Per-calendar-day log variance the heatmap applies to its shock: differences of
 * the same cumulative variance the band and the summary use, so the simulated
 * terminal width is exactly the declared one.
 */
export function genericHeatmapLogVarianceIncrements(modelInputs: GenericModelInputs, horizon: number): number[] {
  const logVarianceAt = (day: number) => genericLogScaleAtDay(modelInputs, day) ** 2;
  return Array.from({ length: horizon }, (_, index) =>
    Math.max(0, logVarianceAt(index + 1) - logVarianceAt(index))
  );
}

/** Model inputs the S&P 500 and gold surfaces forecast with at a given horizon. */
export function buildGenericModelInputs(
  assetId: Exclude<ForecastAssetId, 'btc'>,
  ohlcv: OHLCVData[],
  horizon: number,
  impliedVol?: OHLCVData[]
): { modelInputs: GenericModelInputs; calibrationLabel: string } {
  if (assetId === 'gold') {
    const baseline = computeGoldModelInputs(ohlcv);
    // Horizon-specific promotion: the direct Ridge challenger only cleared its
    // gate at 365 days, so every other horizon keeps the momentum baseline. A
    // null forecast (short snapshot, stale macro cache) also keeps the baseline.
    const gold365 = shouldUseGold365V2(horizon)
      ? buildGold365Forecast(ohlcv, baseline.dailyVol)
      : null;
    if (gold365) {
      // The ridge keeps the sigma*sqrt(365) width it was validated with.
      return {
        modelInputs: {
          ...baseline,
          medianDrift: gold365.logReturn / GOLD_365_V2_HORIZON_DAYS,
          momentumDays: GOLD_MOMENTUM_DAYS,
          longRunDrift: GOLD_LONG_RUN_DRIFT,
        },
        calibrationLabel: 'Direct 1Y ridge interval',
      };
    }
    return {
      modelInputs: {
        ...baseline,
        momentumDays: GOLD_MOMENTUM_DAYS,
        longRunDrift: GOLD_LONG_RUN_DRIFT,
        logVarianceByDay: buildVolTermStructure(ohlcv, baseline.returns, horizon, GOLD_VOL_TERM_STRUCTURE) ?? undefined,
      },
      calibrationLabel: 'Slow momentum interval',
    };
  }

  const baseline = computeSP500ModelInputs(ohlcv);
  const lastSession = ohlcv[ohlcv.length - 1];
  return {
    modelInputs: {
      ...baseline,
      logVarianceByDay: buildVolTermStructure(
        ohlcv, baseline.returns, horizon, SP500_VOL_TERM_STRUCTURE, vixSpotVariance(ohlcv, impliedVol)
      ) ?? undefined,
      csr: lastSession
        ? buildCsrProjection(
            ohlcv,
            {
              spot: lastSession.close,
              mu: baseline.drift,
              sigma: baseline.dailyVol,
              expandingEquityPremium: baseline.expandingEquityPremium,
            },
            horizon
          )
        : null,
    },
    calibrationLabel: 'Log-return interval',
  };
}

function generateGenericHeatmapData(
  ohlcv: OHLCVData[],
  horizon: number,
  modelInputs: GenericModelInputs,
  numSimulations = 500,
  numPriceBands = 80
): HeatmapCell[] {
  const last = ohlcv[ohlcv.length - 1];
  if (!last || horizon < 1) return [];

  const lastDate = new Date(`${last.date}T00:00:00Z`);
  const rng = mulberry32(0x500500 + horizon * 53 + ohlcv.length);
  const sampleStep = horizon <= 90 ? 1 : horizon <= 365 ? 2 : horizon <= 1825 ? 5 : 10;
  const sampledDays: number[] = [];
  for (let day = 1; day <= horizon; day++) {
    if (day === 1 || day === horizon || day % sampleStep === 0) sampledDays.push(day);
  }

  const sampledCount = sampledDays.length;
  const sampledSet = new Set(sampledDays);
  const results = new Float64Array(numSimulations * sampledCount);
  // Gaussian innovations centred on the same anchor increments and scaled by the
  // same cumulative variance the summary card uses, so the heatmap and the
  // quantile band describe one distribution.
  const driftIncrements = genericHeatmapDriftIncrements(modelInputs, horizon);
  const varianceIncrements = genericHeatmapLogVarianceIncrements(modelInputs, horizon);

  for (let sim = 0; sim < numSimulations; sim++) {
    let price = last.close;
    let sampleIndex = 0;
    for (let day = 1; day <= horizon; day++) {
      const logScale = Math.sqrt(varianceIncrements[day - 1]);
      price *= Math.exp(driftIncrements[day - 1] + logScale * normalFromRng(rng));
      if (sampledSet.has(day)) results[sim * sampledCount + sampleIndex++] = price;
    }
  }

  const sorted = Array.from(results).sort((a, b) => a - b);
  const p05 = quantile(sorted, 0.05);
  const p95 = quantile(sorted, 0.95);
  const logMin = Math.log(p05);
  const logMax = Math.log(p95);
  const bandSize = (logMax - logMin) / numPriceBands;
  if (!Number.isFinite(bandSize) || bandSize <= 0) return [];

  const cells: HeatmapCell[] = [];
  for (let dateIndex = 0; dateIndex < sampledCount; dateIndex++) {
    const counts = new Uint16Array(numPriceBands);
    for (let sim = 0; sim < numSimulations; sim++) {
      const logPrice = Math.log(results[sim * sampledCount + dateIndex]);
      const band = Math.min(numPriceBands - 1, Math.max(0, Math.floor((logPrice - logMin) / bandSize)));
      counts[band]++;
    }

    const maxCount = Math.max(...counts);
    if (maxCount === 0) continue;
    const date = dateKey(addUtcDays(lastDate, sampledDays[dateIndex]));
    for (let band = 0; band < numPriceBands; band++) {
      if (counts[band] === 0) continue;
      cells.push({
        date,
        priceLow: Math.exp(logMin + band * bandSize),
        priceHigh: Math.exp(logMin + (band + 1) * bandSize),
        density: counts[band] / maxCount,
      });
    }
  }

  return cells;
}

export function computeGenericProbabilityForecast(
  ohlcv: OHLCVData[],
  horizonDays: number,
  modelInputs: GenericModelInputs,
  calibrationLabel = 'Log-return interval'
): ProbabilityForecast | null {
  const last = ohlcv[ohlcv.length - 1];
  if (!last || horizonDays < 1 || ohlcv.length < 252) return null;

  const { csr = null } = modelInputs;
  const targetDate = dateKey(addUtcDays(new Date(`${last.date}T00:00:00Z`), horizonDays));

  if (csr) {
    // Interpolated exactly like the rendered path for this day, so a summary
    // request outside the anchor horizons cannot describe a different model
    // from the chart built for the same request.
    const z95 = 1.6448536269514722;
    const z80 = 1.2815515655446004;
    const medianLogReturn = csrMedianLogReturnAtDay(csr, horizonDays);
    const logScale = Math.max(genericLogScaleAtDay(modelInputs, horizonDays), 1e-18);
    const median = last.close * Math.exp(medianLogReturn);
    const probabilityUp = Math.min(0.99, Math.max(0.01, csrNormalCdf(medianLogReturn / logScale)));
    return {
      horizonDays,
      targetDate,
      median,
      probabilityUp,
      q05: median * Math.exp(-z95 * logScale),
      q10: median * Math.exp(-z80 * logScale),
      q90: median * Math.exp(z80 * logScale),
      q95: median * Math.exp(z95 * logScale),
      calibrationLabel: 'Session-residual interval',
      verdict: probabilityUp > 0.57 ? 'Upside-biased scenario' : probabilityUp < 0.43 ? 'Downside-biased scenario' : 'Balanced distribution',
    };
  }

  const median = last.close * Math.exp(genericMedianLogReturnAtDay(modelInputs, horizonDays));
  const sigma = genericLogScaleAtDay(modelInputs, horizonDays);
  const q05 = median * Math.exp(-1.6448536269514722 * sigma);
  const q10 = median * Math.exp(-1.2815515655446004 * sigma);
  const q90 = median * Math.exp(1.2815515655446004 * sigma);
  const q95 = median * Math.exp(1.6448536269514722 * sigma);
  const zUp = Math.log(last.close / median) / Math.max(sigma, 1e-9);
  const probabilityUp = Math.min(0.99, Math.max(0.01, 1 - normalCdf(zUp)));

  return {
    horizonDays,
    targetDate,
    median,
    probabilityUp,
    q05,
    q10,
    q90,
    q95,
    calibrationLabel,
    verdict: probabilityUp > 0.57 ? 'Upside-biased scenario' : probabilityUp < 0.43 ? 'Downside-biased scenario' : 'Balanced distribution',
  };
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export function buildMarketForecast(
  assetId: ForecastAssetId,
  marketData: MarketData,
  horizon: number,
  confidenceZ: number,
  options: { pathPolicy?: ForecastPathPolicy } = {}
): MarketForecastResult {
  const pathPolicy = options.pathPolicy ?? 'production-baseline';
  if (assetId === 'btc') {
    return {
      displayData: processRealData(marketData.ohlcv, horizon, confidenceZ, pathPolicy),
      heatmapData: generateHeatmapData(marketData.ohlcv, horizon),
      drawdownStats: computeDrawdownStats(marketData.ohlcv, horizon),
      probabilityForecast: computeProbabilityForecast(marketData.ohlcv, horizon),
    };
  }

  const { modelInputs, calibrationLabel } = buildGenericModelInputs(assetId, marketData.ohlcv, horizon, marketData.impliedVol);
  return {
    displayData: processGenericData(
      assetId,
      marketData.ohlcv,
      horizon,
      confidenceZ,
      modelInputs,
      assetId === 'gold' ? computeGoldChannelBounds(marketData.ohlcv) : computeSP500ChannelBounds(marketData.ohlcv),
      assetId === 'gold',
      pathPolicy
    ),
    heatmapData: generateGenericHeatmapData(marketData.ohlcv, horizon, modelInputs),
    drawdownStats: null,
    probabilityForecast: computeGenericProbabilityForecast(marketData.ohlcv, horizon, modelInputs, calibrationLabel),
  };
}

/**
 * Probability summary for a horizon. It never materializes chart rows, stochastic
 * traces or heatmaps: a summary request must not pay for the chart-only work it
 * then discards, and in the synchronous Express server that work blocks
 * unrelated requests on the same process.
 */
export function buildMarketForecastSummary(
  assetId: ForecastAssetId,
  marketData: MarketData,
  horizon: number,
  confidenceZ: number
): MarketForecastResult {
  if (assetId === 'btc') {
    return {
      displayData: [],
      heatmapData: [],
      drawdownStats: computeDrawdownStats(marketData.ohlcv, horizon),
      probabilityForecast: computeProbabilityForecast(marketData.ohlcv, horizon),
    };
  }

  const { modelInputs, calibrationLabel } = buildGenericModelInputs(assetId, marketData.ohlcv, horizon, marketData.impliedVol);
  return {
    displayData: [],
    heatmapData: [],
    drawdownStats: null,
    probabilityForecast: computeGenericProbabilityForecast(marketData.ohlcv, horizon, modelInputs, calibrationLabel),
  };
}

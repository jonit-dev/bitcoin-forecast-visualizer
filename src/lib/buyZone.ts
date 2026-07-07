import btcHistory from '../data/btc-history.json';
import featureTable from '../data/feature-table.json';
import type { OHLCVData } from './api';
import type { FeatureRow } from './features';

export const BUY_ZONE_CONFIG = {
  heavyThreshold: 0.70,
  maxConvictionThreshold: 0.75,
  minPriorSamples: 730,
  modernStartDate: '2013-01-01',
  minZoneDays: 7,
  minPromotionSamples: 30,
  defaultCooldownDays: 180,
  horizons: [365, 730] as const,
} as const;

export interface BuyZonePoint {
  date: string;
  close: number;
  bottomScore: number;
  residualPctPast: number | null;
  mvrvPercentile: number | null;
  realizedPctPast: number | null;
  drawdownPainPctPast: number | null;
  isHeavyBuy: boolean;
  isMaxConviction: boolean;
}

export interface BuyZoneSpan {
  startDate: string;
  endDate: string;
  days: number;
  startPrice: number;
  endPrice: number;
  lowDate: string;
  lowPrice: number;
  maxScoreDate: string;
  maxScore: number;
  maxConviction: boolean;
}

export interface BuyZoneEvent extends BuyZonePoint {
  forwardReturn1y: number | null;
  forwardReturn2y: number | null;
  maxGain1y: number | null;
  worstDrawdown180d: number | null;
}

export interface BuyZoneMetricSummary {
  sampleCount: number;
  medianReturn1y: number | null;
  meanReturn1y: number | null;
  winRate1y: number | null;
  medianReturn2y: number | null;
  meanReturn2y: number | null;
  winRate2y: number | null;
  medianMaxGain1y: number | null;
  medianWorstDrawdown180d: number | null;
}

export interface BuyZoneBacktestResult extends BuyZoneMetricSummary {
  id: string;
  label: string;
  cooldownDays: number;
  events: BuyZoneEvent[];
}

export interface BuyZoneSummary {
  generatedAt: string;
  data: {
    btcRows: number;
    btcFirstDate?: string;
    btcLastDate?: string;
    featureRows: number;
    featureFirstDate?: string;
    featureLastDate?: string;
  };
  config: typeof BUY_ZONE_CONFIG;
  latest: BuyZonePoint | null;
  zones: BuyZoneSpan[];
  backtests: BuyZoneBacktestResult[];
  pooledDiagnostics: {
    uniqueEventSamples: number;
    minPromotionSamples: number;
    sampleThresholdMet: boolean;
    poolingChoice: string;
    promotionBlockedReason: string | null;
  };
  verdict: 'promote' | 'candidate' | 'watch' | 'context-only' | 'reject';
  caveat: string;
}

const BTC_ROWS = btcHistory as OHLCVData[];
const FEATURE_ROWS = featureTable as FeatureRow[];
const BTC_BY_DATE = new Map(BTC_ROWS.map((row, index) => [row.date, { row, index }]));

function bisectRight(sortedValues: number[], value: number): number {
  let lo = 0;
  let hi = sortedValues.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (value < sortedValues[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function insertSorted(sortedValues: number[], value: number): void {
  sortedValues.splice(bisectRight(sortedValues, value), 0, value);
}

function priorPercentile(sortedValues: number[], value: number | null | undefined): number | null {
  if (!Number.isFinite(value) || sortedValues.length < BUY_ZONE_CONFIG.minPriorSamples) return null;
  return bisectRight(sortedValues, Number(value)) / sortedValues.length;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function computeBuyZonePoints(): BuyZonePoint[] {
  const priorResiduals: number[] = [];
  const priorRealizedDistances: number[] = [];
  const priorDrawdowns: number[] = [];
  const points: BuyZonePoint[] = [];

  for (const featureRow of FEATURE_ROWS) {
    const btc = BTC_BY_DATE.get(featureRow.date);
    const features = featureRow.features;

    const residualPctPast = priorPercentile(priorResiduals, features.priceResidualLog);
    const realizedPctPast = priorPercentile(priorRealizedDistances, features.realizedPriceDistance);
    const drawdownPctPast = priorPercentile(priorDrawdowns, features.drawdownFromCycleHigh);
    const drawdownPainPctPast = drawdownPctPast === null ? null : 1 - drawdownPctPast;
    const mvrvPercentile = isFiniteNumber(features.mvrvPercentile) ? features.mvrvPercentile : null;

    const parts = [
      residualPctPast === null ? null : 1 - residualPctPast,
      mvrvPercentile === null ? null : 1 - mvrvPercentile,
      realizedPctPast === null ? null : 1 - realizedPctPast,
      drawdownPainPctPast,
    ].filter(isFiniteNumber);

    if (btc && parts.length >= 3 && featureRow.date >= BUY_ZONE_CONFIG.modernStartDate) {
      const bottomScore = parts.reduce((sum, value) => sum + value, 0) / parts.length;
      points.push({
        date: featureRow.date,
        close: btc.row.close,
        bottomScore,
        residualPctPast,
        mvrvPercentile,
        realizedPctPast,
        drawdownPainPctPast,
        isHeavyBuy: bottomScore >= BUY_ZONE_CONFIG.heavyThreshold,
        isMaxConviction: bottomScore >= BUY_ZONE_CONFIG.maxConvictionThreshold,
      });
    }

    if (isFiniteNumber(features.priceResidualLog)) insertSorted(priorResiduals, features.priceResidualLog);
    if (isFiniteNumber(features.realizedPriceDistance)) insertSorted(priorRealizedDistances, features.realizedPriceDistance);
    if (isFiniteNumber(features.drawdownFromCycleHigh)) insertSorted(priorDrawdowns, features.drawdownFromCycleHigh);
  }

  return points;
}

function contiguousZones(points: BuyZonePoint[]): BuyZoneSpan[] {
  const zones: BuyZoneSpan[] = [];
  let current: BuyZonePoint[] = [];

  const flush = () => {
    if (current.length >= BUY_ZONE_CONFIG.minZoneDays) {
      const low = current.reduce((best, point) => point.close < best.close ? point : best, current[0]);
      const maxScore = current.reduce((best, point) => point.bottomScore > best.bottomScore ? point : best, current[0]);
      zones.push({
        startDate: current[0].date,
        endDate: current[current.length - 1].date,
        days: current.length,
        startPrice: current[0].close,
        endPrice: current[current.length - 1].close,
        lowDate: low.date,
        lowPrice: low.close,
        maxScoreDate: maxScore.date,
        maxScore: maxScore.bottomScore,
        maxConviction: current.some(point => point.isMaxConviction),
      });
    }
    current = [];
  };

  for (const point of points) {
    if (point.isHeavyBuy) current.push(point);
    else flush();
  }
  flush();

  return zones;
}

function forwardReturn(index: number, horizonDays: number): number | null {
  if (index + horizonDays >= BTC_ROWS.length) return null;
  return BTC_ROWS[index + horizonDays].close / BTC_ROWS[index].close - 1;
}

function maxGain(index: number, horizonDays: number): number | null {
  if (index + horizonDays >= BTC_ROWS.length) return null;
  const start = BTC_ROWS[index].close;
  let best = 0;
  for (let i = index + 1; i <= index + horizonDays; i++) {
    best = Math.max(best, BTC_ROWS[i].close / start - 1);
  }
  return best;
}

function worstDrawdown(index: number, horizonDays: number): number | null {
  if (index + horizonDays >= BTC_ROWS.length) return null;
  let peak = BTC_ROWS[index].close;
  let worst = 0;
  for (let i = index + 1; i <= index + horizonDays; i++) {
    const close = BTC_ROWS[i].close;
    peak = Math.max(peak, close);
    worst = Math.min(worst, close / peak - 1);
  }
  return worst;
}

function median(values: number[]): number | null {
  const finite = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[mid - 1] + finite[mid]) / 2 : finite[mid];
}

function mean(values: number[]): number | null {
  const finite = values.filter(isFiniteNumber);
  return finite.length > 0 ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function summarizeEvents(events: BuyZoneEvent[]): BuyZoneMetricSummary {
  const returns1y = events.map(event => event.forwardReturn1y).filter(isFiniteNumber);
  const returns2y = events.map(event => event.forwardReturn2y).filter(isFiniteNumber);
  const maxGains = events.map(event => event.maxGain1y).filter(isFiniteNumber);
  const worstDrawdowns = events.map(event => event.worstDrawdown180d).filter(isFiniteNumber);

  return {
    sampleCount: events.length,
    medianReturn1y: median(returns1y),
    meanReturn1y: mean(returns1y),
    winRate1y: returns1y.length > 0 ? returns1y.filter(value => value > 0).length / returns1y.length : null,
    medianReturn2y: median(returns2y),
    meanReturn2y: mean(returns2y),
    winRate2y: returns2y.length > 0 ? returns2y.filter(value => value > 0).length / returns2y.length : null,
    medianMaxGain1y: median(maxGains),
    medianWorstDrawdown180d: median(worstDrawdowns),
  };
}

function selectEvents(points: BuyZonePoint[], predicate: (point: BuyZonePoint) => boolean, cooldownDays: number): BuyZoneEvent[] {
  const events: BuyZoneEvent[] = [];
  let lastIndex = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    const btc = BTC_BY_DATE.get(point.date);
    if (!btc || !predicate(point)) continue;
    if (btc.index - lastIndex < cooldownDays) continue;
    if (forwardReturn(btc.index, 365) === null) continue;

    events.push({
      ...point,
      forwardReturn1y: forwardReturn(btc.index, 365),
      forwardReturn2y: forwardReturn(btc.index, 730),
      maxGain1y: maxGain(btc.index, 365),
      worstDrawdown180d: worstDrawdown(btc.index, 180),
    });
    lastIndex = btc.index;
  }

  return events;
}

export function computeBuyZoneBacktests(points = computeBuyZonePoints()): BuyZoneBacktestResult[] {
  const cooldown = BUY_ZONE_CONFIG.defaultCooldownDays;
  const specs = [
    { id: 'heavy-buy-zone', label: 'Heavy Buy Zone: bottomScore >= 0.70', predicate: (point: BuyZonePoint) => point.bottomScore >= 0.70 },
    { id: 'max-conviction-buy-zone', label: 'Max Conviction: bottomScore >= 0.75', predicate: (point: BuyZonePoint) => point.bottomScore >= 0.75 },
    { id: 'capitulation-heavy-buy-zone', label: 'Capitulation Heavy Buy: score >= 0.70 and drawdown pain >= 0.80', predicate: (point: BuyZonePoint) => point.bottomScore >= 0.70 && (point.drawdownPainPctPast ?? 0) >= 0.80 },
  ];

  return specs.map(spec => {
    const events = selectEvents(points, spec.predicate, cooldown);
    return {
      id: spec.id,
      label: spec.label,
      cooldownDays: cooldown,
      events,
      ...summarizeEvents(events),
    };
  });
}

export function computeBuyZoneSummary(): BuyZoneSummary {
  const points = computeBuyZonePoints();
  const backtests = computeBuyZoneBacktests(points);
  const pooledEventDates = new Set(backtests.flatMap(backtest => backtest.events.map(event => event.date)));
  const sampleThresholdMet = pooledEventDates.size >= BUY_ZONE_CONFIG.minPromotionSamples;
  const anyPositiveMedian = backtests.some(backtest => (backtest.medianReturn1y ?? -Infinity) > 0);
  const verdict = anyPositiveMedian ? 'candidate' : 'watch';
  return {
    generatedAt: new Date().toISOString(),
    data: {
      btcRows: BTC_ROWS.length,
      btcFirstDate: BTC_ROWS[0]?.date,
      btcLastDate: BTC_ROWS.at(-1)?.date,
      featureRows: FEATURE_ROWS.length,
      featureFirstDate: FEATURE_ROWS[0]?.date,
      featureLastDate: FEATURE_ROWS.at(-1)?.date,
    },
    config: BUY_ZONE_CONFIG,
    latest: points.at(-1) ?? null,
    zones: contiguousZones(points),
    backtests,
    pooledDiagnostics: {
      uniqueEventSamples: pooledEventDates.size,
      minPromotionSamples: BUY_ZONE_CONFIG.minPromotionSamples,
      sampleThresholdMet,
      poolingChoice: 'Heavy-buy, max-conviction, and capitulation-heavy events are pooled only for sample-size diagnostics because they share the same bottom-score hypothesis.',
      promotionBlockedReason: sampleThresholdMet ? null : `pooled unique sample count ${pooledEventDates.size} is below promotion threshold ${BUY_ZONE_CONFIG.minPromotionSamples}`,
    },
    verdict,
    caveat: sampleThresholdMet
      ? 'Buy-zone remains a candidate overlay pending a residual-model promotion gate; it is not enabled as forecast alpha.'
      : 'Small BTC bottom sample remains below the documented promotion threshold. Use as a candidate/watch buy-zone overlay, not a bottom guarantee or forecast alpha.',
  };
}

import { createHash } from 'node:crypto';
import type { OHLCVData } from './api';
import { evaluateCausalLogPowerLawBase, fitCausalLogPowerLaw, forecastCausalLogPowerLaw } from './btcModelUpgrades';
import { addDays, cycleAdjustedPowerLawForecast } from './cycle';

// Rules: docs/reports/results/btc-candle-median-race-protocol-v1.md
export const RACE_VERSION = 'btc-candle-median-race-v1';
export const RACE_START_ORIGIN = '2026-11-20';
export const RACE_STEP_DAYS = 7;
export const RACE_HORIZONS = [14, 30, 90, 180, 365] as const;
export const RACE_REVIEW_MIN_ORIGINS = 52;
const SHORTEST_HORIZON = RACE_HORIZONS[0];

type Forecasts = Record<string, { shipped: number; naive: number; pit_powerlaw: number }>;
export type RaceRow =
  | { kind: 'prediction'; originDate: string; originClose: number; recordedAt: string; forecasts: Forecasts }
  | { kind: 'gap'; originDate: string; recordedAt: string; reason: string };

export interface RaceLedger {
  raceVersion: typeof RACE_VERSION;
  protocolSha256: string;
  candidateSourceSha256: string;
  rows: RaceRow[];
}

const parse = (date: string) => new Date(`${date}T00:00:00Z`);

/** Hash of every candidate's code. A change here means a new race version. */
export function candidateSourceSha256(): string {
  const source = [cycleAdjustedPowerLawForecast, fitCausalLogPowerLaw, forecastCausalLogPowerLaw, evaluateCausalLogPowerLawBase, buildRaceForecasts]
    .map(fn => fn.toString())
    .join('\n');
  return createHash('sha256').update(source).digest('hex');
}

export function buildRaceForecasts(ohlcv: readonly OHLCVData[], originDate: string): { originClose: number; forecasts: Forecasts } {
  const rows = ohlcv.filter(row => row.date <= originDate);
  const origin = rows[rows.length - 1];
  if (!origin || origin.date !== originDate) throw new Error(`no close on origin ${originDate}`);
  const fit = fitCausalLogPowerLaw(rows, { withCycle: false, startDate: '2013-01-01' });
  if (!fit) throw new Error(`power-law fit failed at ${originDate}`);
  const originTime = parse(originDate);
  const forecasts: Forecasts = {};
  for (const horizon of RACE_HORIZONS) {
    const target = parse(addDays(originDate, horizon));
    forecasts[horizon] = {
      shipped: cycleAdjustedPowerLawForecast(target, origin.close, originTime),
      naive: origin.close,
      pit_powerlaw: forecastCausalLogPowerLaw(fit, target, origin.close, originTime),
    };
  }
  return { originClose: origin.close, forecasts };
}

/**
 * Origins to add now. An origin is recordable only while origin + 14 days is after the
 * latest close (no outcome known yet). Older missed origins become gaps, never predictions.
 */
export function planRaceAppend(ledger: RaceLedger, latestCloseDate: string): { originDate: string; kind: 'prediction' | 'gap' }[] {
  const last = ledger.rows[ledger.rows.length - 1];
  const plan: { originDate: string; kind: 'prediction' | 'gap' }[] = [];
  for (let origin = last ? addDays(last.originDate, RACE_STEP_DAYS) : RACE_START_ORIGIN; origin <= latestCloseDate; origin = addDays(origin, RACE_STEP_DAYS)) {
    plan.push({ originDate: origin, kind: addDays(origin, SHORTEST_HORIZON) > latestCloseDate ? 'prediction' : 'gap' });
  }
  return plan;
}

/** Counts only. Comparative scores stay hidden until a horizon is ready for review. */
export function raceStatus(ledger: RaceLedger, latestCloseDate: string) {
  const predictions = ledger.rows.filter(row => row.kind === 'prediction');
  return {
    predictions: predictions.length,
    gaps: ledger.rows.length - predictions.length,
    horizons: RACE_HORIZONS.map(horizon => {
      const matured = predictions.filter(row => addDays(row.originDate, horizon) <= latestCloseDate).length;
      return { horizon, matured, readyForReview: matured >= RACE_REVIEW_MIN_ORIGINS };
    }),
  };
}

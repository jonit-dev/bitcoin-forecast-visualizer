import { CYCLE_EXPERIMENT_CONFIG } from './modelConfig';
import {
  basePowerLawPrice,
  daysSinceGenesis,
  floorPowerLawPrice,
  peakPowerLawPrice,
  powerLawForecast,
} from './powerLaw';

export type PhaseLabel = 'Accumulation' | 'Bull' | 'Trim' | 'Bear';
export type CycleStrategyId =
  | 'deterministic-pivots'
  | 'no-future-pivots'
  | 'damped-future-pivots'
  | 'pivot-uncertainty-wide';

export interface CyclePivot {
  date: string;
  type: 'ATL' | 'ATH';
  known: boolean;
}

export interface PhaseZone {
  startDate: string;
  endDate: string;
  label: PhaseLabel;
}

export interface PhaseState extends PhaseZone {
  progress: number;
}

export const ATL_TO_ATH_DAYS = 1064;
export const ATH_TO_ATL_DAYS = 364;
export const TRIM_BEFORE_ATH_DAYS = 30;

const CYCLE_SEED_ATL = '2015-01-14';

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

export function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().split('T')[0];
}

const KNOWN_PIVOTS: CyclePivot[] = [
  { date: '2013-12-04', type: 'ATH', known: true },
  { date: '2015-01-14', type: 'ATL', known: true },
  { date: '2017-12-17', type: 'ATH', known: true },
  { date: '2018-12-15', type: 'ATL', known: true },
  { date: '2021-11-10', type: 'ATH', known: true },
  { date: '2022-11-09', type: 'ATL', known: true },
];

export function generateCyclePivots(untilYear = 2040): CyclePivot[] {
  const pivots = [...KNOWN_PIVOTS];
  let last = pivots[pivots.length - 1];

  while (new Date(last.date + 'T00:00:00Z').getUTCFullYear() < untilYear) {
    const nextDays = last.type === 'ATL' ? ATL_TO_ATH_DAYS : ATH_TO_ATL_DAYS;
    const nextType = last.type === 'ATL' ? 'ATH' : 'ATL';
    const nextDate = addDays(last.date, nextDays);
    const pivot: CyclePivot = { date: nextDate, type: nextType, known: false };
    pivots.push(pivot);
    last = pivot;
  }

  return pivots;
}

export function buildPhaseZones(pivots: CyclePivot[]): PhaseZone[] {
  const zones: PhaseZone[] = [];

  for (let i = 0; i < pivots.length; i++) {
    const pivot = pivots[i];
    const next = pivots[i + 1];

    if (pivot.type === 'ATL') {
      const accumEnd = addMonths(pivot.date, 6);
      const athDate = next?.type === 'ATH' ? next.date : addDays(pivot.date, ATL_TO_ATH_DAYS);
      const trimStart = addDays(athDate, -TRIM_BEFORE_ATH_DAYS);
      zones.push({ startDate: pivot.date, endDate: accumEnd, label: 'Accumulation' });
      zones.push({ startDate: accumEnd, endDate: trimStart, label: 'Bull' });
      zones.push({ startDate: trimStart, endDate: athDate, label: 'Trim' });
    } else {
      const bearEnd = next ? next.date : addDays(pivot.date, ATH_TO_ATL_DAYS);
      zones.push({ startDate: pivot.date, endDate: bearEnd, label: 'Bear' });
    }
  }

  return zones;
}

export const CYCLE_PIVOTS = generateCyclePivots();
export const PHASE_ZONES = buildPhaseZones(CYCLE_PIVOTS);

export function getPhaseState(dateLike: string | Date): PhaseState | null {
  const dateStr =
    typeof dateLike === 'string'
      ? dateLike
      : dateLike.toISOString().split('T')[0];
  const date = new Date(dateStr + 'T00:00:00Z');

  for (const zone of PHASE_ZONES) {
    if (zone.startDate > dateStr || dateStr >= zone.endDate) continue;

    const start = new Date(zone.startDate + 'T00:00:00Z');
    const end = new Date(zone.endDate + 'T00:00:00Z');
    const totalDays = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000));
    const elapsedDays = Math.max(0, Math.floor((date.getTime() - start.getTime()) / 86400000));

    return {
      ...zone,
      progress: Math.min(1, Math.max(0, elapsedDays / totalDays)),
    };
  }

  return null;
}

export function getCycleSeedAtl(): string {
  return CYCLE_SEED_ATL;
}

export function cycleAdjustedPowerLawForecast(
  dateFuture: Date,
  currentPrice: number,
  currentDate: Date,
  strategyId: CycleStrategyId = CYCLE_EXPERIMENT_CONFIG.selectedStrategyId as CycleStrategyId
): number {
  const rawForecast = powerLawForecast(dateFuture, currentPrice, currentDate);
  if (strategyId === 'no-future-pivots') return rawForecast;

  const cycleTarget = cyclePivotTargetPrice(dateFuture, strategyId);
  if (!Number.isFinite(rawForecast) || rawForecast <= 0) return cycleTarget ?? rawForecast;
  if (!cycleTarget || !Number.isFinite(cycleTarget) || cycleTarget <= 0) return rawForecast;

  const horizonDays = Math.max(0, Math.round((dateFuture.getTime() - currentDate.getTime()) / 86400000));
  const cycleWeight = smoothstep((horizonDays - 30) / 70);
  return lerpLog(rawForecast, cycleTarget, cycleWeight);
}

export function cycleIntervalSigmaMultiplier(strategyId: CycleStrategyId, horizonDays: number): number {
  return strategyId === 'pivot-uncertainty-wide' && horizonDays >= 90
    ? CYCLE_EXPERIMENT_CONFIG.pivotUncertaintySigmaMultiplier
    : 1;
}

export function cycleAmplitudeDampingForFuturePivot(
  pivot: CyclePivot,
  decay = CYCLE_EXPERIMENT_CONFIG.futureAmplitudeDecay
): number {
  if (pivot.known) return 1;
  const futurePivotIndex = CYCLE_PIVOTS
    .filter(candidate => !candidate.known && candidate.date <= pivot.date)
    .length;
  return Math.max(0.05, Math.pow(decay, Math.max(1, futurePivotIndex)));
}

function cyclePivotTargetPrice(date: Date, strategyId: CycleStrategyId): number | null {
  const dateStr = dateKey(date);
  const pivotIndex = CYCLE_PIVOTS.findIndex(pivot => pivot.date >= dateStr);
  const nextPivot = pivotIndex >= 0 ? CYCLE_PIVOTS[pivotIndex] : null;
  const previousPivot = pivotIndex > 0
    ? CYCLE_PIVOTS[pivotIndex - 1]
    : CYCLE_PIVOTS[CYCLE_PIVOTS.length - 1]?.date < dateStr
      ? CYCLE_PIVOTS[CYCLE_PIVOTS.length - 1]
      : null;

  if (nextPivot?.date === dateStr) return pivotTargetPrice(nextPivot, strategyId);
  if (!previousPivot || !nextPivot) return null;

  const start = new Date(previousPivot.date + 'T00:00:00Z').getTime();
  const end = new Date(nextPivot.date + 'T00:00:00Z').getTime();
  const now = date.getTime();
  if (end <= start || now < start || now > end) return null;

  return lerpLog(
    pivotTargetPrice(previousPivot, strategyId),
    pivotTargetPrice(nextPivot, strategyId),
    (now - start) / (end - start)
  );
}

function pivotTargetPrice(pivot: CyclePivot, strategyId: CycleStrategyId): number {
  const t = daysSinceGenesis(new Date(pivot.date + 'T00:00:00Z'));
  const target = pivot.type === 'ATH' ? peakPowerLawPrice(t) : floorPowerLawPrice(t);
  if (strategyId !== 'damped-future-pivots' && strategyId !== 'pivot-uncertainty-wide') return target;
  if (pivot.known) return target;

  const base = basePowerLawPrice(t);
  const damping = cycleAmplitudeDampingForFuturePivot(pivot);
  return lerpLog(base, target, damping);
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function lerpLog(a: number, b: number, t: number): number {
  return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * smoothstep(t));
}

function dateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

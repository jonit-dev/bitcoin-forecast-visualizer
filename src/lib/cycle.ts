export type PhaseLabel = 'Accumulation' | 'Bull' | 'Trim' | 'Bear';

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
      const bullEnd = next ? next.date : addDays(pivot.date, ATL_TO_ATH_DAYS);
      zones.push({ startDate: pivot.date, endDate: accumEnd, label: 'Accumulation' });
      zones.push({ startDate: accumEnd, endDate: bullEnd, label: 'Bull' });
    } else {
      const trimEnd = addMonths(pivot.date, 4);
      const bearEnd = next ? next.date : addDays(pivot.date, ATH_TO_ATL_DAYS);
      zones.push({ startDate: pivot.date, endDate: trimEnd, label: 'Trim' });
      zones.push({ startDate: trimEnd, endDate: bearEnd, label: 'Bear' });
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

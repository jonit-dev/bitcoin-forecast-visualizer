export type CrossDirection = -1 | 0 | 1;

interface DatedOpen {
  date: string;
  open: number;
}

export function simpleMovingAverage(values: readonly number[], window: number): Array<number | null> {
  if (!Number.isInteger(window) || window < 1) throw new Error('window must be a positive integer');
  const result: Array<number | null> = Array(values.length).fill(null);
  let sum = 0;
  for (let index = 0; index < values.length; index++) {
    sum += values[index];
    if (index >= window) sum -= values[index - window];
    if (index >= window - 1) result[index] = sum / window;
  }
  return result;
}

export function exponentialMovingAverage(values: readonly number[], window: number): number[] {
  if (!Number.isInteger(window) || window < 1) throw new Error('window must be a positive integer');
  if (values.length === 0) return [];
  const alpha = 2 / (window + 1);
  const result = [values[0]];
  for (let index = 1; index < values.length; index++) {
    result.push(alpha * values[index] + (1 - alpha) * result[index - 1]);
  }
  return result;
}

export function strictCrosses(
  left: readonly (number | null)[],
  right: readonly (number | null)[],
): CrossDirection[] {
  if (left.length !== right.length) throw new Error('crossing series lengths must match');
  const result: CrossDirection[] = Array(left.length).fill(0);
  for (let index = 1; index < left.length; index++) {
    const previousLeft = left[index - 1];
    const previousRight = right[index - 1];
    const currentLeft = left[index];
    const currentRight = right[index];
    if (previousLeft === null || previousRight === null || currentLeft === null || currentRight === null) continue;
    const previous = previousLeft - previousRight;
    const current = currentLeft - currentRight;
    if (previous <= 0 && current > 0) result[index] = 1;
    else if (previous >= 0 && current < 0) result[index] = -1;
  }
  return result;
}

export function hysteresisCrosses(
  left: readonly number[],
  right: readonly (number | null)[],
  bandFraction: number,
): CrossDirection[] {
  if (left.length !== right.length) throw new Error('hysteresis series lengths must match');
  if (!(bandFraction >= 0 && bandFraction < 1)) throw new Error('bandFraction must be in [0, 1)');
  const result: CrossDirection[] = Array(left.length).fill(0);
  let state: CrossDirection = 0;
  for (let index = 0; index < left.length; index++) {
    const reference = right[index];
    if (reference === null || !(reference > 0)) continue;
    const ratio = left[index] / reference;
    if (state === 0) {
      if (ratio > 1 + bandFraction) state = 1;
      else if (ratio < 1 - bandFraction) state = -1;
    } else if (state === -1 && ratio > 1 + bandFraction) {
      state = 1;
      result[index] = 1;
    } else if (state === 1 && ratio < 1 - bandFraction) {
      state = -1;
      result[index] = -1;
    }
  }
  return result;
}

export function holmAdjust(pValues: readonly number[]): number[] {
  const order = pValues.map((pValue, index) => ({ pValue, index })).sort((a, b) => a.pValue - b.pValue);
  const adjusted = Array(pValues.length).fill(1);
  let runningMaximum = 0;
  for (let rank = 0; rank < order.length; rank++) {
    const item = order[rank];
    runningMaximum = Math.max(runningMaximum, Math.min(1, item.pValue * (order.length - rank)));
    adjusted[item.index] = runningMaximum;
  }
  return adjusted;
}

export function nextOpenForwardLogReturn(
  rows: readonly DatedOpen[],
  signalIndex: number,
  horizonDays: number,
  periodEnd = '9999-12-31',
): number | null {
  const signal = rows[signalIndex];
  const entry = rows[signalIndex + 1];
  const exit = rows[signalIndex + horizonDays + 1];
  if (!signal || !entry || !exit || exit.date > periodEnd || !(entry.open > 0 && exit.open > 0)) return null;
  if (daysBetween(signal.date, entry.date) !== 1 || daysBetween(entry.date, exit.date) !== horizonDays) return null;
  return Math.log(exit.open / entry.open);
}

export function countCrossingEpisodes(dates: readonly string[], cooldownDays: number): number {
  let count = 0;
  let previousEventDate: string | null = null;
  for (const date of dates) {
    if (previousEventDate === null || daysBetween(previousEventDate, date) >= cooldownDays) count++;
    previousEventDate = date;
  }
  return count;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

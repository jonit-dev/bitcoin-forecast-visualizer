import { isUsMarketSessionDay } from './us-market-calendar.mjs';

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// One year of daily candles bounds every gap walk, repair enumeration and
// backfill window, so a corrupt or far-future row can never fan out unbounded
// work in a Worker request.
export const MAX_BACKFILL_DAYS = 400;

const isDate = (value) => typeof value === 'string' && DATE_PATTERN.test(value);
const parse = (date) => Date.parse(`${date}T00:00:00Z`);

export const shiftDate = (date, days) => new Date(parse(date) + days * DAY_MS).toISOString().slice(0, 10);
export const repairWindowStart = (date, days) => shiftDate(date, -days);
export const daysBetween = (from, to) => Math.round((parse(to) - parse(from)) / DAY_MS);

// Bitcoin trades every calendar day; the ETFs only produce a candle on a US
// market session, so a weekend or observed holiday is not a hole.
export const isExpectedCandleDate = (assetId, date) => (assetId === 'btc' ? true : isUsMarketSessionDay(date));

// Dates the asset should have produced strictly between two observed candles.
// `budget` caps both the reported dates and the walk itself.
function expectedBetween(assetId, from, to, budget) {
  const missing = [];
  const maxSteps = Math.max(budget, 1) * 2;
  let cursor = shiftDate(from, 1);
  let steps = 0;
  while (cursor < to && missing.length < budget && steps < maxSteps) {
    if (isExpectedCandleDate(assetId, cursor)) missing.push(cursor);
    cursor = shiftDate(cursor, 1);
    steps += 1;
  }
  return { missing, truncated: cursor < to };
}

function sortedDates(rows) {
  const dates = [];
  for (const row of rows ?? []) if (isDate(row?.date)) dates.push(row.date);
  return [...new Set(dates)].sort();
}

/**
 * Report which expected candles the series is missing from `since` onwards.
 * `lastContiguousDate` is the newest candle reachable without crossing a hole,
 * which is the newest date a daily-return model may safely treat as adjacent.
 */
export function assessContinuity(assetId, rows, since) {
  const dates = sortedDates(rows);
  if (dates.length === 0) return { complete: false, missingDates: [], lastContiguousDate: null, truncated: false };
  const windowStart = isDate(since) ? since : dates[0];
  // Anchor on the last candle at or before the window so a hole that opens the
  // window is measured against real history instead of the window edge.
  let anchor = 0;
  while (anchor + 1 < dates.length && dates[anchor + 1] <= windowStart) anchor += 1;

  const missingDates = [];
  let lastContiguousDate = dates[anchor];
  let contiguous = true;
  let truncated = false;
  for (let index = anchor + 1; index < dates.length; index += 1) {
    const budget = MAX_BACKFILL_DAYS - missingDates.length;
    if (budget <= 0) { truncated = true; break; }
    const gap = expectedBetween(assetId, dates[index - 1], dates[index], budget);
    missingDates.push(...gap.missing);
    if (gap.truncated) { truncated = true; contiguous = false; break; }
    if (gap.missing.length > 0) contiguous = false;
    else if (contiguous) lastContiguousDate = dates[index];
  }
  return { complete: missingDates.length === 0 && !truncated, missingDates, lastContiguousDate, truncated };
}

/**
 * Truncate a discontinuous series at its last contiguous candle. Daily-return
 * maths treats adjacent rows as consecutive observations, so a series with a
 * hole must not reach the model with the far side attached.
 */
export function applyContinuityGuard(assetId, rows, since) {
  const continuity = assessContinuity(assetId, rows, since);
  const series = rows ?? [];
  if (continuity.complete || !continuity.lastContiguousDate) return { rows: series, continuity };
  return { rows: series.filter((row) => row.date <= continuity.lastContiguousDate), continuity };
}

/**
 * Earliest date a source refresh must re-read to close every hole in stored
 * history, bounded by MAX_BACKFILL_DAYS. `storedDates` may be empty, in which
 * case the caller's bootstrap date is used.
 */
export function backfillWindowStart(assetId, storedDates, today, { lookbackDays, bootstrapSince } = {}) {
  const floor = repairWindowStart(today, MAX_BACKFILL_DAYS);
  const routine = repairWindowStart(today, lookbackDays ?? 7);
  const dates = [...storedDates].filter(isDate).sort();
  const candidate = dates.length === 0
    ? (isDate(bootstrapSince) ? bootstrapSince : routine)
    : assessContinuity(assetId, dates.map((date) => ({ date })), dates[0]).lastContiguousDate ?? routine;
  const start = candidate < routine ? candidate : routine;
  return start < floor ? floor : start;
}

const DAY_MS = 86_400_000;
const dateKey = (date) => date.toISOString().slice(0, 10);

function nthWeekday(year, month, weekday, nth) {
  const date = new Date(Date.UTC(year, month, 1));
  date.setUTCDate(1 + ((7 + weekday - date.getUTCDay()) % 7) + (nth - 1) * 7);
  return dateKey(date);
}

function lastWeekday(year, month, weekday) {
  const date = new Date(Date.UTC(year, month + 1, 0));
  date.setUTCDate(date.getUTCDate() - ((7 + date.getUTCDay() - weekday) % 7));
  return dateKey(date);
}

function observed(year, month, day) {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return dateKey(date);
}

// Anonymous Gregorian computus; NYSE observes Good Friday two days before Easter.
function goodFriday(year) {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateKey(new Date(Date.UTC(year, month, day) - 2 * DAY_MS));
}

// Unscheduled full-day NYSE closures. These are historical facts no rule can
// derive, and omitting one makes a real closure look like a missing candle:
// every continuity consumer would then treat the whole series after it as
// unreachable. `npm test` asserts the tracked datasets stay continuous under
// this calendar, so a future closure fails there instead of silently freezing
// the deployed chart. Add the date here when that test goes red.
const UNSCHEDULED_CLOSURES = new Set([
  '2001-09-11', '2001-09-12', '2001-09-13', '2001-09-14', // September 11 attacks
  '2004-06-11', // National day of mourning, Ronald Reagan
  '2007-01-02', // National day of mourning, Gerald Ford
  '2012-10-29', '2012-10-30', // Hurricane Sandy
  '2018-12-05', // National day of mourning, George H. W. Bush
  '2025-01-09', // National day of mourning, Jimmy Carter
]);

// Cached per year: the calendar is walked once per day of history and per
// heatmap day, and rebuilding the set each time dominated a 10-year render.
const HOLIDAY_CACHE = new Map();

export function usMarketHolidays(year) {
  const cached = HOLIDAY_CACHE.get(year);
  if (cached) return cached;

  const holidays = new Set([
    observed(year, 0, 1), nthWeekday(year, 0, 1, 3), nthWeekday(year, 1, 1, 3), goodFriday(year),
    lastWeekday(year, 4, 1), observed(year, 6, 4), nthWeekday(year, 8, 1, 1),
    nthWeekday(year, 10, 4, 4), observed(year, 11, 25),
  ]);
  // Juneteenth became an exchange holiday in 2022; treating it as closed in older
  // histories shifts every subsequent lead by one observed trading session.
  if (year >= 2022) holidays.add(observed(year, 5, 19));
  // A Dec 31 observation can belong to the following year's New Year's holiday.
  holidays.add(observed(year + 1, 0, 1));
  HOLIDAY_CACHE.set(year, holidays);
  return holidays;
}

export function isUsMarketSessionDay(date) {
  const value = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : new Date(date);
  const weekday = value.getUTCDay();
  const key = dateKey(value);
  return weekday !== 0 && weekday !== 6 && !UNSCHEDULED_CLOSURES.has(key) && !usMarketHolidays(value.getUTCFullYear()).has(key);
}

// Regular-session close in UTC. 21:00 UTC covers both 16:00 EST and 16:00 EDT
// plus the settlement tail, which is the cutoff the quote worker already used.
export const US_SESSION_CLOSE_UTC_HOUR = 21;

/**
 * Whether a source's candle for `date` is final. A BTC candle covers the whole
 * UTC day, so today's is never final; an ETF candle is final once the US session
 * behind it has closed. Both ingestion paths share this rule, otherwise the
 * anchor date depends on which provider answered.
 */
export function isCompletedCandleDate(assetId, date, now = new Date()) {
  const moment = new Date(now);
  const today = dateKey(moment);
  if (date !== today) return date < today;
  return assetId !== 'btc' && moment.getUTCHours() >= US_SESSION_CLOSE_UTC_HOUR;
}

export function countUsMarketSessionsAfter(fromDate, throughDate) {
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  // A caller passing a Date may carry a time of day. Without normalizing it the
  // walk reaches today's midnight, advances once more and counts tomorrow.
  const rawEnd = typeof throughDate === 'string' ? new Date(`${throughDate}T00:00:00Z`) : new Date(throughDate);
  const end = new Date(Date.UTC(rawEnd.getUTCFullYear(), rawEnd.getUTCMonth(), rawEnd.getUTCDate()));
  let sessions = 0;
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isUsMarketSessionDay(cursor)) sessions += 1;
  }
  return sessions;
}

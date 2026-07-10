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

export function usMarketHolidays(year) {
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
  return holidays;
}

export function isUsMarketSessionDay(date) {
  const value = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : new Date(date);
  const weekday = value.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !usMarketHolidays(value.getUTCFullYear()).has(dateKey(value));
}

export function countUsMarketSessionsAfter(fromDate, throughDate) {
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = typeof throughDate === 'string' ? new Date(`${throughDate}T00:00:00Z`) : new Date(throughDate);
  let sessions = 0;
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isUsMarketSessionDay(cursor)) sessions += 1;
  }
  return sessions;
}

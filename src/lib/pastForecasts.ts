import type { OHLCVData } from './api';
import { addDays, cycleAdjustedPowerLawForecast } from './cycle';
import { blendedPowerLawHeatmapVol, effectiveSigmaScaleForHorizon } from './forecastInterval';

export interface PastForecastPoint {
  date: string;
  median: number;
  upper: number;
  lower: number;
}

export interface PastForecast {
  originDate: string;
  points: PastForecastPoint[];
}

export const MAX_PAST_FORECASTS = 24;
const MIN_HISTORY_ROWS = 365; // computePowerLawInterval minimum
// Before 2022 the model constants fit the price badly, so old replays only show that misfit.
// Matches the test period of docs/reports/results/btc-price-match-2026-11-24.md.
export const PAST_FORECAST_START = '2022-01-01';

/**
 * Today's model replayed from past dates: the same median path and band as the live
 * forecast (processRealData), started at each origin's close with rows up to that origin.
 * Hindsight: the model constants were set with data after most origins.
 */
export function buildPastForecasts(ohlcv: OHLCVData[], horizon: number, confidenceZ: number): PastForecast[] {
  if (horizon < 1 || ohlcv.length === 0) return [];
  const lastDate = ohlcv[ohlcv.length - 1].date;
  const sigmaScales = Array.from({ length: horizon }, (_, index) => effectiveSigmaScaleForHorizon(index + 1));
  const fans: PastForecast[] = [];

  for (let k = 1; k <= MAX_PAST_FORECASTS; k++) {
    const end = lastIndexOnOrBefore(ohlcv, addDays(lastDate, -k * horizon));
    if (end + 1 < MIN_HISTORY_ROWS || ohlcv[end].date < PAST_FORECAST_START) break;
    const rows = ohlcv.slice(0, end + 1);
    const origin = rows[end];
    const originTime = parseDate(origin.date);
    const dailyVol = blendedPowerLawHeatmapVol(rows);
    const points: PastForecastPoint[] = [{ date: origin.date, median: origin.close, upper: origin.close, lower: origin.close }];
    for (let day = 1; day <= horizon; day++) {
      const date = addDays(origin.date, day);
      const median = cycleAdjustedPowerLawForecast(parseDate(date), origin.close, originTime);
      const halfWidth = confidenceZ * dailyVol * sigmaScales[day - 1];
      points.push({ date, median, upper: median * Math.exp(halfWidth), lower: median * Math.exp(-halfWidth) });
    }
    fans.push({ originDate: origin.date, points });
  }

  return fans.reverse();
}

/** The fan that covers `date` (origin excluded), with the point on that date. */
export function pastForecastAt(fans: PastForecast[], date: string): { originDate: string; point: PastForecastPoint } | null {
  for (const fan of fans) {
    if (date <= fan.originDate || date > fan.points[fan.points.length - 1].date) continue;
    const point = fan.points.find(candidate => candidate.date === date);
    return point ? { originDate: fan.originDate, point } : null;
  }
  return null;
}

function lastIndexOnOrBefore(ohlcv: OHLCVData[], date: string): number {
  for (let index = ohlcv.length - 1; index >= 0; index--) {
    if (ohlcv[index].date <= date) return index;
  }
  return -1;
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

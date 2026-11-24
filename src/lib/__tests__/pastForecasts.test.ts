import { describe, expect, it } from 'vitest';
import btcHistory from '../../data/btc-history.json';
import type { OHLCVData } from '../api';
import { addDays } from '../cycle';
import { processRealData } from '../data';
import { MAX_PAST_FORECASTS, buildPastForecasts, pastForecastAt } from '../pastForecasts';

const ohlcv = btcHistory as OHLCVData[];
const Z95 = 1.96;
const upTo = (date: string) => ohlcv.filter(row => row.date <= date);

describe('buildPastForecasts', () => {
  it('replays the live yellow-line forecast exactly as it was drawn on the origin date', () => {
    const fan = buildPastForecasts(ohlcv, 180, Z95).at(-1)!;
    const live = processRealData(upTo(fan.originDate), 180, Z95).filter((row: any) => row.isForecast);
    expect(live).toHaveLength(180);
    live.forEach((row: any, index: number) => {
      const point = fan.points[index + 1];
      expect(point.date).toBe(row.date);
      expect(point.median).toBeCloseTo(row.close, 6);
      expect(point.upper).toBeCloseTo(row.forecastUpper, 6);
      expect(point.lower).toBeCloseTo(row.forecastLower, 6);
    });
  });

  it('does not change an origin forecast when prices after that origin change', () => {
    const fans = buildPastForecasts(ohlcv, 90, Z95);
    const target = fans[fans.length - 3];
    const shocked = ohlcv.map(row => row.date > target.originDate ? { ...row, close: row.close * 3, open: row.open * 3 } : row);
    const shockedFan = buildPastForecasts(shocked, 90, Z95).find(fan => fan.originDate === target.originDate);
    expect(shockedFan).toEqual(target);
  });

  it('spaces origins one horizon apart, caps them, and ends the newest fan at the last candle', () => {
    for (const horizon of [30, 180, 365]) {
      const fans = buildPastForecasts(ohlcv, horizon, Z95);
      expect(fans.length).toBeGreaterThan(0);
      expect(fans.length).toBeLessThanOrEqual(MAX_PAST_FORECASTS);
      expect(fans.at(-1)!.points.at(-1)!.date).toBe(ohlcv.at(-1)!.date);
      fans.slice(1).forEach((fan, index) => expect(fan.originDate).toBe(addDays(fans[index].originDate, horizon)));
      fans.forEach(fan => expect(upTo(fan.originDate).length).toBeGreaterThanOrEqual(365));
    }
    expect(buildPastForecasts(ohlcv, 30, Z95)).toHaveLength(MAX_PAST_FORECASTS);
  });

  it('finds the fan under the crosshair and skips origin dates', () => {
    const fans = buildPastForecasts(ohlcv, 90, Z95);
    const fan = fans[2];
    expect(pastForecastAt(fans, addDays(fan.originDate, 10))).toEqual({ originDate: fan.originDate, point: fan.points[10] });
    expect(pastForecastAt(fans, fans[0].originDate)).toBeNull();
  });

  it('leaves processRealData output unchanged', () => {
    const before = JSON.stringify(processRealData(ohlcv, 90, Z95));
    buildPastForecasts(ohlcv, 90, Z95);
    expect(JSON.stringify(processRealData(ohlcv, 90, Z95))).toBe(before);
  });
});

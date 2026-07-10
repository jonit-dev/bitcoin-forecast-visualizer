import { describe, expect, it } from 'vitest';
import {
  buildChartSeriesData,
  buildProbabilityMarker,
  median,
  mvrvZScoreColor,
  relativeVolumeForIndex,
  visibleRangeForTimeRange,
} from '../chart/dataTransforms';

const rows = [
  {
    date: '2024-01-01',
    open: 100,
    high: 120,
    low: 90,
    close: 110,
    volume: 1000,
    sma20: null,
    sma50: null,
    powerLawModel: 105,
    floorPriceModel: 80,
    peakPriceModel: 180,
    stochasticTraces: [110, 111],
  },
  {
    date: '2024-01-02',
    open: 110,
    high: 130,
    low: 105,
    close: 125,
    volume: 2000,
    sma20: 112,
    sma50: null,
    powerLawModel: 115,
    floorPriceModel: 85,
    peakPriceModel: 190,
    stochasticTraces: [125, 126],
  },
  {
    date: '2024-01-03',
    open: 125,
    high: 140,
    low: 120,
    close: 135,
    volume: 3000,
    sma20: 120,
    sma50: 116,
    powerLawModel: 125,
    floorPriceModel: 90,
    peakPriceModel: 200,
  },
  {
    date: '2024-01-04',
    isForecast: true,
    open: 135,
    high: 150,
    low: 130,
    close: 145,
    forecastUpper: 170,
    forecastLower: 120,
    floorPriceModel: 95,
    peakPriceModel: 210,
    stochasticTraces: [148, 151],
  },
  {
    date: '2024-01-05',
    isForecast: true,
    open: 145,
    high: 160,
    low: 140,
    close: 155,
    forecastUpper: 180,
    forecastLower: 125,
    floorPriceModel: 100,
    peakPriceModel: 220,
    stochasticTraces: [132, 161],
  },
];

describe('Chart data transforms', () => {
  it('should preserve trace-based yellow forecast candles', () => {
    const first = buildChartSeriesData(rows, null, true, false, 2);
    const second = buildChartSeriesData(rows, null, true, false, 2);

    const expectedForecastPath = [135, 148, 132];
    expect(first.forecastData.map(point => point.close)).toEqual(expectedForecastPath);
    expect(first.forecastData).toEqual(second.forecastData);
    expect(first.forecastData.slice(1).map(point => point.open)).toEqual([135, 148]);

    // Baseline visible-character diagnostics for this frozen fixture: daily
    // innovations remain non-zero, keep their magnitudes, and do not acquire
    // an artificial smooth-median endpoint (155).
    const innovations = expectedForecastPath.slice(1).map((value, index) => value - expectedForecastPath[index]);
    expect(innovations).toEqual([13, -16]);
    expect(innovations.filter(value => Math.sign(value) !== 0)).toHaveLength(2);
    expect(new Set(innovations.map(Math.sign))).toEqual(new Set([-1, 1]));
    expect(first.forecastData.at(-1)?.close).toBe(132);
    expect(first.forecastData.at(-1)?.close).not.toBe(first.forecastMedianData.at(-1)?.value);
  });

  it('normalizes volume against the rolling positive-volume median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([10, 2, 6, 4])).toBe(5);
    expect(relativeVolumeForIndex(rows, 0)).toBeCloseTo(Math.log1p(1));
    expect(relativeVolumeForIndex(rows, 2)).toBeCloseTo(Math.log1p(3000 / 2000));
    expect(relativeVolumeForIndex([{ volume: 0 }], 0)).toBe(0);
  });

  it('should map primary trace values to yellow forecast candles without resampling', () => {
    const series = buildChartSeriesData(rows, null, true, false, 2);

    expect(series.candleData).toHaveLength(3);
    expect(series.forecastData).toEqual([
      { time: '2024-01-03', open: 135, high: 135, low: 135, close: 135 },
      { time: '2024-01-04', open: 135, high: 148, low: 135, close: 148 },
      { time: '2024-01-05', open: 148, high: 148, low: 132, close: 132 },
    ]);
    expect(series.forecastMedianData).toEqual([
      { time: '2024-01-03', value: 135 },
      { time: '2024-01-04', value: 145 },
      { time: '2024-01-05', value: 155 },
    ]);
    expect(series.stochasticTraceData[0]).toEqual([
      { time: '2024-01-01', value: 110 },
      { time: '2024-01-02', value: 125 },
      { time: '2024-01-04', value: 148 },
      { time: '2024-01-05', value: 132 },
    ]);
  });

  it('suppresses forecast and stochastic traces during playback', () => {
    const series = buildChartSeriesData(rows, 2, true, true, 2);

    expect(series.isInPlayback).toBe(true);
    expect(series.candleData.map(point => point.time)).toEqual(['2024-01-01', '2024-01-02']);
    expect(series.forecastData).toEqual([]);
    expect(series.stochasticTraceData).toEqual([[], []]);
    expect(series.modelLineData).toEqual([
      { time: '2024-01-01', value: 105 },
      { time: '2024-01-02', value: 115 },
    ]);
  });

  it('builds probability markers with stable labels', () => {
    expect(buildProbabilityMarker(rows.filter(row => row.isForecast), {
      horizonDays: 180,
      probabilityUp: 0.615,
      median: 155400,
      q10: 94000,
      q90: 221000,
      calibrationLabel: 'Conservative',
    })).toEqual([{
      time: '2024-01-05',
      position: 'aboveBar',
      color: '#34d399',
      shape: 'circle',
      text: 'Conservative · 62% up · median $155k · $94k-$221k',
    }]);
  });

  it('keeps MVRV colors and time-range windows stable', () => {
    expect(mvrvZScoreColor(7)).toBe('rgba(239,68,68,0.9)');
    expect(mvrvZScoreColor(3.5)).toBe('rgba(251,191,36,0.9)');
    expect(mvrvZScoreColor(2)).toBe('rgba(200,200,200,0.75)');
    expect(mvrvZScoreColor(0)).toBe('rgba(16,185,129,0.7)');
    expect(mvrvZScoreColor(-0.1)).toBe('rgba(16,185,129,0.95)');
    expect(visibleRangeForTimeRange('ALL', rows)).toBeNull();
    expect(visibleRangeForTimeRange('1M', rows)).toEqual({ from: '2024-01-01', to: '2024-01-05' });
  });
});

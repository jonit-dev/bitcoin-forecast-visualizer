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
    powerLawModel: 130,
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
    powerLawModel: 140,
    stochasticTraces: [132, 161],
  },
];

describe('Chart data transforms', () => {
  it('should project deterministic noisy candles around the median, ignoring sampled traces', () => {
    const first = buildChartSeriesData(rows, null, true, false, 2);
    const reshuffled = rows.map(row => row.isForecast ? { ...row, stochasticTraces: [1, 2] } : row);
    const second = buildChartSeriesData(reshuffled, null, true, false, 2);
    const closes = first.forecastData.map(point => point.close);

    expect(second.forecastData).toEqual(first.forecastData);
    expect(closes[0]).toBe(135);
    expect(closes.slice(1)).not.toEqual([145, 155]);
    closes.slice(1).forEach((close, index) => expect(Math.abs(Math.log(close / [145, 155][index]))).toBeLessThan(0.5));
    expect(first.forecastData.slice(1).map(point => point.open)).toEqual(closes.slice(0, 2));
  });

  it('should keep a long projection near the median and above the floor', () => {
    // Two years against a flat 100 median and an 80 floor; trace 0 collapses toward 0.
    const forecast = Array.from({ length: 730 }, (_, day) => ({
      date: new Date(Date.UTC(2024, 0, 4 + day)).toISOString().slice(0, 10),
      isForecast: true,
      close: 100,
      floorPriceModel: 80,
      stochasticTraces: [100 * Math.pow(0.99, day + 1)],
    }));
    const series = buildChartSeriesData([{ ...rows[2], close: 100 }, ...forecast], null, true, false, 1);
    const closes = series.forecastData.map(point => point.close);

    expect(Math.min(...closes)).toBeGreaterThanOrEqual(80);
    expect(closes.at(-1)!).toBeGreaterThan(60); // a candle on trace 0 ends near 0.07
  });

  it('continues the unmodified historical model line through the forecast', () => {
    const series = buildChartSeriesData(rows, null, true, false, 2);

    expect(series.modelLineData.at(-1)).toEqual({ time: '2024-01-03', value: 125 });
    expect(series.modelProjectionData[0]).toEqual(series.modelLineData.at(-1));
  });

  it('normalizes volume against the rolling positive-volume median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([10, 2, 6, 4])).toBe(5);
    expect(relativeVolumeForIndex(rows, 0)).toBeCloseTo(Math.log1p(1));
    expect(relativeVolumeForIndex(rows, 2)).toBeCloseTo(Math.log1p(3000 / 2000));
    expect(relativeVolumeForIndex([{ volume: 0 }], 0)).toBe(0);
  });

  it('should build projected candles, model line and traces', () => {
    const series = buildChartSeriesData(rows, null, true, false, 2);

    expect(series.candleData).toHaveLength(3);
    expect(series.forecastData.map(point => point.time)).toEqual(['2024-01-03', '2024-01-04', '2024-01-05']);
    series.forecastData.forEach(point => {
      expect(point.high).toBeGreaterThanOrEqual(Math.max(point.open, point.close));
      expect(point.low).toBeLessThanOrEqual(Math.min(point.open, point.close));
    });
    expect(series.modelProjectionData).toEqual([
      { time: '2024-01-03', value: 125 },
      { time: '2024-01-04', value: 130 },
      { time: '2024-01-05', value: 140 },
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

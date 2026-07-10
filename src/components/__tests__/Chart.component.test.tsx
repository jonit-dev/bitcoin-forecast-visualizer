import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ForecastChart } from '../Chart';

const seriesMocks: any[] = [];
const chartMocks: any[] = [];
const markerMocks: any[] = [];

vi.mock('lightweight-charts', () => {
  const makeTimeScale = () => ({
    fitContent: vi.fn(),
    setVisibleRange: vi.fn(),
    getVisibleRange: vi.fn(() => ({ from: '2024-01-01', to: '2024-01-05' })),
    subscribeVisibleTimeRangeChange: vi.fn(),
  });

  return {
    ColorType: { Solid: 'solid' },
    CrosshairMode: { Normal: 0 },
    CandlestickSeries: 'CandlestickSeries',
    HistogramSeries: 'HistogramSeries',
    LineSeries: 'LineSeries',
    createSeriesMarkers: vi.fn((_series, markers) => {
      const markerApi = { initialMarkers: markers, setMarkers: vi.fn() };
      markerMocks.push(markerApi);
      return markerApi;
    }),
    createChart: vi.fn((_container, options) => {
      const timeScale = makeTimeScale();
      const chart = {
        options,
        addSeries: vi.fn((seriesType, seriesOptions) => {
          const series = {
            seriesType,
            seriesOptions,
            setData: vi.fn(),
            applyOptions: vi.fn(),
            attachPrimitive: vi.fn(),
            priceToCoordinate: vi.fn((value: number) => value),
          };
          seriesMocks.push(series);
          return series;
        }),
        priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
        timeScale: vi.fn(() => timeScale),
        subscribeCrosshairMove: vi.fn(),
        unsubscribeCrosshairMove: vi.fn(),
        remove: vi.fn(),
      };
      chartMocks.push(chart);
      return chart;
    }),
  };
});

const rows = [
  { date: '2024-01-01', open: 100, high: 120, low: 90, close: 110, volume: 1000, sma20: null, sma50: null, powerLawModel: 105, floorPriceModel: 80, peakPriceModel: 180 },
  { date: '2024-01-02', open: 110, high: 130, low: 105, close: 125, volume: 2000, sma20: 112, sma50: null, powerLawModel: 115, floorPriceModel: 85, peakPriceModel: 190 },
  { date: '2024-01-03', open: 125, high: 140, low: 120, close: 135, volume: 3000, sma20: 120, sma50: 116, powerLawModel: 125, floorPriceModel: 90, peakPriceModel: 200 },
  { date: '2024-01-04', isForecast: true, open: 135, high: 150, low: 130, close: 145, forecastUpper: 170, forecastLower: 120, floorPriceModel: 95, peakPriceModel: 210, stochasticTraces: [148, 151] },
  { date: '2024-01-05', isForecast: true, open: 145, high: 160, low: 140, close: 155, forecastUpper: 180, forecastLower: 125, floorPriceModel: 100, peakPriceModel: 220, stochasticTraces: [132, 161] },
];

function renderChart(overrides = {}) {
  return render(
    <div style={{ width: 800, height: 500 }}>
      <ForecastChart
        data={rows}
        showSMA
        showVolume
        showModelLine
        showScenarios={false}
        showFloorLine
        showPeakLine
        showHeatmap
        heatmapData={[{ date: '2024-01-04', priceLow: 100, priceHigh: 120, density: 0.4 }]}
        showBuyZones
        buyZones={[{ startDate: '2024-01-01', endDate: '2024-01-02', maxScore: 0.8, maxConviction: false }]}
        timeRange="ALL"
        playbackIndex={null}
        mvrvData={[{ date: '2024-01-03', zScore: 1.2, mvrv: 2 }]}
        showMVRV={false}
        showBitcoinOverlays
        showCoreModelLine
        probabilityForecast={{
          horizonDays: 180,
          probabilityUp: 0.6,
          median: 155000,
          q10: 95000,
          q90: 220000,
          calibrationLabel: 'Conservative',
        }}
        {...overrides}
      />
    </div>,
  );
}

afterEach(() => {
  cleanup();
  seriesMocks.length = 0;
  chartMocks.length = 0;
  markerMocks.length = 0;
});

describe('ForecastChart component', () => {
  it('should preserve the jagged yellow forecast as the primary visual', async () => {
    renderChart({ showModelLine: true, showScenarios: false, showCoreModelLine: false });

    await waitFor(() => expect(seriesMocks.length).toBeGreaterThanOrEqual(20));

    // Series 4 owns the trace-based forecast candles. Series 5 is the smooth
    // statistical median, while series 8 is the primary amber scenario trace.
    expect(seriesMocks[4].seriesType).toBe('CandlestickSeries');
    expect(seriesMocks[4].seriesOptions).toEqual({
      upColor: 'rgba(16, 185, 129, 0.5)',
      downColor: 'rgba(239, 68, 68, 0.5)',
      borderVisible: false,
      wickUpColor: 'rgba(16, 185, 129, 0.5)',
      wickDownColor: 'rgba(239, 68, 68, 0.5)',
    });
    expect(seriesMocks[8].seriesType).toBe('LineSeries');
    expect(seriesMocks[8].seriesOptions).toMatchObject({
      color: 'rgba(251, 191, 36, 0.55)',
      lineWidth: 2,
      lineStyle: 0,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
    });
    expect(seriesMocks[8].applyOptions).toHaveBeenLastCalledWith({ visible: true });
    expect(seriesMocks[8].setData).toHaveBeenCalledWith([
      { time: '2024-01-04', value: 148 },
      { time: '2024-01-05', value: 132 },
    ]);
    expect(seriesMocks[9].seriesOptions).toMatchObject({
      color: 'rgba(251, 191, 36, 0.22)',
      lineWidth: 1,
    });
    expect(seriesMocks[9].applyOptions).toHaveBeenLastCalledWith({ visible: false });
    expect(seriesMocks[5].seriesOptions).toMatchObject({
      color: 'rgba(251, 191, 36, 0.95)',
      lineWidth: 3,
    });
    expect(seriesMocks[5].applyOptions).toHaveBeenLastCalledWith({ visible: false });
  });

  it('creates chart series, pushes stable data, and renders the latest legend', async () => {
    const screen = renderChart();

    await waitFor(() => expect(chartMocks.length).toBeGreaterThanOrEqual(2));
    expect(seriesMocks[0].setData).toHaveBeenCalledWith([
      { time: '2024-01-01', open: 100, high: 120, low: 90, close: 110 },
      { time: '2024-01-02', open: 110, high: 130, low: 105, close: 125 },
      { time: '2024-01-03', open: 125, high: 140, low: 120, close: 135 },
    ]);
    expect(markerMocks[0].setMarkers).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ time: '2024-01-03', text: 'Forecast Starts' }),
    ]));
    expect(markerMocks[1].setMarkers).toHaveBeenCalledWith([
      expect.objectContaining({ time: '2024-01-05', text: 'Conservative · 60% up · median $155k · $95k-$220k' }),
    ]);
    expect(screen.getByText('2024-01-03')).toBeTruthy();
    expect(screen.getByText('3,000')).toBeTruthy();
  });

  it('clears forecast markers and forecast data during playback', async () => {
    renderChart({ playbackIndex: 2 });

    await waitFor(() => expect(seriesMocks.length).toBeGreaterThan(0));
    expect(seriesMocks[4].setData).toHaveBeenCalledWith([]);
    expect(markerMocks).toHaveLength(0);
  });
});

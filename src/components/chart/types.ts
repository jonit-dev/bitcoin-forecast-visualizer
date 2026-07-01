import type { ISeriesApi } from 'lightweight-charts';
import type { HeatmapCell } from '../../lib/data';
import type { BuyZoneSpan } from '../../lib/buyZone';

export interface ProbabilityForecastSummary {
  horizonDays: number;
  probabilityUp: number;
  median: number;
  q10: number;
  q90: number;
  calibrationLabel: string;
}

export interface ForecastChartProps {
  data: any[];
  showSMA: boolean;
  showVolume: boolean;
  showModelLine: boolean;
  showScenarios: boolean;
  showFloorLine: boolean;
  showPeakLine: boolean;
  showHeatmap: boolean;
  heatmapData: HeatmapCell[];
  showBuyZones?: boolean;
  buyZones?: BuyZoneSpan[];
  timeRange: string;
  playbackIndex: number | null;
  mvrvData: { date: string; zScore: number; mvrv: number }[];
  showMVRV: boolean;
  showBitcoinOverlays?: boolean;
  showCoreModelLine?: boolean;
  probabilityForecast?: ProbabilityForecastSummary | null;
}

export interface ChartSeriesRefs {
  candlestick?: ISeriesApi<'Candlestick'>;
  volume?: ISeriesApi<'Histogram'>;
  sma20?: ISeriesApi<'Line'>;
  sma50?: ISeriesApi<'Line'>;
  forecast?: ISeriesApi<'Candlestick'>;
  forecastMedian?: ISeriesApi<'Line'>;
  forecastUpper?: ISeriesApi<'Line'>;
  forecastLower?: ISeriesApi<'Line'>;
  stochasticTraces: ISeriesApi<'Line'>[];
  modelLine?: ISeriesApi<'Line'>;
  floorLine?: ISeriesApi<'Line'>;
  peakLine?: ISeriesApi<'Line'>;
}

export interface LegendData {
  time: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  upper?: number;
  lower?: number;
  isForecast: boolean;
}

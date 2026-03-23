import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, ISeriesApi, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

// Bitcoin halving dates — known + dynamically projected every ~4 years
const KNOWN_HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20'];
const HALVING_INTERVAL_MS = 1460 * 86400000; // 1460 days in ms

function generateHalvingDates(untilYear = 2050): { date: string; label: string }[] {
  const result = KNOWN_HALVINGS.map((date, i) => ({ date, label: `H${i + 1}` }));
  let last = new Date(KNOWN_HALVINGS[KNOWN_HALVINGS.length - 1] + 'T00:00:00Z');
  let n = KNOWN_HALVINGS.length + 1;
  while (last.getUTCFullYear() < untilYear) {
    last = new Date(last.getTime() + HALVING_INTERVAL_MS);
    result.push({ date: last.toISOString().split('T')[0], label: `H${n++}` });
  }
  return result;
}

const HALVING_DATES = generateHalvingDates();

// ---- Cycle phase definitions (months after halving) ----
// Based on historical BTC cycle analysis:
//   Accumulation: 0-6 months post-halving (consolidation, low vol)
//   Bull run:     6-12 months (markup begins, breakout)
//   Peak zone:   12-18 months (blow-off top, avg peak ~16 months)
//   Bear market: 18-48 months (markdown/correction until next halving)

const CYCLE_PHASES = [
  { startMonth: 0,  endMonth: 6,  color: 'rgba(96, 165, 250, 0.06)',  label: 'Accumulation' },  // blue
  { startMonth: 6,  endMonth: 12, color: 'rgba(16, 185, 129, 0.06)',  label: 'Bull Run' },       // green
  { startMonth: 12, endMonth: 18, color: 'rgba(251, 191, 36, 0.08)',  label: 'Peak Zone' },      // amber
  { startMonth: 18, endMonth: 48, color: 'rgba(239, 68, 68, 0.05)',   label: 'Bear' },           // red
];

// ---- ATL↔ATH symmetric cycle model (1064d / 364d pattern) ----
// Source: BTC cycle timing shows a repeating 1064-day ATL→ATH run
// followed by a 364-day ATH→ATL correction, then the pattern repeats.
//
//  ATL 2015-01-14 → ATH 2017-12-17 = 1064d
//  ATH 2017-12-17 → ATL 2018-12-15 =  364d
//  ATL 2018-12-15 → ATH 2021-11-10 = 1061d (≈1064)
//  ATH 2021-11-10 → ATL 2022-11-09 =  364d
//  ATL 2022-11-09 → ATH predicted   = 1064d → 2025-10-08

const ATL_TO_ATH_DAYS = 1064;
const ATH_TO_ATL_DAYS = 364;

// Seed: first known ATL in the pattern
const CYCLE_SEED_ATL = '2015-01-14';

interface CyclePivot {
  date: string;
  type: 'ATL' | 'ATH';
  known: boolean; // historical (true) vs projected (false)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// Known historical pivots (exact dates)
const KNOWN_PIVOTS: CyclePivot[] = [
  { date: '2015-01-14', type: 'ATL', known: true },
  { date: '2017-12-17', type: 'ATH', known: true },
  { date: '2018-12-15', type: 'ATL', known: true },
  { date: '2021-11-10', type: 'ATH', known: true },
  { date: '2022-11-09', type: 'ATL', known: true },
];

function generateCyclePivots(untilYear = 2040): CyclePivot[] {
  const pivots = [...KNOWN_PIVOTS];
  // Continue the pattern from the last known pivot
  let last = pivots[pivots.length - 1];
  while (new Date(last.date + 'T00:00:00Z').getUTCFullYear() < untilYear) {
    const nextDays = last.type === 'ATL' ? ATL_TO_ATH_DAYS : ATH_TO_ATL_DAYS;
    const nextType = last.type === 'ATL' ? 'ATH' : 'ATL';
    const nextDate = addDays(last.date, nextDays);
    const pivot: CyclePivot = { date: nextDate, type: nextType, known: false };
    pivots.push(pivot);
    last = pivot;
  }
  return pivots;
}

const CYCLE_PIVOTS = generateCyclePivots();

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().split('T')[0];
}

// ---- Lightweight-charts primitive: halving lines + cycle phase shading ----

class HalvingCycleRenderer {
  private _dates: { date: string; label: string }[];
  private _chart: any;

  constructor(dates: { date: string; label: string }[], chart: any) {
    this._dates = dates;
    this._chart = chart;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (!this._chart) return;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const timeScale = this._chart.timeScale();
      const w = mediaSize.width;
      const h = mediaSize.height;

      // --- Draw cycle phase shading behind everything ---
      for (const { date } of this._dates) {
        for (const phase of CYCLE_PHASES) {
          const startDate = addMonths(date, phase.startMonth);
          const endDate = addMonths(date, phase.endMonth);
          const x0 = timeScale.timeToCoordinate(startDate as any);
          const x1 = timeScale.timeToCoordinate(endDate as any);
          if (x0 === null || x1 === null) continue;
          const left = Math.max(0, Math.min(x0, x1));
          const right = Math.min(w, Math.max(x0, x1));
          if (right <= 0 || left >= w) continue;

          context.fillStyle = phase.color;
          context.fillRect(left, 0, right - left, h);

          // Phase label at top (only if wide enough)
          if (right - left > 40) {
            context.font = '8px sans-serif';
            context.fillStyle = phase.startMonth === 12
              ? 'rgba(251, 191, 36, 0.45)'
              : phase.startMonth === 18
                ? 'rgba(239, 68, 68, 0.35)'
                : phase.startMonth === 6
                  ? 'rgba(16, 185, 129, 0.35)'
                  : 'rgba(96, 165, 250, 0.35)';
            context.fillText(phase.label, left + 4, h - 6);
          }
        }
      }

      // --- Draw halving vertical lines ---
      for (const { date, label } of this._dates) {
        const x = timeScale.timeToCoordinate(date as any);
        if (x === null || x < 0 || x > w) continue;

        // Solid vertical line (more visible)
        context.beginPath();
        context.strokeStyle = 'rgba(251, 191, 36, 0.55)';
        context.lineWidth = 1.5;
        context.setLineDash([6, 3]);
        context.moveTo(x, 0);
        context.lineTo(x, h);
        context.stroke();
        context.setLineDash([]);

        // Label with background pill
        const text = label;
        context.font = 'bold 10px monospace';
        const tm = context.measureText(text);
        const pad = 4;
        const lx = x + 5;
        const ly = 6;
        context.fillStyle = 'rgba(251, 191, 36, 0.15)';
        context.beginPath();
        context.roundRect(lx - pad, ly - 1, tm.width + pad * 2, 14, 3);
        context.fill();
        context.fillStyle = 'rgba(251, 191, 36, 0.85)';
        context.fillText(text, lx, ly + 10);
      }

      // --- Draw ATL↔ATH cycle pivot markers (1064d / 364d pattern) ---
      for (const pivot of CYCLE_PIVOTS) {
        const px = timeScale.timeToCoordinate(pivot.date as any);
        if (px === null || px < 0 || px > w) continue;

        const isATH = pivot.type === 'ATH';
        const lineColor = isATH
          ? (pivot.known ? 'rgba(239, 68, 68, 0.65)' : 'rgba(239, 68, 68, 0.45)')
          : (pivot.known ? 'rgba(16, 185, 129, 0.50)' : 'rgba(16, 185, 129, 0.35)');

        // Vertical line
        context.beginPath();
        context.strokeStyle = lineColor;
        context.lineWidth = pivot.known ? 1.5 : 1;
        context.setLineDash(pivot.known ? [] : [3, 4]);
        context.moveTo(px, 0);
        context.lineTo(px, h);
        context.stroke();
        context.setLineDash([]);

        // Diamond marker
        const dy = isATH ? 28 : h - 28;
        context.beginPath();
        context.moveTo(px, dy - 5);
        context.lineTo(px + 5, dy);
        context.lineTo(px, dy + 5);
        context.lineTo(px - 5, dy);
        context.closePath();
        context.fillStyle = isATH
          ? (pivot.known ? 'rgba(239, 68, 68, 0.9)' : 'rgba(239, 68, 68, 0.6)')
          : (pivot.known ? 'rgba(16, 185, 129, 0.9)' : 'rgba(16, 185, 129, 0.6)');
        context.fill();

        // Label
        const prefix = pivot.known ? '' : '~';
        const pivotLabel = `${pivot.type} ${prefix}${pivot.date.slice(0, 10)}`;
        context.font = 'bold 9px monospace';
        const ptm = context.measureText(pivotLabel);
        const plx = px - ptm.width / 2;
        const ply = isATH ? 36 : h - 44;
        const pillColor = isATH ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)';
        const textColor = isATH
          ? (pivot.known ? 'rgba(239, 68, 68, 0.9)' : 'rgba(239, 68, 68, 0.7)')
          : (pivot.known ? 'rgba(16, 185, 129, 0.9)' : 'rgba(16, 185, 129, 0.7)');
        context.fillStyle = pillColor;
        context.beginPath();
        context.roundRect(plx - 3, ply, ptm.width + 6, 13, 3);
        context.fill();
        context.fillStyle = textColor;
        context.fillText(pivotLabel, plx, ply + 10);
      }
    });
  }
}

class HalvingCyclePaneView {
  private _renderer: HalvingCycleRenderer;

  constructor(dates: { date: string; label: string }[], chart: any) {
    this._renderer = new HalvingCycleRenderer(dates, chart);
  }

  zOrder() { return 'bottom' as const; }

  renderer() { return this._renderer; }
}

class HalvingCyclePrimitive {
  private _dates: { date: string; label: string }[];
  private _chart: any = null;
  private _paneViews: HalvingCyclePaneView[] = [];

  constructor(dates: { date: string; label: string }[]) {
    this._dates = dates;
  }

  updateAllViews() {
    this._paneViews = [new HalvingCyclePaneView(this._dates, this._chart)];
  }

  paneViews() { return this._paneViews; }

  attached(param: any) {
    this._chart = param.chart;
    this.updateAllViews();
  }

  detached() {
    this._chart = null;
    this._paneViews = [];
  }
}

// ---- Probability heatmap primitive (Monte Carlo density) ----

import type { HeatmapCell } from '../lib/data';

// Heatmap rendering cache
let _heatmapOffscreen: HTMLCanvasElement | null = null;
let _heatmapCacheKey = '';

// Pre-computed color LUT (256 entries) to avoid per-cell string building
const _colorLUT: string[] = (() => {
  const lut: string[] = new Array(256);
  lut[0] = 'rgba(0,0,0,0)';
  for (let i = 1; i < 256; i++) {
    const d = i / 255;
    const r = (50 * (1 - d) + 15 * d) | 0;
    const g = (15 * (1 - d) + 200 * d) | 0;
    const b = (160 * (1 - d) + 70 * d) | 0;
    const a = (0.05 + d * 0.22).toFixed(3);
    lut[i] = `rgba(${r},${g},${b},${a})`;
  }
  return lut;
})();

function densityToColor(d: number): string {
  return _colorLUT[Math.min(255, Math.max(0, (d * 255) | 0))];
}

class HeatmapRenderer {
  private _cells: HeatmapCell[];
  private _chart: any;
  private _series: any;
  private _cellsId: number;

  constructor(cells: HeatmapCell[], chart: any, series: any, cellsId: number) {
    this._cells = cells;
    this._chart = chart;
    this._series = series;
    this._cellsId = cellsId;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (!this._chart || !this._series || this._cells.length === 0) return;

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const timeScale = this._chart.timeScale();
      const w = Math.ceil(mediaSize.width);
      const h = Math.ceil(mediaSize.height);

      // Build x-coordinate map for unique dates
      const dateXMap = new Map<string, number>();
      const uniqueDates: string[] = [];
      for (const cell of this._cells) {
        if (!dateXMap.has(cell.date)) {
          const x = timeScale.timeToCoordinate(cell.date as any);
          if (x !== null) {
            dateXMap.set(cell.date, x);
            uniqueDates.push(cell.date);
          }
        }
      }
      if (uniqueDates.length < 2) return;

      const x0 = dateXMap.get(uniqueDates[0])!;
      const x1 = dateXMap.get(uniqueDates[1])!;
      const barWidth = Math.max(Math.abs(x1 - x0), 2);

      // Check viewport cache — skip re-render if nothing moved
      const refY = this._series.priceToCoordinate(this._cells[0].priceLow);
      const cacheKey = `${this._cellsId}:${w}:${h}:${x0.toFixed(1)}:${x1.toFixed(1)}:${refY?.toFixed(1)}`;

      if (cacheKey === _heatmapCacheKey && _heatmapOffscreen) {
        // Reuse cached offscreen — just composite
        context.save();
        context.filter = 'blur(6px)';
        context.drawImage(_heatmapOffscreen, 0, 0);
        context.restore();
        context.save();
        context.globalAlpha = 0.12;
        context.drawImage(_heatmapOffscreen, 0, 0);
        context.restore();
        return;
      }

      // Render cells to offscreen canvas
      if (!_heatmapOffscreen) _heatmapOffscreen = document.createElement('canvas');
      if (_heatmapOffscreen.width !== w || _heatmapOffscreen.height !== h) {
        _heatmapOffscreen.width = w;
        _heatmapOffscreen.height = h;
      }
      const offCtx = _heatmapOffscreen.getContext('2d')!;
      offCtx.clearRect(0, 0, w, h);

      for (const cell of this._cells) {
        const x = dateXMap.get(cell.date);
        if (x === undefined || x < -barWidth * 2 || x > w + barWidth * 2) continue;

        const yHigh = this._series.priceToCoordinate(cell.priceHigh);
        const yLow = this._series.priceToCoordinate(cell.priceLow);
        if (yHigh === null || yLow === null) continue;

        const cellY = Math.min(yHigh, yLow);
        const cellH = Math.max(Math.abs(yLow - yHigh), 1);

        offCtx.fillStyle = densityToColor(cell.density);
        offCtx.fillRect(x - barWidth / 2 - 1, cellY - 1, barWidth + 2, cellH + 2);
      }

      _heatmapCacheKey = cacheKey;

      // Composite: blurred base + subtle crisp overlay
      context.save();
      context.filter = 'blur(6px)';
      context.drawImage(_heatmapOffscreen, 0, 0);
      context.restore();
      context.save();
      context.globalAlpha = 0.12;
      context.drawImage(_heatmapOffscreen, 0, 0);
      context.restore();
    });
  }
}

class HeatmapPaneView {
  private _renderer: HeatmapRenderer;

  constructor(cells: HeatmapCell[], chart: any, series: any, cellsId: number) {
    this._renderer = new HeatmapRenderer(cells, chart, series, cellsId);
  }

  zOrder() { return 'bottom' as const; }
  renderer() { return this._renderer; }
}

class HeatmapPrimitive {
  private _cells: HeatmapCell[] = [];
  private _chart: any = null;
  private _series: any = null;
  private _requestUpdate: (() => void) | null = null;
  private _paneViews: HeatmapPaneView[] = [];
  private _cellsId = 0;

  setCells(cells: HeatmapCell[]) {
    this._cells = cells;
    this._cellsId++;
    this._updateViews();
    this._requestUpdate?.();
  }

  private _updateViews() {
    this._paneViews = [new HeatmapPaneView(this._cells, this._chart, this._series, this._cellsId)];
  }

  updateAllViews() { this._updateViews(); }
  paneViews() { return this._paneViews; }

  attached(param: any) {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    this._updateViews();
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._paneViews = [];
  }
}

// ---- Chart component ----

interface ForecastChartProps {
  data: any[];
  showSMA: boolean;
  showVolume: boolean;
  showModelLine: boolean;
  showHeatmap: boolean;
  heatmapData: HeatmapCell[];
  timeRange: string;
  playbackIndex: number | null;
}

export const ForecastChart = React.memo(function ForecastChart({ data, showSMA, showVolume, showModelLine, showHeatmap, heatmapData, timeRange, playbackIndex }: ForecastChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRefs = useRef<{
    candlestick?: ISeriesApi<"Candlestick">;
    volume?: ISeriesApi<"Histogram">;
    sma20?: ISeriesApi<"Line">;
    sma50?: ISeriesApi<"Line">;
    forecast?: ISeriesApi<"Candlestick">;
    forecastUpper?: ISeriesApi<"Line">;
    forecastLower?: ISeriesApi<"Line">;
    modelLine?: ISeriesApi<"Line">;
  }>({});
  const markersRef = useRef<any>(null);
  const heatmapPrimRef = useRef<HeatmapPrimitive | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#a1a1aa',
      },
      grid: {
        vertLines: { color: '#27272a', style: 1 },
        horzLines: { color: '#27272a', style: 1 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: '#52525b',
        mode: 1, // logarithmic
        autoScale: true,
      },
      timeScale: {
        borderColor: '#52525b',
        timeVisible: false,
        rightOffset: 12,
        barSpacing: 3,
      },
      autoSize: true,
    });

    chartRef.current = chart;

    // Candlestick Series
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    seriesRefs.current.candlestick = candlestickSeries;

    // Attach halving-cycle vertical lines + phase shading primitive
    const halvingPrimitive = new HalvingCyclePrimitive(HALVING_DATES);
    candlestickSeries.attachPrimitive(halvingPrimitive as any);

    // Attach probability heatmap primitive
    const heatmapPrimitive = new HeatmapPrimitive();
    candlestickSeries.attachPrimitive(heatmapPrimitive as any);
    heatmapPrimRef.current = heatmapPrimitive;

    // Volume Series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: '', // set as an overlay
    });
    chart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });
    seriesRefs.current.volume = volumeSeries;

    // SMA Series
    const sma20Series = chart.addSeries(LineSeries, { color: '#60a5fa', lineWidth: 2 });
    const sma50Series = chart.addSeries(LineSeries, { color: '#c084fc', lineWidth: 2 });
    seriesRefs.current.sma20 = sma20Series;
    seriesRefs.current.sma50 = sma50Series;

    // Forecast Series
    const forecastSeries = chart.addSeries(CandlestickSeries, {
      upColor: 'rgba(16, 185, 129, 0.5)',
      downColor: 'rgba(239, 68, 68, 0.5)',
      borderVisible: false,
      wickUpColor: 'rgba(16, 185, 129, 0.5)',
      wickDownColor: 'rgba(239, 68, 68, 0.5)',
    });
    seriesRefs.current.forecast = forecastSeries;

    const forecastUpperSeries = chart.addSeries(LineSeries, {
      color: 'rgba(16, 185, 129, 0.5)',
      lineWidth: 1,
      lineStyle: 3, // Dotted
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    seriesRefs.current.forecastUpper = forecastUpperSeries;

    const forecastLowerSeries = chart.addSeries(LineSeries, {
      color: 'rgba(16, 185, 129, 0.5)',
      lineWidth: 1,
      lineStyle: 3, // Dotted
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    seriesRefs.current.forecastLower = forecastLowerSeries;

    // Power Law Model Line
    const modelLineSeries = chart.addSeries(LineSeries, {
      color: 'rgba(251, 191, 36, 0.8)', // amber
      lineWidth: 1,
      lineStyle: 0,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
    });
    seriesRefs.current.modelLine = modelLineSeries;

    return () => {
      chart.remove();
    };
  }, []);

  const [legendData, setLegendData] = React.useState<any>(null);

  // Update series data (runs each playback tick)
  useEffect(() => {
    if (!data || data.length === 0 || !chartRef.current) return;

    const isInPlayback = playbackIndex !== null;
    const allHistorical = data.filter((d: any) => !d.isForecast);
    const allForecast = data.filter((d: any) => d.isForecast);
    const historical = isInPlayback ? allHistorical.slice(0, playbackIndex) : allHistorical;
    const forecast = isInPlayback ? [] : allForecast;

    const candleData = historical.map((d: any) => ({ time: d.date, open: d.open, high: d.high, low: d.low, close: d.close }));
    const volumeData = historical.map((d: any) => ({ time: d.date, value: d.volume, color: d.close >= d.open ? '#10b98140' : '#ef444440' }));
    const sma20Data = historical.filter((d: any) => d.sma20 !== null).map((d: any) => ({ time: d.date, value: d.sma20 }));
    const sma50Data = historical.filter((d: any) => d.sma50 !== null).map((d: any) => ({ time: d.date, value: d.sma50 }));

    const lastHist = historical[historical.length - 1];
    const forecastData = lastHist && forecast.length > 0 ? [
      { time: lastHist.date, open: lastHist.close, high: lastHist.close, low: lastHist.close, close: lastHist.close },
      ...forecast.map((d: any) => ({ time: d.date, open: d.open, high: d.high, low: d.low, close: d.close }))
    ] : [];
    const forecastUpperData = lastHist && forecast.length > 0 ? [{ time: lastHist.date, value: lastHist.close }, ...forecast.map((d: any) => ({ time: d.date, value: d.forecastUpper }))] : [];
    const forecastLowerData = lastHist && forecast.length > 0 ? [{ time: lastHist.date, value: lastHist.close }, ...forecast.map((d: any) => ({ time: d.date, value: d.forecastLower }))] : [];

    const sortByTime = (a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime();

    // Model line builds up with historical candles during playback
    const modelLineData = historical
      .filter((d: any) => d.powerLawModel != null && d.powerLawModel > 0)
      .map((d: any) => ({ time: d.date, value: d.powerLawModel }));

    seriesRefs.current.candlestick?.setData(candleData.sort(sortByTime));
    seriesRefs.current.volume?.setData(volumeData.sort(sortByTime));
    seriesRefs.current.sma20?.setData(sma20Data.sort(sortByTime));
    seriesRefs.current.sma50?.setData(sma50Data.sort(sortByTime));
    seriesRefs.current.forecast?.setData(forecastData.sort(sortByTime));
    seriesRefs.current.forecastUpper?.setData(forecastUpperData.sort(sortByTime));
    seriesRefs.current.forecastLower?.setData(forecastLowerData.sort(sortByTime));
    seriesRefs.current.modelLine?.setData(modelLineData.sort(sortByTime));

    if (lastHist) {
      setLegendData({
        time: lastHist.date,
        open: lastHist.open,
        high: lastHist.high,
        low: lastHist.low,
        close: lastHist.close,
        volume: lastHist.volume,
        isForecast: false,
      });
    }

    // Marker: only show when not in playback
    if (!isInPlayback && lastHist && seriesRefs.current.candlestick) {
      if (!markersRef.current) {
        markersRef.current = createSeriesMarkers(seriesRefs.current.candlestick, []);
      }
      markersRef.current.setMarkers([{
        time: lastHist.date,
        position: 'aboveBar',
        color: '#10b981',
        shape: 'arrowDown',
        text: 'Forecast Starts',
      }]);
    } else if (isInPlayback && markersRef.current) {
      markersRef.current.setMarkers([]);
    }
  }, [data, playbackIndex]);

  // Crosshair subscription (only re-subscribes when data changes, not every playback tick)
  useEffect(() => {
    if (!data || data.length === 0 || !chartRef.current) return;
    const chart = chartRef.current;
    const lastHist = data.filter((d: any) => !d.isForecast).slice(-1)[0];

    const handleCrosshairMove = (param: any) => {
      if (!param.time || param.point.x < 0 || param.point.y < 0) {
        if (lastHist) {
          setLegendData({
            time: lastHist.date,
            open: lastHist.open,
            high: lastHist.high,
            low: lastHist.low,
            close: lastHist.close,
            volume: lastHist.volume,
            isForecast: false,
          });
        }
        return;
      }

      const candleSeries = seriesRefs.current.candlestick;
      const forecastSeries = seriesRefs.current.forecast;

      if (candleSeries) {
        const candlePoint = param.seriesData.get(candleSeries);
        const forecastPoint = forecastSeries ? param.seriesData.get(forecastSeries) : null;

        if (candlePoint) {
          const volData = seriesRefs.current.volume ? param.seriesData.get(seriesRefs.current.volume) : null;
          setLegendData({
            time: param.time,
            open: candlePoint.open,
            high: candlePoint.high,
            low: candlePoint.low,
            close: candlePoint.close,
            volume: volData ? volData.value : undefined,
            isForecast: false,
          });
        } else if (forecastPoint) {
          const upperData = seriesRefs.current.forecastUpper ? param.seriesData.get(seriesRefs.current.forecastUpper) : null;
          const lowerData = seriesRefs.current.forecastLower ? param.seriesData.get(seriesRefs.current.forecastLower) : null;
          setLegendData({
            time: param.time,
            open: forecastPoint.open,
            high: forecastPoint.high,
            low: forecastPoint.low,
            close: forecastPoint.close,
            upper: upperData ? upperData.value : undefined,
            lower: lowerData ? lowerData.value : undefined,
            isForecast: true,
          });
        }
      }
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => { chart.unsubscribeCrosshairMove(handleCrosshairMove); };
  }, [data]);

  // Handle visibility toggles
  useEffect(() => {
    if (!chartRef.current) return;
    seriesRefs.current.sma20?.applyOptions({ visible: showSMA });
    seriesRefs.current.sma50?.applyOptions({ visible: showSMA });
    seriesRefs.current.volume?.applyOptions({ visible: showVolume });
    seriesRefs.current.modelLine?.applyOptions({ visible: showModelLine });
  }, [showSMA, showVolume, showModelLine]);

  // Update probability heatmap
  useEffect(() => {
    if (!heatmapPrimRef.current) return;
    const visible = showHeatmap && playbackIndex === null;
    heatmapPrimRef.current.setCells(visible ? heatmapData : []);
  }, [heatmapData, showHeatmap, playbackIndex]);

  // Handle time range — only reacts to explicit timeRange button clicks, not data changes
  const prevTimeRange = useRef(timeRange);
  const initialFitDone = useRef(false);

  useEffect(() => {
    if (!chartRef.current || !data || data.length === 0) return;
    if (playbackIndex !== null) return;

    const isTimeRangeChange = prevTimeRange.current !== timeRange;
    prevTimeRange.current = timeRange;

    // Only fit on first load or explicit time range change
    if (!isTimeRangeChange && initialFitDone.current) return;
    initialFitDone.current = true;

    const chart = chartRef.current;

    if (timeRange === 'ALL') {
      chart.timeScale().fitContent();
    } else {
      const forecastCount = data.filter((d: any) => d.isForecast).length;
      const historyCount = data.length - forecastCount;
      let startIdx = 0;

      if (timeRange === '1M') startIdx = Math.max(0, historyCount - 30);
      else if (timeRange === '3M') startIdx = Math.max(0, historyCount - 90);
      else if (timeRange === '6M') startIdx = Math.max(0, historyCount - 180);
      else if (timeRange === '1Y') startIdx = Math.max(0, historyCount - 365);

      const startData = data[startIdx];
      const endData = data[data.length - 1];

      if (startData && endData) {
        chart.timeScale().setVisibleRange({
          from: startData.date,
          to: endData.date,
        });
      }
    }
  }, [timeRange, data, playbackIndex]);

  return (
    <div className="w-full h-full min-h-[350px] relative">
      <div ref={chartContainerRef} className="absolute inset-0" />

      {legendData && (
        <div className="absolute top-3 left-3 z-10 pointer-events-none flex flex-wrap gap-x-3 gap-y-1 text-[10px] md:text-xs font-mono bg-zinc-950/50 backdrop-blur-sm p-1.5 rounded border border-white/5">
          <div className="text-zinc-300 font-sans font-medium mr-1">{legendData.time}</div>

          {legendData.isForecast && (
            <div className="bg-emerald-500/20 text-emerald-400 px-1.5 rounded text-[9px] uppercase tracking-wider font-sans font-semibold flex items-center">
              Forecast
            </div>
          )}

          {legendData.open !== undefined && (
            <div className="flex gap-1">
              <span className="text-zinc-500">O</span>
              <span className={legendData.close >= legendData.open ? "text-emerald-400" : "text-red-400"}>
                {legendData.open?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </span>
            </div>
          )}
          {legendData.high !== undefined && (
            <div className="flex gap-1">
              <span className="text-zinc-500">H</span>
              <span className={legendData.close >= legendData.open ? "text-emerald-400" : "text-red-400"}>
                {legendData.high?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </span>
            </div>
          )}
          {legendData.low !== undefined && (
            <div className="flex gap-1">
              <span className="text-zinc-500">L</span>
              <span className={legendData.close >= legendData.open ? "text-emerald-400" : "text-red-400"}>
                {legendData.low?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </span>
            </div>
          )}
          {legendData.close !== undefined && (
            <div className="flex gap-1">
              <span className="text-zinc-500">C</span>
              <span className={legendData.close >= legendData.open ? "text-emerald-400" : "text-red-400"}>
                {legendData.close?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </span>
            </div>
          )}
          {legendData.upper !== undefined && (
            <div className="flex gap-1 ml-2">
              <span className="text-zinc-500">Upper</span>
              <span className="text-emerald-400/70">
                {legendData.upper?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </span>
            </div>
          )}
          {legendData.lower !== undefined && (
            <div className="flex gap-1">
              <span className="text-zinc-500">Lower</span>
              <span className="text-emerald-400/70">
                {legendData.lower?.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </span>
            </div>
          )}
          {legendData.volume !== undefined && (
            <div className="flex gap-1 ml-2">
              <span className="text-zinc-500">Vol</span>
              <span className="text-zinc-300">
                {legendData.volume?.toLocaleString(undefined, {maximumFractionDigits: 0})}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, ISeriesApi, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import { cn } from '../lib/utils';
import { CYCLE_PIVOTS, PHASE_ZONES, type PhaseLabel } from '../lib/cycle';
import type { BuyZoneSpan } from '../lib/buyZone';
import type { TradingSystemMarker } from '../lib/tradingSystem';

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

// ---- Cycle phase definitions (anchored to ATL/ATH pivots) ----
// Phases are driven by the market cycle bottoms and tops:
//   Accumulation: ATL → ATL + 6 months (bottom consolidation)
//   Bull:         ATL + 6 months → ATH - 30 days (markup / run-up)
//   Trim:         ATH - 30 days → ATH (late-cycle take-profit window)
//   Bear:         ATH → next ATL (markdown / correction)

const PHASE_STYLES = {
  Accumulation: { color: 'rgba(96, 165, 250, 0.06)',  textColor: 'rgba(96, 165, 250, 0.7)',  pillColor: 'rgba(96, 165, 250, 0.10)' },
  Bull:         { color: 'rgba(16, 185, 129, 0.06)',  textColor: 'rgba(16, 185, 129, 0.7)',  pillColor: 'rgba(16, 185, 129, 0.10)' },
  Trim:         { color: 'rgba(251, 191, 36, 0.08)',  textColor: 'rgba(251, 191, 36, 0.7)',  pillColor: 'rgba(251, 191, 36, 0.10)' },
  Bear:         { color: 'rgba(239, 68, 68, 0.05)',   textColor: 'rgba(239, 68, 68, 0.6)',   pillColor: 'rgba(239, 68, 68, 0.08)' },
};

const getPhaseStyle = (label: PhaseLabel) => PHASE_STYLES[label];

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

      // --- Draw cycle phase shading (anchored to ATL/ATH pivots) ---
      for (const zone of PHASE_ZONES) {
        const style = getPhaseStyle(zone.label);
        const x0 = timeScale.timeToCoordinate(zone.startDate as any);
        const x1 = timeScale.timeToCoordinate(zone.endDate as any);
        if (x0 === null || x1 === null) continue;
        const left = Math.max(0, Math.floor(Math.min(x0, x1)) - 1);
        const right = Math.min(w, Math.ceil(Math.max(x0, x1)) + 1);
        if (right <= 0 || left >= w) continue;

        context.fillStyle = style.color;
        context.fillRect(left, 0, right - left, h);

        // Phase label centered at top of zone
        const phaseText = `Phase: ${zone.label}`;
        context.font = 'bold 10px sans-serif';
        const tm = context.measureText(phaseText);
        if (right - left > tm.width + 16) {
          const cx = left + (right - left) / 2;
          const ly = 22;
          const pad = 6;
          context.fillStyle = style.pillColor;
          context.beginPath();
          context.roundRect(cx - tm.width / 2 - pad, ly - 11, tm.width + pad * 2, 16, 4);
          context.fill();
          context.fillStyle = style.textColor;
          context.textAlign = 'center';
          context.fillText(phaseText, cx, ly);
          context.textAlign = 'left';
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

// ---- Buy-zone primitive: leakage-safe heavy-buy shading from backtested flow score ----

class BuyZoneRenderer {
  private _chart: any;
  private _zones: BuyZoneSpan[];

  constructor(chart: any, zones: BuyZoneSpan[]) {
    this._chart = chart;
    this._zones = zones;
  }

  update(chart: any, zones: BuyZoneSpan[]) {
    this._chart = chart;
    this._zones = zones;
  }

  draw(target: CanvasRenderingTarget2D): void {
    if (!this._chart || this._zones.length === 0) return;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const timeScale = this._chart.timeScale();
      const w = mediaSize.width;
      const h = mediaSize.height;

      for (const zone of this._zones) {
        const x0 = timeScale.timeToCoordinate(zone.startDate as any);
        const x1 = timeScale.timeToCoordinate(zone.endDate as any);
        if (x0 === null || x1 === null) continue;
        const left = Math.max(0, Math.floor(Math.min(x0, x1)) - 1);
        const right = Math.min(w, Math.ceil(Math.max(x0, x1)) + 1);
        if (right <= 0 || left >= w) continue;

        const intensity = Math.min(1, Math.max(0, (zone.maxScore - 0.70) / 0.12));
        const alpha = zone.maxConviction ? 0.18 : 0.10 + intensity * 0.06;
        context.fillStyle = `rgba(34, 197, 94, ${alpha})`;
        context.fillRect(left, 0, right - left, h);

        context.strokeStyle = zone.maxConviction ? 'rgba(74, 222, 128, 0.48)' : 'rgba(34, 197, 94, 0.30)';
        context.lineWidth = zone.maxConviction ? 1.5 : 1;
        context.setLineDash(zone.maxConviction ? [] : [3, 3]);
        context.beginPath();
        context.moveTo(left + 0.5, 0);
        context.lineTo(left + 0.5, h);
        context.moveTo(right - 0.5, 0);
        context.lineTo(right - 0.5, h);
        context.stroke();
        context.setLineDash([]);

        const label = zone.maxConviction ? 'MAX BUY' : 'HEAVY BUY';
        context.font = 'bold 10px sans-serif';
        const tm = context.measureText(label);
        if (right - left > tm.width + 16) {
          const cx = left + (right - left) / 2;
          const ly = Math.max(46, Math.min(h - 20, h * 0.18));
          context.fillStyle = zone.maxConviction ? 'rgba(22, 101, 52, 0.70)' : 'rgba(20, 83, 45, 0.55)';
          context.beginPath();
          context.roundRect(cx - tm.width / 2 - 6, ly - 11, tm.width + 12, 16, 4);
          context.fill();
          context.fillStyle = zone.maxConviction ? 'rgba(187, 247, 208, 0.95)' : 'rgba(134, 239, 172, 0.86)';
          context.textAlign = 'center';
          context.fillText(label, cx, ly);
          context.textAlign = 'left';
        }
      }
    });
  }
}

class BuyZonePaneView {
  private _renderer: BuyZoneRenderer;

  constructor(renderer: BuyZoneRenderer) {
    this._renderer = renderer;
  }

  zOrder() { return 'bottom' as const; }

  renderer() { return this._renderer; }
}

class BuyZonePrimitive {
  private _chart: any = null;
  private _zones: BuyZoneSpan[] = [];
  private _renderer = new BuyZoneRenderer(null, []);
  private _paneViews: BuyZonePaneView[] = [new BuyZonePaneView(this._renderer)];
  private _requestUpdate?: () => void;

  setZones(zones: BuyZoneSpan[]) {
    this._zones = zones;
    this._renderer.update(this._chart, zones);
    this._requestUpdate?.();
  }

  updateAllViews() {
    this._renderer.update(this._chart, this._zones);
    this._paneViews = [new BuyZonePaneView(this._renderer)];
  }

  paneViews() { return this._paneViews; }

  attached(param: any) {
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate;
    this.updateAllViews();
  }

  detached() {
    this._chart = null;
    this._requestUpdate = undefined;
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

// ---- MVRV Z-Score indicator pane primitive ----

const MVRV_ZONES = [
  { min: 7,   max: 15,  fill: 'rgba(239,68,68,0.10)',   label: 'Extreme',    labelColor: 'rgba(239,68,68,0.65)' },
  { min: 3.5, max: 7,   fill: 'rgba(251,191,36,0.08)',  label: 'Overvalued', labelColor: 'rgba(251,191,36,0.55)' },
  { min: 2,   max: 3.5, fill: 'rgba(250,250,250,0.03)', label: '',           labelColor: '' },
  { min: 0,   max: 2,   fill: 'rgba(16,185,129,0.05)',  label: 'Undervalued',labelColor: 'rgba(16,185,129,0.55)' },
  { min: -5,  max: 0,   fill: 'rgba(16,185,129,0.12)',  label: 'Deep Value', labelColor: 'rgba(16,185,129,0.70)' },
];

const MVRV_REF_LINES = [
  { value: 7,   color: 'rgba(239,68,68,0.55)',   text: '7' },
  { value: 3.5, color: 'rgba(251,191,36,0.50)',  text: '3.5' },
  { value: 0,   color: 'rgba(16,185,129,0.55)',  text: '0' },
];

class MVRVZoneRenderer {
  private _series: any;
  constructor(series: any) { this._series = series; }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const w = mediaSize.width;
      const h = mediaSize.height;

      for (const zone of MVRV_ZONES) {
        const yTop = this._series.priceToCoordinate(zone.max);
        const yBot = this._series.priceToCoordinate(zone.min);
        if (yTop === null || yBot === null) continue;
        const top = Math.max(0, Math.min(yTop, yBot));
        const bot = Math.min(h, Math.max(yTop, yBot));
        if (bot <= top) continue;
        context.fillStyle = zone.fill;
        context.fillRect(0, top, w, bot - top);
        if (zone.label) {
          context.font = 'bold 9px sans-serif';
          context.fillStyle = zone.labelColor;
          context.textAlign = 'left';
          context.fillText(zone.label, 6, top + 11);
        }
      }

      for (const ref of MVRV_REF_LINES) {
        const y = this._series.priceToCoordinate(ref.value);
        if (y === null || y < 0 || y > h) continue;
        context.beginPath();
        context.strokeStyle = ref.color;
        context.lineWidth = 0.75;
        context.setLineDash([3, 3]);
        context.moveTo(0, y);
        context.lineTo(w, y);
        context.stroke();
        context.setLineDash([]);
        context.font = '9px monospace';
        context.fillStyle = ref.color;
        context.textAlign = 'right';
        context.fillText(ref.text, w - 4, y - 3);
      }

      // "MVRV Z-Score" label top-left
      context.font = 'bold 9px sans-serif';
      context.fillStyle = 'rgba(161,161,170,0.7)';
      context.textAlign = 'left';
      context.fillText('MVRV Z-Score', 6, h - 6);
    });
  }
}

class MVRVZonePaneView {
  private _renderer: MVRVZoneRenderer;
  constructor(series: any) { this._renderer = new MVRVZoneRenderer(series); }
  zOrder() { return 'bottom' as const; }
  renderer() { return this._renderer; }
}

class MVRVZonePrimitive {
  private _series: any = null;
  private _paneViews: MVRVZonePaneView[] = [];
  updateAllViews() { if (this._series) this._paneViews = [new MVRVZonePaneView(this._series)]; }
  paneViews() { return this._paneViews; }
  attached(param: any) { this._series = param.series; this.updateAllViews(); }
  detached() { this._series = null; this._paneViews = []; }
}

function mvrvZScoreColor(z: number): string {
  if (z >= 7)   return 'rgba(239,68,68,0.9)';
  if (z >= 3.5) return 'rgba(251,191,36,0.9)';
  if (z >= 2)   return 'rgba(200,200,200,0.75)';
  if (z >= 0)   return 'rgba(16,185,129,0.7)';
  return 'rgba(16,185,129,0.95)';
}

const VOLUME_NORMALIZATION_WINDOW = 90;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function relativeVolumeForIndex(rows: any[], index: number): number {
  const row = rows[index];
  const volume = Number(row?.volume);
  if (!Number.isFinite(volume) || volume <= 0) return 0;

  const start = Math.max(0, index - VOLUME_NORMALIZATION_WINDOW + 1);
  const windowVolumes = rows
    .slice(start, index + 1)
    .map((d: any) => Number(d.volume))
    .filter((value: number) => Number.isFinite(value) && value > 0);
  const baseline = median(windowVolumes);
  if (!Number.isFinite(baseline) || baseline <= 0) return 0;

  return Math.log1p(volume / baseline);
}

// ---- Chart component ----

interface ForecastChartProps {
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
  showTradingSystem?: boolean;
  tradingSystemMarkers?: TradingSystemMarker[];
  timeRange: string;
  playbackIndex: number | null;
  mvrvData: { date: string; zScore: number; mvrv: number }[];
  showMVRV: boolean;
  showBitcoinOverlays?: boolean;
  showCoreModelLine?: boolean;
  probabilityForecast?: {
    horizonDays: number;
    probabilityUp: number;
    median: number;
    q10: number;
    q90: number;
    calibrationLabel: string;
  } | null;
}

export const ForecastChart = React.memo(function ForecastChart({ data, showSMA, showVolume, showModelLine, showScenarios, showFloorLine, showPeakLine, showHeatmap, heatmapData, showBuyZones = true, buyZones = [], showTradingSystem = false, tradingSystemMarkers = [], timeRange, playbackIndex, mvrvData, showMVRV, showBitcoinOverlays = true, showCoreModelLine = false, probabilityForecast }: ForecastChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRefs = useRef<{
    candlestick?: ISeriesApi<"Candlestick">;
    volume?: ISeriesApi<"Histogram">;
    sma20?: ISeriesApi<"Line">;
    sma50?: ISeriesApi<"Line">;
    forecast?: ISeriesApi<"Candlestick">;
    forecastMedian?: ISeriesApi<"Line">;
    forecastUpper?: ISeriesApi<"Line">;
    forecastLower?: ISeriesApi<"Line">;
    stochasticTraces: ISeriesApi<"Line">[];
    modelLine?: ISeriesApi<"Line">;
    floorLine?: ISeriesApi<"Line">;
    peakLine?: ISeriesApi<"Line">;
  }>({ stochasticTraces: [] });
  const markersRef = useRef<any>(null);
  const forecastMarkersRef = useRef<any>(null);
  const heatmapPrimRef = useRef<HeatmapPrimitive | null>(null);
  const buyZonePrimRef = useRef<BuyZonePrimitive | null>(null);
  const mvrvChartContainerRef = useRef<HTMLDivElement>(null);
  const mvrvChartRef = useRef<any>(null);
  const mvrvSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

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

    if (showBitcoinOverlays) {
      const halvingPrimitive = new HalvingCyclePrimitive(HALVING_DATES);
      candlestickSeries.attachPrimitive(halvingPrimitive as any);
    }

    // Attach probability heatmap primitive
    const heatmapPrimitive = new HeatmapPrimitive();
    candlestickSeries.attachPrimitive(heatmapPrimitive as any);
    heatmapPrimRef.current = heatmapPrimitive;

    // Attach statistically backtested BTC buy-zone primitive
    const buyZonePrimitive = new BuyZonePrimitive();
    candlestickSeries.attachPrimitive(buyZonePrimitive as any);
    buyZonePrimRef.current = buyZonePrimitive;

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

    const forecastMedianSeries = chart.addSeries(LineSeries, {
      color: 'rgba(251, 191, 36, 0.95)',
      lineWidth: 3,
      lineStyle: 0,
      crosshairMarkerVisible: true,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    seriesRefs.current.forecastMedian = forecastMedianSeries;

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

    // Stochastic scenario traces: seeded block-bootstrap paths around the
    // power-law median. They start a few days before the latest candle so the
    // user can see how sampled paths behaved against recent realized prices.
    seriesRefs.current.stochasticTraces = Array.from({ length: 12 }, (_, index) => chart.addSeries(LineSeries, {
      color: index === 0 ? 'rgba(251, 191, 36, 0.55)' : 'rgba(251, 191, 36, 0.22)',
      lineWidth: index === 0 ? 2 : 1,
      lineStyle: 0,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
    }));

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

    // Floor Price Power Law Line (e^-36.562 * d^5.4279)
    const floorLineSeries = chart.addSeries(LineSeries, {
      color: 'rgba(96, 165, 250, 0.9)', // blue
      lineWidth: 2,
      lineStyle: 1, // Dotted
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
    });
    seriesRefs.current.floorLine = floorLineSeries;

    // Peak Price Power Law Line (9.89e-7 * d^2.9379)
    const peakLineSeries = chart.addSeries(LineSeries, {
      color: 'rgba(239, 68, 68, 0.9)', // red
      lineWidth: 2,
      lineStyle: 1, // Dotted
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
    });
    seriesRefs.current.peakLine = peakLineSeries;

    // ---- MVRV Z-Score panel: completely separate chart instance ----
    if (showBitcoinOverlays && mvrvChartContainerRef.current) {
      const mvrvChart = createChart(mvrvChartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#a1a1aa',
        },
        grid: {
          vertLines: { color: '#27272a', style: 1 },
          horzLines: { color: '#27272a', style: 1 },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#52525b' },
        leftPriceScale: { visible: false },
        timeScale: {
          borderColor: '#52525b',
          timeVisible: false,
          rightOffset: 12,
          barSpacing: 3,
          visible: false, // time axis shown only on main chart
        },
        handleScroll: false,
        handleScale: false,
        autoSize: true,
      });
      mvrvChartRef.current = mvrvChart;

      const mvrvSeries = mvrvChart.addSeries(LineSeries, {
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
      });
      mvrvSeriesRef.current = mvrvSeries;
      mvrvSeries.attachPrimitive(new MVRVZonePrimitive() as any);

      // Sync main chart time range → MVRV panel (one-way; MVRV panel is non-interactive)
      // Guard with try/catch: MVRV chart throws if called before its data is loaded
      chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
        if (!range) return;
        try { mvrvChart.timeScale().setVisibleRange(range); } catch { /* not ready */ }
      });
    }

    return () => {
      chart.remove();
      mvrvChartRef.current?.remove();
      chartRef.current = null;
      mvrvChartRef.current = null;
      mvrvSeriesRef.current = null;
      heatmapPrimRef.current = null;
      buyZonePrimRef.current = null;
      markersRef.current = null;
      forecastMarkersRef.current = null;
      seriesRefs.current = { stochasticTraces: [] };
    };
  }, [showBitcoinOverlays]);

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
    const volumeData = historical.map((d: any, index: number) => ({
      time: d.date,
      value: relativeVolumeForIndex(historical, index),
      rawVolume: d.volume,
      color: d.close >= d.open ? '#10b98140' : '#ef444440',
    }));
    const sma20Data = historical.filter((d: any) => d.sma20 !== null).map((d: any) => ({ time: d.date, value: d.sma20 }));
    const sma50Data = historical.filter((d: any) => d.sma50 !== null).map((d: any) => ({ time: d.date, value: d.sma50 }));

    const lastHist = historical[historical.length - 1];
    const forecastData = lastHist && forecast.length > 0 ? [
      { time: lastHist.date, open: lastHist.close, high: lastHist.close, low: lastHist.close, close: lastHist.close },
      ...forecast.map((d: any, index: number) => {
        const primaryTraceClose = d.stochasticTraces?.[0];
        const previousForecast = index > 0 ? forecast[index - 1] : null;
        const primaryTraceOpen = previousForecast?.stochasticTraces?.[0];
        const close = Number.isFinite(primaryTraceClose) && primaryTraceClose > 0 ? primaryTraceClose : d.close;
        const open = Number.isFinite(primaryTraceOpen) && primaryTraceOpen > 0
          ? primaryTraceOpen
          : index === 0
            ? lastHist.close
            : forecast[index - 1].close;
        return {
          time: d.date,
          open,
          high: Math.max(open, close),
          low: Math.min(open, close),
          close,
        };
      })
    ] : [];
    const forecastMedianData = lastHist && forecast.length > 0 ? [
      { time: lastHist.date, value: lastHist.close },
      ...forecast.map((d: any) => ({ time: d.date, value: d.close }))
    ] : [];
    const forecastUpperData = lastHist && forecast.length > 0 ? [{ time: lastHist.date, value: lastHist.close }, ...forecast.map((d: any) => ({ time: d.date, value: d.forecastUpper }))] : [];
    const forecastLowerData = lastHist && forecast.length > 0 ? [{ time: lastHist.date, value: lastHist.close }, ...forecast.map((d: any) => ({ time: d.date, value: d.forecastLower }))] : [];
    const traceRows = !showModelLine && !showScenarios || isInPlayback ? [] : [...historical, ...forecast].filter((d: any) => Array.isArray(d.stochasticTraces));
    const stochasticTraceData = seriesRefs.current.stochasticTraces.map((_, traceIndex) =>
      traceRows
        .map((d: any) => ({ time: d.date, value: d.stochasticTraces?.[traceIndex] }))
        .filter((point: any) => Number.isFinite(point.value) && point.value > 0)
    );

    const sortByTime = (a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime();

    // Model line builds up with historical candles during playback
    const modelLineData = historical
      .filter((d: any) => d.powerLawModel != null && d.powerLawModel > 0)
      .map((d: any) => ({ time: d.date, value: d.powerLawModel }));

    // Floor price line (all data including forecast projection)
    const floorLineData = [...historical, ...forecast]
      .filter((d: any) => d.floorPriceModel != null && d.floorPriceModel > 0)
      .map((d: any) => ({ time: d.date, value: d.floorPriceModel }));

    // Peak price line (all data including forecast projection)
    const peakLineData = [...historical, ...forecast]
      .filter((d: any) => d.peakPriceModel != null && d.peakPriceModel > 0)
      .map((d: any) => ({ time: d.date, value: d.peakPriceModel }));

    seriesRefs.current.candlestick?.setData(candleData.sort(sortByTime));
    seriesRefs.current.volume?.setData(volumeData.sort(sortByTime));
    seriesRefs.current.sma20?.setData(sma20Data.sort(sortByTime));
    seriesRefs.current.sma50?.setData(sma50Data.sort(sortByTime));
    seriesRefs.current.forecast?.setData(forecastData.sort(sortByTime));
    seriesRefs.current.forecastMedian?.setData(forecastMedianData.sort(sortByTime));
    seriesRefs.current.forecastUpper?.setData(forecastUpperData.sort(sortByTime));
    seriesRefs.current.forecastLower?.setData(forecastLowerData.sort(sortByTime));
    seriesRefs.current.stochasticTraces.forEach((series, traceIndex) => {
      series.setData(stochasticTraceData[traceIndex].sort(sortByTime));
    });
    seriesRefs.current.modelLine?.setData(modelLineData.sort(sortByTime));
    seriesRefs.current.floorLine?.setData(floorLineData.sort(sortByTime));
    seriesRefs.current.peakLine?.setData(peakLineData.sort(sortByTime));

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

    const minSystemLabelSpacingDays = timeRange === 'ALL' ? 300 : timeRange === '1Y' ? 45 : 20;
    const minSystemLabelTime = timeRange === 'ALL' && lastHist
      ? Date.parse(`${lastHist.date}T00:00:00Z`) - 5 * 365 * 86400000
      : -Infinity;
    let lastSystemLabelTime = -Infinity;
    const systemMarkerRows = showBitcoinOverlays && showTradingSystem && !isInPlayback
      ? tradingSystemMarkers.map(marker => {
        const exposurePct = Math.round(marker.exposure * 100);
        const reservePct = Math.max(0, 100 - Math.min(100, exposurePct));
        const markerTime = Date.parse(`${marker.date}T00:00:00Z`);
        const canPrintLabel = Number.isFinite(markerTime)
          && markerTime >= minSystemLabelTime
          && markerTime - lastSystemLabelTime >= minSystemLabelSpacingDays * 86400000;
        if (canPrintLabel) lastSystemLabelTime = markerTime;
        const exposureLabel = !canPrintLabel
          ? undefined
          : marker.exposure > 1
            ? `TARGET: ${exposurePct}% BTC / ${exposurePct - 100}% BORROW`
          : marker.action === 'trim'
            ? `TRIM: ${exposurePct}% BTC / ${reservePct}% CASH`
            : marker.action === 'reset'
              ? `EXIT: ${reservePct}% CASH`
              : `TARGET: ${exposurePct}% BTC`;
        return {
          time: marker.date,
          position: marker.action === 'trim' || marker.action === 'reset' ? 'aboveBar' : 'belowBar',
          color: marker.action === 'trim' || marker.action === 'reset' ? '#f59e0b' : '#22c55e',
          shape: marker.action === 'trim' || marker.action === 'reset' ? 'arrowDown' : 'arrowUp',
          text: exposureLabel,
        };
      })
      : [];

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
      }, ...systemMarkerRows]);
    } else if (isInPlayback && markersRef.current) {
      markersRef.current.setMarkers([]);
    }

    if (!isInPlayback && forecast.length > 0 && probabilityForecast && seriesRefs.current.forecast) {
      if (!forecastMarkersRef.current) {
        forecastMarkersRef.current = createSeriesMarkers(seriesRefs.current.forecast, []);
      }
      const terminal = forecast[forecast.length - 1];
      const pUp = Math.round(probabilityForecast.probabilityUp * 100);
      const medianK = `$${Math.round(probabilityForecast.median / 1000)}k`;
      const rangeLowK = `$${Math.round(probabilityForecast.q10 / 1000)}k`;
      const rangeHighK = `$${Math.round(probabilityForecast.q90 / 1000)}k`;
      forecastMarkersRef.current.setMarkers([{
        time: terminal.date,
        position: 'aboveBar',
        color: pUp >= 50 ? '#34d399' : '#fbbf24',
        shape: 'circle',
        text: `${probabilityForecast.calibrationLabel} · ${pUp}% up · median ${medianK} · ${rangeLowK}-${rangeHighK}`,
      }]);
    } else if (forecastMarkersRef.current) {
      forecastMarkersRef.current.setMarkers([]);
    }
  }, [data, playbackIndex, probabilityForecast, showScenarios, showBitcoinOverlays, showTradingSystem, tradingSystemMarkers]);

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
            volume: volData ? (volData.rawVolume ?? volData.value) : undefined,
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

  // Load MVRV Z-Score data into the separate indicator chart
  useEffect(() => {
    if (!mvrvSeriesRef.current || !mvrvData?.length) return;
    const lineData = mvrvData.map(d => ({
      time: d.date as any,
      value: d.zScore,
      color: mvrvZScoreColor(d.zScore),
    }));
    mvrvSeriesRef.current.setData(lineData);
    // Once MVRV data is loaded, sync current main chart range into the MVRV chart
    if (chartRef.current && mvrvChartRef.current) {
      try {
        const range = chartRef.current.timeScale().getVisibleRange();
        if (range) mvrvChartRef.current.timeScale().setVisibleRange(range);
      } catch { /* ignore */ }
    }
  }, [mvrvData]);

  // Handle visibility toggles
  useEffect(() => {
    if (!chartRef.current) return;
    seriesRefs.current.sma20?.applyOptions({ visible: showSMA });
    seriesRefs.current.sma50?.applyOptions({ visible: showSMA });
    seriesRefs.current.volume?.applyOptions({ visible: showVolume });
    seriesRefs.current.forecastMedian?.applyOptions({ visible: showCoreModelLine && showModelLine });
    seriesRefs.current.modelLine?.applyOptions({ visible: showModelLine });
    seriesRefs.current.stochasticTraces.forEach((series, index) => {
      series.applyOptions({ visible: index === 0 ? showModelLine || showScenarios : showScenarios });
    });
    seriesRefs.current.floorLine?.applyOptions({ visible: showFloorLine });
    seriesRefs.current.peakLine?.applyOptions({ visible: showPeakLine });
  }, [showSMA, showVolume, showModelLine, showScenarios, showFloorLine, showPeakLine, showBitcoinOverlays, showCoreModelLine]);

  // Update probability heatmap
  useEffect(() => {
    if (!heatmapPrimRef.current) return;
    const visible = showHeatmap && playbackIndex === null;
    heatmapPrimRef.current.setCells(visible ? heatmapData : []);
  }, [heatmapData, showHeatmap, playbackIndex]);

  // Update statistically backtested buy-zone overlay
  useEffect(() => {
    if (!buyZonePrimRef.current) return;
    const visible = showBitcoinOverlays && showBuyZones && playbackIndex === null;
    buyZonePrimRef.current.setZones(visible ? buyZones : []);
  }, [buyZones, showBuyZones, playbackIndex, showBitcoinOverlays]);

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
      // Double-RAF ensures ResizeObserver has fired and chart has been sized
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (chartRef.current) chartRef.current.timeScale().fitContent();
      }));
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
    <div className="w-full h-full min-h-[350px] flex flex-col">
      {/* Main price chart */}
      <div className="relative flex-1 min-h-0">
        <div ref={chartContainerRef} className="absolute inset-0" />

      {legendData && (
        <div className="absolute bottom-8 left-3 z-10 pointer-events-none flex flex-wrap gap-x-3 gap-y-1 text-[10px] md:text-xs font-mono bg-zinc-950/50 backdrop-blur-sm p-1.5 rounded border border-white/5">
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
      </div>{/* end main chart wrapper */}

      {/* MVRV Z-Score indicator panel — separate chart, synced time range */}
      <div
        ref={mvrvChartContainerRef}
        className={cn(
          "shrink-0 transition-all duration-200",
          showBitcoinOverlays && showMVRV && mvrvData?.length > 0
            ? "h-[130px] border-t border-white/5"
            : "h-0 overflow-hidden"
        )}
      />
    </div>
  );
});

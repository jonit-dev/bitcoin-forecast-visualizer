import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import { CYCLE_PIVOTS, PHASE_ZONES, type PhaseLabel } from '../../lib/cycle';
import type { BuyZoneSpan } from '../../lib/buyZone';
import type { HeatmapCell } from '../../lib/data';

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


export { BuyZonePrimitive, HalvingCyclePrimitive, HALVING_DATES, HeatmapPrimitive, MVRVZonePrimitive };

import { HistogramSeries, LineSeries, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { CrisisHistoryPoint } from '../../lib/sp500CrisisModel';

const CRISIS_PANE_INDEX = 1;
const BAND_OPTIONS = { color: 'rgba(251,113,133,.22)', base: 0, priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'volume' as const } };
const PERCENT_FORMAT = { type: 'custom' as const, minMove: 0.01, formatter: (value: number) => `${value.toFixed(1)}%` };

export interface CrisisPaneOptions {
  history: CrisisHistoryPoint[];
  watchThreshold: number;
  highThreshold: number;
}

/**
 * The OOS sample has multi-month gaps (weeks the model does not score). A line series draws straight
 * through missing points — whitespace does not break it — so each contiguous run gets its own series.
 */
function splitAtGaps<T extends { time: string }>(points: T[]): T[][] {
  const segments: T[][] = [];
  let current: T[] = [];
  points.forEach((point, index) => {
    const previous = points[index - 1];
    const days = previous ? (Date.parse(`${point.time}T00:00:00Z`) - Date.parse(`${previous.time}T00:00:00Z`)) / 86_400_000 : 0;
    if (previous && days > 10) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  });
  if (current.length) segments.push(current);
  return segments;
}

/** Crosshair time → ISO date string; lightweight-charts hands back either form. */
export function timeKey(time: unknown): string | null {
  if (typeof time === 'string') return time;
  if (time && typeof time === 'object' && 'year' in time) {
    const { year, month, day } = time as { year: number; month: number; day: number };
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

/** Last weekly crisis observation at or before `date`; the price series is daily, the model weekly. */
export function crisisPointAt(history: CrisisHistoryPoint[], date: string): CrisisHistoryPoint | null {
  let low = 0;
  let high = history.length - 1;
  let found: CrisisHistoryPoint | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (history[mid].date <= date) {
      found = history[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** Crisis history clipped to the price history the chart actually draws, so the time axis is unchanged. */
export function clipCrisisHistory(history: CrisisHistoryPoint[], firstDate: string | null): CrisisHistoryPoint[] {
  if (!firstDate) return history;
  return history.filter((point) => point.date >= firstDate);
}

/**
 * Stacks the imported crisis probability under the price as a TradingView-style indicator pane on the
 * same time axis and crosshair. Returns a disposer that removes the pane and leaves the price pane intact.
 */
export function attachCrisisPane(chart: IChartApi, { history, watchThreshold, highThreshold }: CrisisPaneOptions): () => void {
  const created: ISeriesApi<'Line' | 'Histogram'>[] = [];
  const crisisWindows = history.map((point) => ({ time: point.date, value: point.target ? 1 : 0 }));

  // Labeled crisis windows shaded behind the price, on a hidden overlay scale so price autoscaling is untouched.
  const priceBands = chart.addSeries(HistogramSeries, { ...BAND_OPTIONS, priceScaleId: 'crisis-bands-price' }, 0);
  chart.priceScale('crisis-bands-price', 0).applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
  priceBands.setData(crisisWindows);
  created.push(priceBands as ISeriesApi<'Histogram'>);

  const crisisBands = chart.addSeries(HistogramSeries, { ...BAND_OPTIONS, priceScaleId: 'crisis-bands-indicator' }, CRISIS_PANE_INDEX);
  chart.priceScale('crisis-bands-indicator', CRISIS_PANE_INDEX).applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
  crisisBands.setData(crisisWindows);
  created.push(crisisBands as ISeriesApi<'Histogram'>);

  const drawSegmented = (points: Array<{ time: string; value: number }>, options: Parameters<typeof chart.addSeries<'Line'>>[1]) => {
    const segments = splitAtGaps(points);
    return segments.map((segment, index) => {
      const isLast = index === segments.length - 1;
      const series = chart.addSeries(LineSeries, { ...options, lastValueVisible: isLast && options?.lastValueVisible !== false, priceLineVisible: false }, CRISIS_PANE_INDEX);
      series.setData(segment);
      created.push(series as ISeriesApi<'Line'>);
      return series;
    });
  };

  drawSegmented(history.map((point) => ({ time: point.date, value: point.incumbentProbability * 100 })), {
    color: '#a1a1aa',
    lineWidth: 1,
    lineStyle: 2,
    lastValueVisible: false,
    priceFormat: PERCENT_FORMAT,
  });

  const challengerSegments = drawSegmented(history.map((point) => ({ time: point.date, value: point.challengerDeploymentProbability * 100 })), {
    color: '#7dd3fc',
    lineWidth: 2,
    priceFormat: PERCENT_FORMAT,
  });
  // The indicator pane inherits the price pane's logarithmic scale at creation, so linear mode is set explicitly.
  chart.priceScale('right', CRISIS_PANE_INDEX).applyOptions({ mode: 0, scaleMargins: { top: 0.12, bottom: 0.06 } });

  const challenger = challengerSegments.at(-1);
  challenger?.createPriceLine({ price: watchThreshold * 100, color: '#fbbf24', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'WATCH' });
  challenger?.createPriceLine({ price: highThreshold * 100, color: '#fb7185', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'HIGH' });

  const panes = chart.panes();
  panes[0]?.setStretchFactor(3);
  panes[CRISIS_PANE_INDEX]?.setStretchFactor(1);

  return () => {
    try {
      created.forEach((series) => chart.removeSeries(series as ISeriesApi<'Line'>));
      if (chart.panes().length > CRISIS_PANE_INDEX) chart.removePane(CRISIS_PANE_INDEX);
    } catch {
      /* chart already disposed */
    }
  };
}

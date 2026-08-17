import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, HistogramSeries, LineSeries, type IChartApi } from 'lightweight-charts';
import type { OHLCVData } from '../../lib/api';
import type { CrisisHistoryPoint } from '../../lib/sp500CrisisModel';

const RANGE_OPTIONS: Array<{ id: string; years: number | null }> = [
  { id: '5Y', years: 5 },
  { id: '10Y', years: 10 },
  { id: '15Y', years: 15 },
  { id: 'ALL', years: null },
];

interface CrisisChartPanelProps {
  history: CrisisHistoryPoint[];
  priceRows: OHLCVData[];
  priceLabel: string;
  watchThreshold: number;
  highThreshold: number;
  eventCount: number;
}

interface Readout {
  date: string;
  price: number | null;
  challenger: number;
  incumbent: number;
  raw: number;
  target: 0 | 1;
}

function formatPercent(value: number, digits = 2): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function timeKey(time: unknown): string | null {
  if (typeof time === 'string') return time;
  if (time && typeof time === 'object' && 'year' in time) {
    const { year, month, day } = time as { year: number; month: number; day: number };
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

function shiftYears(date: string, years: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCFullYear(shifted.getUTCFullYear() - years);
  return shifted.toISOString().slice(0, 10);
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

/** Last weekly crisis observation at or before `date`; the price series is daily, the model weekly. */
function crisisPointAt(history: CrisisHistoryPoint[], date: string): CrisisHistoryPoint | null {
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

export function CrisisChartPanel({ history, priceRows, priceLabel, watchThreshold, highThreshold, eventCount }: CrisisChartPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState('15Y');
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const priceByDate = useMemo(() => new Map(priceRows.map((row) => [row.date, row.close])), [priceRows]);
  const lastDate = useMemo(() => {
    const lastPrice = priceRows.at(-1)?.date ?? '';
    const lastCrisis = history.at(-1)?.date ?? '';
    return lastPrice > lastCrisis ? lastPrice : lastCrisis;
  }, [priceRows, history]);

  const readout = useMemo<Readout>(() => {
    const date = hoverDate ?? lastDate;
    const point = crisisPointAt(history, date) ?? history.at(-1)!;
    return {
      date,
      price: priceByDate.get(date) ?? null,
      challenger: point.challengerDeploymentProbability,
      incumbent: point.incumbentProbability,
      raw: point.rawProbability,
      target: point.target,
    };
  }, [hoverDate, lastDate, history, priceByDate]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#a1a1aa', panes: { separatorColor: '#3f3f46', separatorHoverColor: 'rgba(125,211,252,.2)', enableResize: true } },
      grid: { vertLines: { color: '#27272a', style: 1 }, horzLines: { color: '#27272a', style: 1 } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#52525b', autoScale: true },
      timeScale: { borderColor: '#52525b', timeVisible: false, rightOffset: 2, barSpacing: 3 },
      autoSize: true,
    });
    chartRef.current = chart;

    const crisisWindows = history.map((point) => ({ time: point.date, value: point.target ? 1 : 0 }));
    const bandOptions = { color: 'rgba(251,113,133,.22)', base: 0, priceLineVisible: false, lastValueVisible: false, priceFormat: { type: 'volume' as const } };

    // Price pane: the VOO path the crisis model is read against.
    const priceBands = chart.addSeries(HistogramSeries, { ...bandOptions, priceScaleId: 'crisis-bands-price' }, 0);
    chart.priceScale('crisis-bands-price', 0).applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    priceBands.setData(crisisWindows);

    const price = chart.addSeries(LineSeries, {
      color: '#fbbf24',
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    }, 0);
    price.setData(priceRows.map((row) => ({ time: row.date, value: row.close })));
    chart.priceScale('right', 0).applyOptions({ mode: 1, scaleMargins: { top: 0.12, bottom: 0.08 } });

    // Indicator pane: the imported crisis probability, on the same time axis.
    const crisisBands = chart.addSeries(HistogramSeries, { ...bandOptions, priceScaleId: 'crisis-bands-indicator' }, 1);
    chart.priceScale('crisis-bands-indicator', 1).applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    crisisBands.setData(crisisWindows);

    const percentFormat = { type: 'custom' as const, minMove: 0.01, formatter: (value: number) => `${value.toFixed(1)}%` };
    const drawSegmented = (points: Array<{ time: string; value: number }>, options: Parameters<typeof chart.addSeries<'Line'>>[1]) => {
      const segments = splitAtGaps(points);
      return segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        const series = chart.addSeries(LineSeries, { ...options, lastValueVisible: isLast && options?.lastValueVisible !== false, priceLineVisible: false }, 1);
        series.setData(segment);
        return series;
      });
    };

    drawSegmented(history.map((point) => ({ time: point.date, value: point.incumbentProbability * 100 })), {
      color: '#a1a1aa',
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: false,
      priceFormat: percentFormat,
    });

    const challengerSegments = drawSegmented(history.map((point) => ({ time: point.date, value: point.challengerDeploymentProbability * 100 })), {
      color: '#7dd3fc',
      lineWidth: 2,
      priceFormat: percentFormat,
    });
    const challenger = challengerSegments.at(-1)!;
    // Pane 1 inherits the price pane's scale options at creation, so its linear mode is set explicitly.
    chart.priceScale('right', 1).applyOptions({ mode: 0, scaleMargins: { top: 0.12, bottom: 0.06 } });

    challenger.createPriceLine({ price: watchThreshold * 100, color: '#fbbf24', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'WATCH' });
    challenger.createPriceLine({ price: highThreshold * 100, color: '#fb7185', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'HIGH' });

    const panes = chart.panes();
    panes[0]?.setStretchFactor(1.6);
    panes[1]?.setStretchFactor(1);

    chart.subscribeCrosshairMove((param) => setHoverDate(timeKey(param.time)));

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [history, priceRows, watchThreshold, highThreshold]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const years = RANGE_OPTIONS.find((option) => option.id === range)?.years ?? null;
    if (years === null) {
      chart.timeScale().fitContent();
      return;
    }
    chart.timeScale().setVisibleRange({ from: shiftYears(lastDate, years), to: lastDate } as never);
  }, [range, lastDate]);

  return (
    <section className="chart-panel crisis-chart-panel" aria-label="Crisis probability chart">
      <header className="chart-panel-header">
        <div>
          <h2>{priceLabel} vs crisis probability</h2>
          <p>Imported weekly 63-trading-day crisis probability plotted under the VOO price on one time axis. Shadow model output; it never feeds the VOO price forecast.</p>
        </div>
        <div className="chart-panel-tools">
          <div className="range-controls" aria-label="Crisis history range">
            {RANGE_OPTIONS.map((option) => (
              <button key={option.id} type="button" aria-pressed={range === option.id} onClick={() => setRange(option.id)}>{option.id}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="crisis-chart-legend">
        <span className="crisis-legend-item"><span className="crisis-legend-swatch crisis-legend-price" aria-hidden="true" />VOO close</span>
        <span className="crisis-legend-item"><span className="crisis-legend-swatch crisis-legend-challenger" aria-hidden="true" />Challenger v2 deployment</span>
        <span className="crisis-legend-item"><span className="crisis-legend-swatch crisis-legend-incumbent" aria-hidden="true" />Incumbent</span>
        <span className="crisis-legend-item"><span className="crisis-legend-swatch crisis-legend-band" aria-hidden="true" />Labeled crisis window ({eventCount} events)</span>
        <span className="crisis-legend-item crisis-legend-watch">WATCH {formatPercent(watchThreshold)}</span>
        <span className="crisis-legend-item crisis-legend-high">HIGH {formatPercent(highThreshold)}</span>
      </div>

      <div className="chart-panel-body crisis-chart-body">
        <div ref={containerRef} className="crisis-chart-canvas" data-testid="crisis-chart-canvas" />
      </div>

      <p className="crisis-chart-readout">
        <strong>{readout.date}</strong>
        <span>VOO {readout.price === null ? '—' : `$${readout.price.toFixed(2)}`}</span>
        <span>challenger {formatPercent(readout.challenger)}</span>
        <span>incumbent {formatPercent(readout.incumbent)}</span>
        <span>base raw {formatPercent(readout.raw)}</span>
        <span className={readout.target ? 'crisis-readout-hit' : undefined}>{readout.target ? 'crisis within 63 sessions' : 'no crisis within 63 sessions'}</span>
      </p>
      <p className="crisis-chart-note">VOO history starts 2010-09-09 and the crisis model history starts 2000-01-07, so the price pane is empty before 2010 on the ALL range. Breaks in the indicator line are weeks the OOS sample does not score, not zero risk.</p>
    </section>
  );
}

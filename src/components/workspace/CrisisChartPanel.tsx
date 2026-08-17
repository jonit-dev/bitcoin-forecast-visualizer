import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, HistogramSeries, LineSeries, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { CrisisHistoryPoint } from '../../lib/sp500CrisisModel';

const RANGE_OPTIONS: Array<{ id: string; weeks: number | null }> = [
  { id: '5Y', weeks: 261 },
  { id: '10Y', weeks: 522 },
  { id: '15Y', weeks: 783 },
  { id: 'ALL', weeks: null },
];

interface CrisisChartPanelProps {
  history: CrisisHistoryPoint[];
  watchThreshold: number;
  highThreshold: number;
  eventCount: number;
}

interface Readout {
  date: string;
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

function toReadout(point: CrisisHistoryPoint): Readout {
  return {
    date: point.date,
    challenger: point.challengerDeploymentProbability,
    incumbent: point.incumbentProbability,
    raw: point.rawProbability,
    target: point.target,
  };
}

export function CrisisChartPanel({ history, watchThreshold, highThreshold, eventCount }: CrisisChartPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const challengerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [range, setRange] = useState('ALL');
  const [hover, setHover] = useState<Readout | null>(null);
  const pointsByDate = useMemo(() => new Map(history.map((point) => [point.date, point])), [history]);
  const latest = history.at(-1)!;
  const readout = hover ?? toReadout(latest);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#a1a1aa' },
      grid: { vertLines: { color: '#27272a', style: 1 }, horzLines: { color: '#27272a', style: 1 } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#52525b', autoScale: true, scaleMargins: { top: 0.1, bottom: 0.06 } },
      timeScale: { borderColor: '#52525b', timeVisible: false, rightOffset: 2, barSpacing: 3 },
      localization: { priceFormatter: (value: number) => `${value.toFixed(1)}%` },
      autoSize: true,
    });
    chartRef.current = chart;

    const crisisBands = chart.addSeries(HistogramSeries, {
      priceScaleId: 'crisis-bands',
      color: 'rgba(251,113,133,.22)',
      base: 0,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale('crisis-bands').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
    crisisBands.setData(history.map((point) => ({ time: point.date, value: point.target ? 1 : 0 })));

    const incumbent = chart.addSeries(LineSeries, {
      color: '#a1a1aa',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    incumbent.setData(history.map((point) => ({ time: point.date, value: point.incumbentProbability * 100 })));

    const challenger = chart.addSeries(LineSeries, {
      color: '#7dd3fc',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    challenger.setData(history.map((point) => ({ time: point.date, value: point.challengerDeploymentProbability * 100 })));
    challengerRef.current = challenger;

    challenger.createPriceLine({ price: watchThreshold * 100, color: '#fbbf24', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'WATCH' });
    challenger.createPriceLine({ price: highThreshold * 100, color: '#fb7185', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'HIGH' });

    chart.subscribeCrosshairMove((param) => {
      const key = timeKey(param.time);
      const point = key ? pointsByDate.get(key) : undefined;
      setHover(point ? toReadout(point) : null);
    });

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
      challengerRef.current = null;
    };
  }, [history, pointsByDate, watchThreshold, highThreshold]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const weeks = RANGE_OPTIONS.find((option) => option.id === range)?.weeks ?? null;
    if (weeks === null || weeks >= history.length) {
      chart.timeScale().fitContent();
      return;
    }
    chart.timeScale().setVisibleLogicalRange({ from: history.length - weeks, to: history.length });
  }, [range, history.length]);

  return (
    <section className="chart-panel crisis-chart-panel" aria-label="Crisis probability chart">
      <header className="chart-panel-header">
        <div>
          <h2>Crisis probability history</h2>
          <p>Imported weekly 63-trading-day crisis probability for the S&amp;P 500. Shadow model output; it never feeds the VOO price forecast.</p>
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
        <span>challenger {formatPercent(readout.challenger)}</span>
        <span>incumbent {formatPercent(readout.incumbent)}</span>
        <span>base raw {formatPercent(readout.raw)}</span>
        <span className={readout.target ? 'crisis-readout-hit' : undefined}>{readout.target ? 'crisis within 63 sessions' : 'no crisis within 63 sessions'}</span>
      </p>
    </section>
  );
}

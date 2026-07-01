import type { LegendData, ProbabilityForecastSummary } from './types';

const VOLUME_NORMALIZATION_WINDOW = 90;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function relativeVolumeForIndex(rows: any[], index: number): number {
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

export function mvrvZScoreColor(z: number): string {
  if (z >= 7) return 'rgba(239,68,68,0.9)';
  if (z >= 3.5) return 'rgba(251,191,36,0.9)';
  if (z >= 2) return 'rgba(200,200,200,0.75)';
  if (z >= 0) return 'rgba(16,185,129,0.7)';
  return 'rgba(16,185,129,0.95)';
}

export function sortByTime(a: any, b: any): number {
  return new Date(a.time).getTime() - new Date(b.time).getTime();
}

export function splitPlaybackData(data: any[], playbackIndex: number | null) {
  const isInPlayback = playbackIndex !== null;
  const allHistorical = data.filter((d: any) => !d.isForecast);
  const allForecast = data.filter((d: any) => d.isForecast);
  return {
    isInPlayback,
    allHistorical,
    allForecast,
    historical: isInPlayback ? allHistorical.slice(0, playbackIndex) : allHistorical,
    forecast: isInPlayback ? [] : allForecast,
  };
}

export function buildLegendFromRow(row: any): LegendData {
  return {
    time: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    isForecast: false,
  };
}

export function buildChartSeriesData(
  data: any[],
  playbackIndex: number | null,
  showModelLine: boolean,
  showScenarios: boolean,
  traceCount: number,
) {
  const { isInPlayback, historical, forecast } = splitPlaybackData(data, playbackIndex);
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
    }),
  ] : [];

  const forecastMedianData = lastHist && forecast.length > 0
    ? [{ time: lastHist.date, value: lastHist.close }, ...forecast.map((d: any) => ({ time: d.date, value: d.close }))]
    : [];
  const forecastUpperData = lastHist && forecast.length > 0
    ? [{ time: lastHist.date, value: lastHist.close }, ...forecast.map((d: any) => ({ time: d.date, value: d.forecastUpper }))]
    : [];
  const forecastLowerData = lastHist && forecast.length > 0
    ? [{ time: lastHist.date, value: lastHist.close }, ...forecast.map((d: any) => ({ time: d.date, value: d.forecastLower }))]
    : [];
  const traceRows = (!showModelLine && !showScenarios) || isInPlayback
    ? []
    : [...historical, ...forecast].filter((d: any) => Array.isArray(d.stochasticTraces));
  const stochasticTraceData = Array.from({ length: traceCount }, (_, traceIndex) =>
    traceRows
      .map((d: any) => ({ time: d.date, value: d.stochasticTraces?.[traceIndex] }))
      .filter((point: any) => Number.isFinite(point.value) && point.value > 0)
  );
  const modelLineData = historical
    .filter((d: any) => d.powerLawModel != null && d.powerLawModel > 0)
    .map((d: any) => ({ time: d.date, value: d.powerLawModel }));
  const floorLineData = [...historical, ...forecast]
    .filter((d: any) => d.floorPriceModel != null && d.floorPriceModel > 0)
    .map((d: any) => ({ time: d.date, value: d.floorPriceModel }));
  const peakLineData = [...historical, ...forecast]
    .filter((d: any) => d.peakPriceModel != null && d.peakPriceModel > 0)
    .map((d: any) => ({ time: d.date, value: d.peakPriceModel }));

  return {
    isInPlayback,
    historical,
    forecast,
    lastHist,
    candleData: candleData.sort(sortByTime),
    volumeData: volumeData.sort(sortByTime),
    sma20Data: sma20Data.sort(sortByTime),
    sma50Data: sma50Data.sort(sortByTime),
    forecastData: forecastData.sort(sortByTime),
    forecastMedianData: forecastMedianData.sort(sortByTime),
    forecastUpperData: forecastUpperData.sort(sortByTime),
    forecastLowerData: forecastLowerData.sort(sortByTime),
    stochasticTraceData: stochasticTraceData.map(trace => trace.sort(sortByTime)),
    modelLineData: modelLineData.sort(sortByTime),
    floorLineData: floorLineData.sort(sortByTime),
    peakLineData: peakLineData.sort(sortByTime),
  };
}

export function buildProbabilityMarker(forecast: any[], probabilityForecast: ProbabilityForecastSummary | null | undefined) {
  if (forecast.length === 0 || !probabilityForecast) return [];
  const terminal = forecast[forecast.length - 1];
  const pUp = Math.round(probabilityForecast.probabilityUp * 100);
  const medianK = `$${Math.round(probabilityForecast.median / 1000)}k`;
  const rangeLowK = `$${Math.round(probabilityForecast.q10 / 1000)}k`;
  const rangeHighK = `$${Math.round(probabilityForecast.q90 / 1000)}k`;
  return [{
    time: terminal.date,
    position: 'aboveBar',
    color: pUp >= 50 ? '#34d399' : '#fbbf24',
    shape: 'circle',
    text: `${probabilityForecast.calibrationLabel} · ${pUp}% up · median ${medianK} · ${rangeLowK}-${rangeHighK}`,
  }];
}

export function visibleRangeForTimeRange(timeRange: string, data: any[]) {
  if (timeRange === 'ALL') return null;
  const forecastCount = data.filter((d: any) => d.isForecast).length;
  const historyCount = data.length - forecastCount;
  let startIdx = 0;

  if (timeRange === '1M') startIdx = Math.max(0, historyCount - 30);
  else if (timeRange === '3M') startIdx = Math.max(0, historyCount - 90);
  else if (timeRange === '6M') startIdx = Math.max(0, historyCount - 180);
  else if (timeRange === '1Y') startIdx = Math.max(0, historyCount - 365);

  const startData = data[startIdx];
  const endData = data[data.length - 1];
  return startData && endData ? { from: startData.date, to: endData.date } : null;
}

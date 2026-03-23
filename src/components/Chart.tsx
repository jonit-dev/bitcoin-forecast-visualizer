import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, ISeriesApi, CandlestickSeries, HistogramSeries, LineSeries, AreaSeries, createSeriesMarkers } from 'lightweight-charts';

interface ForecastChartProps {
  data: any[];
  showSMA: boolean;
  showVolume: boolean;
  showModelLine: boolean;
  timeRange: string;
  playbackIndex: number | null;
}

export const ForecastChart = React.memo(function ForecastChart({ data, showSMA, showVolume, showModelLine, timeRange, playbackIndex }: ForecastChartProps) {
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
      },
      timeScale: {
        borderColor: '#52525b',
        timeVisible: false,
        rightOffset: 12,
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

  // Handle time range (frozen during playback to keep scale stable)
  useEffect(() => {
    if (!chartRef.current || !data || data.length === 0) return;
    if (playbackIndex !== null) return;

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
    <div className="w-full h-[350px] sm:h-[400px] md:h-[500px] relative">
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

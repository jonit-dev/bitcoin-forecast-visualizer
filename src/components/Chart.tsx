import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, ISeriesApi, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import { cn } from '../lib/utils';
import type { ChartSeriesRefs, ForecastChartProps, LegendData } from './chart/types';
import { ChartLegend } from './chart/Legend';
import { BuyZonePrimitive, HalvingCyclePrimitive, HALVING_DATES, HeatmapPrimitive, MVRVZonePrimitive } from './chart/primitives';
import {
  buildChartSeriesData,
  buildLegendFromRow,
  buildProbabilityMarker,
  mvrvZScoreColor,
  visibleRangeForTimeRange,
} from './chart/dataTransforms';

export const ForecastChart = React.memo(function ForecastChart({ data, showSMA, showVolume, showModelLine, showScenarios, showFloorLine, showPeakLine, showHeatmap, heatmapData, showBuyZones = true, buyZones = [], timeRange, playbackIndex, mvrvData, showMVRV, showBitcoinOverlays = true, showCoreModelLine = false, probabilityForecast }: ForecastChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRefs = useRef<ChartSeriesRefs>({ stochasticTraces: [] });
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

  const [legendData, setLegendData] = React.useState<LegendData | null>(null);

  // Update series data (runs each playback tick)
  useEffect(() => {
    if (!data || data.length === 0 || !chartRef.current) return;

    const seriesData = buildChartSeriesData(
      data,
      playbackIndex,
      showModelLine,
      showScenarios,
      seriesRefs.current.stochasticTraces.length,
    );

    seriesRefs.current.candlestick?.setData(seriesData.candleData);
    seriesRefs.current.volume?.setData(seriesData.volumeData);
    seriesRefs.current.sma20?.setData(seriesData.sma20Data);
    seriesRefs.current.sma50?.setData(seriesData.sma50Data);
    seriesRefs.current.forecast?.setData(seriesData.forecastData);
    seriesRefs.current.forecastMedian?.setData(seriesData.forecastMedianData);
    seriesRefs.current.forecastUpper?.setData(seriesData.forecastUpperData);
    seriesRefs.current.forecastLower?.setData(seriesData.forecastLowerData);
    seriesRefs.current.stochasticTraces.forEach((series, traceIndex) => {
      series.setData(seriesData.stochasticTraceData[traceIndex] ?? []);
    });
    seriesRefs.current.modelLine?.setData(seriesData.modelLineData);
    seriesRefs.current.floorLine?.setData(seriesData.floorLineData);
    seriesRefs.current.peakLine?.setData(seriesData.peakLineData);

    if (seriesData.lastHist) {
      setLegendData(buildLegendFromRow(seriesData.lastHist));
    }

    // Marker: only show when not in playback
    if (!seriesData.isInPlayback && seriesData.lastHist && seriesRefs.current.candlestick) {
      if (!markersRef.current) {
        markersRef.current = createSeriesMarkers(seriesRefs.current.candlestick, []);
      }
      markersRef.current.setMarkers([{
        time: seriesData.lastHist.date,
        position: 'aboveBar',
        color: '#10b981',
        shape: 'arrowDown',
        text: 'Forecast Starts',
      }]);
    } else if (seriesData.isInPlayback && markersRef.current) {
      markersRef.current.setMarkers([]);
    }

    if (!seriesData.isInPlayback && seriesData.forecast.length > 0 && probabilityForecast && seriesRefs.current.forecast) {
      if (!forecastMarkersRef.current) {
        forecastMarkersRef.current = createSeriesMarkers(seriesRefs.current.forecast, []);
      }
      forecastMarkersRef.current.setMarkers(buildProbabilityMarker(seriesData.forecast, probabilityForecast));
    } else if (forecastMarkersRef.current) {
      forecastMarkersRef.current.setMarkers([]);
    }
  }, [data, playbackIndex, probabilityForecast, showScenarios, showBitcoinOverlays]);

  // Crosshair subscription (only re-subscribes when data changes, not every playback tick)
  useEffect(() => {
    if (!data || data.length === 0 || !chartRef.current) return;
    const chart = chartRef.current;
    const lastHist = data.filter((d: any) => !d.isForecast).slice(-1)[0];

    const handleCrosshairMove = (param: any) => {
      if (!param.time || param.point.x < 0 || param.point.y < 0) {
        if (lastHist) {
          setLegendData(buildLegendFromRow(lastHist));
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
      const range = visibleRangeForTimeRange(timeRange, data);
      if (range) chart.timeScale().setVisibleRange(range);
    }
  }, [timeRange, data, playbackIndex]);

  return (
    <div className="w-full h-full min-h-[350px] flex flex-col">
      {/* Main price chart */}
      <div className="relative flex-1 min-h-0">
        <div ref={chartContainerRef} className="absolute inset-0" />
        <ChartLegend data={legendData} />
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

import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import { Activity, TrendingUp, TrendingDown, RefreshCw, BarChart2, Play, Square, HelpCircle, X, Zap, Bitcoin, CalendarClock, Gauge, Layers3, CircleDollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { ForecastChart } from './components/Chart';
import { processRealData, generateHeatmapData, computeDrawdownStats, computeProbabilityForecast, HISTORICAL_CYCLE_DRAWDOWNS, CONFIDENCE_Z_SCORES, type HeatmapCell, type DrawdownStats } from './lib/data';
import { loadBTCData, computeMVRVStats, computeMVRVZScoreSeries, type MarketData, type MVRVStats } from './lib/api';
import { cn } from './lib/utils';

function formatHorizonLabel(days: number): string {
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}M`;
  return `${Math.round(days / 365)}Y`;
}

function formatPrice(n: number) {
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatIntervalOption(level: number, horizonDays: number, calibrationLabel?: string): string {
  const pct = `${Math.round(level * 100)}%`;
  if (horizonDays >= 180) return `${pct} scenario envelope`;
  const label = calibrationLabel === 'Conservative' ? 'conservative band' : 'calibrated band';
  return `${pct} ${label}`;
}

function getHalvingInfo() {
  const lastHalvingDate = '2024-04-20';
  const HALVING_INTERVAL_MS = 1460 * 86400000;
  const nextHalving = new Date(new Date(lastHalvingDate + 'T00:00:00Z').getTime() + HALVING_INTERVAL_MS);
  const daysUntil = Math.ceil((nextHalving.getTime() - Date.now()) / 86400000);
  const currentReward = 3.125; // post-4th halving
  const nextReward = currentReward / 2;
  return {
    nextDate: nextHalving.toISOString().split('T')[0],
    daysUntil: Math.max(0, daysUntil),
    currentReward,
    nextReward,
    dailyIssuance: Math.round(144 * currentReward),   // ~450 BTC/day
    nextDailyIssuance: Math.round(144 * nextReward),  // ~225 BTC/day
  };
}

const CIRCULATING_SUPPLY = 19_850_000;
const MAX_SUPPLY = 21_000_000;
const HORIZON_OPTIONS = [
  { value: 7, label: '7D' },
  { value: 14, label: '14D' },
  { value: 30, label: '30D' },
  { value: 90, label: '3M' },
  { value: 180, label: '6M' },
  { value: 365, label: '1Y' },
  { value: 730, label: '2Y' },
  { value: 1825, label: '5Y' },
  { value: 3650, label: '10Y' },
];

function formatMarketCap(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return `$${(n / 1e6).toFixed(0)}M`;
}

export default function App() {
  const [marketData] = useState<MarketData>(() => loadBTCData());
  const [mvrvStats] = useState<MVRVStats>(() => computeMVRVStats());
  const [mvrvZScoreData] = useState(() => computeMVRVZScoreSeries());
  const halvingInfo = useMemo(() => getHalvingInfo(), []);
  const [horizon, setHorizon] = useState(180);
  const [model, setModel] = useState('powerlaw');
  const [confidenceLevel, setConfidenceLevel] = useState<keyof typeof CONFIDENCE_Z_SCORES>(0.95);
  const [isGenerating, setIsGenerating] = useState(false);
  const [displayData, setDisplayData] = useState<any[]>(() =>
    processRealData(marketData.ohlcv, 180, 'powerlaw', CONFIDENCE_Z_SCORES[0.95])
  );

  // Heatmap
  const [heatmapData, setHeatmapData] = useState<HeatmapCell[]>(() =>
    generateHeatmapData(marketData.ohlcv, 180, 'powerlaw')
  );

  // Drawdown analysis
  const [drawdownStats, setDrawdownStats] = useState<DrawdownStats>(() =>
    computeDrawdownStats(marketData.ohlcv, 180)
  );

  // Chart Controls
  const [timeRange, setTimeRange] = useState('ALL');
  const [showSMA, setShowSMA] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showModelLine, setShowModelLine] = useState(true);
  const [showScenarios, setShowScenarios] = useState(false);
  const [showFloorLine, setShowFloorLine] = useState(true);
  const [showPeakLine, setShowPeakLine] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showMVRV, setShowMVRV] = useState(false);
  const [showFormulaHelp, setShowFormulaHelp] = useState(false);
  const [lastRunAt, setLastRunAt] = useState(() => new Date());

  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);

  const refreshForecast = (delay = 300) => {
    setIsPlaying(false);
    setPlaybackIndex(null);
    setIsGenerating(true);
    const timer = window.setTimeout(() => {
      setDisplayData(processRealData(marketData.ohlcv, horizon, model, CONFIDENCE_Z_SCORES[confidenceLevel]));
      setHeatmapData(generateHeatmapData(marketData.ohlcv, horizon, model));
      setDrawdownStats(computeDrawdownStats(marketData.ohlcv, horizon));
      setLastRunAt(new Date());
      setIsGenerating(false);
    }, delay);

    return () => window.clearTimeout(timer);
  };

  const handleRunForecast = () => {
    refreshForecast(0);
  };

  useEffect(() => {
    return refreshForecast(350);
  }, [horizon, model, confidenceLevel]);

  const activeDisplayData = displayData;

  const historicalCount = useMemo(() =>
    activeDisplayData.filter((d: any) => !d.isForecast).length,
    [activeDisplayData]
  );

  const startPlaybackIndex = useMemo(() => {
    if (timeRange === '1M') return Math.max(0, historicalCount - 30);
    if (timeRange === '3M') return Math.max(0, historicalCount - 90);
    if (timeRange === '6M') return Math.max(0, historicalCount - 180);
    if (timeRange === '1Y') return Math.max(0, historicalCount - 365);
    return 0;
  }, [historicalCount, timeRange]);

  const handlePlay = () => {
    setPlaybackIndex(startPlaybackIndex + 1);
    setIsPlaying(true);
  };

  const handleStop = () => {
    setIsPlaying(false);
    setPlaybackIndex(null);
  };

  useEffect(() => {
    if (!isPlaying || playbackIndex === null) return;
    if (playbackIndex >= historicalCount) {
      setIsPlaying(false);
      setPlaybackIndex(null);
      return;
    }
    const stepSize = Math.max(1, Math.floor((historicalCount - startPlaybackIndex) / 180));
    const timer = setTimeout(() => {
      setPlaybackIndex(prev =>
        prev === null ? null : Math.min(prev + stepSize, historicalCount)
      );
    }, 40);
    return () => clearTimeout(timer);
  }, [isPlaying, playbackIndex, historicalCount, startPlaybackIndex]);

  // Derived stats
  const currentPrice = marketData?.currentPrice ?? 0;
  const priceChange24h = marketData?.priceChange24h ?? 0;
  const forecastPrice = useMemo(() => {
    const fcast = activeDisplayData.filter(d => d.isForecast);
    return fcast.length > 0 ? fcast[fcast.length - 1].close : 0;
  }, [activeDisplayData]);

  const forecastChange = currentPrice ? ((forecastPrice - currentPrice) / currentPrice) * 100 : 0;

  const probabilityForecast = useMemo(() =>
    computeProbabilityForecast(marketData.ohlcv, horizon),
    [marketData.ohlcv, horizon]
  );

  const { annualizedVol, volRisk } = useMemo(() => {
    if (!marketData?.ohlcv || marketData.ohlcv.length < 2) return { annualizedVol: 0, volRisk: 'High' };
    const recent = marketData.ohlcv.slice(-30);
    const returns = recent.slice(1).map((d, i) => Math.log(d.close / recent[i].close));
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const vol = Math.sqrt(variance * 365) * 100;
    const risk = vol > 80 ? 'High' : vol > 50 ? 'Medium' : 'Low';
    return { annualizedVol: vol, volRisk: risk };
  }, [marketData]);

  const volColor = volRisk === 'High' ? 'text-red-400' : volRisk === 'Medium' ? 'text-amber-500' : 'text-emerald-400';

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#070806] text-zinc-50 font-sans selection:bg-amber-400/30">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0b0d0a]/95 shrink-0 shadow-[0_1px_0_rgba(251,191,36,0.14)]">
        <div className="max-w-[1920px] mx-auto px-4 h-16 md:h-[72px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-9 h-9 rounded-lg bg-amber-400 text-black flex items-center justify-center shadow-[0_0_28px_rgba(251,191,36,0.24)]">
              <Bitcoin className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold tracking-tight text-base md:text-lg leading-tight">Block Signal</h1>
              <p className="text-[10px] md:text-xs uppercase tracking-[0.24em] text-zinc-500 truncate">Bitcoin forecast workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3 text-xs text-zinc-400">
            <span className="hidden sm:inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Data through {new Date(marketData.ohlcv[marketData.ohlcv.length - 1].date).getFullYear()}
            </span>
            <span className="inline-flex items-center gap-2 rounded-md border border-amber-400/20 bg-amber-400/10 px-2.5 py-1.5 text-amber-200">
              <RefreshCw className={cn("h-3.5 w-3.5", isGenerating && "animate-spin")} />
              <span className="hidden sm:inline">{isGenerating ? 'Recomputing' : `Updated ${lastRunAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</span>
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
        <div className="max-w-[1920px] mx-auto px-4 py-4 md:py-5 flex flex-col lg:grid lg:grid-cols-[1fr_320px] lg:h-full gap-4 md:gap-5">

        {/* Main Content */}
        <div className="flex flex-col gap-4 md:gap-5 order-1 min-h-0">
          {/* Chart */}
          <Card className="overflow-hidden flex-1 flex flex-col min-h-[400px] rounded-lg border-white/10 bg-[#0c0f0b] shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
            <CardHeader className="border-b border-white/10 bg-white/[0.015] pb-3 md:pb-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3 md:gap-4">
              <div>
                <CardTitle className="text-sm md:text-base uppercase tracking-[0.18em] text-zinc-300">BTC/USD Forward View</CardTitle>
                <p className="mt-1 text-xs text-zinc-500">Forecast auto-refreshes when horizon or model changes.</p>
              </div>
              <div className="flex items-center gap-2 md:gap-4 overflow-x-auto pb-1 sm:pb-0 scrollbar-hide w-full sm:w-auto">
                <div className="flex items-center bg-black/30 rounded-lg p-1 border border-white/10 shrink-0">
                  {['1M', '3M', '6M', '1Y', 'ALL'].map(range => (
                    <button
                      key={range}
                      onClick={() => setTimeRange(range)}
                      className={cn(
                        "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors",
                        timeRange === range
                          ? "bg-amber-400 text-black shadow-sm"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                      )}
                    >
                      {range}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 border-l border-white/10 pl-2 md:pl-4 shrink-0">
                  <button
                    onClick={isPlaying ? handleStop : handlePlay}
                    disabled={isGenerating}
                    title={isPlaying ? 'Stop playback' : 'Play price evolution candle by candle'}
                    className={cn(
                      "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors border flex items-center gap-1",
                      isPlaying
                        ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20"
                        : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                    )}
                  >
                    {isPlaying
                      ? <Square className="w-3 h-3 fill-current" />
                      : <Play className="w-3 h-3 fill-current" />}
                    {isPlaying ? 'Stop' : 'Play'}
                  </button>
                  <button
                    onClick={() => setShowSMA(!showSMA)}
                    className={cn(
                      "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors border",
                      showSMA
                        ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                        : "bg-transparent text-zinc-500 border-transparent hover:bg-zinc-800/50"
                    )}
                  >
                    SMA
                  </button>
                  <button
                    onClick={() => setShowVolume(!showVolume)}
                    className={cn(
                      "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors border",
                      showVolume
                        ? "bg-zinc-800 text-zinc-300 border-zinc-700"
                        : "bg-transparent text-zinc-500 border-transparent hover:bg-zinc-800/50"
                    )}
                  >
                    Vol
                  </button>
                  {model === 'powerlaw' && (
                    <button
                      onClick={() => setShowModelLine(!showModelLine)}
                      className={cn(
                        "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors border",
                        showModelLine
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          : "bg-transparent text-zinc-500 border-transparent hover:bg-zinc-800/50"
                      )}
                    >
                      Path
                    </button>
                  )}
                  {model === 'powerlaw' && (
                    <button
                      onClick={() => setShowScenarios(!showScenarios)}
                      className={cn(
                        "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors border",
                        showScenarios
                          ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                          : "bg-transparent text-zinc-500 border-transparent hover:bg-zinc-800/50"
                      )}
                    >
                      Scenarios
                    </button>
                  )}
                  <button
                    onClick={() => setShowFloorLine(!showFloorLine)}
                    className={cn(
                      "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors border",
                      showFloorLine
                        ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                        : "bg-transparent text-zinc-500 border-transparent hover:bg-zinc-800/50"
                    )}
                  >
                    Floor
                  </button>
                  <button
                    onClick={() => setShowPeakLine(!showPeakLine)}
                    className={cn(
                      "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors border",
                      showPeakLine
                        ? "bg-red-500/10 text-red-400 border-red-500/20"
                        : "bg-transparent text-zinc-500 border-transparent hover:bg-zinc-800/50"
                    )}
                  >
                    Peak
                  </button>
                  <button
                    onClick={() => setShowHeatmap(!showHeatmap)}
                    className={cn(
                      "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors border",
                      showHeatmap
                        ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                        : "bg-transparent text-zinc-500 border-transparent hover:bg-zinc-800/50"
                    )}
                  >
                    Heatmap
                  </button>
                  {mvrvZScoreData.length > 0 && (
                    <button
                      onClick={() => setShowMVRV(!showMVRV)}
                      className={cn(
                        "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors border",
                        showMVRV
                          ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
                          : "bg-transparent text-zinc-500 border-transparent hover:bg-zinc-800/50"
                      )}
                    >
                      MVRV Z
                    </button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 pt-4 md:pt-6 flex-1 min-h-0">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: isGenerating ? 0.5 : 1 }}
                transition={{ duration: 0.3 }}
                className="h-full w-full"
              >
                <ForecastChart
                  data={activeDisplayData}
                  showSMA={showSMA}
                  showVolume={showVolume}
                  showModelLine={model === 'powerlaw' && showModelLine}
                  showScenarios={model === 'powerlaw' && showScenarios}
                  showFloorLine={showFloorLine}
                  showPeakLine={showPeakLine}
                  showHeatmap={showHeatmap}
                  heatmapData={heatmapData}
                  timeRange={timeRange}
                  playbackIndex={playbackIndex}
                  mvrvData={mvrvZScoreData}
                  showMVRV={showMVRV}
                  probabilityForecast={probabilityForecast}
                />
              </motion.div>
            </CardContent>
          </Card>

          {/* Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3 shrink-0">
            <Card className="rounded-lg border-white/10 bg-[#11140f]">
              <CardContent className="p-3 md:p-4">
                <div className="mb-2 flex items-center gap-2 text-[10px] md:text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  <CircleDollarSign className="h-3.5 w-3.5 text-amber-400" />
                  Current Price
                </div>
                <p className="text-lg md:text-2xl font-semibold font-mono text-zinc-100">
                  {currentPrice ? formatPrice(currentPrice) : '—'}
                </p>
                {priceChange24h !== 0 && (
                  <p className={cn("text-[10px] md:text-xs font-mono mt-0.5", priceChange24h >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}% 24h
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-lg border-amber-400/20 bg-amber-400/[0.06]">
              <CardContent className="p-3 md:p-4">
                <div className="mb-2 flex items-center gap-2 text-[10px] md:text-xs font-medium text-amber-200/80 uppercase tracking-wider">
                  <CalendarClock className="h-3.5 w-3.5 text-amber-300" />
                  Target {formatHorizonLabel(horizon)}
                </div>
                <p className="text-lg md:text-2xl font-semibold font-mono text-amber-100">
                  {forecastPrice ? formatPrice(forecastPrice) : '—'}
                </p>
                {probabilityForecast && (
                  <p className="mt-0.5 text-[10px] font-medium text-amber-200/70">
                    {probabilityForecast.calibrationLabel}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-lg border-white/10 bg-[#11140f]">
              <CardContent className="p-3 md:p-4">
                <div className="mb-2 flex items-center gap-2 text-[10px] md:text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                  Forecast Delta
                </div>
                <p className={cn("text-lg md:text-2xl font-semibold font-mono", forecastChange >= 0 ? "text-emerald-400" : "text-red-400")}>
                  {forecastChange >= 0 ? '+' : ''}{forecastChange.toFixed(2)}%
                </p>
              </CardContent>
            </Card>
            <Card className="rounded-lg border-white/10 bg-[#11140f]">
              <CardContent className="p-3 md:p-4">
                <div className="mb-2 flex items-center gap-2 text-[10px] md:text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  <Gauge className="h-3.5 w-3.5 text-sky-400" />
                  30D Volatility
                </div>
                <div className="flex items-baseline gap-2">
                  <p className={cn("text-lg md:text-2xl font-semibold font-mono", volColor)}>
                    {annualizedVol ? annualizedVol.toFixed(0) + '%' : '—'}
                  </p>
                  <p className={cn("text-[10px] font-medium", volColor)}>{volRisk}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4 md:space-y-5 order-2 min-h-0 lg:overflow-y-auto lg:scrollbar-hide">
          <Card className="rounded-lg border-amber-400/20 bg-[#11110c]">
            <CardHeader className="p-4 md:p-5">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <Layers3 className="w-4 h-4 text-amber-300" />
                  Forecast Console
                </span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  isGenerating ? "bg-amber-400/15 text-amber-200" : "bg-emerald-400/10 text-emerald-300"
                )}>
                  {isGenerating ? 'Live' : 'Ready'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 md:space-y-5 p-4 pt-0 md:p-5 md:pt-0">
              <div className="space-y-1.5 md:space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] md:text-xs font-medium text-zinc-500 uppercase tracking-wider">Model</label>
                  {model === 'powerlaw' && (
                    <button
                      onClick={() => setShowFormulaHelp(true)}
                      className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-amber-300 transition-colors"
                      title="View Power Law formula"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs md:text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                >
                  <option value="powerlaw">BTC Power Law</option>
                  <option value="transformer">Temporal Fusion Transformer</option>
                  <option value="lstm">LSTM Network</option>
                  <option value="prophet">Facebook Prophet</option>
                  <option value="arima">ARIMA (Baseline)</option>
                </select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] md:text-xs font-medium text-zinc-500 uppercase tracking-wider">Forecast Horizon</label>
                  <span className="text-[10px] text-amber-200/70">auto-run</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {HORIZON_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setHorizon(option.value)}
                      className={cn(
                        "h-8 rounded-md border text-xs font-semibold transition-colors",
                        horizon === option.value
                          ? "border-amber-300 bg-amber-300 text-black"
                          : "border-white/10 bg-black/20 text-zinc-400 hover:border-amber-300/50 hover:text-zinc-100"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 md:space-y-2">
                <label className="text-[10px] md:text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  {horizon >= 180 ? 'Scenario Envelope' : 'Interval Band'}
                </label>
                <select
                  value={confidenceLevel}
                  onChange={(e) => setConfidenceLevel(Number(e.target.value) as keyof typeof CONFIDENCE_Z_SCORES)}
                  className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs md:text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                >
                  <option value={0.95}>{formatIntervalOption(0.95, horizon, probabilityForecast?.calibrationLabel)}</option>
                  <option value={0.9}>{formatIntervalOption(0.9, horizon, probabilityForecast?.calibrationLabel)}</option>
                  <option value={0.8}>{formatIntervalOption(0.8, horizon, probabilityForecast?.calibrationLabel)}</option>
                </select>
                {model === 'powerlaw' && (
                  <p className="text-[10px] leading-relaxed text-zinc-500">
                    Amber path = median path. Dotted bands show {horizon >= 180 ? 'scenario range' : 'calibrated risk range'}. Scenario sketches stay hidden unless enabled.
                  </p>
                )}
              </div>

              <Button
                onClick={handleRunForecast}
                disabled={isGenerating}
                className="w-full mt-2 md:mt-4 bg-zinc-100 text-black hover:bg-amber-300"
              >
                {isGenerating ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Activity className="w-4 h-4 mr-2" />
                )}
                {isGenerating ? 'Computing...' : 'Refresh Now'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="flex items-center gap-2 text-sm">
                <BarChart2 className="w-4 h-4 text-zinc-400" />
                Market Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0">
              <div className="space-y-2 md:space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs md:text-sm text-zinc-400">24h Change</span>
                  <span className={cn("text-xs md:text-sm font-mono", priceChange24h >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs md:text-sm text-zinc-400">Market Cap</span>
                  <span className="text-xs md:text-sm font-mono text-zinc-200">
                    {formatMarketCap(marketData.marketCap)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs md:text-sm text-zinc-400">24h Volume</span>
                  <span className="text-xs md:text-sm font-mono text-zinc-200">
                    {formatMarketCap(marketData.volume24h)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs md:text-sm text-zinc-400">Ann. Volatility</span>
                  <span className={cn("text-xs md:text-sm font-mono", volColor)}>
                    {annualizedVol ? annualizedVol.toFixed(1) + '%' : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs md:text-sm text-zinc-400">Data Source</span>
                  <span className="text-xs md:text-sm font-mono text-zinc-400">CoinGecko + CryptoCompare</span>
                </div>
                {mvrvStats.currentMVRV !== null && (
                  <>
                    <div className="border-t border-white/5 my-1" />
                    <div className="flex justify-between items-center">
                      <span className="text-xs md:text-sm text-zinc-400">MVRV Ratio</span>
                      <span className="text-xs md:text-sm font-mono text-zinc-200">
                        {mvrvStats.currentMVRV.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs md:text-sm text-zinc-400">MVRV Z-Score</span>
                      <span className={cn("text-xs md:text-sm font-mono", mvrvStats.signalColor)}>
                        {mvrvStats.zScore!.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs md:text-sm text-zinc-400">Cycle Signal</span>
                      <span className={cn("text-xs md:text-sm font-medium", mvrvStats.signalColor)}>
                        {mvrvStats.signal}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Zap className="w-4 h-4 text-amber-400" />
                Supply &amp; Halvings
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0 space-y-3 md:space-y-4">
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-[10px] md:text-xs font-medium text-zinc-400 uppercase tracking-wider">Next Halving (H5)</span>
                  <span className="text-xs font-mono text-amber-400">{halvingInfo.daysUntil}d</span>
                </div>
                <p className="text-sm md:text-base font-mono text-zinc-200">{halvingInfo.nextDate}</p>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs md:text-sm text-zinc-400">Block Reward</span>
                  <span className="text-xs md:text-sm font-mono text-zinc-200">
                    {halvingInfo.currentReward} <span className="text-zinc-500">→</span> {halvingInfo.nextReward} BTC
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs md:text-sm text-zinc-400">Daily Issuance</span>
                  <span className="text-xs md:text-sm font-mono text-zinc-200">
                    ~{halvingInfo.dailyIssuance} <span className="text-zinc-500">→</span> ~{halvingInfo.nextDailyIssuance} BTC
                  </span>
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs md:text-sm text-zinc-400">Circulating Supply</span>
                  <span className="text-xs font-mono text-zinc-300">
                    {(CIRCULATING_SUPPLY / 1_000_000).toFixed(2)}M / 21M
                  </span>
                </div>
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500/70 rounded-full"
                    style={{ width: `${(CIRCULATING_SUPPLY / MAX_SUPPLY) * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-zinc-500 mt-1 text-right">
                  {((CIRCULATING_SUPPLY / MAX_SUPPLY) * 100).toFixed(1)}% mined
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="flex items-center gap-2 text-sm">
                <TrendingDown className="w-4 h-4 text-red-400" />
                Drawdown Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0 space-y-4">
              {/* Cycle 4 bear projection */}
              <div>
                <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-2">
                  Cycle {drawdownStats.cycleIndex} Bear Projection
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-400">Projected Max DD</span>
                    <span className="text-xs font-mono text-red-400">
                      -{drawdownStats.projectedMDD.toFixed(1)}%
                    </span>
                  </div>
                  {drawdownStats.cycleHighPrice > 0 && (
                    <>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-400">Cycle ATH</span>
                        <span className="text-xs font-mono text-zinc-200">
                          {formatPrice(drawdownStats.cycleHighPrice)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-400">Current from ATH</span>
                        <span className={cn(
                          "text-xs font-mono",
                          drawdownStats.currentDrawdownPct > 0 ? "text-red-400" : "text-emerald-400"
                        )}>
                          -{drawdownStats.currentDrawdownPct.toFixed(1)}%
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div>
                        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-1">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${drawdownStats.drawdownProgress * 100}%`,
                              backgroundColor: drawdownStats.drawdownProgress < 0.4
                                ? 'rgb(52 211 153)' // emerald
                                : drawdownStats.drawdownProgress < 0.75
                                ? 'rgb(251 146 60)' // orange
                                : 'rgb(248 113 113)', // red
                            }}
                          />
                        </div>
                        <p className="text-[10px] text-zinc-500 mt-1 text-right">
                          {(drawdownStats.drawdownProgress * 100).toFixed(0)}% of projected MDD reached
                        </p>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-400">Bear Floor Est.</span>
                        <span className="text-xs font-mono text-zinc-300">
                          {formatPrice(drawdownStats.impliedFloorFromCycleHigh)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* GBM Monte Carlo MDD */}
              <div className="border-t border-white/5 pt-3">
                <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-2">
                  GBM E[MDD] · {formatHorizonLabel(drawdownStats.gbmHorizonDays)}
                </p>
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-400">Expected</span>
                    <span className="text-xs font-mono text-amber-400">
                      -{drawdownStats.gbmExpectedMDD.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-400">Worst 5%</span>
                    <span className="text-xs font-mono text-red-400">
                      -{drawdownStats.gbmP95MDD.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Cycle history mini bar chart */}
              <div className="border-t border-white/5 pt-3">
                <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-2">
                  Cycle History
                </p>
                <div className="space-y-1.5">
                  {HISTORICAL_CYCLE_DRAWDOWNS.map(({ cycle, label, pct }) => (
                    <div key={cycle} className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-zinc-500 w-14 shrink-0">C{cycle} {label.slice(0, 4)}</span>
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-zinc-500 rounded-full"
                          style={{ width: `${(pct / 90) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400 w-10 text-right shrink-0">
                        -{pct}%
                      </span>
                    </div>
                  ))}
                  {/* Cycle 4 projection */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-400 w-14 shrink-0">C4 proj.</span>
                    <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-500/60 rounded-full"
                        style={{ width: `${(drawdownStats.projectedMDD / 90) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-red-400 w-10 text-right shrink-0">
                      -{drawdownStats.projectedMDD.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        </div>
      </main>

      {/* Power Law Formula Modal */}
      {showFormulaHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowFormulaHelp(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h3 className="font-semibold text-sm text-zinc-100">BTC Power Law Model</h3>
              <button onClick={() => setShowFormulaHelp(false)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4 text-xs md:text-sm">
              <div>
                <h4 className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-2">Core Structural Model</h4>
                <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-[11px] md:text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre">
{`P(t) = a * t^b * (1 + c₁·sin(ωt) + c₂·cos(ωt))

where:
  t  = days since Genesis block (2009-01-03)
  a  = 9.48 × 10⁻¹⁰
  b  = 3.6702
  c₁ = 0.2323   (sine amplitude)
  c₂ = 0.4288   (cosine amplitude)
  ω  = 2π / 1460  (≈ 4-year cycle)`}</pre>
              </div>
              <div>
                <h4 className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-2">Mean-Reverting Correction (all horizons)</h4>
                <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-[11px] md:text-xs font-mono text-amber-400 overflow-x-auto whitespace-pre">
{`F(t_future) = P(t_future) * exp(r_t * exp(-h / τ))

where:
  r_t = ln(current_price) - ln(P(t_now))
  h   = forecast horizon in days
  τ   = 210  (residual decay constant)`}</pre>
              </div>
              <div>
                <h4 className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-2">Calibrated Forecast Interval</h4>
                <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-[11px] md:text-xs font-mono text-sky-300 overflow-x-auto whitespace-pre">
{`CI_h = F_h * exp(± z * stress(h) * sqrt(σ² * Σ exp(-2k/τ)))

where:
  z = 1.28, 1.64, or 1.96
  σ = blended 90d/365d realized volatility
  stress(h) rises with horizon for BTC fat tails
  k = 0..h-1
  no long-horizon visual cap`}</pre>
              </div>
              <p className="text-zinc-500 text-[10px] leading-relaxed">
                The model combines a power-law growth trend with a 4-year sinusoidal cycle aligned to BTC halvings.
                A mean-reverting correction anchors the prediction to the current market price for all horizons,
                decaying exponentially with time constant &tau;=210 days toward the pure power law as h grows.
                Forecast bands now use residual-process volatility plus a horizon stress ramp instead of
                clipping long-range uncertainty to a cosmetic ±50% envelope.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

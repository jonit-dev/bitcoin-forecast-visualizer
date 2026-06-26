import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import { Activity, TrendingUp, TrendingDown, RefreshCw, BarChart2, Play, Square, Zap, Bitcoin, CalendarClock, Gauge, Layers3, CircleDollarSign, LineChart, Workflow } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { ForecastChart } from './components/Chart';
import {
  coefficientAwareCalibrationLabel,
  coefficientStabilityTrustCopy,
  HISTORICAL_CYCLE_DRAWDOWNS,
  CONFIDENCE_Z_SCORES,
} from './lib/data';
import { computeMVRVStats, computeMVRVZScoreSeries, loadMarketData, type MarketAssetId, type MarketData, type MVRVStats } from './lib/api';
import { cn } from './lib/utils';
import { loadCurrentRegimeSummary, loadPowerLawStabilitySummary, loadReliabilitySummary, loadSourceFreshness } from './lib/reliabilityReport';
import { buildMarketForecast, getMarketAssetConfig, MARKET_ASSETS } from './lib/marketForecast';
import { computeCrossMarketContext } from './lib/crossMarket';
import buyZoneSummaryData from './data/buy-zone-summary.json';
import type { BuyZoneSummary } from './lib/buyZone';
import { computeTradingSystemSummary } from './lib/tradingSystem';

function formatHorizonLabel(days: number): string {
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}M`;
  return `${Math.round(days / 365)}Y`;
}

function formatPrice(n: number) {
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatSignedPercent(value: number, digits = 1): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

function formatUnsignedPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatCompactCurrency(value: number): string {
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatIntervalOption(level: number, horizonDays: number, calibrationLabel?: string): string {
  const pct = `${Math.round(level * 100)}%`;
  if (horizonDays >= 180) return `${pct} ${(calibrationLabel ?? 'Scenario range').toLowerCase()}`;
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
const BUY_ZONE_SUMMARY = buyZoneSummaryData as unknown as BuyZoneSummary;
const PRIMARY_BUY_ZONE_BACKTEST = BUY_ZONE_SUMMARY.backtests.find((result) => result.id === 'heavy-buy-zone') ?? BUY_ZONE_SUMMARY.backtests[0];
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

function formatCompactCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

export default function App() {
  const [activeAssetId, setActiveAssetId] = useState<MarketAssetId>('btc');
  const [marketDataByAsset] = useState<Record<MarketAssetId, MarketData>>(() => ({
    btc: loadMarketData('btc'),
    sp500: loadMarketData('sp500'),
    gold: loadMarketData('gold'),
  }));
  const [mvrvStats] = useState<MVRVStats>(() => computeMVRVStats());
  const [mvrvZScoreData] = useState(() => computeMVRVZScoreSeries());
  const [tradingSystemSummary] = useState(() => computeTradingSystemSummary());
  const [reliabilitySummary] = useState(() => loadReliabilitySummary());
  const [powerLawStabilitySummary] = useState(() => loadPowerLawStabilitySummary());
  const [sourceFreshness] = useState(() => loadSourceFreshness());
  const [currentRegimeSummary] = useState(() => loadCurrentRegimeSummary());
  const regimeContext = currentRegimeSummary.regime;
  const tailRisk = currentRegimeSummary.tailRisk;
  const derivativesContext = currentRegimeSummary.derivativesContext;
  const networkContext = currentRegimeSummary.networkContext;
  const halvingInfo = useMemo(() => getHalvingInfo(), []);
  const [horizon, setHorizon] = useState(180);
  const [confidenceLevel, setConfidenceLevel] = useState<keyof typeof CONFIDENCE_Z_SCORES>(0.95);
  const [isGenerating, setIsGenerating] = useState(false);
  const initialForecast = useMemo(() =>
    buildMarketForecast('btc', marketDataByAsset.btc, 180, CONFIDENCE_Z_SCORES[0.95]),
    [marketDataByAsset]
  );
  const [forecastResult, setForecastResult] = useState(() => initialForecast);

  // Chart Controls
  const [timeRange, setTimeRange] = useState('ALL');
  const [showSMA, setShowSMA] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showModelLine, setShowModelLine] = useState(true);
  const [showScenarios, setShowScenarios] = useState(false);
  const [showFloorLine, setShowFloorLine] = useState(true);
  const [showPeakLine, setShowPeakLine] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showBuyZones, setShowBuyZones] = useState(true);
  const [showTradingSystem, setShowTradingSystem] = useState(false);
  const [showMVRV, setShowMVRV] = useState(false);
  const [lastRunAt, setLastRunAt] = useState(() => new Date());
  const activeAsset = getMarketAssetConfig(activeAssetId);
  const marketData = marketDataByAsset[activeAssetId];
  const canShowBitcoinOverlays = activeAsset.capabilities.bitcoinOverlays;
  const crossMarketContext = useMemo(() =>
    computeCrossMarketContext(marketDataByAsset.btc.ohlcv, marketDataByAsset.sp500.ohlcv, 90),
    [marketDataByAsset]
  );

  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const forecastInitialized = React.useRef(false);

  const refreshForecast = (delay = 300) => {
    setIsPlaying(false);
    setPlaybackIndex(null);
    setIsGenerating(true);
    const timer = window.setTimeout(() => {
      setForecastResult(buildMarketForecast(activeAssetId, marketData, horizon, CONFIDENCE_Z_SCORES[confidenceLevel]));
      setLastRunAt(new Date());
      setIsGenerating(false);
    }, delay);

    return () => window.clearTimeout(timer);
  };

  const handleRunForecast = () => {
    refreshForecast(0);
  };

  useEffect(() => {
    if (!forecastInitialized.current) {
      forecastInitialized.current = true;
      return;
    }
    return refreshForecast(350);
  }, [horizon, confidenceLevel, activeAssetId]);

  const activeDisplayData = forecastResult.displayData;
  const heatmapData = forecastResult.heatmapData;
  const buyZoneSummary = canShowBitcoinOverlays ? BUY_ZONE_SUMMARY : null;
  const latestBuyZone = buyZoneSummary?.latest ?? null;
  const primaryBuyZoneBacktest = canShowBitcoinOverlays ? PRIMARY_BUY_ZONE_BACKTEST : null;
  const tradingSystemChartData = useMemo(() => {
    const step = Math.max(1, Math.floor(tradingSystemSummary.points.length / 180));
    return tradingSystemSummary.points
      .filter((_, index) => index % step === 0 || index === tradingSystemSummary.points.length - 1)
      .map(point => ({
        date: point.date,
        system: Math.round(point.value),
        buyHold: Math.round(point.buyHoldValue),
      }));
  }, [tradingSystemSummary.points]);
  const drawdownStats = forecastResult.drawdownStats;
  const probabilityForecast = forecastResult.probabilityForecast;
  const adjustedProbabilityForecast = useMemo(() => {
    if (!probabilityForecast || activeAssetId !== 'btc') return probabilityForecast;
    if (probabilityForecast.horizonDays < 180) return probabilityForecast;
    return {
      ...probabilityForecast,
      calibrationLabel: coefficientAwareCalibrationLabel(
        probabilityForecast.horizonDays,
        probabilityForecast.calibrationLabel,
        powerLawStabilitySummary.verdict
      ),
    };
  }, [activeAssetId, probabilityForecast, powerLawStabilitySummary.verdict]);

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
    if (!canShowBitcoinOverlays) {
      setShowMVRV(false);
    }
  }, [canShowBitcoinOverlays]);

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
    if ((activeAssetId === 'sp500' || activeAssetId === 'gold') && probabilityForecast?.median) {
      return probabilityForecast.median;
    }
    const fcast = activeDisplayData.filter(d => d.isForecast);
    return fcast.length > 0 ? fcast[fcast.length - 1].close : 0;
  }, [activeAssetId, activeDisplayData, probabilityForecast]);

  const forecastChange = currentPrice ? ((forecastPrice - currentPrice) / currentPrice) * 100 : 0;

  const { annualizedVol, volRisk } = useMemo(() => {
    if (!marketData?.ohlcv || marketData.ohlcv.length < 2) return { annualizedVol: 0, volRisk: 'High' };
    const recent = marketData.ohlcv.slice(-30);
    const returns = recent.slice(1).map((d, i) => Math.log(d.close / recent[i].close));
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const annualizationDays = activeAssetId === 'btc' ? 365 : 252;
    const vol = Math.sqrt(variance * annualizationDays) * 100;
    const risk = activeAssetId !== 'btc'
      ? (vol > 30 ? 'High' : vol > 18 ? 'Medium' : 'Low')
      : (vol > 80 ? 'High' : vol > 50 ? 'Medium' : 'Low');
    return { annualizedVol: vol, volRisk: risk };
  }, [marketData, activeAssetId]);

  const volColor = volRisk === 'High' ? 'text-red-400' : volRisk === 'Medium' ? 'text-amber-500' : 'text-emerald-400';

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#070806] text-zinc-50 font-sans selection:bg-amber-400/30">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0b0d0a]/95 shrink-0 shadow-[0_1px_0_rgba(251,191,36,0.14)]">
        <div className="max-w-[1920px] mx-auto px-4 h-16 md:h-[72px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-9 h-9 rounded-lg bg-amber-400 text-black flex items-center justify-center shadow-[0_0_28px_rgba(251,191,36,0.24)]">
              {activeAssetId === 'btc' ? <Bitcoin className="w-4 h-4" /> : <LineChart className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold tracking-tight text-base md:text-lg leading-tight">Block Signal</h1>
              <p className="text-[10px] md:text-xs uppercase tracking-[0.24em] text-zinc-500 truncate">{activeAsset.subtitle}</p>
            </div>
          </div>
          <div className="hidden md:flex items-center bg-black/30 rounded-lg p-1 border border-white/10 shrink-0">
            {MARKET_ASSETS.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => setActiveAssetId(asset.id)}
                className={cn(
                  "h-8 px-3 rounded-md text-xs font-semibold transition-colors",
                  activeAssetId === asset.id
                    ? "bg-amber-400 text-black"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                )}
              >
                {asset.shortLabel}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 md:gap-3 text-xs text-zinc-400">
            <span className="hidden sm:inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {activeAsset.ticker} through {marketData.ohlcv[marketData.ohlcv.length - 1].date}
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
          <div className="md:hidden flex items-center bg-black/30 rounded-lg p-1 border border-white/10 shrink-0">
            {MARKET_ASSETS.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => setActiveAssetId(asset.id)}
                className={cn(
                  "h-8 flex-1 rounded-md text-xs font-semibold transition-colors",
                  activeAssetId === asset.id
                    ? "bg-amber-400 text-black"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                )}
              >
                {asset.shortLabel}
              </button>
            ))}
          </div>
          {/* Chart */}
          <Card className="overflow-hidden flex-1 flex flex-col min-h-[400px] rounded-lg border-white/10 bg-[#0c0f0b] shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
            <CardHeader className="border-b border-white/10 bg-white/[0.015] pb-3 md:pb-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3 md:gap-4">
              <div>
                <CardTitle className="text-sm md:text-base uppercase tracking-[0.18em] text-zinc-300">{activeAsset.chartTitle}</CardTitle>
                <p className="mt-1 text-xs text-zinc-500">{activeAsset.instrumentLabel}. Forecast auto-refreshes when horizon or interval changes.</p>
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
                  <button
                    onClick={() => setShowFloorLine(!showFloorLine)}
                    className={cn(
                      "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors border",
                      showFloorLine
                        ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                        : "bg-transparent text-zinc-500 border-transparent hover:bg-zinc-800/50"
                    )}
                  >
                    {canShowBitcoinOverlays ? 'Floor' : 'Lower'}
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
                    {canShowBitcoinOverlays ? 'Peak' : 'Top'}
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
                  {canShowBitcoinOverlays && (
                    <button
                      onClick={() => setShowBuyZones(!showBuyZones)}
                      className={cn(
                        "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors border",
                        showBuyZones
                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                          : "bg-transparent text-zinc-500 border-transparent hover:bg-zinc-800/50"
                      )}
                    >
                      Buy Zones
                    </button>
                  )}
                  {canShowBitcoinOverlays && (
                    <button
                      onClick={() => setShowTradingSystem(!showTradingSystem)}
                      className={cn(
                        "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors border",
                        showTradingSystem
                          ? "bg-lime-500/10 text-lime-300 border-lime-500/20"
                          : "bg-transparent text-zinc-500 border-transparent hover:bg-zinc-800/50"
                      )}
                    >
                      Trading System
                    </button>
                  )}
                  {canShowBitcoinOverlays && mvrvZScoreData.length > 0 && (
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
                initial={false}
                animate={{ opacity: isGenerating ? 0.5 : 1 }}
                transition={{ duration: 0.3 }}
                className="h-full w-full"
              >
                <ForecastChart
                  data={activeDisplayData}
                  showSMA={showSMA}
                  showVolume={showVolume}
                  showModelLine={showModelLine}
                  showScenarios={showScenarios}
                  showFloorLine={showFloorLine}
                  showPeakLine={showPeakLine}
                  showHeatmap={showHeatmap}
                  heatmapData={heatmapData}
                  showBuyZones={showBuyZones}
                  buyZones={buyZoneSummary?.zones ?? []}
                  showTradingSystem={showTradingSystem}
                  tradingSystemMarkers={tradingSystemSummary.markers}
                  timeRange={timeRange}
                  playbackIndex={playbackIndex}
                  mvrvData={mvrvZScoreData}
                  showMVRV={showMVRV}
                  showBitcoinOverlays={canShowBitcoinOverlays}
                  probabilityForecast={adjustedProbabilityForecast}
                />
              </motion.div>
            </CardContent>
          </Card>

          {/* Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 md:gap-3 shrink-0">
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
            {latestBuyZone && primaryBuyZoneBacktest && (
              <Card className={cn(
                "rounded-lg",
                latestBuyZone.isHeavyBuy
                  ? "border-emerald-400/30 bg-emerald-400/[0.08]"
                  : "border-white/10 bg-[#11140f]"
              )}>
                <CardContent className="p-3 md:p-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] md:text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />
                    Buy Zone
                  </div>
                  <p className={cn(
                    "text-lg md:text-2xl font-semibold font-mono",
                    latestBuyZone.isMaxConviction ? "text-emerald-200" : latestBuyZone.isHeavyBuy ? "text-emerald-300" : "text-zinc-100"
                  )}>
                    {(latestBuyZone.bottomScore * 100).toFixed(0)}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
                    {latestBuyZone.isMaxConviction ? 'Max conviction' : latestBuyZone.isHeavyBuy ? 'Heavy buy active' : 'Not active'} · 1Y med {formatUnsignedPercent(primaryBuyZoneBacktest.medianReturn1y ?? 0, 0)}
                  </p>
                </CardContent>
              </Card>
            )}
            <Card className="rounded-lg border-amber-400/20 bg-amber-400/[0.06]">
              <CardContent className="p-3 md:p-4">
                <div className="mb-2 flex items-center gap-2 text-[10px] md:text-xs font-medium text-amber-200/80 uppercase tracking-wider">
                  <CalendarClock className="h-3.5 w-3.5 text-amber-300" />
                  Target {formatHorizonLabel(horizon)}
                </div>
                <p className="text-lg md:text-2xl font-semibold font-mono text-amber-100">
                  {forecastPrice ? formatPrice(forecastPrice) : '—'}
                </p>
                {adjustedProbabilityForecast && (
                  <p className="mt-0.5 text-[10px] font-medium text-amber-200/70">
                    {adjustedProbabilityForecast.calibrationLabel}
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
                  {coefficientAwareCalibrationLabel(horizon, 'Interval Band', activeAssetId === 'btc' ? powerLawStabilitySummary.verdict : undefined)}
                </label>
                <select
                  value={confidenceLevel}
                  onChange={(e) => setConfidenceLevel(Number(e.target.value) as keyof typeof CONFIDENCE_Z_SCORES)}
                  className="w-full bg-black/30 border border-white/10 rounded-md px-3 py-2 text-xs md:text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                >
                  <option value={0.95}>{formatIntervalOption(0.95, horizon, adjustedProbabilityForecast?.calibrationLabel)}</option>
                  <option value={0.9}>{formatIntervalOption(0.9, horizon, adjustedProbabilityForecast?.calibrationLabel)}</option>
                  <option value={0.8}>{formatIntervalOption(0.8, horizon, adjustedProbabilityForecast?.calibrationLabel)}</option>
                </select>
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  {coefficientStabilityTrustCopy(horizon, activeAssetId === 'btc' ? powerLawStabilitySummary.verdict : undefined)}
                </p>
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

          {latestBuyZone && primaryBuyZoneBacktest && (
            <Card className="rounded-lg border-emerald-400/20 bg-[#0b120d]">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-emerald-300" />
                    Heavy Buy Lab
                  </span>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    latestBuyZone.isHeavyBuy ? "bg-emerald-400/15 text-emerald-200" : "bg-zinc-800 text-zinc-400"
                  )}>
                    {latestBuyZone.isHeavyBuy ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 md:p-5 md:pt-0 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs md:text-sm text-zinc-400">Bottom score</span>
                  <span className="text-xs md:text-sm font-mono text-emerald-200">{(latestBuyZone.bottomScore * 100).toFixed(1)} / 70</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs md:text-sm text-zinc-400">MVRV / realized dist pct</span>
                  <span className="text-xs md:text-sm font-mono text-zinc-200">
                    {formatUnsignedPercent(latestBuyZone.mvrvPercentile ?? 0, 0)} / {formatUnsignedPercent(latestBuyZone.realizedPctPast ?? 0, 0)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs md:text-sm text-zinc-400">Backtest 1Y / 2Y median</span>
                  <span className="text-xs md:text-sm font-mono text-emerald-300">
                    {formatSignedPercent(primaryBuyZoneBacktest.medianReturn1y ?? 0, 0)} / {formatSignedPercent(primaryBuyZoneBacktest.medianReturn2y ?? 0, 0)}
                  </span>
                </div>
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  Overlay is leakage-safe: power-law residual, MVRV, realized-price distance, and drawdown pain are ranked only against prior history. Historically strong, but still allowed roughly {formatSignedPercent(primaryBuyZoneBacktest.medianWorstDrawdown180d ?? 0, 0)} median next-180d drawdown.
                </p>
              </CardContent>
            </Card>
          )}

          {canShowBitcoinOverlays && showTradingSystem && (
            <Card className="rounded-lg border-lime-400/20 bg-[#0c1209]">
              <CardHeader className="p-4 md:p-5">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Workflow className="w-4 h-4 text-lime-300" />
                    Trading System
                  </span>
                  <span className="rounded-full bg-lime-400/10 px-2 py-0.5 text-[10px] font-medium text-lime-200">
                    NO LEVERAGE
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 md:p-5 md:pt-0 space-y-3">
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={tradingSystemChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <XAxis dataKey="date" hide />
                      <YAxis hide domain={['dataMin', 'dataMax']} />
                      <Tooltip
                        contentStyle={{ background: '#090b08', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#e4e4e7' }}
                        formatter={(value: number, name: string) => [formatCompactCurrency(value), name === 'system' ? 'System' : 'Buy & Hold']}
                        labelStyle={{ color: '#a1a1aa' }}
                      />
                      <Area type="monotone" dataKey="buyHold" stroke="#71717a" fill="#71717a" fillOpacity={0.05} strokeWidth={1} dot={false} />
                      <Area type="monotone" dataKey="system" stroke="#a3e635" fill="#65a30d" fillOpacity={0.18} strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-white/5 bg-black/20 p-2">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">System</p>
                    <p className="mt-1 font-mono text-lg text-lime-200">{formatCompactCurrency(tradingSystemSummary.finalValue)}</p>
                    <p className="text-[10px] text-lime-300">{formatSignedPercent(tradingSystemSummary.cagr)} CAGR</p>
                  </div>
                  <div className="rounded-md border border-white/5 bg-black/20 p-2">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">Buy & Hold</p>
                    <p className="mt-1 font-mono text-lg text-zinc-200">{formatCompactCurrency(tradingSystemSummary.buyHoldFinalValue)}</p>
                    <p className="text-[10px] text-zinc-400">{formatSignedPercent(tradingSystemSummary.buyHoldCagr)} CAGR</p>
                  </div>
                </div>
                <div className="space-y-1.5 border-t border-white/5 pt-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Max drawdown</span>
                    <span className="font-mono text-lime-200">
                      {formatSignedPercent(tradingSystemSummary.maxDrawdown)} vs {formatSignedPercent(tradingSystemSummary.buyHoldMaxDrawdown)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Avg exposure / trades</span>
                    <span className="font-mono text-zinc-200">
                      {formatUnsignedPercent(tradingSystemSummary.averageExposure)} / {tradingSystemSummary.trades}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Fees / borrow</span>
                    <span className="font-mono text-zinc-200">
                      {formatCompactCurrency(tradingSystemSummary.feesPaid)} / {formatCompactCurrency(tradingSystemSummary.borrowCost)}
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5 border-t border-white/5 pt-3 text-[10px] leading-relaxed">
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Buy</span>
                    <span className="text-right text-zinc-300">Target 100% BTC after confirmed uptrend or high-probability bottom zone.</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Trim</span>
                    <span className="text-right text-zinc-300">Target 35% BTC / 65% reserve after 14 hot-valuation days.</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Raise</span>
                    <span className="text-right text-zinc-300">Return to 100% BTC only after 45 cool-valuation days.</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Exit</span>
                    <span className="text-right text-zinc-300">Move to 100% reserve after 10 confirmed trend-break days.</span>
                  </div>
                </div>
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  Chart markers are full portfolio targets after rebalance, not cumulative buys or sells.
                </p>
              </CardContent>
            </Card>
          )}

          {activeAsset.capabilities.modelTrust && (
          <Card>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Gauge className="w-4 h-4 text-sky-400" />
                Model Trust
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs md:text-sm text-zinc-400">14-90d Backtest</span>
                <span className={cn("text-xs md:text-sm font-mono", reliabilitySummary.qualityGateStatus === 'PASS' ? "text-emerald-400" : "text-red-400")}>
                  {reliabilitySummary.qualityGateStatus}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs md:text-sm text-zinc-400">14-90d Score</span>
                <span className="text-xs md:text-sm font-mono text-zinc-200">{reliabilitySummary.reliabilityScore}/100</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs md:text-sm text-zinc-400">Active Model</span>
                <span className="text-xs md:text-sm font-medium text-amber-200">
                  {reliabilitySummary.ensembleEnabled ? 'Regime ensemble' : 'Power-law'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs md:text-sm text-zinc-400">180d+ Stability</span>
                <span className={cn(
                  "text-xs md:text-sm font-mono",
                  powerLawStabilitySummary.verdict === 'stable' ? "text-emerald-400" : powerLawStabilitySummary.verdict === 'unstable' ? "text-red-400" : "text-amber-300"
                )}>
                  {powerLawStabilitySummary.verdict}
                </span>
              </div>
              {horizon >= 180 && (
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  {coefficientStabilityTrustCopy(horizon, powerLawStabilitySummary.verdict)}
                </p>
              )}
              {horizon < 180 && powerLawStabilitySummary.verdict === 'unstable' && (
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  Short-horizon backtests passed, but the long-horizon coefficient refit is unstable.
                </p>
              )}
            </CardContent>
          </Card>
          )}

          {activeAsset.capabilities.bitcoinOverlays && (
          <Card>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Layers3 className="w-4 h-4 text-amber-300" />
                Regime Context
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs md:text-sm text-zinc-400">Top State</span>
                <span className="text-xs md:text-sm font-medium text-zinc-200">{regimeContext.topState}</span>
              </div>
              <div className="space-y-1">
                {(Object.entries(regimeContext.probabilities) as [string, number][])
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([state, probability]) => (
                    <div key={state} className="flex justify-between items-center">
                      <span className="text-[10px] text-zinc-500">{state}</span>
                      <span className="text-[10px] font-mono text-zinc-300">{Math.round(probability * 100)}%</span>
                    </div>
                  ))}
              </div>
              <div className="border-t border-white/5 pt-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-400">Tail Risk</span>
                  <span className="text-xs font-mono text-zinc-200">{tailRisk.riskFlag}</span>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                  {tailRisk.drivers.slice(0, 3).join(' · ')}
                </p>
              </div>
              {derivativesContext && (
                <div className="space-y-2 border-t border-white/5 pt-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] text-zinc-500">Futures OI</p>
                      <p className="text-xs font-mono text-zinc-200">
                        {derivativesContext.openInterestToMarketCap === null
                          ? 'n/a'
                          : `${formatUnsignedPercent(derivativesContext.openInterestToMarketCap, 2)} · ${derivativesContext.leverageState}`}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500">Daily Funding</p>
                      <p className={cn(
                        "text-xs font-mono",
                        derivativesContext.fundingState === 'long-crowded' ? "text-amber-300" :
                          derivativesContext.fundingState === 'short-stress' ? "text-sky-300" :
                            "text-zinc-200"
                      )}>
                        {derivativesContext.fundingRateDailySum === null
                          ? 'n/a'
                          : `${formatSignedPercent(derivativesContext.fundingRateDailySum, 3)} · ${derivativesContext.fundingState}`}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] leading-relaxed text-zinc-500">{derivativesContext.insight}</p>
                  <p className="text-[10px] leading-relaxed text-zinc-600">
                    Binance derivatives context only; not applied to forecast price or bands.
                  </p>
                </div>
              )}
              {networkContext && (
                <div className="space-y-2 border-t border-white/5 pt-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] text-zinc-500">Transfers</p>
                      <p className="text-xs font-mono text-zinc-200">
                        {networkContext.transferCount === null ? 'n/a' : formatCompactCount(networkContext.transferCount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500">Activity Rank</p>
                      <p className="text-xs font-mono text-zinc-200">
                        {networkContext.transferActivityPercentile === null
                          ? networkContext.networkState
                          : `${formatUnsignedPercent(networkContext.transferActivityPercentile, 0)} · ${networkContext.networkState}`}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500">Active Share</p>
                      <p className="text-xs font-mono text-zinc-200">
                        {networkContext.activeAddressShare === null ? 'n/a' : formatUnsignedPercent(networkContext.activeAddressShare, 2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-500">Transfers / Tx</p>
                      <p className="text-xs font-mono text-zinc-200">
                        {networkContext.transfersPerTransaction === null ? 'n/a' : networkContext.transfersPerTransaction.toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] leading-relaxed text-zinc-500">{networkContext.insight}</p>
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {crossMarketContext && (
          <Card className="rounded-lg border-sky-400/20 bg-[#0d1114]">
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <LineChart className="w-4 h-4 text-sky-300" />
                  Cross-Market Context
                </span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  crossMarketContext.regime === 'Risk-on linked' ? "bg-sky-400/10 text-sky-200" :
                    crossMarketContext.regime === 'Crypto-specific' ? "bg-violet-400/10 text-violet-200" :
                    crossMarketContext.regime === 'Inverse stress' ? "bg-red-400/10 text-red-200" :
                    "bg-zinc-400/10 text-zinc-200"
                )}>
                  {crossMarketContext.regime}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0 space-y-3">
              <p className="text-[10px] leading-relaxed text-zinc-500">{crossMarketContext.summary}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-white/5 bg-black/20 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">90D Corr</p>
                  <p className="mt-1 font-mono text-lg text-sky-200">{crossMarketContext.correlation.toFixed(2)}</p>
                </div>
                <div className="rounded-md border border-white/5 bg-black/20 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">BTC Beta</p>
                  <p className="mt-1 font-mono text-lg text-zinc-100">{crossMarketContext.beta.toFixed(2)}x</p>
                </div>
              </div>
              <div className="space-y-2 border-t border-white/5 pt-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-400">BTC vs S&P 90D</span>
                  <span className={cn("text-xs font-mono", crossMarketContext.btcRelativeReturn >= 0 ? "text-emerald-300" : "text-red-300")}>
                    {formatSignedPercent(crossMarketContext.btcRelativeReturn)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-400">BTC / S&P Vol</span>
                  <span className="text-xs font-mono text-zinc-200">
                    {formatSignedPercent(crossMarketContext.btcAnnualizedVol, 0).replace('+', '')} / {formatSignedPercent(crossMarketContext.sp500AnnualizedVol, 0).replace('+', '')}
                  </span>
                </div>
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  Promoted as context only: useful for interpreting whether BTC is trading as high-beta risk/liquidity exposure, not a point-forecast override.
                </p>
              </div>
            </CardContent>
          </Card>
          )}

          {activeAsset.capabilities.sourceFreshness && (
          <Card>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="flex items-center gap-2 text-sm">
                <RefreshCw className="w-4 h-4 text-zinc-400" />
                Source Freshness
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0 space-y-2">
              {(Object.entries(sourceFreshness.sources) as [string, { status: string; latestDate: string | null; required: boolean }][])
                .map(([name, source]) => (
                <div key={name} className="flex justify-between items-center">
                  <span className="text-xs text-zinc-400">{name}</span>
                  <span className={cn(
                    "text-[10px] font-mono",
                    source.required && source.status !== 'fresh' ? "text-red-400" : source.status === 'fresh' || source.status === 'available' ? "text-emerald-400" : "text-zinc-500"
                  )}>
                    {source.latestDate ?? source.status}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          )}

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
                    {marketData.marketCap > 0 ? formatMarketCap(marketData.marketCap) : 'N/A'}
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
                  <span className="text-xs md:text-sm font-mono text-zinc-400">{activeAsset.dataSourceLabel}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs md:text-sm text-zinc-400">Instrument</span>
                  <span className="text-xs md:text-sm font-mono text-zinc-400">{activeAsset.instrumentLabel}</span>
                </div>
                {canShowBitcoinOverlays && mvrvStats.currentMVRV !== null && (
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

          {activeAsset.capabilities.halvings && (
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
          )}
          {activeAsset.capabilities.drawdownCycle && drawdownStats && (
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
          )}
        </div>
        </div>
      </main>

    </div>
  );
}

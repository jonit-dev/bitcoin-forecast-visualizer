import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import { Activity, TrendingUp, Settings2, RefreshCw, BarChart2, Play, Square } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { ForecastChart } from './components/Chart';
import { processRealData } from './lib/data';
import { loadBTCData, type MarketData } from './lib/api';
import { cn } from './lib/utils';

function formatHorizonLabel(days: number): string {
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}M`;
  return `${Math.round(days / 365)}Y`;
}

function formatPrice(n: number) {
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatMarketCap(n: number) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return `$${(n / 1e6).toFixed(0)}M`;
}

export default function App() {
  const [marketData] = useState<MarketData>(() => loadBTCData());
  const [horizon, setHorizon] = useState(14);
  const [model, setModel] = useState('powerlaw');
  const [isGenerating, setIsGenerating] = useState(false);
  const [displayData, setDisplayData] = useState<any[]>(() =>
    processRealData(marketData.ohlcv, 14, 'powerlaw')
  );

  // Chart Controls
  const [timeRange, setTimeRange] = useState('3M');
  const [showSMA, setShowSMA] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showModelLine, setShowModelLine] = useState(true);

  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);

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

  const handleRunForecast = () => {
    setIsPlaying(false);
    setPlaybackIndex(null);
    setIsGenerating(true);
    setTimeout(() => {
      setDisplayData(processRealData(marketData.ohlcv, horizon, model));
      setIsGenerating(false);
    }, 700);
  };

  const activeDisplayData = displayData;

  // Derived stats
  const currentPrice = marketData?.currentPrice ?? 0;
  const priceChange24h = marketData?.priceChange24h ?? 0;
  const forecastPrice = useMemo(() => {
    const fcast = activeDisplayData.filter(d => d.isForecast);
    return fcast.length > 0 ? fcast[fcast.length - 1].close : 0;
  }, [activeDisplayData]);

  const forecastChange = currentPrice ? ((forecastPrice - currentPrice) / currentPrice) * 100 : 0;

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
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 md:h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
              <TrendingUp className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-400" />
            </div>
            <h1 className="font-semibold tracking-tight text-sm md:text-base">Nexus Forecast</h1>
            <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] md:text-xs font-medium text-zinc-400 border border-zinc-700">
              BTC/USD
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs md:text-sm text-zinc-400">
            <span className="hidden sm:block text-[10px] text-zinc-500">
              Data: 2010–{new Date(marketData.ohlcv[marketData.ohlcv.length - 1].date).getFullYear()}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4 md:py-8 flex flex-col lg:grid lg:grid-cols-4 gap-4 md:gap-6">

        {/* Main Content */}
        <div className="lg:col-span-3 space-y-4 md:space-y-6 order-1 lg:order-2 flex flex-col">
          {/* Chart */}
          <Card className="overflow-hidden flex-1 flex flex-col min-h-[450px] md:min-h-[550px]">
            <CardHeader className="border-b border-white/5 pb-3 md:pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 md:gap-4">
              <CardTitle className="text-base md:text-lg">Price Forecast Visualization</CardTitle>
              <div className="flex items-center gap-2 md:gap-4 overflow-x-auto pb-1 sm:pb-0 scrollbar-hide w-full sm:w-auto">
                <div className="flex items-center bg-zinc-900/50 rounded-lg p-1 border border-white/5 shrink-0">
                  {['1M', '3M', '6M', '1Y', 'ALL'].map(range => (
                    <button
                      key={range}
                      onClick={() => setTimeRange(range)}
                      className={cn(
                        "px-2.5 py-1 md:px-3 md:py-1 text-[10px] md:text-xs font-medium rounded-md transition-colors",
                        timeRange === range
                          ? "bg-zinc-800 text-zinc-100 shadow-sm"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
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
                      Model
                    </button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 pt-4 md:pt-6 flex-1">
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
                  timeRange={timeRange}
                  playbackIndex={playbackIndex}
                />
              </motion.div>
            </CardContent>
          </Card>

          {/* Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <Card>
              <CardContent className="p-3 md:p-4">
                <p className="text-[10px] md:text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Current Price</p>
                <p className="text-lg md:text-2xl font-semibold font-mono">
                  {currentPrice ? formatPrice(currentPrice) : '—'}
                </p>
                {priceChange24h !== 0 && (
                  <p className={cn("text-[10px] md:text-xs font-mono mt-0.5", priceChange24h >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}% 24h
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 md:p-4">
                <p className="text-[10px] md:text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Predicted ({formatHorizonLabel(horizon)})</p>
                <p className="text-lg md:text-2xl font-semibold font-mono">
                  {forecastPrice ? formatPrice(forecastPrice) : '—'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 md:p-4">
                <p className="text-[10px] md:text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Forecast Change</p>
                <p className={cn("text-lg md:text-2xl font-semibold font-mono", forecastChange >= 0 ? "text-emerald-400" : "text-red-400")}>
                  {forecastChange >= 0 ? '+' : ''}{forecastChange.toFixed(2)}%
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 md:p-4">
                <p className="text-[10px] md:text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">30D Volatility</p>
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
        <div className="space-y-4 md:space-y-6 order-2 lg:order-1">
          <Card>
            <CardHeader className="p-4 md:p-6">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Settings2 className="w-4 h-4 text-zinc-400" />
                Model Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 md:space-y-5 p-4 pt-0 md:p-6 md:pt-0">
              <div className="space-y-1.5 md:space-y-2">
                <label className="text-[10px] md:text-xs font-medium text-zinc-400 uppercase tracking-wider">Architecture</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-xs md:text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="powerlaw">BTC Power Law</option>
                  <option value="transformer">Temporal Fusion Transformer</option>
                  <option value="lstm">LSTM Network</option>
                  <option value="prophet">Facebook Prophet</option>
                  <option value="arima">ARIMA (Baseline)</option>
                </select>
              </div>

              <div className="space-y-1.5 md:space-y-2">
                <label className="text-[10px] md:text-xs font-medium text-zinc-400 uppercase tracking-wider">Forecast Horizon</label>
                <select
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-xs md:text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value={7}>7 Days</option>
                  <option value={14}>14 Days</option>
                  <option value={30}>30 Days</option>
                  <option value={90}>3 Months</option>
                  <option value={180}>6 Months</option>
                  <option value={365}>1 Year</option>
                  <option value={730}>2 Years</option>
                  <option value={1825}>5 Years</option>
                  <option value={3650}>10 Years</option>
                </select>
              </div>

              <div className="space-y-1.5 md:space-y-2">
                <label className="text-[10px] md:text-xs font-medium text-zinc-400 uppercase tracking-wider">Confidence Interval</label>
                <select className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-xs md:text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500">
                  <option>95% (2σ)</option>
                  <option>90% (1.64σ)</option>
                  <option>80% (1.28σ)</option>
                </select>
              </div>

              <Button
                onClick={handleRunForecast}
                disabled={isGenerating}
                className="w-full mt-2 md:mt-4"
              >
                {isGenerating ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Activity className="w-4 h-4 mr-2" />
                )}
                {isGenerating ? 'Computing…' : 'Run Forecast'}
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
                  <span className="text-xs md:text-sm font-mono text-zinc-400">
                    CryptoCompare
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

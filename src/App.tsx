import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import { Activity, TrendingUp, TrendingDown, RefreshCw, BarChart2, Play, Square, Zap, Bitcoin, CalendarClock, Gauge, Layers3, CircleDollarSign, LineChart } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { ForecastChart } from './components/Chart';
import {
  coefficientAwareCalibrationLabel,
  coefficientStabilityTrustCopy,
  HISTORICAL_CYCLE_DRAWDOWNS,
  CONFIDENCE_Z_SCORES,
} from './lib/data';
import { computeMVRVStats, computeMVRVZScoreSeries, loadMarketData, type MarketAssetId, type MarketData, type MarketDataStatus as DataStatus, type MVRVStats } from './lib/api';
import { hydrateMarketData } from './lib/marketDataClient';
import { MarketDataStatus } from './components/MarketDataStatus';
import { MarketBar } from './components/workspace/MarketBar';
import { ForecastSummary } from './components/workspace/ForecastSummary';
import { ForecastControls } from './components/workspace/ForecastControls';
import { ChartSettings, type OverlayControl } from './components/workspace/ChartSettings';
import { EvidencePanel } from './components/workspace/EvidencePanel';
import { ChartPanel } from './components/workspace/ChartPanel';
import { cn } from './lib/utils';
import { loadCurrentRegimeSummary, loadPowerLawStabilitySummary, loadReliabilitySummary, loadSourceFreshness } from './lib/reliabilityReport';
import { buildMarketForecast, getMarketAssetConfig, MARKET_ASSETS } from './lib/marketForecast';
import { computeCrossMarketContext } from './lib/crossMarket';
import buyZoneSummaryData from './data/buy-zone-summary.json';
import type { BuyZoneSummary } from './lib/buyZone';

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

function featureStatusLabel(status: string): string {
  if (status === 'eligible-for-manual-review') return 'manual review';
  if (status === 'disabled-negative-result') return 'disabled';
  return status;
}

export default function App() {
  const [activeAssetId, setActiveAssetId] = useState<MarketAssetId>('btc');
  const [marketDataByAsset, setMarketDataByAsset] = useState<Record<MarketAssetId, MarketData>>(() => ({
    btc: loadMarketData('btc'),
    sp500: loadMarketData('sp500'),
    gold: loadMarketData('gold'),
  }));
  const [marketStatusByAsset, setMarketStatusByAsset] = useState<Record<MarketAssetId, DataStatus>>({ btc: 'fallback', sp500: 'fallback', gold: 'fallback' });
  const [mvrvStats] = useState<MVRVStats>(() => computeMVRVStats());
  const [mvrvZScoreData] = useState(() => computeMVRVZScoreSeries());
  const [reliabilitySummary] = useState(() => loadReliabilitySummary());
  const [powerLawStabilitySummary] = useState(() => loadPowerLawStabilitySummary());
  const [sourceFreshness] = useState(() => loadSourceFreshness());
  const [currentRegimeSummary] = useState(() => loadCurrentRegimeSummary());
  const regimeContext = currentRegimeSummary.regime;
  const tailRisk = currentRegimeSummary.tailRisk;
  const derivativesContext = currentRegimeSummary.derivativesContext;
  const networkContext = currentRegimeSummary.networkContext;
  const featureStatusRows = useMemo(() =>
    (reliabilitySummary.featureExperimentStatus ?? [])
      .filter(row => row.family !== 'all-features')
      .sort((a, b) => {
        const priority: Record<string, number> = {
          'eligible-for-manual-review': 4,
          watch: 3,
          'context-only': 2,
          'disabled-negative-result': 1,
        };
        return (priority[b.status] ?? 0) - (priority[a.status] ?? 0) || a.family.localeCompare(b.family);
      })
      .slice(0, 4),
    [reliabilitySummary.featureExperimentStatus]
  );
  const residualModelStatus = reliabilitySummary.featureExperimentStatus?.find(row => row.family === 'all-features') ?? null;
  const tier3Status = reliabilitySummary.tier3Status;
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
  const [showMVRV, setShowMVRV] = useState(false);
  const [chartSettingsOpen, setChartSettingsOpen] = useState(false);
  const chartSettingsTriggerRef = React.useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    let active = true;
    (Object.keys(marketDataByAsset) as MarketAssetId[]).forEach(async (assetId) => {
      const hydrated = await hydrateMarketData(assetId, marketDataByAsset[assetId]);
      if (!active) return;
      setMarketDataByAsset((current) => ({ ...current, [assetId]: hydrated.data }));
      setMarketStatusByAsset((current) => ({ ...current, [assetId]: hydrated.status }));
    });
    return () => { active = false; };
  }, []);

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
  }, [horizon, confidenceLevel, activeAssetId, marketData]);

  const activeDisplayData = forecastResult.displayData;
  const heatmapData = forecastResult.heatmapData;
  const buyZoneSummary = canShowBitcoinOverlays ? BUY_ZONE_SUMMARY : null;
  const latestBuyZone = buyZoneSummary?.latest ?? null;
  const primaryBuyZoneBacktest = canShowBitcoinOverlays ? PRIMARY_BUY_ZONE_BACKTEST : null;
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
        powerLawStabilitySummary.verdict,
        reliabilitySummary.coreAssumptions
      ),
    };
  }, [activeAssetId, probabilityForecast, powerLawStabilitySummary.verdict, reliabilitySummary.coreAssumptions]);

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
  const overlayControls: OverlayControl[] = [
    { id: 'sma', label: 'Moving average', group: 'Price', checked: showSMA, onChange: () => setShowSMA(!showSMA), description: 'Show the simple moving average.' },
    { id: 'volume', label: 'Volume', group: 'Price', checked: showVolume, onChange: () => setShowVolume(!showVolume), description: 'Show daily trading volume.' },
    { id: 'path', label: 'Forecast path', group: 'Forecast', checked: showModelLine, onChange: () => setShowModelLine(!showModelLine), description: 'Show the median forecast path.' },
    { id: 'scenarios', label: 'Scenarios', group: 'Forecast', checked: showScenarios, onChange: () => setShowScenarios(!showScenarios), description: 'Show probabilistic scenario paths.' },
    { id: 'floor', label: canShowBitcoinOverlays ? 'Power-law floor' : 'Lower channel', group: 'Forecast', checked: showFloorLine, onChange: () => setShowFloorLine(!showFloorLine), description: 'Show the lower reference boundary.' },
    { id: 'peak', label: canShowBitcoinOverlays ? 'Power-law peak' : 'Upper channel', group: 'Forecast', checked: showPeakLine, onChange: () => setShowPeakLine(!showPeakLine), description: 'Show the upper reference boundary.' },
    { id: 'heatmap', label: 'Forecast heatmap', group: 'Forecast', checked: showHeatmap, onChange: () => setShowHeatmap(!showHeatmap), description: 'Show forecast probability density.' },
    ...(canShowBitcoinOverlays ? [
      { id: 'buy-zones', label: 'Buy zones', group: 'Bitcoin context' as const, checked: showBuyZones, onChange: () => setShowBuyZones(!showBuyZones), description: 'Show context-only historical buy zones.' },
      ...(mvrvZScoreData.length ? [{ id: 'mvrv', label: 'MVRV Z-score', group: 'Bitcoin context' as const, checked: showMVRV, onChange: () => setShowMVRV(!showMVRV), description: 'Show context-only MVRV valuation history.' }] : []),
    ] : []),
  ];

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#070806] text-zinc-50 font-sans selection:bg-amber-400/30">
      <a href="#forecast-workspace" className="skip-link">Skip to forecast workspace</a>
      <header className="workspace-header"><div className="brand"><span aria-hidden="true">₿</span><div><h1>Block Signal</h1><p>{activeAsset.subtitle}</p></div></div>
        <MarketBar assets={MARKET_ASSETS} activeId={activeAssetId} onChange={setActiveAssetId} quoteDate={marketData.ohlcv.at(-1)!.date} status={marketStatusByAsset[activeAssetId]} />
      </header>

      <main id="forecast-workspace" tabIndex={-1} className="flex-1 min-h-0 overflow-y-auto">
        <div className="workspace-shell">

        {/* Main Content */}
        <div className="flex flex-col gap-4 md:gap-5 order-1 min-h-0">
          <ForecastSummary current={currentPrice ? formatPrice(currentPrice) : '—'} median={forecastPrice ? formatPrice(forecastPrice) : '—'} move={`${forecastChange >= 0 ? '+' : ''}${forecastChange.toFixed(1)}%`} probability={adjustedProbabilityForecast ? formatUnsignedPercent(adjustedProbabilityForecast.probabilityUp) : undefined} lower={adjustedProbabilityForecast ? formatPrice(adjustedProbabilityForecast.q10) : undefined} upper={adjustedProbabilityForecast ? formatPrice(adjustedProbabilityForecast.q90) : undefined} horizonLabel={formatHorizonLabel(horizon)} />
          <ForecastControls horizon={horizon} options={HORIZON_OPTIONS} confidence={confidenceLevel} confidenceLabel={coefficientAwareCalibrationLabel(horizon, 'Interval Band', activeAssetId === 'btc' ? powerLawStabilitySummary.verdict : undefined, activeAssetId === 'btc' ? reliabilitySummary.coreAssumptions : undefined)} trustCopy={coefficientStabilityTrustCopy(horizon, activeAssetId === 'btc' ? powerLawStabilitySummary.verdict : undefined, activeAssetId === 'btc' ? reliabilitySummary.coreAssumptions : undefined)} busy={isGenerating} onHorizon={setHorizon} onConfidence={(value) => setConfidenceLevel(value as keyof typeof CONFIDENCE_Z_SCORES)} onRefresh={handleRunForecast} />
          <ChartPanel title={activeAsset.chartTitle} subtitle={`${activeAsset.instrumentLabel}. Forecast auto-refreshes when horizon or interval changes.`} range={timeRange} onRange={setTimeRange} isPlaying={isPlaying} busy={isGenerating} onPlayToggle={isPlaying ? handleStop : handlePlay} settingsTriggerRef={chartSettingsTriggerRef} settingsOpen={chartSettingsOpen} onOpenSettings={() => setChartSettingsOpen(true)}>
            <motion.div initial={false} animate={{ opacity: isGenerating ? 0.5 : 1 }} transition={{ duration: 0.18 }} className="h-full w-full">
              <ForecastChart data={activeDisplayData} showSMA={showSMA} showVolume={showVolume} showModelLine={showModelLine} showScenarios={showScenarios} showFloorLine={showFloorLine} showPeakLine={showPeakLine} showHeatmap={showHeatmap} heatmapData={heatmapData} showBuyZones={showBuyZones} buyZones={buyZoneSummary?.zones ?? []} timeRange={timeRange} playbackIndex={playbackIndex} mvrvData={mvrvZScoreData} showMVRV={showMVRV} showBitcoinOverlays={canShowBitcoinOverlays} probabilityForecast={adjustedProbabilityForecast} />
            </motion.div>
          </ChartPanel>
        </div>

        <EvidencePanel panels={{
          overview: <div className="evidence-grid">
            <article><h3>Market snapshot</h3><dl><div><dt>24h change</dt><dd>{priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%</dd></div><div><dt>30D annualized volatility</dt><dd>{annualizedVol.toFixed(1)}% · {volRisk}</dd></div><div><dt>Instrument</dt><dd>{activeAsset.instrumentLabel}</dd></div></dl></article>
            {latestBuyZone && primaryBuyZoneBacktest && <article><h3>Buy-zone context <small>context only</small></h3><dl><div><dt>Bottom score</dt><dd>{(latestBuyZone.bottomScore * 100).toFixed(1)} / 70</dd></div><div><dt>Status</dt><dd>{latestBuyZone.isHeavyBuy ? 'Heavy buy active' : 'Inactive'}</dd></div><div><dt>Backtest 1Y median</dt><dd>{formatSignedPercent(primaryBuyZoneBacktest.medianReturn1y ?? 0, 0)}</dd></div></dl><p>Historical context only; not applied as a forecast override.</p></article>}
            {crossMarketContext && <article><h3>Cross-market context <small>context only</small></h3><dl><div><dt>Regime</dt><dd>{crossMarketContext.regime}</dd></div><div><dt>90D correlation</dt><dd>{crossMarketContext.correlation.toFixed(2)}</dd></div><div><dt>BTC beta</dt><dd>{crossMarketContext.beta.toFixed(2)}x</dd></div><div><dt>BTC vs S&P 90D</dt><dd>{formatSignedPercent(crossMarketContext.btcRelativeReturn)}</dd></div><div><dt>BTC / S&P vol</dt><dd>{formatUnsignedPercent(crossMarketContext.btcAnnualizedVol, 0)} / {formatUnsignedPercent(crossMarketContext.sp500AnnualizedVol, 0)}</dd></div></dl><p>{crossMarketContext.summary}</p></article>}
          </div>,
          'model-risk': <div className="evidence-grid">
            <article><h3>Model trust</h3><dl><div><dt>14–90d backtest</dt><dd>{reliabilitySummary.qualityGateStatus}</dd></div><div><dt>Reliability score</dt><dd>{reliabilitySummary.reliabilityScore}/100</dd></div><div><dt>Active model</dt><dd>{reliabilitySummary.ensembleEnabled ? 'Regime ensemble' : 'Power-law'}</dd></div><div><dt>180d+ stability</dt><dd>{powerLawStabilitySummary.verdict}</dd></div>{tier3Status && <><div><dt>Ensemble</dt><dd>{featureStatusLabel(tier3Status.ensemble.status)}</dd></div><div><dt>Tail-risk gate</dt><dd>{featureStatusLabel(tier3Status.tailRisk.status)}</dd></div></>}</dl><p>{coefficientStabilityTrustCopy(horizon, activeAssetId === 'btc' ? powerLawStabilitySummary.verdict : undefined, activeAssetId === 'btc' ? reliabilitySummary.coreAssumptions : undefined)}</p></article>
            {featureStatusRows.length > 0 && <article><h3>Feature gates <small>trust qualifiers</small></h3><dl>{featureStatusRows.map((row) => <div key={row.family}><dt>{row.family}</dt><dd>{featureStatusLabel(row.status)}</dd></div>)}{residualModelStatus && <div><dt>All features</dt><dd>{featureStatusLabel(residualModelStatus.status)}</dd></div>}</dl></article>}
            {canShowBitcoinOverlays && <article><h3>Regime & tail risk</h3><dl><div><dt>Top state</dt><dd>{regimeContext.topState}</dd></div><div><dt>Tail risk</dt><dd>{tailRisk.riskFlag}</dd></div>{networkContext && <><div><dt>Network state</dt><dd>{networkContext.networkState}</dd></div><div><dt>Transfers</dt><dd>{networkContext.transferCount === null ? 'n/a' : formatCompactCount(networkContext.transferCount)}</dd></div><div><dt>Active share</dt><dd>{networkContext.activeAddressShare === null ? 'n/a' : formatUnsignedPercent(networkContext.activeAddressShare, 2)}</dd></div><div><dt>Transfers / tx</dt><dd>{networkContext.transfersPerTransaction === null ? 'n/a' : networkContext.transfersPerTransaction.toFixed(2)}</dd></div></>}</dl>{networkContext && <p>{networkContext.insight}</p>}<p>Context-only signals remain disabled for direct forecast influence unless their gates pass.</p></article>}
            {derivativesContext && <article><h3>Derivatives <small>context only</small></h3><dl><div><dt>Open interest</dt><dd>{derivativesContext.openInterestUSD === null ? 'n/a' : formatMarketCap(derivativesContext.openInterestUSD)}</dd></div><div><dt>OI / market cap</dt><dd>{derivativesContext.openInterestToMarketCap === null ? 'n/a' : formatUnsignedPercent(derivativesContext.openInterestToMarketCap, 2)}</dd></div><div><dt>Leverage / funding</dt><dd>{derivativesContext.leverageState} / {derivativesContext.fundingState}</dd></div></dl><p>{derivativesContext.insight}</p></article>}
            {drawdownStats && activeAsset.capabilities.drawdownCycle && <article><h3>Drawdown analysis</h3><dl><div><dt>Projected max drawdown</dt><dd>-{drawdownStats.projectedMDD.toFixed(1)}%</dd></div><div><dt>Cycle ATH</dt><dd>{formatPrice(drawdownStats.cycleHighPrice)} · {drawdownStats.cycleHighDate}</dd></div><div><dt>Current from ATH</dt><dd>-{drawdownStats.currentDrawdownPct.toFixed(1)}%</dd></div><div><dt>Bear-floor estimate</dt><dd>{formatPrice(drawdownStats.impliedFloorFromCycleHigh)}</dd></div><div><dt>GBM expected / worst 5%</dt><dd>-{drawdownStats.gbmExpectedMDD.toFixed(1)}% / -{drawdownStats.gbmP95MDD.toFixed(1)}%</dd></div></dl><p>Cycle history: {HISTORICAL_CYCLE_DRAWDOWNS.map((item) => `C${item.cycle} -${item.pct}%`).join(' · ')}</p></article>}
          </div>,
          'data-market': <div className="evidence-grid">
            <article><h3>Market data</h3><dl><div><dt>Source</dt><dd>{activeAsset.dataSourceLabel}</dd></div><div><dt>Latest candle</dt><dd>{marketData.ohlcv.at(-1)!.date}</dd></div><div><dt>Volume</dt><dd>{formatMarketCap(marketData.volume24h)}</dd></div><div><dt>Market cap</dt><dd>{marketData.marketCap > 0 ? formatMarketCap(marketData.marketCap) : 'N/A'}</dd></div>{canShowBitcoinOverlays && mvrvStats.currentMVRV !== null && <><div><dt>MVRV ratio</dt><dd>{mvrvStats.currentMVRV.toFixed(2)}</dd></div><div><dt>MVRV Z-score</dt><dd>{mvrvStats.zScore?.toFixed(2)}</dd></div><div><dt>Cycle signal</dt><dd>{mvrvStats.signal}</dd></div></>}</dl></article>
            {activeAsset.capabilities.sourceFreshness && <article><h3>Source freshness</h3><dl>{(Object.entries(sourceFreshness.sources) as [string, { status: string; latestDate: string | null; required: boolean }][]).map(([name, source]) => <div key={name}><dt>{name}{!source.required && ' (optional)'}</dt><dd>{source.latestDate ?? source.status}</dd></div>)}</dl></article>}
            {activeAsset.capabilities.halvings && <article><h3>Supply & halvings</h3><dl><div><dt>Next halving</dt><dd>{halvingInfo.nextDate} · {halvingInfo.daysUntil}d</dd></div><div><dt>Block reward</dt><dd>{halvingInfo.currentReward} → {halvingInfo.nextReward} BTC</dd></div><div><dt>Daily issuance</dt><dd>~{halvingInfo.dailyIssuance} → ~{halvingInfo.nextDailyIssuance} BTC</dd></div><div><dt>Circulating</dt><dd>{(CIRCULATING_SUPPLY / 1_000_000).toFixed(2)}M / 21M · {((CIRCULATING_SUPPLY / MAX_SUPPLY) * 100).toFixed(1)}%</dd></div></dl></article>}
          </div>,
        }} />

        </div>
      </main>
      <ChartSettings open={chartSettingsOpen} controls={overlayControls} onClose={() => setChartSettingsOpen(false)} triggerRef={chartSettingsTriggerRef} />
    </div>
  );
}

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import mvrvHistory from '../src/data/mvrv-history.json';
import onchainHistory from '../src/data/onchain-history.json';
import featureTable from '../src/data/feature-table.json';
import { ENSEMBLE_CONFIG } from '../src/lib/modelConfig';
import { classifyRegime } from '../src/lib/regimeModel';
import { computeTailRisk } from '../src/lib/tailRisk';

const RESULTS_DIR = join(process.cwd(), 'docs/reports/results');
const RELIABILITY_OUT = join(process.cwd(), 'src/data/reliability-summary.json');
const FRESHNESS_OUT = join(process.cwd(), 'src/data/source-freshness.json');
const REGIME_OUT = join(process.cwd(), 'src/data/current-regime-summary.json');
const MS_PER_DAY = 86400000;

function main(): void {
  const report = loadLatestBacktest();
  const requiredChecks = report.qualityGate.checks.length;
  const passedChecks = report.qualityGate.checks.filter((check: any) => check.passed).length;
  const reliabilityScore = Math.round(50 + 35 * (passedChecks / Math.max(1, requiredChecks)) + 15 * coverageScore(report));
  const horizonConfidence = Object.fromEntries(
    report.qualityGate.checks.map((check: any) => [
      `${check.horizonDays}d`,
      {
        powerlawError: check.powerlawMedianAbsLogError,
        naiveError: check.naiveMedianAbsLogError,
        status: check.passed ? 'beats-naive' : 'fails-naive',
      },
    ])
  );

  writeFileSync(RELIABILITY_OUT, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    reportPath: report.__path,
    qualityGateStatus: report.qualityGate.status,
    reliabilityScore,
    horizonConfidence,
    ensembleEnabled: ENSEMBLE_CONFIG.defaultEnabled,
    ensembleReason: ENSEMBLE_CONFIG.enablementReason,
    coreAssumptions: buildCoreAssumptionSummary(),
    featureExperimentStatus: buildFeatureExperimentStatus(),
    tier3Status: buildTier3Status(),
  }, null, 2)}\n`);

  writeFileSync(FRESHNESS_OUT, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    sources: {
      btc: sourceStatus((btcHistory as any[]).at(-1)?.date, true),
      mvrv: sourceStatus((mvrvHistory as any[]).at(-1)?.date, true),
      onchain: sourceStatus((onchainHistory as any[]).at(-1)?.date, true),
      features: sourceStatus((featureTable as any[]).at(-1)?.date, true),
      derivatives: optionalCacheStatus('src/data/derivatives-history.json'),
      stablecoins: optionalCacheStatus('src/data/stablecoin-history.json'),
      etf: optionalCacheStatus('src/data/etf-flow-history.json'),
      macro: optionalCacheStatus('src/data/macro-history.json'),
      sentiment: optionalCacheStatus('src/data/sentiment-history.json'),
      cot: optionalCacheStatus('src/data/cot-history.json'),
    },
  }, null, 2)}\n`);

  const latestFeatureRow = (featureTable as any[]).at(-1);
  writeFileSync(REGIME_OUT, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    featureDate: latestFeatureRow?.date ?? null,
    regime: classifyRegime(latestFeatureRow),
    tailRisk: computeTailRisk(latestFeatureRow),
    derivativesContext: latestFeatureRow ? buildDerivativesContext(latestFeatureRow) : null,
    networkContext: latestFeatureRow ? buildNetworkContext(latestFeatureRow, featureTable as any[]) : null,
  }, null, 2)}\n`);

  console.log(`[Runtime summaries] reliability=${RELIABILITY_OUT}`);
  console.log(`[Runtime summaries] freshness=${FRESHNESS_OUT}`);
  console.log(`[Runtime summaries] regime=${REGIME_OUT}`);
}

function buildDerivativesContext(row: any) {
  const features = row.features || {};
  const sourceDates = row.sourceDates || {};
  if (!Number.isFinite(features.futuresOpenInterestToMarketCap) && !Number.isFinite(features.futuresFundingRateDailySum)) {
    return null;
  }
  const openInterestToMarketCap = finiteOrNull(features.futuresOpenInterestToMarketCap);
  const fundingRateDailySum = finiteOrNull(features.futuresFundingRateDailySum);
  const leverageState = classifyLeverageState(openInterestToMarketCap);
  const fundingState = classifyFundingState(fundingRateDailySum);
  return {
    source: 'Binance USD-M Futures public REST',
    sourceDate: sourceDates.futuresOpenInterestToMarketCap || sourceDates.futuresFundingRateDailySum || null,
    openInterestUSD: finiteOrNull(features.futuresOpenInterestUSD),
    openInterestToMarketCap,
    fundingRateDailySum,
    fundingRateDailyAvg: finiteOrNull(features.futuresFundingRateDailyAvg),
    leverageState,
    fundingState,
    insight: derivativesInsight(leverageState, fundingState),
    status: 'context-only',
  };
}

function finiteOrNull(value: unknown): number | null {
  return Number.isFinite(value) ? Number(value) : null;
}

function buildNetworkContext(row: any, rows: any[]) {
  const features = row.features || {};
  const sourceDates = row.sourceDates || {};
  const transferCount = finiteOrNull(features.transferCount);
  const addressBalanceCount = finiteOrNull(features.addressBalanceCount);
  if (transferCount === null && addressBalanceCount === null) return null;
  const transferActivityPercentile = transferCount === null
    ? null
    : percentileRank(rows.map(item => item.features?.transferCount).filter(Number.isFinite), transferCount);
  const activeAddressShare = finiteOrNull(features.activeAddressShare);
  const transfersPerTransaction = finiteOrNull(features.transfersPerTransaction);
  const networkState = classifyNetworkState(transferActivityPercentile, activeAddressShare);
  return {
    source: 'CoinMetrics Community API',
    sourceDate: sourceDates.transferCount || sourceDates.addressBalanceCount || null,
    transferCount,
    addressBalanceCount,
    activeAddressShare,
    transfersPerTransaction,
    transferActivityPercentile,
    networkState,
    insight: networkInsight(networkState),
    status: 'context-only',
  };
}

function percentileRank(values: number[], value: number): number | null {
  if (values.length < 30) return null;
  const belowOrEqual = values.filter(item => item <= value).length;
  return belowOrEqual / values.length;
}

function classifyNetworkState(
  transferActivityPercentile: number | null,
  activeAddressShare: number | null
): 'unknown' | 'quiet' | 'normal' | 'busy' | 'speculative-congestion' {
  if (transferActivityPercentile === null && activeAddressShare === null) return 'unknown';
  if ((transferActivityPercentile ?? 0) >= 0.85 && (activeAddressShare ?? 1) < 0.015) return 'speculative-congestion';
  if ((transferActivityPercentile ?? 0) >= 0.75) return 'busy';
  if ((transferActivityPercentile ?? 1) <= 0.25) return 'quiet';
  return 'normal';
}

function networkInsight(state: ReturnType<typeof classifyNetworkState>): string {
  if (state === 'busy') return 'Transfer activity is high versus history, so network usage confirms above-normal activity.';
  if (state === 'speculative-congestion') return 'Transfers are high while active address share is low, which can indicate churn rather than broad demand.';
  if (state === 'quiet') return 'Transfer activity is subdued versus history, so network usage is not confirming a strong demand impulse.';
  if (state === 'normal') return 'Network usage is near its historical middle range.';
  return 'Network usage context is unavailable.';
}

function classifyLeverageState(value: number | null): 'unknown' | 'light' | 'normal' | 'crowded' {
  if (value === null) return 'unknown';
  if (value >= 0.005) return 'crowded';
  if (value <= 0.0035) return 'light';
  return 'normal';
}

function classifyFundingState(value: number | null): 'unknown' | 'short-stress' | 'neutral' | 'long-crowded' {
  if (value === null) return 'unknown';
  if (value >= 0.0002) return 'long-crowded';
  if (value <= -0.00005) return 'short-stress';
  return 'neutral';
}

function derivativesInsight(
  leverageState: ReturnType<typeof classifyLeverageState>,
  fundingState: ReturnType<typeof classifyFundingState>
): string {
  if (leverageState === 'crowded' && fundingState === 'long-crowded') {
    return 'Leveraged longs are crowded; treat upside breakouts as liquidation-sensitive.';
  }
  if (leverageState === 'crowded' && fundingState === 'short-stress') {
    return 'High open interest with negative funding raises two-sided squeeze risk.';
  }
  if (leverageState === 'crowded') {
    return 'Open interest is elevated, but funding is not chasing price right now.';
  }
  if (fundingState === 'long-crowded') {
    return 'Funding is stretched positive, so long positioning may be crowded.';
  }
  if (fundingState === 'short-stress') {
    return 'Funding is negative, which can support squeeze-prone rebounds.';
  }
  return 'Funding is neutral, so derivatives are not confirming a crowded directional trade.';
}

function loadLatestBacktest(): any {
  const file = readdirSync(RESULTS_DIR)
    .filter(name => /^backtest-.*\.json$/.test(name))
    .sort()
    .reverse()
    .find(name => {
      const report = JSON.parse(readFileSync(join(RESULTS_DIR, name), 'utf8'));
      return report.metadata?.command === 'npm run backtest';
    });
  if (!file) throw new Error('No backtest JSON report found');
  const path = join(RESULTS_DIR, file);
  return { ...JSON.parse(readFileSync(path, 'utf8')), __path: `docs/reports/results/${file}` };
}

function buildCoreAssumptionSummary() {
  const coefficient = loadJsonIfExists('src/data/powerlaw-stability-summary.json');
  const tau = loadLatestResult(/^tau-sweep-.*\.json$/, report => Boolean(report.verdict));
  const cycle = loadLatestResult(/^backtest-.*\.json$/, report => Boolean(report.cycleComparison));
  const residual = loadLatestResult(/^backtest-.*\.json$/, report => Boolean(report.residualBootstrapComparison));

  const coefficientVerdict = coefficient?.verdict ?? 'watch';
  const tauVerdict = tau?.verdict?.status === 'eligible-for-manual-review' ? 'watch' : 'stable';
  const cycleVerdict = cycle?.cycleComparison?.status === 'selected-default' ? 'stable' : 'watch';
  const residualVerdict = residual?.residualBootstrapComparison?.status === 'retain-recent' ? 'stable' : 'watch';
  const verdicts = [coefficientVerdict, tauVerdict, cycleVerdict, residualVerdict];
  const longHorizonLabel = verdicts.includes('unstable') ? 'Directional only' : 'Scenario range';
  const reason = [
    `coefficients=${coefficientVerdict}`,
    `tau=${tauVerdict}`,
    `cycle=${cycleVerdict}`,
    `residuals=${residualVerdict}`,
  ].join('; ');

  return {
    generatedAt: new Date().toISOString(),
    longHorizonLabel,
    reason,
    coefficientStability: {
      verdict: coefficientVerdict,
      reportPath: coefficient?.reportPath ?? null,
    },
    tau: {
      verdict: tauVerdict,
      selectedModelId: tau?.verdict?.selectedModelId ?? null,
      reportPath: tau?.__path ?? null,
    },
    cycle: {
      verdict: cycleVerdict,
      selectedModelId: cycle?.cycleComparison?.selectedModelId ?? null,
      reportPath: cycle?.__path ?? null,
    },
    residualBootstrap: {
      verdict: residualVerdict,
      selectedModelId: residual?.residualBootstrapComparison?.selectedModelId ?? null,
      reportPath: residual?.__path ?? null,
    },
  };
}

function buildFeatureExperimentStatus() {
  const featureReport = loadLatestResultByGeneratedAt(/^feature-continuous-.*\.json$/, report => Array.isArray(report.families) && report.families.length > 1);
  const residualModel = loadLatestResultByGeneratedAt(/^residual-model-.*\.json$/, report => Boolean(report.verdict));
  const familyStatuses = (featureReport?.families ?? []).map((family: any) => {
    const gates = Array.isArray(family.continuousGates) ? family.continuousGates : [];
    const bestGate = selectFeatureGate(gates);
    return {
      family: family.family,
      status: featureFamilyStatus(family, gates),
      latestReportPath: featureReport?.__path ?? null,
      holdoutWindow: bestGate?.holdoutStart ?? featureReport?.metadata?.holdoutStarts?.[0] ?? null,
      primaryMetric: featureReport?.metadata?.primaryMetric ?? 'lag-safe sample availability',
      promotionReason: bestGate?.reason ?? (family.status === 'sample-starved' ? 'sample-starved for continuous residual testing' : 'no continuous gate evidence available'),
    };
  });

  if (residualModel) {
    familyStatuses.push({
      family: 'all-features',
      status: residualModel.verdict === 'eligible-for-manual-review' ? 'eligible-for-manual-review' : 'disabled-negative-result',
      latestReportPath: residualModel.__path,
      holdoutWindow: residualModel.metadata?.holdoutStarts?.join(', ') ?? null,
      primaryMetric: 'walk-forward kitchen-sink residual model mean pinball loss',
      promotionReason: residualModel.verdictReason ?? 'kitchen-sink residual model remains disabled',
    });
  }

  return familyStatuses;
}

function buildTier3Status() {
  const ensemble = loadLatestResultByGeneratedAt(/^backtest-.*\.json$/, report => Boolean(report.ensembleComparison));
  const tailRisk = loadLatestResultByGeneratedAt(/^backtest-.*\.json$/, report => Boolean(report.tailRiskComparison));
  return {
    ensemble: {
      status: ENSEMBLE_CONFIG.defaultEnabled ? 'active' : (ensemble?.ensembleComparison?.status ?? 'context-only'),
      enabled: ENSEMBLE_CONFIG.defaultEnabled,
      latestReportPath: ensemble?.__path ?? null,
      reason: ENSEMBLE_CONFIG.defaultEnabled
        ? 'validation-weighted ensemble is enabled by config'
        : (ensemble?.ensembleComparison?.reason ?? ENSEMBLE_CONFIG.enablementReason),
      weightsByHorizon: ensemble?.ensembleComparison?.weightsByHorizon ?? ENSEMBLE_CONFIG.candidateWeights,
    },
    tailRisk: {
      status: tailRisk?.tailRiskComparison?.status ?? 'context-only',
      enabled: false,
      latestReportPath: tailRisk?.__path ?? null,
      reason: tailRisk?.tailRiskComparison?.reason ?? 'tail-risk interval adjustment has not been calibrated',
    },
  };
}

function selectFeatureGate(gates: any[]) {
  const priority: Record<string, number> = {
    'eligible-for-manual-review': 4,
    watch: 3,
    'context-only': 2,
    'not-evaluated': 1,
  };
  return [...gates].sort((a, b) =>
    (priority[b.status] ?? 0) - (priority[a.status] ?? 0) ||
    (b.improvement?.meanPinballLoss ?? -Infinity) - (a.improvement?.meanPinballLoss ?? -Infinity)
  )[0] ?? null;
}

function featureFamilyStatus(family: any, gates: any[]): 'context-only' | 'watch' | 'eligible-for-manual-review' | 'disabled-negative-result' {
  if (gates.some(gate => gate.status === 'eligible-for-manual-review')) return 'eligible-for-manual-review';
  if (gates.some(gate => gate.status === 'watch')) return 'watch';
  if (family.status === 'sample-starved') return 'context-only';
  return 'context-only';
}

function loadJsonIfExists(relativePath: string): any | null {
  const path = join(process.cwd(), relativePath);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadLatestResult(pattern: RegExp, predicate: (report: any) => boolean): any | null {
  const file = readdirSync(RESULTS_DIR)
    .filter(name => pattern.test(name))
    .sort()
    .reverse()
    .find(name => {
      const report = JSON.parse(readFileSync(join(RESULTS_DIR, name), 'utf8'));
      return predicate(report);
    });
  if (!file) return null;
  const path = join(RESULTS_DIR, file);
  return { ...JSON.parse(readFileSync(path, 'utf8')), __path: `docs/reports/results/${file}` };
}

function loadLatestResultByGeneratedAt(pattern: RegExp, predicate: (report: any) => boolean): any | null {
  const reports = readdirSync(RESULTS_DIR)
    .filter(name => pattern.test(name))
    .map(name => {
      const report = JSON.parse(readFileSync(join(RESULTS_DIR, name), 'utf8'));
      return { name, report };
    })
    .filter(item => predicate(item.report))
    .sort((a, b) => String(b.report.metadata?.generatedAt ?? b.report.generatedAt ?? '').localeCompare(String(a.report.metadata?.generatedAt ?? a.report.generatedAt ?? '')));
  const latest = reports[0];
  if (!latest) return null;
  return { ...latest.report, __path: `docs/reports/results/${latest.name}` };
}

function sourceStatus(latestDate: string | null | undefined, required: boolean) {
  const lagDays = latestDate ? daysBetween(latestDate, dateKey(Date.now())) : null;
  return {
    status: latestDate ? (lagDays !== null && lagDays <= 3 ? 'fresh' : 'stale') : 'missing',
    latestDate: latestDate ?? null,
    lagDays,
    required,
  };
}

function optionalCacheStatus(relativePath: string) {
  const path = join(process.cwd(), relativePath);
  if (!existsSync(path)) return { status: 'missing', latestDate: null, lagDays: null, required: false };
  const cache = JSON.parse(readFileSync(path, 'utf8'));
  const rows = Array.isArray(cache) ? cache : cache.rows || [];
  const metadata = Array.isArray(cache) ? {} : cache.metadata || {};
  const latestDate = rows.at(-1)?.date ?? null;
  return {
    status: metadata.status || (latestDate ? 'available' : 'unavailable'),
    latestDate,
    lagDays: latestDate ? daysBetween(latestDate, dateKey(Date.now())) : null,
    required: false,
  };
}

function coverageScore(report: any): number {
  const rows = [14, 30, 60, 90].map(horizon => report.metrics[String(horizon)]?.['powerlaw-current']?.coverage);
  const valid = rows.filter(Boolean);
  if (valid.length === 0) return 0;
  const misses = valid.flatMap((coverage: any) => [
    Math.abs(coverage.interval80 - 0.8),
    Math.abs(coverage.interval90 - 0.9),
    Math.abs(coverage.interval95 - 0.95),
  ]);
  return Math.max(0, 1 - misses.reduce((sum, value) => sum + value, 0) / misses.length / 0.1);
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) / MS_PER_DAY);
}

function dateKey(value: number | Date): string {
  return new Date(value).toISOString().split('T')[0];
}

main();

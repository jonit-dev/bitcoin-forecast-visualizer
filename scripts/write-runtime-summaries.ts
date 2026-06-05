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
  }, null, 2)}\n`);

  writeFileSync(FRESHNESS_OUT, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    sources: {
      btc: sourceStatus((btcHistory as any[]).at(-1)?.date, true),
      mvrv: sourceStatus((mvrvHistory as any[]).at(-1)?.date, true),
      onchain: sourceStatus((onchainHistory as any[]).at(-1)?.date, true),
      features: sourceStatus((featureTable as any[]).at(-1)?.date, true),
      derivatives: optionalCacheStatus('src/data/derivatives-history.json'),
      etf: optionalCacheStatus('src/data/etf-flow-history.json'),
      macro: optionalCacheStatus('src/data/macro-history.json'),
      sentiment: { status: 'deferred', latestDate: null, lagDays: null, required: false },
    },
  }, null, 2)}\n`);

  const latestFeatureRow = (featureTable as any[]).at(-1);
  writeFileSync(REGIME_OUT, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    featureDate: latestFeatureRow?.date ?? null,
    regime: classifyRegime(latestFeatureRow),
    tailRisk: computeTailRisk(latestFeatureRow),
  }, null, 2)}\n`);

  console.log(`[Runtime summaries] reliability=${RELIABILITY_OUT}`);
  console.log(`[Runtime summaries] freshness=${FRESHNESS_OUT}`);
  console.log(`[Runtime summaries] regime=${REGIME_OUT}`);
}

function loadLatestBacktest(): any {
  const file = readdirSync(RESULTS_DIR)
    .filter(name => /^backtest-.*\.json$/.test(name))
    .sort()
    .at(-1);
  if (!file) throw new Error('No backtest JSON report found');
  const path = join(RESULTS_DIR, file);
  return { ...JSON.parse(readFileSync(path, 'utf8')), __path: `docs/reports/results/${file}` };
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

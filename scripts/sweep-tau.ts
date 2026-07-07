import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { aggregateForecastMetrics, type BacktestMetricRow, type MetricInput } from '../src/lib/backtestMetrics';
import { getBacktestModels, type BacktestModelId } from '../src/lib/backtestModels';
import { BACKTEST_CONFIG, TAU_EXPERIMENT_CONFIG } from '../src/lib/modelConfig';

interface TauSweepCheck {
  horizonDays: number;
  medianPassed: boolean;
  biasPassed: boolean;
  nllPassed: boolean;
  pinballPassed: boolean;
  coveragePassed: boolean;
  reason: string;
}

interface TauCandidateReport {
  id: BacktestModelId;
  description: string;
  config: Record<string, unknown>;
  metrics: Record<string, BacktestMetricRow>;
  checks: TauSweepCheck[];
  status: 'retained-default' | 'eligible-for-manual-review' | 'watch' | 'rejected';
  score: number;
}

interface TauSweepReport {
  metadata: {
    generatedAt: string;
    command: string;
    gitCommit: string;
    dataset: {
      firstDate: string;
      lastDate: string;
      rowCount: number;
    };
    gatedHorizons: readonly number[];
    promotionPolicy: string;
  };
  baselineModelId: 'powerlaw-tau-210';
  defaultModelId: 'powerlaw-current';
  candidates: TauCandidateReport[];
  verdict: {
    selectedModelId: BacktestModelId;
    selectedTauDays: number;
    status: 'retain-current' | 'eligible-for-manual-review';
    reason: string;
  };
}

const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');

function main(): void {
  const ohlcv = btcHistory as OHLCVData[];
  const models = getBacktestModels({ tauSuite: true })
    .filter(model => model.id === 'powerlaw-current' || model.id.startsWith('powerlaw-tau-'));
  const metrics = evaluateModels(ohlcv, models);
  const baseline = metrics['powerlaw-tau-210'];
  if (!baseline) throw new Error('Tau suite did not include powerlaw-tau-210 baseline');

  const candidates = models
    .filter(model => model.id.startsWith('powerlaw-tau-'))
    .map(model => buildCandidateReport(model, metrics[model.id], baseline))
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));

  const eligible = candidates.find(candidate => candidate.status === 'eligible-for-manual-review');
  const selected = eligible ?? candidates.find(candidate => candidate.id === 'powerlaw-tau-210') ?? candidates[0];
  const report: TauSweepReport = {
    metadata: {
      generatedAt: new Date().toISOString(),
      command: 'npm run sweep:tau',
      gitCommit: gitCommit(),
      dataset: {
        firstDate: ohlcv[0]?.date ?? '',
        lastDate: ohlcv[ohlcv.length - 1]?.date ?? '',
        rowCount: ohlcv.length,
      },
      gatedHorizons: TAU_EXPERIMENT_CONFIG.gatedHorizons,
      promotionPolicy: TAU_EXPERIMENT_CONFIG.promotionPolicy,
    },
    baselineModelId: 'powerlaw-tau-210',
    defaultModelId: 'powerlaw-current',
    candidates,
    verdict: {
      selectedModelId: selected.id,
      selectedTauDays: selected.id === 'powerlaw-tau-vol-conditional'
        ? TAU_EXPERIMENT_CONFIG.defaultTauDays
        : Number(String(selected.id).replace('powerlaw-tau-', '')),
      status: eligible ? 'eligible-for-manual-review' : 'retain-current',
      reason: eligible
        ? `${eligible.id} passed every gated horizon against the 210-day tau baseline. Manual config review is still required before promotion.`
        : 'No tau candidate beat or matched the 210-day tau baseline across every median, bias, NLL, pinball, and coverage gate, so the current default is retained.',
    },
  };

  writeReports(report);
}

function evaluateModels(
  ohlcv: OHLCVData[],
  models: ReturnType<typeof getBacktestModels>
): Record<BacktestModelId, Record<string, BacktestMetricRow>> {
  const byModel = new Map<BacktestModelId, Map<string, MetricInput[]>>();
  for (const model of models) {
    byModel.set(model.id, new Map(BACKTEST_CONFIG.horizons.map(horizon => [String(horizon), []])));
  }

  for (const horizon of BACKTEST_CONFIG.horizons) {
    for (
      let originIndex = BACKTEST_CONFIG.minimumLookbackDays;
      originIndex + horizon < ohlcv.length;
      originIndex += BACKTEST_CONFIG.rollingOriginSpacingDays
    ) {
      const origin = ohlcv[originIndex];
      if (origin.date < BACKTEST_CONFIG.holdoutStartDate) continue;
      if (!isContiguous(ohlcv, originIndex, horizon)) continue;
      const target = ohlcv[originIndex + horizon];
      for (const model of models) {
        const forecast = model.forecast(ohlcv, originIndex, horizon);
        if (!forecast || !Number.isFinite(forecast.median) || forecast.median <= 0) continue;
        byModel.get(model.id)?.get(String(horizon))?.push({ actual: target.close, forecast });
      }
    }
  }

  return Object.fromEntries([...byModel.entries()].map(([modelId, byHorizon]) => [
    modelId,
    Object.fromEntries([...byHorizon.entries()].map(([horizon, inputs]) => [horizon, aggregateForecastMetrics(inputs)])),
  ])) as Record<BacktestModelId, Record<string, BacktestMetricRow>>;
}

function buildCandidateReport(
  model: ReturnType<typeof getBacktestModels>[number],
  metrics: Record<string, BacktestMetricRow>,
  baseline: Record<string, BacktestMetricRow>
): TauCandidateReport {
  const checks = TAU_EXPERIMENT_CONFIG.gatedHorizons.map(horizon => compareHorizon(horizon, metrics[String(horizon)], baseline[String(horizon)]));
  const allPassed = checks.every(check =>
    check.medianPassed &&
    check.biasPassed &&
    check.nllPassed &&
    check.pinballPassed &&
    check.coveragePassed
  );
  const score = checks.reduce((sum, check) => sum + [
    check.medianPassed,
    check.biasPassed,
    check.nllPassed,
    check.pinballPassed,
    check.coveragePassed,
  ].filter(Boolean).length, 0);
  return {
    id: model.id,
    description: model.description,
    config: model.config,
    metrics,
    checks,
    status: model.id === 'powerlaw-tau-210'
      ? 'retained-default'
      : allPassed
        ? 'eligible-for-manual-review'
        : score >= checks.length * 3
          ? 'watch'
          : 'rejected',
    score,
  };
}

function compareHorizon(horizonDays: number, candidate: BacktestMetricRow, baseline: BacktestMetricRow): TauSweepCheck {
  const medianPassed = compareNullable(candidate.medianAbsLogError, baseline.medianAbsLogError, 1.005);
  const biasPassed = candidate.biasLogError !== null && baseline.biasLogError !== null
    ? Math.abs(candidate.biasLogError) <= Math.abs(baseline.biasLogError) * 1.05 + 0.001
    : false;
  const nllPassed = compareLoss(candidate.nll, baseline.nll, 0.005);
  const pinballPassed = (['q05', 'q10', 'q50', 'q90', 'q95'] as const).every(key =>
    compareLoss(candidate.pinballLoss[key], baseline.pinballLoss[key], 0.005)
  );
  const coveragePassed = (
    compareCoverage(candidate.coverage.interval80, baseline.coverage.interval80) &&
    compareCoverage(candidate.coverage.interval90, baseline.coverage.interval90) &&
    compareCoverage(candidate.coverage.interval95, baseline.coverage.interval95)
  );
  return {
    horizonDays,
    medianPassed,
    biasPassed,
    nllPassed,
    pinballPassed,
    coveragePassed,
    reason: [
      medianPassed ? null : 'median error degraded',
      biasPassed ? null : 'bias degraded',
      nllPassed ? null : 'NLL degraded',
      pinballPassed ? null : 'pinball loss degraded',
      coveragePassed ? null : 'coverage degraded',
    ].filter(Boolean).join('; ') || 'matched or beat baseline on all tau gates',
  };
}

function compareNullable(candidate: number | null, baseline: number | null, tolerance: number): boolean {
  return candidate !== null && baseline !== null && candidate <= baseline * tolerance;
}

function compareLoss(candidate: number | null, baseline: number | null, relativeTolerance: number): boolean {
  if (candidate === null || baseline === null) return false;
  return candidate <= baseline + Math.abs(baseline) * relativeTolerance;
}

function compareCoverage(candidate: number | null, baseline: number | null): boolean {
  return candidate !== null && baseline !== null && candidate >= baseline - 0.02;
}

function writeReports(report: TauSweepReport): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.metadata.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `tau-sweep-${stamp}.json`);
  const markdownPath = join(REPORT_DIR, `tau-sweep-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));

  console.log(`Tau sweep verdict: ${report.verdict.status}`);
  console.log(report.verdict.reason);
  for (const candidate of report.candidates) {
    const metric = candidate.metrics['90'];
    console.log(`${candidate.id}: ${candidate.status} 90d median=${formatMetric(metric.medianAbsLogError)} bias=${formatMetric(metric.biasLogError)} nll=${formatMetric(metric.nll)}`);
  }
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
}

function renderMarkdown(report: TauSweepReport): string {
  const lines = [
    '# Tau Sensitivity Sweep',
    '',
    `Generated: ${report.metadata.generatedAt}`,
    `Command: \`${report.metadata.command}\``,
    `Git commit: \`${report.metadata.gitCommit}\``,
    `Dataset: ${report.metadata.dataset.firstDate} to ${report.metadata.dataset.lastDate} (${report.metadata.dataset.rowCount} rows)`,
    `Gated horizons: ${report.metadata.gatedHorizons.join(', ')}`,
    '',
    `## Verdict: ${report.verdict.status}`,
    '',
    report.verdict.reason,
    '',
    `Promotion policy: ${report.metadata.promotionPolicy}`,
    '',
    '## Ranked Candidates',
    '',
    '| Candidate | Status | Score | 14d median | 30d median | 60d median | 90d median | 90d bias | 90d NLL | 90d coverage 80/90/95 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.candidates.map(candidate => {
      const metric = candidate.metrics;
      const m90 = metric['90'];
      return [
        `| \`${candidate.id}\``,
        candidate.status,
        candidate.score,
        formatMetric(metric['14'].medianAbsLogError),
        formatMetric(metric['30'].medianAbsLogError),
        formatMetric(metric['60'].medianAbsLogError),
        formatMetric(m90.medianAbsLogError),
        formatMetric(m90.biasLogError),
        formatMetric(m90.nll),
        [formatPercent(m90.coverage.interval80), formatPercent(m90.coverage.interval90), formatPercent(m90.coverage.interval95)].join(' / '),
        '|',
      ].join(' | ');
    }),
    '',
    '## Gate Checks',
    '',
  ];

  for (const candidate of report.candidates) {
    lines.push(`### ${candidate.id}`, '');
    lines.push('| Horizon | Median | Bias | NLL | Pinball | Coverage | Reason |');
    lines.push('| ---: | --- | --- | --- | --- | --- | --- |');
    for (const check of candidate.checks) {
      lines.push([
        `| ${check.horizonDays}d`,
        check.medianPassed ? 'PASS' : 'FAIL',
        check.biasPassed ? 'PASS' : 'FAIL',
        check.nllPassed ? 'PASS' : 'FAIL',
        check.pinballPassed ? 'PASS' : 'FAIL',
        check.coveragePassed ? 'PASS' : 'FAIL',
        check.reason,
        '|',
      ].join(' | '));
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function isContiguous(data: OHLCVData[], start: number, horizon: number): boolean {
  for (let step = 0; step < horizon; step++) {
    const current = parseDate(data[start + step].date);
    const next = parseDate(data[start + step + 1].date);
    if ((next.getTime() - current.getTime()) / 86400000 !== 1) return false;
  }
  return true;
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function formatMetric(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(5);
}

function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

main();

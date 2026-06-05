import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { aggregateForecastMetrics, type BacktestMetricRow, type MetricInput } from '../src/lib/backtestMetrics';
import { getBacktestModels, type BacktestModelId } from '../src/lib/backtestModels';
import { BACKTEST_CONFIG, INTERVAL_CONFIG, POWER_LAW_CONFIG } from '../src/lib/modelConfig';

interface BacktestReport {
  metadata: {
    generatedAt: string;
    command: string;
    gitCommit: string;
    dataset: {
      firstDate: string;
      lastDate: string;
      rowCount: number;
    };
    holdoutStartDate: string;
    rollingOriginSpacingDays: number;
    skippedWindowCount: number;
    modelConfig: {
      powerLaw: typeof POWER_LAW_CONFIG;
      interval: typeof INTERVAL_CONFIG;
      backtest: typeof BACKTEST_CONFIG;
    };
    featureTable?: {
      rowCount: number;
      firstDate: string;
      lastDate: string;
      latestFeatureCount: number;
    };
  };
  horizons: number[];
  models: {
    id: BacktestModelId;
    description: string;
    config: Record<string, unknown>;
  }[];
  metrics: Record<string, Record<BacktestModelId, BacktestMetricRow>>;
  qualityGate: {
    status: 'PASS' | 'FAIL';
    checks: {
      horizonDays: number;
      powerlawMedianAbsLogError: number | null;
      naiveMedianAbsLogError: number | null;
      passed: boolean;
      reason: string;
    }[];
  };
}

const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');

function main(): void {
  const ohlcv = btcHistory as OHLCVData[];
  const models = getBacktestModels();
  const metricInputs = new Map<string, Map<BacktestModelId, MetricInput[]>>();
  let skippedWindowCount = 0;

  for (const horizon of BACKTEST_CONFIG.horizons) {
    const byModel = new Map<BacktestModelId, MetricInput[]>();
    for (const model of models) byModel.set(model.id, []);
    metricInputs.set(String(horizon), byModel);

    for (
      let originIndex = BACKTEST_CONFIG.minimumLookbackDays;
      originIndex + horizon < ohlcv.length;
      originIndex += BACKTEST_CONFIG.rollingOriginSpacingDays
    ) {
      const origin = ohlcv[originIndex];
      if (origin.date < BACKTEST_CONFIG.holdoutStartDate) continue;
      if (!isContiguous(ohlcv, originIndex, horizon)) {
        skippedWindowCount++;
        continue;
      }

      const target = ohlcv[originIndex + horizon];
      for (const model of models) {
        const forecast = model.forecast(ohlcv, originIndex, horizon);
        if (!forecast || !Number.isFinite(forecast.median) || forecast.median <= 0) continue;
        byModel.get(model.id)?.push({ actual: target.close, forecast });
      }
    }
  }

  const metrics = Object.fromEntries(
    BACKTEST_CONFIG.horizons.map(horizon => [
      String(horizon),
      Object.fromEntries(
        models.map(model => [
          model.id,
          aggregateForecastMetrics(metricInputs.get(String(horizon))?.get(model.id) ?? []),
        ])
      ),
    ])
  ) as BacktestReport['metrics'];

  const report: BacktestReport = {
    metadata: {
      generatedAt: new Date().toISOString(),
      command: 'npm run backtest',
      gitCommit: gitCommit(),
      dataset: {
        firstDate: ohlcv[0]?.date ?? '',
        lastDate: ohlcv[ohlcv.length - 1]?.date ?? '',
        rowCount: ohlcv.length,
      },
      holdoutStartDate: BACKTEST_CONFIG.holdoutStartDate,
      rollingOriginSpacingDays: BACKTEST_CONFIG.rollingOriginSpacingDays,
      skippedWindowCount,
      modelConfig: {
        powerLaw: POWER_LAW_CONFIG,
        interval: INTERVAL_CONFIG,
        backtest: BACKTEST_CONFIG,
      },
      featureTable: loadFeatureTableMetadata(),
    },
    horizons: [...BACKTEST_CONFIG.horizons],
    models: models.map(({ id, description, config }) => ({ id, description, config })),
    metrics,
    qualityGate: evaluateQualityGate(metrics),
  };

  writeReports(report);

  if (report.qualityGate.status === 'FAIL' && !process.argv.includes('--report-only')) {
    process.exitCode = 1;
  }
}

function loadFeatureTableMetadata(): BacktestReport['metadata']['featureTable'] {
  const path = join(process.cwd(), 'src', 'data', 'feature-table.json');
  if (!existsSync(path)) return undefined;
  const rows = JSON.parse(readFileSync(path, 'utf8')) as { date: string; features?: Record<string, number> }[];
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  return {
    rowCount: rows.length,
    firstDate: rows[0].date,
    lastDate: rows[rows.length - 1].date,
    latestFeatureCount: Object.keys(rows[rows.length - 1].features ?? {}).length,
  };
}

function evaluateQualityGate(metrics: BacktestReport['metrics']): BacktestReport['qualityGate'] {
  const checks = BACKTEST_CONFIG.requiredGateHorizons.map(horizon => {
    const row = metrics[String(horizon)];
    const powerlaw = row?.['powerlaw-current']?.medianAbsLogError ?? null;
    const naive = row?.['naive-current-price']?.medianAbsLogError ?? null;
    const passed = powerlaw !== null && naive !== null && powerlaw < naive;
    return {
      horizonDays: horizon,
      powerlawMedianAbsLogError: powerlaw,
      naiveMedianAbsLogError: naive,
      passed,
      reason: passed
        ? `powerlaw-current median absolute log error ${formatMetric(powerlaw)} beat naive ${formatMetric(naive)}`
        : `powerlaw-current median absolute log error ${formatMetric(powerlaw)} did not beat naive ${formatMetric(naive)}`,
    };
  });

  return {
    status: checks.every(check => check.passed) ? 'PASS' : 'FAIL',
    checks,
  };
}

function writeReports(report: BacktestReport): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.metadata.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `backtest-${stamp}.json`);
  const markdownPath = join(REPORT_DIR, `backtest-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));

  console.log(`Backtest quality gate: ${report.qualityGate.status}`);
  for (const check of report.qualityGate.checks) {
    console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.horizonDays}d: ${check.reason}`);
  }
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
}

function renderMarkdown(report: BacktestReport): string {
  const lines = [
    '# Forecast Backtest Report',
    '',
    `Generated: ${report.metadata.generatedAt}`,
    `Command: \`${report.metadata.command}\``,
    `Git commit: \`${report.metadata.gitCommit}\``,
    `Dataset: ${report.metadata.dataset.firstDate} to ${report.metadata.dataset.lastDate} (${report.metadata.dataset.rowCount} rows)`,
    `Horizon days: ${report.horizons.join(', ')}`,
    `Rolling-origin spacing: ${report.metadata.rollingOriginSpacingDays} days`,
    `Skipped windows: ${report.metadata.skippedWindowCount}`,
    '',
    `## Quality Gate: ${report.qualityGate.status}`,
    '',
    '| Horizon | Result | Reason |',
    '| --- | --- | --- |',
    ...report.qualityGate.checks.map(check => `| ${check.horizonDays}d | ${check.passed ? 'PASS' : 'FAIL'} | ${check.reason} |`),
    '',
    '## Metrics',
    '',
  ];

  for (const horizon of report.horizons) {
    lines.push(`### ${horizon} Day Horizon`, '');
    lines.push('| Model | Samples | Median abs log error | Approx mult error | Bias log error | NLL | Pinball q05/q10/q50/q90/q95 | 80% / 90% / 95% coverage |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');

    for (const model of report.models) {
      const metric = report.metrics[String(horizon)][model.id];
      lines.push([
        `| \`${model.id}\``,
        metric.samples,
        formatMetric(metric.medianAbsLogError),
        formatPercent(metric.approximateMultiplicativeError),
        formatMetric(metric.biasLogError),
        formatMetric(metric.nll),
        [
          formatMetric(metric.pinballLoss.q05),
          formatMetric(metric.pinballLoss.q10),
          formatMetric(metric.pinballLoss.q50),
          formatMetric(metric.pinballLoss.q90),
          formatMetric(metric.pinballLoss.q95),
        ].join(' / '),
        `${formatPercent(metric.coverage.interval80)} / ${formatPercent(metric.coverage.interval90)} / ${formatPercent(metric.coverage.interval95)}`,
        '|',
      ].join(' | '));
    }
    lines.push('');
  }

  lines.push('## Model Config Snapshot', '', '```json', JSON.stringify(report.metadata.modelConfig, null, 2), '```', '');
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

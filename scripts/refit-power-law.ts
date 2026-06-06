import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { BACKTEST_CONFIG, POWER_LAW_CONFIG } from '../src/lib/modelConfig';
import {
  buildForecastImpactSummary,
  buildPowerLawRefitSummary,
  type ForecastImpactSummary,
  type PowerLawCoefficientSummary,
  type PowerLawRefitSummary,
} from '../src/lib/powerLawFit';

interface PowerLawRefitReport extends PowerLawRefitSummary {
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
    minimumTrainingDays: number;
    fitModel: string;
    verdictThresholds: PowerLawRefitSummary['stabilityVerdict']['thresholds'];
  };
  currentConfig: typeof POWER_LAW_CONFIG.base;
  forecastImpact: ForecastImpactSummary[];
  skippedWindows: {
    reason: string;
    count: number;
  }[];
}

const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const SUMMARY_PATH = join(process.cwd(), 'src', 'data', 'powerlaw-stability-summary.json');

function main(): void {
  const ohlcv = btcHistory as OHLCVData[];
  const summary = buildPowerLawRefitSummary(ohlcv);
  const generatedAt = new Date().toISOString();
  const report: PowerLawRefitReport = {
    metadata: {
      generatedAt,
      command: 'npm run refit:powerlaw',
      gitCommit: gitCommit(),
      dataset: {
        firstDate: ohlcv[0]?.date ?? '',
        lastDate: ohlcv[ohlcv.length - 1]?.date ?? '',
        rowCount: ohlcv.length,
      },
      holdoutStartDate: BACKTEST_CONFIG.holdoutStartDate,
      minimumTrainingDays: 1460,
      fitModel: 'log(price) = intercept + exponent*log(daysSinceGenesis) + sin + cos cycle terms',
      verdictThresholds: summary.stabilityVerdict.thresholds,
    },
    currentConfig: POWER_LAW_CONFIG.base,
    ...summary,
    forecastImpact: buildForecastImpactSummary(ohlcv, summary.fitWindows, [180, 365]),
    skippedWindows: [
      {
        reason: 'training rows fewer than 1460 days before rolling origin',
        count: estimateSkippedTrainingWindows(ohlcv),
      },
    ],
  };

  writeReports(report);
  writeRuntimeSummary(report);
}

function writeReports(report: PowerLawRefitReport): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.metadata.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `powerlaw-refit-${stamp}.json`);
  const markdownPath = join(REPORT_DIR, `powerlaw-refit-${stamp}.md`);

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));

  console.log(`Power-law coefficient stability: ${report.stabilityVerdict.verdict}`);
  console.log(`Fit windows: ${report.fitWindows.length}`);
  console.log(`Suggested candidate config: ${JSON.stringify(report.suggestedConfig)}`);
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
}

function writeRuntimeSummary(report: PowerLawRefitReport): void {
  const summary = {
    generatedAt: report.metadata.generatedAt,
    reportPath: latestRelativeReportPath(report.metadata.generatedAt),
    verdict: report.stabilityVerdict.verdict,
    reasons: report.stabilityVerdict.reasons,
    coefficientSummary: report.coefficientSummary,
    forecastImpact: report.forecastImpact,
  };
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
}

function renderMarkdown(report: PowerLawRefitReport): string {
  const lines = [
    '# Power-Law Coefficient Stability Report',
    '',
    `Generated: ${report.metadata.generatedAt}`,
    `Command: \`${report.metadata.command}\``,
    `Git commit: \`${report.metadata.gitCommit}\``,
    `Dataset: ${report.metadata.dataset.firstDate} to ${report.metadata.dataset.lastDate} (${report.metadata.dataset.rowCount} rows)`,
    `Holdout start: ${report.metadata.holdoutStartDate}`,
    `Minimum training window: ${report.metadata.minimumTrainingDays} days`,
    '',
    `## Stability Verdict: ${report.stabilityVerdict.verdict}`,
    '',
    ...report.stabilityVerdict.reasons.map(reason => `- ${reason}`),
    '',
    'Thresholds:',
    '',
    '```json',
    JSON.stringify(report.stabilityVerdict.thresholds, null, 2),
    '```',
    '',
    '## Current Coefficients',
    '',
    '```json',
    JSON.stringify(report.currentConfig, null, 2),
    '```',
    '',
    '## Coefficient Summary',
    '',
    '| Term | Current | Median | Mean | Std dev | p05 | p25 | p75 | p95 | Drift vs current | Max window jump |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...renderCoefficientRows(report.coefficientSummary),
    '',
    '## Forecast Impact',
    '',
    '| Horizon | Current forecast | Candidate median | Candidate p05 | Candidate p95 | Median diff | p05 diff | p95 diff |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.forecastImpact.map(row => [
      `| ${row.horizonDays}d`,
      formatCurrency(row.currentForecast),
      formatCurrency(row.candidateMedianForecast),
      formatCurrency(row.candidateP05Forecast),
      formatCurrency(row.candidateP95Forecast),
      formatPercent(row.medianRelativeDifference),
      formatPercent(row.p05RelativeDifference),
      formatPercent(row.p95RelativeDifference),
      '|',
    ].join(' | ')),
    '',
    '## Fit Windows',
    '',
    `Eligible windows: ${report.fitWindows.length}`,
    `Skipped windows: ${report.skippedWindows.map(row => `${row.count} ${row.reason}`).join('; ')}`,
    '',
    '| Mode | Origin | Training range | Rows | Residual sd | Residual p05/p50/p95 |',
    '| --- | --- | --- | ---: | ---: | --- |',
    ...report.fitWindows.slice(-24).map(window => [
      `| ${window.mode}`,
      window.originDate,
      `${window.firstTrainingDate} to ${window.lastTrainingDate}`,
      window.trainingRows,
      formatNumber(window.residual.standardDeviation),
      `${formatNumber(window.residual.p05)} / ${formatNumber(window.residual.p50)} / ${formatNumber(window.residual.p95)}`,
      '|',
    ].join(' | ')),
    '',
    '## Suggested Candidate Config',
    '',
    'The app keeps `powerlaw-current` as the default. Candidate coefficients require a separate candidate backtest before manual config changes.',
    '',
    '```json',
    JSON.stringify(report.suggestedConfig, null, 2),
    '```',
    '',
  ];

  return `${lines.join('\n')}\n`;
}

function renderCoefficientRows(summary: PowerLawCoefficientSummary): string[] {
  return (Object.entries(summary) as [keyof PowerLawCoefficientSummary, PowerLawCoefficientSummary[keyof PowerLawCoefficientSummary]][])
    .map(([term, row]) => [
      `| \`${term}\``,
      formatNumber(row.currentValue),
      formatNumber(row.median),
      formatNumber(row.mean),
      formatNumber(row.standardDeviation),
      formatNumber(row.p05),
      formatNumber(row.p25),
      formatNumber(row.p75),
      formatNumber(row.p95),
      formatPercent(row.relativeDriftFromCurrent),
      formatPercent(row.maxWindowToWindowDrift),
      '|',
    ].join(' | '));
}

function estimateSkippedTrainingWindows(ohlcv: OHLCVData[]): number {
  const holdoutIndex = ohlcv.findIndex(row => row.date >= BACKTEST_CONFIG.holdoutStartDate);
  if (holdoutIndex < 0) return 0;
  let skipped = 0;
  for (let originIndex = holdoutIndex; originIndex < ohlcv.length - 1; originIndex += 30) {
    if (originIndex < 1460) skipped++;
    if (Math.min(originIndex, 1460 * 3) < 1460) skipped++;
  }
  return skipped;
}

function latestRelativeReportPath(generatedAt: string): string {
  const stamp = generatedAt.replace(/[:.]/g, '-');
  return `docs/reports/results/powerlaw-refit-${stamp}.json`;
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  if (Math.abs(value) > 0 && Math.abs(value) < 0.0001) return value.toExponential(4);
  return value.toFixed(5);
}

function formatCurrency(value: number): string {
  return Number.isFinite(value) ? `$${Math.round(value).toLocaleString('en-US')}` : 'n/a';
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

main();

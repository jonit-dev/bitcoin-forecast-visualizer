import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { aggregateForecastMetrics, type BacktestMetricRow, type MetricInput } from '../src/lib/backtestMetrics';
import { getBacktestModels, type BacktestModelId } from '../src/lib/backtestModels';
import { BACKTEST_CONFIG, ENSEMBLE_CONFIG, INTERVAL_CONFIG, POWER_LAW_CONFIG } from '../src/lib/modelConfig';
import type { PowerLawFitCoefficients } from '../src/lib/powerLawFit';
import { classifyRegime, type RegimeState } from '../src/lib/regimeModel';

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
  robustness: {
    status: 'PASS' | 'FAIL';
    blockBootstrapIterations: number;
    checks: RobustnessCheck[];
  };
  regimeSummary?: Record<string, Partial<Record<RegimeState, BacktestMetricRow>>>;
  ablation: {
    modes: {
      id: string;
      enabled: boolean;
      status: 'baseline' | 'disabled' | 'context-only';
      reason: string;
      metrics?: Record<string, BacktestMetricRow>;
    }[];
    enablementGate: {
      defaultEnsembleEnabled: boolean;
      reason: string;
    };
  };
  candidateComparison?: {
    candidateModelId: 'powerlaw-refit-candidate';
    source: string;
    status: 'disabled' | 'watch' | 'eligible-for-manual-config-update';
    reasons: string[];
    checks: {
      horizonDays: number;
      currentMedianAbsLogError: number | null;
      candidateMedianAbsLogError: number | null;
      currentBiasLogError: number | null;
      candidateBiasLogError: number | null;
      currentInterval90Coverage: number | null;
      candidateInterval90Coverage: number | null;
      passed: boolean;
      reason: string;
    }[];
  };
}

interface RobustnessCheck {
  horizonDays: number;
  benchmarkModelId: BacktestModelId;
  samples: number;
  blockLength: number;
  medianAbsLogErrorImprovement: number | null;
  meanAbsLogErrorImprovement: number | null;
  bootstrapLower95MeanImprovement: number | null;
  passed: boolean;
  reason: string;
}

const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const ROBUSTNESS_BOOTSTRAP_ITERATIONS = 400;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function main(): void {
  const ohlcv = btcHistory as OHLCVData[];
  const candidateSource = parseCandidateArg(process.argv.slice(2));
  const candidate = candidateSource ? loadCandidateConfig(candidateSource) : null;
  const models = getBacktestModels({ powerLawCandidate: candidate?.coefficients });
  const metricInputs = new Map<string, Map<BacktestModelId, MetricInput[]>>();
  const featureRows = loadFeatureRowsByDate();
  const regimeInputs = new Map<string, Map<RegimeState, MetricInput[]>>();
  let skippedWindowCount = 0;

  for (const horizon of BACKTEST_CONFIG.horizons) {
    const byModel = new Map<BacktestModelId, MetricInput[]>();
    for (const model of models) byModel.set(model.id, []);
    metricInputs.set(String(horizon), byModel);
    regimeInputs.set(String(horizon), new Map());

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
        const input = { actual: target.close, forecast };
        byModel.get(model.id)?.push(input);
        if (model.id === 'powerlaw-current' && featureRows.size > 0) {
          const state = classifyRegime(featureRows.get(origin.date)).topState;
          const byState = regimeInputs.get(String(horizon))!;
          if (!byState.has(state)) byState.set(state, []);
          byState.get(state)!.push(input);
        }
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
      command: ['npm run backtest', candidateSource ? `-- --candidate-powerlaw ${candidateSource}` : ''].filter(Boolean).join(' '),
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
    robustness: evaluateRobustness(ohlcv, models),
    regimeSummary: renderRegimeSummary(regimeInputs),
    ablation: buildAblationSummary(metrics),
    candidateComparison: candidate ? evaluateCandidateComparison(metrics, candidate.source) : undefined,
  };

  writeReports(report);

  if (report.qualityGate.status === 'FAIL' && !process.argv.includes('--report-only')) {
    process.exitCode = 1;
  }
}

function evaluateRobustness(ohlcv: OHLCVData[], models: ReturnType<typeof getBacktestModels>): BacktestReport['robustness'] {
  const checks: RobustnessCheck[] = [];
  const powerlaw = models.find(model => model.id === 'powerlaw-current');
  const benchmarks = models.filter(model =>
    model.id !== 'powerlaw-current' &&
    model.id !== 'powerlaw-refit-candidate'
  );
  if (!powerlaw) {
    return {
      status: 'FAIL',
      blockBootstrapIterations: ROBUSTNESS_BOOTSTRAP_ITERATIONS,
      checks: [{
        horizonDays: 0,
        benchmarkModelId: 'naive-current-price',
        samples: 0,
        blockLength: 0,
        medianAbsLogErrorImprovement: null,
        meanAbsLogErrorImprovement: null,
        bootstrapLower95MeanImprovement: null,
        passed: false,
        reason: 'powerlaw-current model was unavailable',
      }],
    };
  }

  for (const horizon of BACKTEST_CONFIG.requiredGateHorizons) {
    for (const benchmark of benchmarks) {
      const paired = pairedErrorImprovements(ohlcv, horizon, powerlaw, benchmark);
      const medianImprovement = median(paired);
      const meanImprovement = mean(paired);
      const blockLength = Math.max(7, Math.min(horizon, 90));
      const lower95 = paired.length > blockLength * 3
        ? blockBootstrapLowerBound(paired, blockLength, ROBUSTNESS_BOOTSTRAP_ITERATIONS, 0xB17C000 + horizon * 997 + benchmark.id.length)
        : null;
      const passed = (
        paired.length > blockLength * 3 &&
        medianImprovement !== null &&
        meanImprovement !== null &&
        lower95 !== null &&
        medianImprovement > 0 &&
        meanImprovement > 0 &&
        lower95 > 0
      );
      checks.push({
        horizonDays: horizon,
        benchmarkModelId: benchmark.id,
        samples: paired.length,
        blockLength,
        medianAbsLogErrorImprovement: medianImprovement,
        meanAbsLogErrorImprovement: meanImprovement,
        bootstrapLower95MeanImprovement: lower95,
        passed,
        reason: passed
          ? `powerlaw-current beat ${benchmark.id} after block-bootstrap overlap adjustment`
          : `powerlaw-current did not clear the block-bootstrap robustness threshold against ${benchmark.id}`,
      });
    }
  }

  return {
    status: checks.every(check => check.passed) ? 'PASS' : 'FAIL',
    blockBootstrapIterations: ROBUSTNESS_BOOTSTRAP_ITERATIONS,
    checks,
  };
}

function pairedErrorImprovements(
  ohlcv: OHLCVData[],
  horizon: number,
  powerlaw: ReturnType<typeof getBacktestModels>[number],
  benchmark: ReturnType<typeof getBacktestModels>[number]
): number[] {
  const improvements: number[] = [];
  for (
    let originIndex = BACKTEST_CONFIG.minimumLookbackDays;
    originIndex + horizon < ohlcv.length;
    originIndex += BACKTEST_CONFIG.rollingOriginSpacingDays
  ) {
    const origin = ohlcv[originIndex];
    if (origin.date < BACKTEST_CONFIG.holdoutStartDate) continue;
    if (!isContiguous(ohlcv, originIndex, horizon)) continue;

    const target = ohlcv[originIndex + horizon];
    const powerlawForecast = powerlaw.forecast(ohlcv, originIndex, horizon);
    const benchmarkForecast = benchmark.forecast(ohlcv, originIndex, horizon);
    if (!powerlawForecast?.median || !benchmarkForecast?.median) continue;

    const powerlawError = Math.abs(Math.log(powerlawForecast.median / target.close));
    const benchmarkError = Math.abs(Math.log(benchmarkForecast.median / target.close));
    if (Number.isFinite(powerlawError) && Number.isFinite(benchmarkError)) {
      improvements.push(benchmarkError - powerlawError);
    }
  }
  return improvements;
}

function blockBootstrapLowerBound(values: number[], blockLength: number, iterations: number, seed: number): number | null {
  if (values.length === 0) return null;
  const rng = mulberry32(seed);
  const means: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    let sum = 0;
    let count = 0;
    while (count < values.length) {
      const start = Math.floor(rng() * Math.max(1, values.length - blockLength + 1));
      for (let offset = 0; offset < blockLength && count < values.length; offset++, count++) {
        sum += values[start + offset];
      }
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return means[Math.floor(iterations * 0.05)] ?? null;
}

function mulberry32(seed: number) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

function loadFeatureRowsByDate(): Map<string, any> {
  const path = join(process.cwd(), 'src', 'data', 'feature-table.json');
  if (!existsSync(path)) return new Map();
  const rows = JSON.parse(readFileSync(path, 'utf8')) as any[];
  if (!Array.isArray(rows)) return new Map();
  return new Map(rows.map(row => [row.date, row]));
}

function buildAblationSummary(metrics: BacktestReport['metrics']): BacktestReport['ablation'] {
  const baselineMetrics = Object.fromEntries(
    BACKTEST_CONFIG.horizons.map(horizon => [String(horizon), metrics[String(horizon)]['powerlaw-current']])
  );

  return {
    modes: [
      {
        id: 'baseline-only',
        enabled: true,
        status: 'baseline',
        reason: 'Calibrated power-law remains the default forecast baseline.',
        metrics: baselineMetrics,
      },
      ...ENSEMBLE_CONFIG.featureFamilies.map(featureFamily => ({
        id: `plus-${featureFamily}`,
        enabled: false,
        status: 'context-only' as const,
        reason: `${featureFamily} signals are loaded for context but not enabled until ablation beats baseline.`,
      })),
      {
        id: 'full-regime-ensemble',
        enabled: false,
        status: 'disabled',
        reason: ENSEMBLE_CONFIG.enablementReason,
      },
    ],
    enablementGate: {
      defaultEnsembleEnabled: ENSEMBLE_CONFIG.defaultEnabled,
      reason: ENSEMBLE_CONFIG.enablementReason,
    },
  };
}

function evaluateCandidateComparison(
  metrics: BacktestReport['metrics'],
  source: string
): BacktestReport['candidateComparison'] {
  const requiredHorizons = [14, 30, 60, 90, 180, 365];
  const checks = requiredHorizons.map(horizon => {
    const row = metrics[String(horizon)];
    const current = row?.['powerlaw-current'];
    const candidate = row?.['powerlaw-refit-candidate'];
    const currentMedian = current?.medianAbsLogError ?? null;
    const candidateMedian = candidate?.medianAbsLogError ?? null;
    const currentBias = current?.biasLogError ?? null;
    const candidateBias = candidate?.biasLogError ?? null;
    const currentCoverage = current?.coverage.interval90 ?? null;
    const candidateCoverage = candidate?.coverage.interval90 ?? null;
    const medianPassed = candidateMedian !== null && currentMedian !== null && candidateMedian <= currentMedian * 1.005;
    const biasPassed = candidateBias !== null && currentBias !== null && Math.abs(candidateBias) <= Math.abs(currentBias) * 1.05 + 0.001;
    const coveragePassed = candidateCoverage === null || currentCoverage === null || candidateCoverage >= currentCoverage - 0.02;
    const passed = medianPassed && biasPassed && coveragePassed;
    return {
      horizonDays: horizon,
      currentMedianAbsLogError: currentMedian,
      candidateMedianAbsLogError: candidateMedian,
      currentBiasLogError: currentBias,
      candidateBiasLogError: candidateBias,
      currentInterval90Coverage: currentCoverage,
      candidateInterval90Coverage: candidateCoverage,
      passed,
      reason: passed
        ? 'candidate preserved median error, bias, and 90% interval coverage'
        : [
            medianPassed ? null : 'median error degraded',
            biasPassed ? null : 'bias degraded',
            coveragePassed ? null : '90% coverage degraded',
          ].filter(Boolean).join('; '),
    };
  });

  const failed = checks.filter(check => !check.passed);
  const status = failed.length === 0
    ? 'eligible-for-manual-config-update'
    : failed.length <= 2
      ? 'watch'
      : 'disabled';

  return {
    candidateModelId: 'powerlaw-refit-candidate',
    source,
    status,
    reasons: failed.length === 0
      ? ['Candidate preserved or improved required current-model metrics across all comparison horizons.']
      : failed.map(check => `${check.horizonDays}d ${check.reason}`),
    checks,
  };
}

function renderRegimeSummary(regimeInputs: Map<string, Map<RegimeState, MetricInput[]>>): BacktestReport['regimeSummary'] {
  return Object.fromEntries(
    [...regimeInputs.entries()].map(([horizon, byState]) => [
      horizon,
      Object.fromEntries([...byState.entries()].map(([state, inputs]) => [state, aggregateForecastMetrics(inputs)])),
    ])
  ) as BacktestReport['regimeSummary'];
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
  console.log(`Backtest robustness audit: ${report.robustness.status}`);
  for (const check of report.robustness.checks) {
    console.log(
      `${check.passed ? 'PASS' : 'FAIL'} ${check.horizonDays}d vs ${check.benchmarkModelId}: mean improvement ${formatMetric(check.meanAbsLogErrorImprovement)}, bootstrap lower95 ${formatMetric(check.bootstrapLower95MeanImprovement)}`
    );
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
    `## Robustness Audit: ${report.robustness.status}`,
    '',
    `Block bootstrap iterations: ${report.robustness.blockBootstrapIterations}`,
    '',
    '| Horizon | Benchmark | Samples | Block length | Median improvement | Mean improvement | 5% bootstrap mean improvement | Result |',
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.robustness.checks.map(check => [
      `| ${check.horizonDays}d`,
      `\`${check.benchmarkModelId}\``,
      check.samples,
      check.blockLength,
      formatMetric(check.medianAbsLogErrorImprovement),
      formatMetric(check.meanAbsLogErrorImprovement),
      formatMetric(check.bootstrapLower95MeanImprovement),
      check.passed ? 'PASS' : 'FAIL',
      '|',
    ].join(' | ')),
    '',
    'Positive values mean `powerlaw-current` had lower absolute log error than the benchmark. The bootstrap samples contiguous blocks so overlapping rolling-origin windows are not treated as independent daily observations.',
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

  lines.push('## Regime Summary', '');
  if (report.regimeSummary) {
    for (const horizon of report.horizons) {
      const byState = report.regimeSummary[String(horizon)] ?? {};
      lines.push(`### ${horizon} Day Horizon`, '');
      lines.push('| Top state | Samples | Median abs log error | Bias log error |');
      lines.push('| --- | ---: | ---: | ---: |');
      for (const [state, metric] of Object.entries(byState)) {
        lines.push(`| \`${state}\` | ${metric.samples} | ${formatMetric(metric.medianAbsLogError)} | ${formatMetric(metric.biasLogError)} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('No feature table was available for regime grouping.', '');
  }

  lines.push('## Ablation And Enablement', '');
  lines.push(`Default ensemble enabled: ${report.ablation.enablementGate.defaultEnsembleEnabled ? 'yes' : 'no'}`);
  lines.push(report.ablation.enablementGate.reason, '');
  lines.push('| Mode | Status | Enabled | Reason |');
  lines.push('| --- | --- | --- | --- |');
  for (const mode of report.ablation.modes) {
    lines.push(`| \`${mode.id}\` | ${mode.status} | ${mode.enabled ? 'yes' : 'no'} | ${mode.reason} |`);
  }
  lines.push('');

  lines.push('## Power-Law Refit Candidate', '');
  if (report.candidateComparison) {
    lines.push(`Source: \`${report.candidateComparison.source}\``);
    lines.push(`Enablement status: ${report.candidateComparison.status}`, '');
    lines.push('| Horizon | Result | Current median error | Candidate median error | Current bias | Candidate bias | Current 90% coverage | Candidate 90% coverage | Reason |');
    lines.push('| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const check of report.candidateComparison.checks) {
      lines.push([
        `| ${check.horizonDays}d`,
        check.passed ? 'PASS' : 'FAIL',
        formatMetric(check.currentMedianAbsLogError),
        formatMetric(check.candidateMedianAbsLogError),
        formatMetric(check.currentBiasLogError),
        formatMetric(check.candidateBiasLogError),
        formatPercent(check.currentInterval90Coverage),
        formatPercent(check.candidateInterval90Coverage),
        check.reason,
        '|',
      ].join(' | '));
    }
    lines.push('');
  } else {
    lines.push('No candidate was supplied. Run `npm run backtest -- --candidate-powerlaw latest` after `npm run refit:powerlaw` to compare refit coefficients.', '');
  }

  lines.push('## Model Config Snapshot', '', '```json', JSON.stringify(report.metadata.modelConfig, null, 2), '```', '');
  return `${lines.join('\n')}\n`;
}

function parseCandidateArg(args: string[]): string | null {
  const index = args.indexOf('--candidate-powerlaw');
  if (index < 0) return null;
  return args[index + 1] ?? 'latest';
}

function loadCandidateConfig(sourceArg: string): { source: string; coefficients: PowerLawFitCoefficients } {
  const source = sourceArg === 'latest' ? latestRefitReportPath() : sourceArg;
  const report = JSON.parse(readFileSync(source, 'utf8')) as { suggestedConfig?: PowerLawFitCoefficients };
  if (!report.suggestedConfig) {
    throw new Error(`Candidate report ${source} does not include suggestedConfig`);
  }
  return { source, coefficients: report.suggestedConfig };
}

function latestRefitReportPath(): string {
  const reports = readdirSync(REPORT_DIR)
    .filter(file => /^powerlaw-refit-.*\.json$/.test(file))
    .sort();
  const latest = reports[reports.length - 1];
  if (!latest) {
    throw new Error('No powerlaw-refit JSON reports found. Run npm run refit:powerlaw first.');
  }
  return join(REPORT_DIR, latest);
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

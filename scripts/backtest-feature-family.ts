import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { intervalCoverage, pinballLoss, pinballLosses } from '../src/lib/backtestMetrics';
import { getFeatureRows } from '../src/lib/features';
import {
  FEATURE_EXPERIMENT_HOLDOUTS,
  FEATURE_EXPERIMENT_HORIZONS,
  FEATURE_FAMILIES,
  MIN_CONTINUOUS_FEATURE_ROWS,
  buildResidualFeatureDataset,
  type FeatureFamily,
  type ResidualDatasetRow,
  type ResidualDatasetSummary,
} from '../src/lib/featureExperimentDataset';

type FamilyStatus = 'ready' | 'sample-starved';
type GateStatus = 'not-evaluated' | 'context-only' | 'watch' | 'eligible-for-manual-review';

interface MetricSummary {
  samples: number;
  medianAbsError: number | null;
  meanAbsError: number | null;
  bias: number | null;
  nll: number | null;
  pinballLoss: {
    q10: number | null;
    q50: number | null;
    q90: number | null;
    mean: number | null;
  };
  coverage80: number | null;
}

interface ResidualDistribution {
  q10: number;
  q50: number;
  q90: number;
  sigma: number | null;
}

interface ContinuousGateSummary {
  family: FeatureFamily;
  horizonDays: number;
  holdoutStart: string;
  trainRows: number;
  evalRows: number;
  status: GateStatus;
  reason: string;
  baseline: MetricSummary;
  model: MetricSummary;
  improvement: {
    meanPinballLoss: number | null;
    bootstrapLower95: number | null;
    bootstrapUpper95: number | null;
  };
}

interface FamilyReport {
  family: FeatureFamily;
  featureNames: string[];
  status: FamilyStatus;
  summaries: ResidualDatasetSummary[];
  continuousGates: ContinuousGateSummary[];
}

interface FeatureContinuousReport {
  metadata: {
    generatedAt: string;
    command: string;
    gitCommit: string;
    holdoutStarts: readonly string[];
    horizons: readonly number[];
    minimumContinuousRows: number;
    modelForm: string;
    primaryMetric: string;
    sparseDiagnosticsPolicy: string;
    holdoutPolicy: string;
    dataset: {
      btcRows: number;
      btcFirstDate: string;
      btcLastDate: string;
      featureRows: number;
      featureFirstDate: string;
      featureLastDate: string;
    };
  };
  families: FamilyReport[];
}

const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const TRAINING_START = '2012-01-01';
const RIDGE_LAMBDA = 1;
const BOOTSTRAP_ITERATIONS = 80;
const BOOTSTRAP_BLOCK_SIZE = 30;

function main(): void {
  const args = process.argv.slice(2);
  const selectedFamily = parseFamilyArg(args);
  const holdouts = parseHoldoutArg(args);
  const ohlcv = btcHistory as OHLCVData[];
  const featureRows = getFeatureRows();
  const families = selectedFamily === 'all'
    ? Object.keys(FEATURE_FAMILIES) as FeatureFamily[]
    : [selectedFamily];

  const familyReports = families.map(family => {
    const summaries = holdouts.flatMap(holdoutStart =>
      FEATURE_EXPERIMENT_HORIZONS.map(horizonDays =>
        buildResidualFeatureDataset({
          ohlcv,
          featureRows,
          family,
          horizonDays,
          holdoutStart,
        }).summary
      )
    );
    const continuousGates = holdouts.flatMap(holdoutStart =>
      FEATURE_EXPERIMENT_HORIZONS.map(horizonDays =>
        evaluateContinuousGate({ ohlcv, featureRows, family, horizonDays, holdoutStart })
      )
    );
    const maxFilteredRows = Math.max(...summaries.map(summary => summary.filteredRows), 0);
    return {
      family,
      featureNames: FEATURE_FAMILIES[family].featureNames,
      status: maxFilteredRows >= MIN_CONTINUOUS_FEATURE_ROWS ? 'ready' as const : 'sample-starved' as const,
      summaries,
      continuousGates,
    };
  });

  const report: FeatureContinuousReport = {
    metadata: {
      generatedAt: new Date().toISOString(),
      command: commandString(args),
      gitCommit: gitCommit(),
      holdoutStarts: holdouts,
      horizons: FEATURE_EXPERIMENT_HORIZONS,
      minimumContinuousRows: MIN_CONTINUOUS_FEATURE_ROWS,
      modelForm: `pre-holdout ridge regression on standardized family features, lambda=${RIDGE_LAMBDA}`,
      primaryMetric: 'mean pinball loss across q10/q50/q90 residual quantiles',
      sparseDiagnosticsPolicy: 'legacy event/state feature scripts are diagnostics only and are not promotion gates',
      holdoutPolicy: '2022-01-01 is the primary longer-window gate where history exists; 2025-01-01 is retained as a short recent diagnostic window.',
      dataset: {
        btcRows: ohlcv.length,
        btcFirstDate: ohlcv[0]?.date ?? '',
        btcLastDate: ohlcv.at(-1)?.date ?? '',
        featureRows: featureRows.length,
        featureFirstDate: featureRows[0]?.date ?? '',
        featureLastDate: featureRows.at(-1)?.date ?? '',
      },
    },
    families: familyReports,
  };

  writeReport(report);
}

function evaluateContinuousGate(input: {
  ohlcv: OHLCVData[];
  featureRows: ReturnType<typeof getFeatureRows>;
  family: FeatureFamily;
  horizonDays: number;
  holdoutStart: string;
}): ContinuousGateSummary {
  const train = buildResidualFeatureDataset({
    ...input,
    holdoutStart: input.holdoutStart,
    originStart: TRAINING_START,
    originEndExclusive: input.holdoutStart,
  }).rows;
  const evalRows = buildResidualFeatureDataset(input).rows;
  const empty = emptyMetrics();

  if (train.length < MIN_CONTINUOUS_FEATURE_ROWS || evalRows.length < MIN_CONTINUOUS_FEATURE_ROWS) {
    return {
      family: input.family,
      horizonDays: input.horizonDays,
      holdoutStart: input.holdoutStart,
      trainRows: train.length,
      evalRows: evalRows.length,
      status: 'not-evaluated',
      reason: `sample-starved train=${train.length} eval=${evalRows.length}; minimum=${MIN_CONTINUOUS_FEATURE_ROWS}`,
      baseline: empty,
      model: empty,
      improvement: { meanPinballLoss: null, bootstrapLower95: null, bootstrapUpper95: null },
    };
  }

  const normalizer = buildNormalizer(train, FEATURE_FAMILIES[input.family].featureNames);
  const coefficients = fitRidge(train, normalizer);
  const baselineResiduals = train.map(row => row.targetResidualLog);
  const modelResiduals = train.map(row => row.targetResidualLog - predictResidual(row, normalizer, coefficients));
  const baselineDistribution = summarizeResidualDistribution(baselineResiduals);
  const modelDistribution = summarizeResidualDistribution(modelResiduals);
  const baseline = scoreRows(evalRows, baselineDistribution, null, normalizer);
  const model = scoreRows(evalRows, modelDistribution, coefficients, normalizer);
  const lossDiffs = evalRows.map(row => {
    const baselineLoss = meanPinball(row.targetResidualLog, 0, baselineDistribution);
    const modelPrediction = predictResidual(row, normalizer, coefficients);
    const modelLoss = meanPinball(row.targetResidualLog, modelPrediction, modelDistribution);
    return baselineLoss - modelLoss;
  }).filter(Number.isFinite);
  const improvement = mean(lossDiffs);
  const interval = blockBootstrapMeanInterval(lossDiffs);
  const status = classifyGate(improvement, interval.lower95, baseline.coverage80, model.coverage80);

  return {
    family: input.family,
    horizonDays: input.horizonDays,
    holdoutStart: input.holdoutStart,
    trainRows: train.length,
    evalRows: evalRows.length,
    status: status.status,
    reason: status.reason,
    baseline,
    model,
    improvement: {
      meanPinballLoss: improvement,
      bootstrapLower95: interval.lower95,
      bootstrapUpper95: interval.upper95,
    },
  };
}

function parseFamilyArg(args: string[]): FeatureFamily | 'all' {
  const index = args.indexOf('--family');
  const value = index >= 0 ? args[index + 1] : 'all';
  if (value === 'all') return 'all';
  if (value && value in FEATURE_FAMILIES) return value as FeatureFamily;
  throw new Error(`Unknown feature family "${value}". Expected all or one of: ${Object.keys(FEATURE_FAMILIES).join(', ')}`);
}

function parseHoldoutArg(args: string[]): readonly string[] {
  const index = args.indexOf('--holdout');
  const value = index >= 0 ? args[index + 1] : null;
  return value ? [value] : FEATURE_EXPERIMENT_HOLDOUTS;
}

function writeReport(report: FeatureContinuousReport): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const familyPart = report.families.length === 1 ? report.families[0].family : 'all';
  const stamp = report.metadata.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `feature-continuous-${familyPart}-${stamp}.json`);
  const markdownPath = join(REPORT_DIR, `feature-continuous-${familyPart}-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));
  console.log(`Feature continuous report: ${jsonPath}`);
  console.log(`Feature continuous markdown: ${markdownPath}`);
  for (const family of report.families) {
    const best = Math.max(...family.summaries.map(summary => summary.filteredRows), 0);
    const eligible = family.continuousGates.filter(gate => gate.status === 'eligible-for-manual-review').length;
    console.log(`${family.family}: ${family.status} bestFilteredRows=${best} eligibleGates=${eligible}`);
  }
}

function renderMarkdown(report: FeatureContinuousReport): string {
  const lines = [
    '# Continuous Feature Residual Experiment Report',
    '',
    `Generated: ${report.metadata.generatedAt}`,
    `Command: \`${report.metadata.command}\``,
    `Git commit: \`${report.metadata.gitCommit}\``,
    `BTC rows: ${report.metadata.dataset.btcRows} (${report.metadata.dataset.btcFirstDate} to ${report.metadata.dataset.btcLastDate})`,
    `Feature rows: ${report.metadata.dataset.featureRows} (${report.metadata.dataset.featureFirstDate} to ${report.metadata.dataset.featureLastDate})`,
    `Holdout starts: ${report.metadata.holdoutStarts.join(', ')}`,
    `Horizons: ${report.metadata.horizons.join(', ')}`,
    `Model: ${report.metadata.modelForm}`,
    `Primary metric: ${report.metadata.primaryMetric}`,
    `Holdout policy: ${report.metadata.holdoutPolicy}`,
    '',
    '**Sparse-gate warning:** legacy rare-event/state outputs are diagnostics only and are not a promotion gate. Continuous residual gates below are the promotion evidence for PRD v2.9.',
    '',
  ];

  for (const family of report.families) {
    lines.push(`## ${family.family}`, '');
    lines.push(`Status: ${family.status}`);
    lines.push(`Features: ${family.featureNames.map(name => `\`${name}\``).join(', ')}`, '');
    lines.push('### Sample counts', '');
    lines.push('| Holdout | Horizon | Raw rows | Lag-safe rows | Filtered rows | Missing row | Future source date | Missing feature | Invalid forecast |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const summary of family.summaries) {
      lines.push([
        `| ${summary.holdoutStart}`,
        `${summary.horizonDays}d`,
        summary.rawRows,
        summary.lagSafeRows,
        summary.filteredRows,
        summary.skipped.missingFeatureRow,
        summary.skipped.futureSourceDate,
        summary.skipped.missingFeatureValue,
        summary.skipped.invalidForecast,
        '|',
      ].join(' | '));
    }
    lines.push('', '### Continuous gates', '');
    lines.push('| Holdout | Horizon | Train | Eval | Status | Pinball improvement | Lower95 | Model 80% cov | Reason |');
    lines.push('| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |');
    for (const gate of family.continuousGates) {
      lines.push([
        `| ${gate.holdoutStart}`,
        `${gate.horizonDays}d`,
        gate.trainRows,
        gate.evalRows,
        gate.status,
        formatNumber(gate.improvement.meanPinballLoss),
        formatNumber(gate.improvement.bootstrapLower95),
        formatNumber(gate.model.coverage80),
        gate.reason,
        '|',
      ].join(' | '));
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function buildNormalizer(rows: ResidualDatasetRow[], featureNames: string[]): { featureNames: string[]; means: number[]; stds: number[] } {
  const means = featureNames.map(name => mean(rows.map(row => row.features[name]).filter(Number.isFinite)) ?? 0);
  const stds = featureNames.map((name, index) => {
    const values = rows.map(row => row.features[name]).filter(Number.isFinite);
    const variance = mean(values.map(value => (value - means[index]) ** 2)) ?? 0;
    return variance > 0 ? Math.sqrt(variance) : 1;
  });
  return { featureNames, means, stds };
}

function fitRidge(rows: ResidualDatasetRow[], normalizer: ReturnType<typeof buildNormalizer>): number[] {
  const width = normalizer.featureNames.length + 1;
  const xtx = Array.from({ length: width }, () => Array.from({ length: width }, () => 0));
  const xty = Array.from({ length: width }, () => 0);

  for (const row of rows) {
    const x = rowVector(row, normalizer);
    for (let i = 0; i < width; i++) {
      xty[i] += x[i] * row.targetResidualLog;
      for (let j = 0; j < width; j++) xtx[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < width; i++) xtx[i][i] += RIDGE_LAMBDA;
  return solveLinearSystem(xtx, xty) ?? Array.from({ length: width }, () => 0);
}

function scoreRows(
  rows: ResidualDatasetRow[],
  residualDistribution: ResidualDistribution,
  coefficients: number[] | null,
  normalizer: ReturnType<typeof buildNormalizer>
): MetricSummary {
  const errors: number[] = [];
  const nlls: number[] = [];
  const q10Losses: number[] = [];
  const q50Losses: number[] = [];
  const q90Losses: number[] = [];
  const covered80: boolean[] = [];

  for (const row of rows) {
    const prediction = coefficients ? predictResidual(row, normalizer, coefficients) : 0;
    const quantiles = {
      0.1: prediction + residualDistribution.q10,
      0.5: prediction + residualDistribution.q50,
      0.9: prediction + residualDistribution.q90,
    };
    const losses = pinballLosses(row.targetResidualLog, quantiles);
    const error = prediction - row.targetResidualLog;
    errors.push(error);
    q10Losses.push(losses[0.1]);
    q50Losses.push(losses[0.5]);
    q90Losses.push(losses[0.9]);
    covered80.push(intervalCoverage(row.targetResidualLog, quantiles[0.1], quantiles[0.9]));
    if (residualDistribution.sigma && residualDistribution.sigma > 0) {
      nlls.push(normalNll(row.targetResidualLog, prediction, residualDistribution.sigma));
    }
  }

  return {
    samples: rows.length,
    medianAbsError: median(errors.map(Math.abs)),
    meanAbsError: mean(errors.map(Math.abs)),
    bias: mean(errors),
    nll: mean(nlls),
    pinballLoss: {
      q10: mean(q10Losses),
      q50: mean(q50Losses),
      q90: mean(q90Losses),
      mean: mean([...q10Losses, ...q50Losses, ...q90Losses]),
    },
    coverage80: covered80.length > 0 ? covered80.filter(Boolean).length / covered80.length : null,
  };
}

function rowVector(row: ResidualDatasetRow, normalizer: ReturnType<typeof buildNormalizer>): number[] {
  return [
    1,
    ...normalizer.featureNames.map((name, index) => (row.features[name] - normalizer.means[index]) / normalizer.stds[index]),
  ];
}

function predictResidual(row: ResidualDatasetRow, normalizer: ReturnType<typeof buildNormalizer>, coefficients: number[]): number {
  const x = rowVector(row, normalizer);
  return x.reduce((sum, value, index) => sum + value * (coefficients[index] ?? 0), 0);
}

function summarizeResidualDistribution(values: number[]): ResidualDistribution {
  return {
    q10: quantile(values, 0.1) ?? 0,
    q50: quantile(values, 0.5) ?? 0,
    q90: quantile(values, 0.9) ?? 0,
    sigma: standardDeviation(values),
  };
}

function meanPinball(actual: number, prediction: number, residualDistribution: ResidualDistribution): number {
  return mean([
    pinballLoss(actual, prediction + residualDistribution.q10, 0.1),
    pinballLoss(actual, prediction + residualDistribution.q50, 0.5),
    pinballLoss(actual, prediction + residualDistribution.q90, 0.9),
  ]) ?? 0;
}

function classifyGate(
  improvement: number | null,
  lower95: number | null,
  baselineCoverage80: number | null,
  modelCoverage80: number | null
): { status: GateStatus; reason: string } {
  if (improvement === null || lower95 === null) return { status: 'not-evaluated', reason: 'no finite improvement estimate' };
  const coverageOk = baselineCoverage80 === null || modelCoverage80 === null || modelCoverage80 >= baselineCoverage80 - 0.03;
  if (lower95 > 0 && coverageOk) return { status: 'eligible-for-manual-review', reason: 'pinball improvement lower95 is positive without material 80% coverage degradation' };
  if (improvement > 0 && coverageOk) return { status: 'watch', reason: 'mean pinball improves, but bootstrap lower95 is not positive' };
  return { status: 'context-only', reason: 'continuous residual gate did not beat the current residual-decay baseline' };
}

function blockBootstrapMeanInterval(values: number[]): { lower95: number | null; upper95: number | null } {
  if (values.length === 0) return { lower95: null, upper95: null };
  const means: number[] = [];
  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration++) {
    const sample: number[] = [];
    let cursor = seededIndex(iteration, values.length);
    while (sample.length < values.length) {
      for (let offset = 0; offset < BOOTSTRAP_BLOCK_SIZE && sample.length < values.length; offset++) {
        sample.push(values[(cursor + offset) % values.length]);
      }
      cursor = (cursor + seededIndex(iteration + sample.length + 17, values.length) + BOOTSTRAP_BLOCK_SIZE) % values.length;
    }
    means.push(mean(sample) ?? 0);
  }
  return { lower95: quantile(means, 0.025), upper95: quantile(means, 0.975) };
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    }
    if (Math.abs(augmented[pivot][col]) < 1e-12) return null;
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    const divisor = augmented[col][col];
    for (let j = col; j <= n; j++) augmented[col][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let j = col; j <= n; j++) augmented[row][j] -= factor * augmented[col][j];
    }
  }
  return augmented.map(row => row[n]);
}

function normalNll(actual: number, predicted: number, sigma: number): number {
  const variance = sigma * sigma;
  return 0.5 * Math.log(2 * Math.PI * variance) + ((actual - predicted) ** 2) / (2 * variance);
}

function emptyMetrics(): MetricSummary {
  return {
    samples: 0,
    medianAbsError: null,
    meanAbsError: null,
    bias: null,
    nll: null,
    pinballLoss: { q10: null, q50: null, q90: null, mean: null },
    coverage80: null,
  };
}

function seededIndex(seed: number, modulo: number): number {
  const x = Math.sin(seed * 99991) * 10000;
  return Math.floor((x - Math.floor(x)) * modulo);
}

function quantile(values: number[], q: number): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const index = (finite.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return finite[low];
  return finite[low] + (finite[high] - finite[low]) * (index - low);
}

function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

function mean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function standardDeviation(values: number[]): number | null {
  const avg = mean(values);
  if (avg === null) return null;
  const variance = mean(values.map(value => (value - avg) ** 2));
  return variance === null ? null : Math.sqrt(variance);
}

function formatNumber(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(5);
}

function commandString(args: string[]): string {
  return ['npm run backtest:features-continuous', args.length > 0 ? `-- ${args.join(' ')}` : ''].filter(Boolean).join(' ');
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

main();
